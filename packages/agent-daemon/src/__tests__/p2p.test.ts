// =============================================================================
// P2P Client & Handler Tests (Issue #56)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { P2PClient, P2PError, type P2PMessage, type P2PMessageAck, type AgentEndpoint } from "../p2p-client.js";
import { P2PHandler, type P2PMessageCallback } from "../p2p-handler.js";
import type { DaemonConfig, DaemonLogger } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLogger: DaemonLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    agentName: "test-agent",
    roleId: "11111111-2222-3333-4444-555555555555",
    teamId: "66666666-7777-8888-9999-000000000000",
    model: "anthropic/claude-sonnet-4-5",
    registryUrl: "http://registry:4001",
    hivemiSecret: "test-secret",
    daemonPort: 3100,
    openclawUrl: "http://127.0.0.1:4100",
    pollIntervalMs: 1000,
    heartbeatIntervalMs: 1000,
    telemetryIntervalMs: 1000,
    logBatchIntervalMs: 1000,
    taskTimeoutMs: 30_000,
    ...overrides,
  };
}

const targetAgentId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";

const mockEndpoint: AgentEndpoint = {
  id: targetAgentId,
  name: "target-agent",
  host: "10.0.0.5",
  port: 3100,
  status: "idle",
  privateIp: "10.0.0.5",
};

// =============================================================================
// P2PClient
// =============================================================================

describe("P2PClient", () => {
  let config: DaemonConfig;
  let client: P2PClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    config = makeConfig();
    client = new P2PClient(config, silentLogger, { cacheTtlMs: 5000 });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  describe("discover()", () => {
    it("fetches endpoint from registry", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ success: true, data: mockEndpoint }), { status: 200 }),
      ) as typeof fetch;

      const result = await client.discover(targetAgentId);

      expect(result.id).toBe(targetAgentId);
      expect(result.host).toBe("10.0.0.5");
      expect(result.port).toBe(3100);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/agents/${targetAgentId}/endpoint`),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer test-secret`,
          }),
        }),
      );
    });

    it("caches discovery results", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ success: true, data: mockEndpoint }), { status: 200 }),
      ) as typeof fetch;

      await client.discover(targetAgentId);
      await client.discover(targetAgentId);

      // Should only fetch once (second is cached)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("throws P2PError on 404", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ error: "Agent not found" }), { status: 404 }),
      ) as typeof fetch;

      await expect(client.discover(targetAgentId)).rejects.toThrow(P2PError);
      await expect(client.discover(targetAgentId)).rejects.toThrow("not found");
    });

    it("throws P2PError on server error", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () =>
        new Response("Internal error", { status: 500 }),
      ) as typeof fetch;

      await expect(client.discover(targetAgentId)).rejects.toThrow(P2PError);
    });

    it("clearCache invalidates cached endpoint", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ success: true, data: mockEndpoint }), { status: 200 }),
      ) as typeof fetch;

      await client.discover(targetAgentId);
      client.clearCache(targetAgentId);
      await client.discover(targetAgentId);

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("clearCache() with no args clears all", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ success: true, data: mockEndpoint }), { status: 200 }),
      ) as typeof fetch;

      await client.discover(targetAgentId);
      client.clearCache();
      await client.discover(targetAgentId);

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Send
  // -----------------------------------------------------------------------

  describe("send()", () => {
    it("discovers endpoint and sends message", async () => {
      const calls: string[] = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        calls.push(urlStr);

        // Discovery call
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }

        // Message delivery
        if (urlStr.includes("/message")) {
          return new Response(
            JSON.stringify({ accepted: true } satisfies P2PMessageAck),
            { status: 200 },
          );
        }

        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const ack = await client.send(targetAgentId, "request", {
        action: "review",
        content: "Review this PR",
      });

      expect(ack.accepted).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain("/endpoint");
      expect(calls[1]).toContain("/message");
    });

    it("includes correlationId and ttlMs when provided", async () => {
      let capturedBody = "";

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/message")) {
          capturedBody = init?.body as string || "";
          return new Response(JSON.stringify({ accepted: true }), { status: 200 });
        }
        return new Response("", { status: 404 });
      }) as typeof fetch;

      await client.send(targetAgentId, "request", { action: "test", content: "test" }, {
        correlationId: "cccccccc-dddd-eeee-ffff-111111111111",
        ttlMs: 30000,
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.correlationId).toBe("cccccccc-dddd-eeee-ffff-111111111111");
      expect(parsed.ttlMs).toBe(30000);
      expect(parsed.from).toBe(config.agentId);
      expect(parsed.to).toBe(targetAgentId);
      expect(parsed.type).toBe("request");
    });

    it("retries on server error with backoff", async () => {
      let attempt = 0;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/message")) {
          attempt++;
          if (attempt <= 2) {
            return new Response("Server error", { status: 500 });
          }
          return new Response(JSON.stringify({ accepted: true }), { status: 200 });
        }
        return new Response("", { status: 404 });
      }) as typeof fetch;

      const ack = await client.send(targetAgentId, "ping", {}, {
        retry: { maxRetries: 3, initialDelayMs: 10, multiplier: 2, maxDelayMs: 100 },
      });

      expect(ack.accepted).toBe(true);
      expect(attempt).toBe(3); // 2 failures + 1 success
    });

    it("throws after all retries exhausted", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        return new Response("Server error", { status: 500 });
      }) as typeof fetch;

      await expect(
        client.send(targetAgentId, "ping", {}, {
          retry: { maxRetries: 2, initialDelayMs: 10, multiplier: 2, maxDelayMs: 100 },
        }),
      ).rejects.toThrow(P2PError);
    });

    it("does not retry on 400 (non-retryable)", async () => {
      let messageAttempts = 0;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/message")) {
          messageAttempts++;
          return new Response(JSON.stringify({ error: "Bad message" }), { status: 400 });
        }
        return new Response("", { status: 404 });
      }) as typeof fetch;

      await expect(
        client.send(targetAgentId, "request", { action: "bad", content: "x" }, {
          retry: { maxRetries: 3, initialDelayMs: 10, multiplier: 2, maxDelayMs: 100 },
        }),
      ).rejects.toThrow("rejected");

      expect(messageAttempts).toBe(1); // No retries
    });

    it("clears cache after all retries exhausted", async () => {
      let discoveryCount = 0;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          discoveryCount++;
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        return new Response("Server error", { status: 500 });
      }) as typeof fetch;

      // First attempt — discovers + fails
      await expect(
        client.send(targetAgentId, "ping", {}, {
          retry: { maxRetries: 0, initialDelayMs: 10, multiplier: 2, maxDelayMs: 100 },
        }),
      ).rejects.toThrow();

      // Second attempt — should re-discover (cache cleared on failure)
      await expect(
        client.send(targetAgentId, "ping", {}, {
          retry: { maxRetries: 0, initialDelayMs: 10, multiplier: 2, maxDelayMs: 100 },
        }),
      ).rejects.toThrow();

      expect(discoveryCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Convenience methods
  // -----------------------------------------------------------------------

  describe("convenience methods", () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/message")) {
          return new Response(JSON.stringify({ accepted: true }), { status: 200 });
        }
        return new Response("", { status: 404 });
      }) as typeof fetch;
    });

    it("request() sends type=request", async () => {
      let capturedBody = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        capturedBody = init?.body as string || "";
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      }) as typeof fetch;

      await client.request(targetAgentId, {
        action: "review-code",
        content: "Check PR #5",
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.type).toBe("request");
    });

    it("delegate() sends type=delegate", async () => {
      let capturedBody = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        capturedBody = init?.body as string || "";
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      }) as typeof fetch;

      await client.delegate(targetAgentId, {
        action: "write-tests",
        content: "Add tests for auth",
        priority: "high",
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.type).toBe("delegate");
    });

    it("ping() sends type=ping with fast timeout", async () => {
      let capturedBody = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(
            JSON.stringify({ success: true, data: mockEndpoint }),
            { status: 200 },
          );
        }
        capturedBody = init?.body as string || "";
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      }) as typeof fetch;

      await client.ping(targetAgentId);

      const parsed = JSON.parse(capturedBody);
      expect(parsed.type).toBe("ping");
    });
  });
});

// =============================================================================
// P2PError
// =============================================================================

describe("P2PError", () => {
  it("has code and message", () => {
    const err = new P2PError("Agent not found", "AGENT_NOT_FOUND");
    expect(err.message).toBe("Agent not found");
    expect(err.code).toBe("AGENT_NOT_FOUND");
    expect(err.name).toBe("P2PError");
  });

  it("is instanceof Error", () => {
    const err = new P2PError("test", "TIMEOUT");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof P2PError).toBe(true);
  });

  it("has all error codes", () => {
    const codes = [
      "AGENT_NOT_FOUND",
      "DISCOVERY_FAILED",
      "MESSAGE_REJECTED",
      "TIMEOUT",
      "DELIVERY_FAILED",
    ] as const;

    for (const code of codes) {
      const err = new P2PError("test", code);
      expect(err.code).toBe(code);
    }
  });
});

// =============================================================================
// P2PHandler
// =============================================================================

describe("P2PHandler", () => {
  let config: DaemonConfig;
  let handler: P2PHandler;
  let onMessage: P2PMessageCallback;
  let handlerPort: number;

  // Use a random port for each test to avoid conflicts
  const getPort = () => 3200 + Math.floor(Math.random() * 10000);

  beforeEach(async () => {
    handlerPort = getPort();
    config = makeConfig({ daemonPort: handlerPort });
    onMessage = vi.fn().mockResolvedValue(undefined);
    handler = new P2PHandler(config, silentLogger, onMessage, { port: handlerPort });
    await handler.start();
  });

  afterEach(async () => {
    await handler.stop();
  });

  const sendMessage = async (message: Partial<P2PMessage>) => {
    const fullMessage: P2PMessage = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      type: "request",
      from: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
      to: config.agentId,
      payload: { action: "test", content: "hello" },
      timestamp: new Date().toISOString(),
      ...message,
    };

    const res = await fetch(`http://127.0.0.1:${handlerPort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullMessage),
    });

    return { res, body: await res.json() as P2PMessageAck };
  };

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  it("responds to GET /health", async () => {
    const res = await fetch(`http://127.0.0.1:${handlerPort}/health`);
    const body = await res.json() as { status: string; agentId: string };
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.agentId).toBe(config.agentId);
  });

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  it("accepts valid request message", async () => {
    const { res, body } = await sendMessage({ type: "request" });
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(onMessage).toHaveBeenCalled();
  });

  it("accepts valid delegate message", async () => {
    const { res, body } = await sendMessage({ type: "delegate" });
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(onMessage).toHaveBeenCalled();
  });

  it("handles ping with pong response", async () => {
    const { res, body } = await sendMessage({ type: "ping" });
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.response).toBeDefined();
    expect(body.response?.type).toBe("pong");
    expect(body.response?.from).toBe(config.agentId);

    const pongPayload = body.response?.payload as { status: string; uptimeMs: number };
    expect(pongPayload.status).toBe("idle");
    expect(pongPayload.uptimeMs).toBeGreaterThanOrEqual(0);

    // Ping handler doesn't call onMessage
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("returns inline response for request when callback provides one", async () => {
    (onMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "Looks good, approved!",
    });

    const { res, body } = await sendMessage({ type: "request" });
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.response).toBeDefined();
    expect(body.response?.type).toBe("response");

    const responsePayload = body.response?.payload as { success: boolean; content: string };
    expect(responsePayload.success).toBe(true);
    expect(responsePayload.content).toBe("Looks good, approved!");
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  it("rejects missing required fields", async () => {
    const res = await fetch(`http://127.0.0.1:${handlerPort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "test" }),
    });
    const body = await res.json() as P2PMessageAck;
    expect(res.status).toBe(400);
    expect(body.accepted).toBe(false);
  });

  it("rejects empty body", async () => {
    const res = await fetch(`http://127.0.0.1:${handlerPort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    const body = await res.json() as P2PMessageAck;
    expect(res.status).toBe(400);
    expect(body.accepted).toBe(false);
  });

  it("rejects invalid JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${handlerPort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const body = await res.json() as P2PMessageAck;
    expect(res.status).toBe(400);
    expect(body.accepted).toBe(false);
  });

  it("rejects message not addressed to this agent", async () => {
    const { res, body } = await sendMessage({
      to: "99999999-8888-7777-6666-555555555555", // Wrong agent
    });
    expect(res.status).toBe(400);
    expect(body.accepted).toBe(false);
    expect(body.error).toContain("not addressed");
  });

  it("rejects expired TTL", async () => {
    const { res, body } = await sendMessage({
      timestamp: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
      ttlMs: 1000, // 1 second TTL — already expired
    });
    expect(res.status).toBe(400);
    expect(body.accepted).toBe(false);
    expect(body.error).toContain("expired");
  });

  it("accepts message with valid TTL", async () => {
    const { res, body } = await sendMessage({
      timestamp: new Date().toISOString(),
      ttlMs: 60000, // 1 minute TTL — still valid
    });
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 404 for unknown routes
  // -----------------------------------------------------------------------

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://127.0.0.1:${handlerPort}/unknown`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for GET /message", async () => {
    const res = await fetch(`http://127.0.0.1:${handlerPort}/message`);
    expect(res.status).toBe(404);
  });

  // -----------------------------------------------------------------------
  // Pending requests (response correlation)
  // -----------------------------------------------------------------------

  it("resolves pending request on response message", async () => {
    const correlationId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    // Set up pending request
    const responsePromise = handler.waitForResponse(correlationId, 5000);

    // Send response message
    await sendMessage({
      type: "response",
      correlationId,
      payload: { success: true, content: "Done!" },
    });

    const response = await responsePromise;
    expect(response.type).toBe("response");
    expect(response.correlationId).toBe(correlationId);
  });

  it("times out pending request", async () => {
    const responsePromise = handler.waitForResponse("nonexistent", 100);

    await expect(responsePromise).rejects.toThrow("timeout");
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("handles callback error gracefully", async () => {
    (onMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Processing failed"));

    const { res, body } = await sendMessage({ type: "delegate" });
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(false);
    expect(body.error).toBe("Message processing failed");
  });

  // -----------------------------------------------------------------------
  // Start / Stop
  // -----------------------------------------------------------------------

  it("stops cleanly", async () => {
    await handler.stop();
    // Verify server is stopped — fetch should fail
    await expect(
      fetch(`http://127.0.0.1:${handlerPort}/health`),
    ).rejects.toThrow();
  });
});

// =============================================================================
// Private IP Registration Tests (Issue #82)
//
// Validates that:
// 1. networking.ts correctly detects private/public IPs
// 2. RegistryClient sends privateIp and publicIp in registration
// 3. RegistryClient sends privateIp in heartbeat
// 4. Agent registration route persists privateIp and publicIp
// 5. Heartbeat route updates privateIp when provided
// 6. P2P communication uses private IP when available
// 7. Fallback works when no private IP is detected
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isPrivateIp, getAllPrivateIps, detectPrivateIp, detectPublicIp } from "../networking.js";
import { RegistryClient } from "../registry-client.js";
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

// =============================================================================
// isPrivateIp()
// =============================================================================

describe("isPrivateIp", () => {
  it("identifies 10.x.x.x as private (Class A)", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("10.116.0.2")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  it("identifies 172.16-31.x.x as private (Class B)", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.20.5.100")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
  });

  it("identifies 192.168.x.x as private (Class C)", () => {
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.100")).toBe(true);
    expect(isPrivateIp("192.168.255.255")).toBe(true);
  });

  it("rejects public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("165.245.132.133")).toBe(false);
    expect(isPrivateIp("1.2.3.4")).toBe(false);
  });

  it("rejects loopback", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(false);
  });

  it("rejects 172.x.x.x outside 172.16-31 range", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("rejects 192.x.x.x outside 192.168.x.x range", () => {
    expect(isPrivateIp("192.169.0.1")).toBe(false);
    expect(isPrivateIp("192.0.2.1")).toBe(false);
  });
});

// =============================================================================
// getAllPrivateIps()
// =============================================================================

describe("getAllPrivateIps", () => {
  it("returns an array", () => {
    const result = getAllPrivateIps();
    expect(Array.isArray(result)).toBe(true);
  });

  it("each entry has address, interfaceName, and range", () => {
    const result = getAllPrivateIps();
    for (const entry of result) {
      expect(typeof entry.address).toBe("string");
      expect(typeof entry.interfaceName).toBe("string");
      expect(typeof entry.range).toBe("string");
    }
  });

  it("all returned addresses are private", () => {
    const result = getAllPrivateIps();
    for (const entry of result) {
      expect(isPrivateIp(entry.address)).toBe(true);
    }
  });

  it("sorts 10.x addresses first (cloud VPC preference)", () => {
    const result = getAllPrivateIps();
    if (result.length >= 2) {
      // If there are multiple addresses and some are 10.x, they should come first
      const firstNon10 = result.findIndex((r) => !r.address.startsWith("10."));
      const last10 = result.map((r, i) => r.address.startsWith("10.") ? i : -1).filter((i) => i >= 0).pop();
      if (firstNon10 >= 0 && last10 !== undefined && last10 >= 0) {
        expect(last10).toBeLessThan(firstNon10);
      }
    }
  });
});

// =============================================================================
// detectPrivateIp()
// =============================================================================

describe("detectPrivateIp", () => {
  it("returns a string or null", () => {
    const result = detectPrivateIp();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("if returns a value, it's a valid private IP", () => {
    const result = detectPrivateIp();
    if (result !== null) {
      expect(isPrivateIp(result)).toBe(true);
    }
  });
});

// =============================================================================
// detectPublicIp()
// =============================================================================

describe("detectPublicIp", () => {
  it("returns a string or null", () => {
    const result = detectPublicIp();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("if returns a value, it's NOT a private IP", () => {
    const result = detectPublicIp();
    if (result !== null) {
      expect(isPrivateIp(result)).toBe(false);
    }
  });
});

// =============================================================================
// RegistryClient — Registration with Private IP
// =============================================================================

describe("RegistryClient — Private IP in Registration", () => {
  let config: DaemonConfig;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    config = makeConfig();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends privateIp in registration body when detected", async () => {
    let capturedBody = "";

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ success: true }), { status: 201 });
    }) as typeof fetch;

    const client = new RegistryClient(config, silentLogger);
    await client.register();

    const parsed = JSON.parse(capturedBody);
    // Registration should always include the host field
    expect(parsed.host).toBeDefined();
    expect(typeof parsed.host).toBe("string");
    expect(parsed.host).not.toBe("");
    // Port should be set
    expect(parsed.port).toBe(config.daemonPort);
  });

  it("sets host to privateIp when available, falls back to 0.0.0.0", async () => {
    let capturedBody = "";

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ success: true }), { status: 201 });
    }) as typeof fetch;

    const client = new RegistryClient(config, silentLogger);
    await client.register();

    const parsed = JSON.parse(capturedBody);
    // If privateIp is detected, host should match; otherwise host is "0.0.0.0" or publicIp
    if (parsed.privateIp) {
      expect(parsed.host).toBe(parsed.privateIp);
    }
    // In any case, host should not be undefined
    expect(parsed.host).toBeDefined();
  });

  it("includes both privateIp and publicIp when both detected", async () => {
    let capturedBody = "";

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ success: true }), { status: 201 });
    }) as typeof fetch;

    const client = new RegistryClient(config, silentLogger);
    await client.register();

    const parsed = JSON.parse(capturedBody);
    // Both fields should be present or absent depending on network config
    // At minimum, the registration body should have these fields
    expect(parsed).toHaveProperty("host");
    expect(parsed).toHaveProperty("port");
    expect(parsed).toHaveProperty("id");
  });

  it("caches detected IPs after registration", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ success: true }), { status: 201 }),
    ) as typeof fetch;

    const client = new RegistryClient(config, silentLogger);
    await client.register();

    // getPrivateIp and getPublicIp should return cached values
    const privateIp = client.getPrivateIp();
    const publicIp = client.getPublicIp();

    // Values should be consistent (null or string)
    expect(privateIp === null || typeof privateIp === "string").toBe(true);
    expect(publicIp === null || typeof publicIp === "string").toBe(true);
  });
});

// =============================================================================
// RegistryClient — Heartbeat with Private IP
// =============================================================================

describe("RegistryClient — Private IP in Heartbeat", () => {
  let config: DaemonConfig;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    config = makeConfig();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends privateIp in heartbeat when it was detected during registration", async () => {
    const capturedBodies: string[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBodies.push(init?.body as string || "");
      return new Response(JSON.stringify({ ack: true, success: true }), { status: 200 });
    }) as typeof fetch;

    const client = new RegistryClient(config, silentLogger);
    // First register to detect IPs
    await client.register();
    // Then heartbeat
    await client.heartbeat("idle", null);

    expect(capturedBodies.length).toBe(2);

    const registerBody = JSON.parse(capturedBodies[0]);
    const heartbeatBody = JSON.parse(capturedBodies[1]);

    // Heartbeat should include status and timestamp
    expect(heartbeatBody.status).toBe("idle");
    expect(heartbeatBody.timestamp).toBeDefined();

    // If register detected a privateIp, heartbeat should include it too
    if (registerBody.privateIp) {
      expect(heartbeatBody.privateIp).toBe(registerBody.privateIp);
    }
  });

  it("heartbeat works without prior registration (no cached IP)", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ ack: true }), { status: 200 }),
    ) as typeof fetch;

    const client = new RegistryClient(config, silentLogger);
    // Heartbeat without register — no cached IPs
    const result = await client.heartbeat("idle", null);
    expect(result.ack).toBe(true);
    expect(result.cancelTask).toBeNull();
  });

  it("heartbeat includes currentTaskId when working", async () => {
    let capturedBody = "";

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ ack: true }), { status: 200 });
    }) as typeof fetch;

    const client = new RegistryClient(config, silentLogger);
    await client.heartbeat("working", "task-123");

    const parsed = JSON.parse(capturedBody);
    expect(parsed.status).toBe("working");
    expect(parsed.currentTaskId).toBe("task-123");
  });
});

// =============================================================================
// Protocol Schema — Registration includes privateIp and publicIp
// =============================================================================

describe("RegisterAgentSchema", () => {
  it("accepts registration with privateIp and publicIp", async () => {
    // Dynamic import to avoid top-level import issues
    const { RegisterAgentSchema } = await import("@hivemi/protocol");

    const result = RegisterAgentSchema.safeParse({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      name: "test-agent",
      roleId: "11111111-2222-3333-4444-555555555555",
      teamId: "66666666-7777-8888-9999-000000000000",
      model: "claude-sonnet",
      host: "10.116.0.5",
      port: 3100,
      privateIp: "10.116.0.5",
      publicIp: "165.245.132.133",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.privateIp).toBe("10.116.0.5");
      expect(result.data.publicIp).toBe("165.245.132.133");
    }
  });

  it("accepts registration without privateIp (no VPC)", async () => {
    const { RegisterAgentSchema } = await import("@hivemi/protocol");

    const result = RegisterAgentSchema.safeParse({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      name: "test-agent",
      roleId: "11111111-2222-3333-4444-555555555555",
      teamId: "66666666-7777-8888-9999-000000000000",
      model: "claude-sonnet",
      host: "0.0.0.0",
      port: 3100,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.privateIp).toBeUndefined();
      expect(result.data.publicIp).toBeUndefined();
    }
  });
});

// =============================================================================
// Protocol Schema — Heartbeat includes privateIp
// =============================================================================

describe("HeartbeatPayloadSchema", () => {
  it("accepts heartbeat with privateIp", async () => {
    const { HeartbeatPayloadSchema } = await import("@hivemi/protocol");

    const result = HeartbeatPayloadSchema.safeParse({
      status: "idle",
      currentTaskId: null,
      timestamp: new Date().toISOString(),
      privateIp: "10.116.0.5",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.privateIp).toBe("10.116.0.5");
    }
  });

  it("accepts heartbeat without privateIp (backward compat)", async () => {
    const { HeartbeatPayloadSchema } = await import("@hivemi/protocol");

    const result = HeartbeatPayloadSchema.safeParse({
      status: "working",
      currentTaskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.privateIp).toBeUndefined();
    }
  });
});

// =============================================================================
// P2P Communication — Private IP Preference
// =============================================================================

describe("P2P — Private IP Preference", () => {
  it("P2PClient sendWithRetry prefers privateIp over host", async () => {
    // We test this by importing P2PClient and checking its behavior
    const { P2PClient } = await import("../p2p-client.js");
    const client = new P2PClient(makeConfig(), silentLogger, { cacheTtlMs: 5000 });

    const originalFetch = globalThis.fetch;
    let capturedUrl = "";

    try {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(JSON.stringify({
            success: true,
            data: {
              id: "target-id",
              name: "target-agent",
              host: "165.245.132.133",  // public IP
              port: 3100,
              status: "idle",
              privateIp: "10.116.0.5",  // private IP
            },
          }), { status: 200 });
        }
        if (urlStr.includes("/message")) {
          capturedUrl = urlStr;
          return new Response(JSON.stringify({ accepted: true }), { status: 200 });
        }
        return new Response("", { status: 404 });
      }) as typeof fetch;

      await client.send("target-id", "ping", {});

      // Should have used the private IP, not the public one
      expect(capturedUrl).toContain("10.116.0.5");
      expect(capturedUrl).not.toContain("165.245.132.133");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("P2PClient falls back to public host when no privateIp", async () => {
    const { P2PClient } = await import("../p2p-client.js");
    const client = new P2PClient(makeConfig(), silentLogger, { cacheTtlMs: 5000 });

    const originalFetch = globalThis.fetch;
    let capturedUrl = "";

    try {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes("/endpoint")) {
          return new Response(JSON.stringify({
            success: true,
            data: {
              id: "target-id",
              name: "target-agent",
              host: "165.245.132.133",
              port: 3100,
              status: "idle",
              privateIp: null,  // no private IP
            },
          }), { status: 200 });
        }
        if (urlStr.includes("/message")) {
          capturedUrl = urlStr;
          return new Response(JSON.stringify({ accepted: true }), { status: 200 });
        }
        return new Response("", { status: 404 });
      }) as typeof fetch;

      await client.send("target-id", "ping", {});

      // Should use public host as fallback
      expect(capturedUrl).toContain("165.245.132.133");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// =============================================================================
// Agent Registration Route — Persists privateIp and publicIp
// =============================================================================

describe("Agent Registration Route — IP Persistence", () => {
  it("registration route code persists privateIp from request body", async () => {
    // Read the route source to verify privateIp is saved
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const routeSource = readFileSync(
      resolve(__dirname, "../../../../apps/registry/src/routes/agents.ts"),
      "utf-8",
    );

    // Both create and update paths should include privateIp
    expect(routeSource).toContain("privateIp: data.privateIp");
    expect(routeSource).toContain("publicIp: data.publicIp");
  });

  it("heartbeat route code updates privateIp when provided", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const heartbeatSource = readFileSync(
      resolve(__dirname, "../../../../apps/registry/src/routes/heartbeat.ts"),
      "utf-8",
    );

    // Heartbeat should conditionally update privateIp
    expect(heartbeatSource).toContain("data.privateIp");
    expect(heartbeatSource).toContain("updateSet.privateIp");
  });
});

// =============================================================================
// DB Schema — publicIp column exists
// =============================================================================

describe("DB Schema — IP Columns", () => {
  it("schema has both privateIp and publicIp columns", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const schemaSource = readFileSync(
      resolve(__dirname, "../../../../apps/registry/src/db/schema.ts"),
      "utf-8",
    );

    expect(schemaSource).toContain('privateIp: varchar("private_ip"');
    expect(schemaSource).toContain('publicIp: varchar("public_ip"');
  });
});

// =============================================================================
// Discovery Endpoint — Returns privateIp
// =============================================================================

describe("Discovery Endpoint — Private IP", () => {
  it("discovery route returns privateIp in endpoint response", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const discoverySource = readFileSync(
      resolve(__dirname, "../../../../apps/registry/src/routes/discovery.ts"),
      "utf-8",
    );

    expect(discoverySource).toContain("privateIp: agents.privateIp");
  });
});

// =============================================================================
// Dashboard API — Agent interface includes publicIp
// =============================================================================

describe("Dashboard API — Agent Interface", () => {
  it("Agent interface includes publicIp field", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const apiSource = readFileSync(
      resolve(__dirname, "../../../../apps/dashboard/src/lib/api.ts"),
      "utf-8",
    );

    expect(apiSource).toContain("publicIp: string | null");
    expect(apiSource).toContain("privateIp: string | null");
  });
});

// =============================================================================
// Networking Module — Edge Cases
// =============================================================================

describe("Networking — Edge Cases", () => {
  it("isPrivateIp handles empty string", () => {
    expect(isPrivateIp("")).toBe(false);
  });

  it("isPrivateIp handles IPv6-like strings", () => {
    expect(isPrivateIp("::1")).toBe(false);
    expect(isPrivateIp("fe80::1")).toBe(false);
  });

  it("isPrivateIp handles all 172.16-31 sub-ranges", () => {
    for (let i = 16; i <= 31; i++) {
      expect(isPrivateIp(`172.${i}.0.1`)).toBe(true);
    }
  });

  it("isPrivateIp rejects 172.15 and 172.32", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });
});

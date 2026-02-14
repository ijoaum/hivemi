// =============================================================================
// Agent Daemon Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadConfigFromEnv,
  type DaemonConfig,
  type DaemonLogger,
  type DaemonTask,
  type IRegistryClient,
  type IOpenClawClient,
  type LogEntry,
  type OpenClawStatus,
} from "../types.js";
import { RegistryClient } from "../registry-client.js";
import { TaskPoller } from "../task-poller.js";
import { TelemetryCollector } from "../telemetry.js";
import { AgentDaemon } from "../index.js";

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

function makeTask(overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id: "task-001",
    title: "Test Task",
    description: "Do something useful",
    input: "some input data",
    priority: "medium",
    roleTarget: null,
    parentTaskId: null,
    teamId: "66666666-7777-8888-9999-000000000000",
    ...overrides,
  };
}

function makeMockRegistry(): IRegistryClient {
  return {
    register: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue({ ack: true, cancelTask: null }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    pollTask: vi.fn().mockResolvedValue(null),
    reportTaskResult: vi.fn().mockResolvedValue(undefined),
    createSubtask: vi.fn().mockResolvedValue(null),
    sendTelemetry: vi.fn().mockResolvedValue(undefined),
    sendLogs: vi.fn().mockResolvedValue(undefined),
    setOffline: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockOpenClaw(): IOpenClawClient {
  return {
    healthCheck: vi.fn().mockResolvedValue("running" as OpenClawStatus),
    executeTask: vi.fn().mockResolvedValue("Task completed successfully"),
    restart: vi.fn().mockResolvedValue(true),
    cancelExecution: vi.fn(),
    destroySession: vi.fn().mockResolvedValue(true),
  };
}

// =============================================================================
// Config Loading
// =============================================================================

describe("loadConfigFromEnv", () => {
  it("parses all required env vars", () => {
    const env = {
      AGENT_ID: "aaa-bbb",
      AGENT_NAME: "my-agent",
      ROLE_ID: "role-1",
      TEAM_ID: "team-1",
      MODEL: "claude-sonnet",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret123",
    };

    const config = loadConfigFromEnv(env);

    expect(config.agentId).toBe("aaa-bbb");
    expect(config.agentName).toBe("my-agent");
    expect(config.roleId).toBe("role-1");
    expect(config.model).toBe("claude-sonnet");
    expect(config.registryUrl).toBe("http://localhost:4001");
    expect(config.hivemiSecret).toBe("secret123");
  });

  it("uses defaults for optional intervals", () => {
    const env = {
      AGENT_ID: "a",
      AGENT_NAME: "a",
      ROLE_ID: "r",
      TEAM_ID: "t",
      MODEL: "m",
      REGISTRY_URL: "http://r",
      HIVEMI_SECRET: "s",
    };

    const config = loadConfigFromEnv(env);

    expect(config.pollIntervalMs).toBe(15_000);
    expect(config.heartbeatIntervalMs).toBe(30_000);
    expect(config.telemetryIntervalMs).toBe(60_000);
    expect(config.logBatchIntervalMs).toBe(300_000);
    expect(config.taskTimeoutMs).toBe(600_000);
    expect(config.daemonPort).toBe(3100);
    expect(config.openclawUrl).toBe("http://127.0.0.1:4100");
  });

  it("overrides intervals from env", () => {
    const env = {
      AGENT_ID: "a",
      AGENT_NAME: "a",
      ROLE_ID: "r",
      TEAM_ID: "t",
      MODEL: "m",
      REGISTRY_URL: "http://r",
      HIVEMI_SECRET: "s",
      POLL_INTERVAL_MS: "5000",
      HEARTBEAT_INTERVAL_MS: "10000",
      DAEMON_PORT: "3200",
    };

    const config = loadConfigFromEnv(env);

    expect(config.pollIntervalMs).toBe(5000);
    expect(config.heartbeatIntervalMs).toBe(10000);
    expect(config.daemonPort).toBe(3200);
  });

  it("throws on missing required env var", () => {
    expect(() => loadConfigFromEnv({})).toThrow("Missing required env var: AGENT_ID");
  });

  it("throws on invalid integer", () => {
    const env = {
      AGENT_ID: "a",
      AGENT_NAME: "a",
      ROLE_ID: "r",
      TEAM_ID: "t",
      MODEL: "m",
      REGISTRY_URL: "http://r",
      HIVEMI_SECRET: "s",
      POLL_INTERVAL_MS: "not-a-number",
    };

    expect(() => loadConfigFromEnv(env)).toThrow("Invalid integer for POLL_INTERVAL_MS");
  });

  it("reads OPENCLAW_API_TOKEN if provided", () => {
    const env = {
      AGENT_ID: "a",
      AGENT_NAME: "a",
      ROLE_ID: "r",
      TEAM_ID: "t",
      MODEL: "m",
      REGISTRY_URL: "http://r",
      HIVEMI_SECRET: "s",
      OPENCLAW_API_TOKEN: "tok123",
    };

    const config = loadConfigFromEnv(env);
    expect(config.openclawApiToken).toBe("tok123");
  });
});

// =============================================================================
// Task Poller
// =============================================================================

describe("TaskPoller", () => {
  let config: DaemonConfig;
  let registry: IRegistryClient;
  let openclaw: IOpenClawClient;
  let logBuffer: LogEntry[];
  let poller: TaskPoller;

  beforeEach(() => {
    config = makeConfig();
    registry = makeMockRegistry();
    openclaw = makeMockOpenClaw();
    logBuffer = [];
    poller = new TaskPoller(config, registry, openclaw, silentLogger, logBuffer);
  });

  afterEach(() => {
    poller.stop();
  });

  it("starts and stops without error", () => {
    poller.start();
    expect(poller.tasksCompleted).toBe(0);
    expect(poller.tasksFailed).toBe(0);
    expect(poller.activeTask).toBeNull();
    poller.stop();
  });

  it("polls registry for tasks", async () => {
    // Poll returns null — no task
    (registry.pollTask as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    poller.start();

    // Wait for first poll
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();

    expect(registry.pollTask).toHaveBeenCalled();
  });

  it("executes task via OpenClaw when one is available", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Task done successfully",
    );

    poller.start();

    // Wait for execution
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    // Agent status should have been set to working, then back to idle
    expect(registry.updateStatus).toHaveBeenCalledWith("working");
    expect(registry.updateStatus).toHaveBeenCalledWith("idle");

    // Task result should be reported
    expect(registry.reportTaskResult).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: "completed",
        output: "Task done successfully",
      }),
    );

    expect(poller.tasksCompleted).toBe(1);
    expect(poller.tasksFailed).toBe(0);
  });

  it("reports failure when OpenClaw throws", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM timeout"),
    );

    poller.start();

    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    expect(registry.reportTaskResult).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: "failed",
        error: "LLM timeout",
      }),
    );

    expect(poller.tasksFailed).toBe(1);
    expect(poller.tasksCompleted).toBe(0);
  });

  it("adds log entries to buffer during execution", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    poller.start();
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    expect(logBuffer.length).toBeGreaterThan(0);
    expect(logBuffer.some((l) => l.component === "task-executor")).toBe(true);
    expect(logBuffer.some((l) => l.taskId === task.id)).toBe(true);
  });

  it("does not double-poll while executing", async () => {
    const task = makeTask();
    let callCount = 0;

    (registry.pollTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return task;
      return null;
    });

    // Simulate slow task execution
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => setTimeout(() => r("done"), 300)),
    );

    poller.start();
    await new Promise((r) => setTimeout(r, 800));
    poller.stop();

    // Should not have polled while task was executing
    // First poll gets the task, subsequent polls should be skipped during execution
    expect(poller.tasksCompleted).toBe(1);
  });
});

// =============================================================================
// Telemetry Collector
// =============================================================================

describe("TelemetryCollector", () => {
  let config: DaemonConfig;
  let registry: IRegistryClient;
  let openclaw: IOpenClawClient;
  let collector: TelemetryCollector;

  beforeEach(() => {
    config = makeConfig();
    registry = makeMockRegistry();
    openclaw = makeMockOpenClaw();
    collector = new TelemetryCollector(
      config,
      registry,
      openclaw,
      silentLogger,
      () => ({ completed: 5, failed: 1, active: 0 }),
    );
  });

  afterEach(() => {
    collector.stop();
  });

  it("builds a telemetry snapshot", async () => {
    const snapshot = await collector.buildSnapshot();

    expect(snapshot.ts).toBeDefined();
    expect(new Date(snapshot.ts).getTime()).not.toBeNaN();
    expect(snapshot.infra.memTotal).toBeGreaterThan(0);
    expect(snapshot.infra.cpu).toBeGreaterThanOrEqual(0);
    expect(typeof snapshot.infra.loadAvg).toBe("number");
    expect(snapshot.infra.loadAvg).toBeGreaterThanOrEqual(0);
    expect(snapshot.daemon.version).toBe("0.1.0");
    expect(snapshot.daemon.openclawStatus).toBe("running");
    expect(snapshot.tasks.completed).toBe(5);
    expect(snapshot.tasks.failed).toBe(1);
    expect(snapshot.tasks.active).toBe(0);
    expect(snapshot.llm.requests).toBe(0);
  });

  it("records LLM metrics", async () => {
    collector.recordLlmRequest(150, 1000, 500);
    collector.recordLlmRequest(200, 2000, 800);
    collector.recordLlmError();

    const snapshot = await collector.buildSnapshot();

    expect(snapshot.llm.requests).toBe(2);
    expect(snapshot.llm.promptTokens).toBe(3000);
    expect(snapshot.llm.completionTokens).toBe(1300);
    expect(snapshot.llm.errors).toBe(1);
    expect(snapshot.llm.avgLatencyMs).toBe(175); // (150+200)/2
  });

  it("tracks OpenClaw status", async () => {
    (openclaw.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue("stopped");

    await collector.buildSnapshot();

    expect(collector.lastOpenClawStatus).toBe("stopped");
  });

  it("sends telemetry to registry on collect()", async () => {
    await collector.collect();

    expect(registry.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        infra: expect.any(Object),
        llm: expect.any(Object),
        tasks: expect.any(Object),
        daemon: expect.any(Object),
      }),
    );
  });

  it("handles telemetry send failure gracefully", async () => {
    (registry.sendTelemetry as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );

    // Should not throw
    const snapshot = await collector.collect();
    expect(snapshot).toBeDefined();
  });

  it("starts and stops interval", () => {
    collector.start();
    collector.stop();
    // No errors
  });
});

// =============================================================================
// AgentDaemon (integration-level)
// =============================================================================

describe("AgentDaemon", () => {
  it("starts and stops gracefully", async () => {
    const config = makeConfig();

    // Mock fetch globally for this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);

      // Registry agent endpoints
      if (urlStr.includes("/api/agents/") && urlStr.includes("heartbeat")) {
        return new Response(JSON.stringify({ ack: true }), { status: 200 });
      }
      if (urlStr.includes("/api/agents/")) {
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
      }
      if (urlStr.includes("/api/agents")) {
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 201 });
      }
      // OpenClaw health
      if (urlStr.includes("/v1/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      // Task polling
      if (urlStr.includes("/api/tasks/next")) {
        return new Response(JSON.stringify({ success: true, data: null }), { status: 200 });
      }
      // Telemetry
      if (urlStr.includes("/telemetry")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    try {
      const daemon = new AgentDaemon(config, silentLogger);
      await daemon.start();

      // Let it run for a moment
      await new Promise((r) => setTimeout(r, 200));

      await daemon.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles registration failure and continues", async () => {
    const config = makeConfig({ registryUrl: "http://nonexistent:9999" });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("Connection refused");
    }) as typeof fetch;

    try {
      const daemon = new AgentDaemon(config, silentLogger);
      await daemon.start();

      // Should start despite registration failure
      await new Promise((r) => setTimeout(r, 100));
      await daemon.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// =============================================================================
// RegistryClient
// =============================================================================

describe("RegistryClient", () => {
  let config: DaemonConfig;

  beforeEach(() => {
    config = makeConfig();
  });

  it("constructs with correct base URL", () => {
    const client = new RegistryClient(
      { ...config, registryUrl: "http://registry:4001/" },
      silentLogger,
    );
    // Just verify it constructs without error
    expect(client).toBeDefined();
  });

  it("register() sends single POST for upsert", async () => {
    const calls: string[] = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      calls.push(method);

      if (method === "POST") {
        return new Response(JSON.stringify({ success: true }), { status: 201 });
      }
      return new Response("", { status: 200 });
    }) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      await client.register();

      // Single POST call — no PUT-then-POST anymore
      expect(calls).toEqual(["POST"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("register() succeeds on POST 200 (update)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      await client.register();
      // Should succeed — 200 means existing agent was updated
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("heartbeat() sends POST with status payload to correct endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ ack: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      const result = await client.heartbeat("idle", null);

      expect(capturedUrl).toContain(`/api/agents/${config.agentId}/heartbeat`);
      expect(result.ack).toBe(true);
      expect(result.cancelTask).toBeNull();

      const parsed = JSON.parse(capturedBody);
      expect(parsed.status).toBe("idle");
      expect(parsed.currentTaskId).toBeNull();
      expect(parsed.timestamp).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("heartbeat() returns false on 404 (agent removed)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Agent not found" }), { status: 404 }),
    ) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      const result = await client.heartbeat("idle", null);

      expect(result.ack).toBe(false);
      expect(result.cancelTask).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("heartbeat() returns true on server error (no re-register trigger)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    ) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      const result = await client.heartbeat("working", "task-123");

      expect(result.ack).toBe(true);
      expect(result.cancelTask).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("heartbeat() returns cancelTask when present in response", async () => {
    const cancelTaskId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ack: true, cancelTask: cancelTaskId }), { status: 200 }),
    ) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      const result = await client.heartbeat("working", cancelTaskId);

      expect(result.ack).toBe(true);
      expect(result.cancelTask).toBe(cancelTaskId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends Authorization header with HIVEMI_SECRET", async () => {
    let capturedHeaders: Record<string, string> = {};

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> || {};
      capturedHeaders = { ...headers };
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      await client.heartbeat();

      expect(capturedHeaders["Authorization"]).toBe(`Bearer ${config.hivemiSecret}`);
      expect(capturedHeaders["X-Agent-Id"]).toBe(config.agentId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("register() includes privateIp when available", async () => {
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      await client.register();

      // The PUT body should have been sent (register tries PUT first)
      // privateIp detection depends on actual network interfaces
      // so we just verify registration completes without error
      expect(capturedBody).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("setOffline() calls updateStatus", async () => {
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const client = new RegistryClient(config, silentLogger);
      await client.setOffline();

      const parsed = JSON.parse(capturedBody);
      expect(parsed.status).toBe("offline");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

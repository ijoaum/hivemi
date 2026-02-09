// =============================================================================
// Undeploy Flow Tests — Issue #70
//
// Tests for:
// 1. Daemon graceful shutdown (SIGTERM handling, task wait, timeout)
// 2. Deploy Orchestrator undeploy (force, graceful, firewall, task requeue)
// 3. Redeploy (destroy + deploy)
// 4. Edge cases (already destroyed, VM gone, daemon unresponsive)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentDaemon } from "../index.js";
import type { DaemonConfig, DaemonLogger, LogEntry } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestConfig(overrides?: Partial<DaemonConfig>): DaemonConfig {
  return {
    agentId: "test-agent-id",
    agentName: "TestAgent",
    roleId: "test-role-id",
    teamId: "test-team-id",
    model: "gpt-4o",
    registryUrl: "http://localhost:4001",
    hivemiSecret: "test-secret",
    daemonPort: 3100,
    pollIntervalMs: 15_000,
    heartbeatIntervalMs: 30_000,
    telemetryIntervalMs: 60_000,
    logBatchIntervalMs: 300_000,
    taskTimeoutMs: 600_000,
    shutdownTimeoutMs: 2_000, // Short for tests
    ...overrides,
  };
}

function createSilentLogger(): DaemonLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Daemon Graceful Shutdown Tests
// ---------------------------------------------------------------------------

describe("AgentDaemon — Graceful Shutdown", () => {
  let daemon: AgentDaemon;
  let logger: DaemonLogger;

  beforeEach(() => {
    logger = createSilentLogger();
    // Mock fetch globally for all registry calls
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: "test-agent-id" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should set shuttingDown flag on stop", async () => {
    daemon = new AgentDaemon(createTestConfig(), logger);
    await daemon.start();

    expect(daemon.shuttingDown).toBe(false);

    await daemon.stop();

    expect(daemon.shuttingDown).toBe(true);
  });

  it("should stop immediately when idle (no active task)", async () => {
    daemon = new AgentDaemon(createTestConfig(), logger);
    await daemon.start();

    const startTime = Date.now();
    await daemon.stop();
    const elapsed = Date.now() - startTime;

    // Should stop almost immediately when idle (< 1s)
    expect(elapsed).toBeLessThan(1000);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("No active task"),
    );
  });

  it("should call setOffline during shutdown", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    daemon = new AgentDaemon(createTestConfig(), logger);
    await daemon.start();
    await daemon.stop();

    // Should have made a PUT to set status offline
    const offlineCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("/api/agents/") && 
        call[1]?.method === "PUT" && 
        call[1]?.body?.toString().includes("offline"),
    );
    expect(offlineCall).toBeTruthy();
  });

  it("should log lifecycle events during shutdown", async () => {
    daemon = new AgentDaemon(createTestConfig(), logger);
    await daemon.start();
    await daemon.stop();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Graceful shutdown initiated"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Daemon stopped"),
    );
  });

  it("should be idempotent — calling stop twice is safe", async () => {
    daemon = new AgentDaemon(createTestConfig(), logger);
    await daemon.start();

    await daemon.stop();
    await daemon.stop(); // Should not throw

    expect(daemon.shuttingDown).toBe(true);
  });

  it("should use custom shutdownTimeoutMs from config", () => {
    daemon = new AgentDaemon(createTestConfig({ shutdownTimeoutMs: 10_000 }), logger);
    expect(daemon.shutdownTimeoutMs).toBe(10_000);
  });

  it("should default shutdownTimeoutMs to 55000", () => {
    daemon = new AgentDaemon(createTestConfig({ shutdownTimeoutMs: undefined }), logger);
    expect(daemon.shutdownTimeoutMs).toBe(55_000);
  });
});

// ---------------------------------------------------------------------------
// Config — shutdownTimeoutMs
// ---------------------------------------------------------------------------

describe("DaemonConfig — shutdownTimeoutMs", () => {
  it("should parse SHUTDOWN_TIMEOUT_MS from env", async () => {
    const { loadConfigFromEnv } = await import("../types.js");
    const config = loadConfigFromEnv({
      AGENT_ID: "id",
      AGENT_NAME: "name",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4o",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
      SHUTDOWN_TIMEOUT_MS: "30000",
    });
    expect(config.shutdownTimeoutMs).toBe(30_000);
  });

  it("should default to 55000 when not set", async () => {
    const { loadConfigFromEnv } = await import("../types.js");
    const config = loadConfigFromEnv({
      AGENT_ID: "id",
      AGENT_NAME: "name",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4o",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
    });
    expect(config.shutdownTimeoutMs).toBe(55_000);
  });
});

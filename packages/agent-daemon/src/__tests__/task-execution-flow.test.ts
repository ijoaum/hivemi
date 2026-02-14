// =============================================================================
// Task Execution Flow Tests — Issue #67
//
// Tests the complete end-to-end task execution flow:
// 1. Role-based timeout configuration
// 2. Full lifecycle (poll → execute → report → cleanup)
// 3. Timeout handling (marks task as failed)
// 4. Subtask creation via dedicated API
// 5. Session cleanup after each task
// 6. Heartbeat continues during execution
// 7. Error handling and recovery
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadConfigFromEnv,
  getEffectiveTimeout,
  DEFAULT_ROLE_TIMEOUTS,
  type DaemonConfig,
  type DaemonLogger,
  type DaemonTask,
  type IRegistryClient,
  type IOpenClawClient,
  type LogEntry,
  type OpenClawStatus,
  type SubtaskPayload,
} from "../types.js";
import { TaskExecutor, OpenClawUnavailableError } from "../task-executor.js";
import { TaskPoller } from "../task-poller.js";

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
    title: "Implement feature X",
    description: "Add the new feature X to the system",
    input: "Requirements: fast, reliable, tested",
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
    createSubtask: vi.fn().mockResolvedValue("subtask-001"),
    sendTelemetry: vi.fn().mockResolvedValue(undefined),
    sendLogs: vi.fn().mockResolvedValue(undefined),
    setOffline: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn().mockResolvedValue(undefined),
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
// Role-Based Timeout Configuration
// =============================================================================

describe("Role-Based Timeouts", () => {
  it("returns default PM timeout (10 min)", () => {
    const config = makeConfig({ roleName: "pm" });
    expect(getEffectiveTimeout(config)).toBe(10 * 60_000);
  });

  it("returns default Developer timeout (30 min)", () => {
    const config = makeConfig({ roleName: "developer" });
    expect(getEffectiveTimeout(config)).toBe(30 * 60_000);
  });

  it("returns default QA timeout (20 min)", () => {
    const config = makeConfig({ roleName: "qa" });
    expect(getEffectiveTimeout(config)).toBe(20 * 60_000);
  });

  it("returns default Tech Lead timeout (15 min)", () => {
    const config = makeConfig({ roleName: "tech-lead" });
    expect(getEffectiveTimeout(config)).toBe(15 * 60_000);
  });

  it("falls back to taskTimeoutMs for unknown role", () => {
    const config = makeConfig({ roleName: "designer", taskTimeoutMs: 45_000 });
    expect(getEffectiveTimeout(config)).toBe(45_000);
  });

  it("falls back to taskTimeoutMs when no role set", () => {
    const config = makeConfig({ taskTimeoutMs: 60_000 });
    expect(getEffectiveTimeout(config)).toBe(60_000);
  });

  it("uses custom roleTimeouts over defaults", () => {
    const config = makeConfig({
      roleName: "developer",
      roleTimeouts: { developer: 45 * 60_000 },
    });
    expect(getEffectiveTimeout(config)).toBe(45 * 60_000);
  });

  it("roleTimeouts take precedence over DEFAULT_ROLE_TIMEOUTS", () => {
    const config = makeConfig({
      roleName: "pm",
      roleTimeouts: { pm: 5 * 60_000 },
    });
    expect(getEffectiveTimeout(config)).toBe(5 * 60_000);
  });

  it("is case insensitive for role names", () => {
    const config = makeConfig({ roleName: "PM" });
    // PM lowercase matches the default
    expect(getEffectiveTimeout(config)).toBe(10 * 60_000);
  });

  it("DEFAULT_ROLE_TIMEOUTS has all expected roles", () => {
    expect(DEFAULT_ROLE_TIMEOUTS).toHaveProperty("pm");
    expect(DEFAULT_ROLE_TIMEOUTS).toHaveProperty("developer");
    expect(DEFAULT_ROLE_TIMEOUTS).toHaveProperty("qa");
    expect(DEFAULT_ROLE_TIMEOUTS).toHaveProperty("tech-lead");
  });
});

describe("loadConfigFromEnv - Role Config", () => {
  const baseEnv = {
    AGENT_ID: "a",
    AGENT_NAME: "a",
    ROLE_ID: "r",
    TEAM_ID: "t",
    MODEL: "m",
    REGISTRY_URL: "http://r",
    HIVEMI_SECRET: "s",
  };

  it("reads ROLE_NAME from env", () => {
    const config = loadConfigFromEnv({ ...baseEnv, ROLE_NAME: "developer" });
    expect(config.roleName).toBe("developer");
  });

  it("roleName is undefined when not set", () => {
    const config = loadConfigFromEnv(baseEnv);
    expect(config.roleName).toBeUndefined();
  });

  it("parses ROLE_TIMEOUTS from env", () => {
    const config = loadConfigFromEnv({
      ...baseEnv,
      ROLE_TIMEOUTS: "pm=300000,developer=900000,qa=600000",
    });
    expect(config.roleTimeouts).toEqual({
      pm: 300_000,
      developer: 900_000,
      qa: 600_000,
    });
  });

  it("returns undefined roleTimeouts when not set", () => {
    const config = loadConfigFromEnv(baseEnv);
    expect(config.roleTimeouts).toBeUndefined();
  });

  it("ignores malformed ROLE_TIMEOUTS entries", () => {
    const config = loadConfigFromEnv({
      ...baseEnv,
      ROLE_TIMEOUTS: "pm=300000,invalid,qa=abc,dev=-100",
    });
    expect(config.roleTimeouts).toEqual({ pm: 300_000 });
  });
});

// =============================================================================
// TaskExecutor — Full Execution Lifecycle
// =============================================================================

describe("TaskExecutor", () => {
  let config: DaemonConfig;
  let openclaw: IOpenClawClient;
  let registry: IRegistryClient;
  let logBuffer: LogEntry[];
  let executor: TaskExecutor;

  beforeEach(() => {
    config = makeConfig({ roleName: "developer" });
    openclaw = makeMockOpenClaw();
    registry = makeMockRegistry();
    logBuffer = [];
    executor = new TaskExecutor(config, openclaw, registry, silentLogger, logBuffer);
  });

  // -----------------------------------------------------------------------
  // Successful execution
  // -----------------------------------------------------------------------

  it("executes a task end-to-end and returns structured result", async () => {
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Feature X implemented successfully. All tests pass.",
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.taskResult.status).toBe("completed");
    expect(result.taskResult.output).toContain("Feature X implemented");
    expect(result.taskResult.error).toBeNull();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("calls healthCheck before executing", async () => {
    const task = makeTask();
    await executor.execute(task);

    expect(openclaw.healthCheck).toHaveBeenCalled();
  });

  it("sends formatted prompt to OpenClaw", async () => {
    const task = makeTask({ title: "Build API", description: "REST API for users" });
    await executor.execute(task);

    const prompt = (openclaw.executeTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("Build API");
    expect(prompt).toContain("REST API for users");
    expect(prompt).toContain("Instructions");
  });

  it("uses role-based timeout when executing", async () => {
    const task = makeTask();
    await executor.execute(task);

    // Developer default timeout = 30 min
    const timeoutUsed = (openclaw.executeTask as ReturnType<typeof vi.fn>).mock.calls[0][1] as number;
    expect(timeoutUsed).toBe(30 * 60_000);
  });

  it("destroys session after successful execution", async () => {
    const task = makeTask();
    await executor.execute(task);

    expect(openclaw.destroySession).toHaveBeenCalled();
  });

  it("destroys session even after failed execution", async () => {
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Build failed: compilation errors occurred",
    );

    const task = makeTask();
    await executor.execute(task);

    expect(openclaw.destroySession).toHaveBeenCalled();
  });

  it("destroys session even after timeout", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "TimeoutError";
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(timeoutError);

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.taskResult.status).toBe("failed");
    expect(openclaw.destroySession).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Timeout handling
  // -----------------------------------------------------------------------

  it("marks task as failed on execution timeout", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "TimeoutError";
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(timeoutError);

    const config = makeConfig({ roleName: "pm" }); // 10 min timeout
    const executor = new TaskExecutor(config, openclaw, registry, silentLogger, logBuffer);

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.taskResult.status).toBe("failed");
    expect(result.taskResult.error).toContain("Execution timeout");
    expect(result.taskResult.error).toContain("600s"); // 10 min in seconds
    expect(result.parsed.status).toBe("failed");
    expect(result.parsed.subtasks).toEqual([]);
  });

  it("handles AbortError as timeout", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(abortError);

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.taskResult.status).toBe("failed");
    expect(result.taskResult.error).toContain("Execution timeout");
  });

  it("re-throws non-timeout errors", async () => {
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network failure"),
    );

    const task = makeTask();
    await expect(executor.execute(task)).rejects.toThrow("Network failure");

    // Session should still be destroyed
    expect(openclaw.destroySession).toHaveBeenCalled();
  });

  it("re-throws OpenClawUnavailableError", async () => {
    (openclaw.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue("stopped");
    (openclaw.restart as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const task = makeTask();
    await expect(executor.execute(task)).rejects.toThrow(OpenClawUnavailableError);
  });

  // -----------------------------------------------------------------------
  // Output parsing integration
  // -----------------------------------------------------------------------

  it("extracts PR links from output", async () => {
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Done! PR: https://github.com/org/repo/pull/42",
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.parsed.pullRequests).toHaveLength(1);
    expect(result.parsed.pullRequests[0].url).toBe("https://github.com/org/repo/pull/42");
    expect(result.taskResult.artifacts).toHaveLength(1);
  });

  it("extracts subtasks from structured output", async () => {
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Done. Need tests.\n\n```subtasks\n[{"title":"Write tests","description":"Unit tests for X","priority":"high","roleTarget":"qa"}]\n```',
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.parsed.subtasks).toHaveLength(1);
    expect(result.parsed.subtasks[0].title).toBe("Write tests");
    expect(result.parsed.subtasks[0].roleTarget).toBe("qa");
  });

  it("detects failed status from output text", async () => {
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Build failed: tests failed with 5 errors",
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.taskResult.status).toBe("failed");
    expect(result.taskResult.error).toBeTruthy();
  });

  it("detects needs-input status as failed", async () => {
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Cannot proceed — need more information about the API format",
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.taskResult.status).toBe("failed");
    expect(result.taskResult.error).toContain("additional input");
  });

  // -----------------------------------------------------------------------
  // Prompt building
  // -----------------------------------------------------------------------

  it("includes task metadata in prompt", async () => {
    const task = makeTask({ id: "abc-123-def", priority: "high" });
    await executor.execute(task);

    const prompt = (openclaw.executeTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("abc-123-");
    expect(prompt).toContain("high");
  });

  it("includes parentTaskId in prompt when present", async () => {
    const task = makeTask({ parentTaskId: "parent-task-999" });
    await executor.execute(task);

    const prompt = (openclaw.executeTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("parent-t");
  });

  it("includes subtask output format guidance", async () => {
    const task = makeTask();
    await executor.execute(task);

    const prompt = (openclaw.executeTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("subtasks");
    expect(prompt).toContain("roleTarget");
  });

  // -----------------------------------------------------------------------
  // Log entries
  // -----------------------------------------------------------------------

  it("adds log entries during execution", async () => {
    const task = makeTask();
    await executor.execute(task);

    const taskLogs = logBuffer.filter((l) => l.taskId === task.id);
    expect(taskLogs.length).toBeGreaterThanOrEqual(2);
    expect(taskLogs.some((l) => l.component === "task-executor")).toBe(true);
    expect(taskLogs.some((l) => l.message.includes("Executing task"))).toBe(true);
  });

  it("logs timeout information", async () => {
    const task = makeTask();
    await executor.execute(task);

    const execLog = logBuffer.find((l) => l.message.includes("timeout:"));
    expect(execLog).toBeDefined();
    expect(execLog!.message).toContain("1800000"); // 30 min developer timeout
  });

  it("logs role name in execution log", async () => {
    const task = makeTask();
    await executor.execute(task);

    const execLog = logBuffer.find((l) => l.message.includes("role:"));
    expect(execLog).toBeDefined();
    expect(execLog!.message).toContain("developer");
  });

  // -----------------------------------------------------------------------
  // Session cleanup edge cases
  // -----------------------------------------------------------------------

  it("continues even if session cleanup fails", async () => {
    (openclaw.destroySession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Cleanup failed"),
    );

    const task = makeTask();
    const result = await executor.execute(task);

    // Should still complete successfully
    expect(result.taskResult.status).toBe("completed");
  });

  it("attempts session cleanup on health check failure", async () => {
    (openclaw.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue("stopped");
    (openclaw.restart as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const task = makeTask();
    await expect(executor.execute(task)).rejects.toThrow();

    // Session cleanup should still be attempted in finally block
    expect(openclaw.destroySession).toHaveBeenCalled();
  });
});

// =============================================================================
// TaskPoller — Subtask Creation via API
// =============================================================================

describe("TaskPoller — Subtask Creation", () => {
  let config: DaemonConfig;
  let registry: IRegistryClient;
  let openclaw: IOpenClawClient;
  let logBuffer: LogEntry[];
  let poller: TaskPoller;

  beforeEach(() => {
    config = makeConfig({ roleName: "pm" });
    registry = makeMockRegistry();
    openclaw = makeMockOpenClaw();
    logBuffer = [];
    poller = new TaskPoller(config, registry, openclaw, silentLogger, logBuffer);
  });

  afterEach(() => {
    poller.stop();
  });

  it("creates subtasks via dedicated API endpoint", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    // Output includes subtasks in structured format
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Analysis complete.\n\n```subtasks\n[{"title":"Implement login","description":"Add OAuth login","priority":"high","roleTarget":"developer"},{"title":"Test login","description":"E2E tests","priority":"medium","roleTarget":"qa"}]\n```',
    );

    poller.start();
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    // Should call createSubtask for each subtask, not reportTaskResult
    expect(registry.createSubtask).toHaveBeenCalledTimes(2);
    expect(registry.createSubtask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        title: "Implement login",
        description: "Add OAuth login",
        priority: "high",
        roleTarget: "developer",
      }),
    );
    expect(registry.createSubtask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        title: "Test login",
        description: "E2E tests",
        priority: "medium",
        roleTarget: "qa",
      }),
    );
  });

  it("continues even if subtask creation fails", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      '```subtasks\n[{"title":"Sub1"},{"title":"Sub2"}]\n```',
    );

    // First subtask fails, second succeeds
    (registry.createSubtask as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce("sub-2");

    poller.start();
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    // Should attempt both subtasks
    expect(registry.createSubtask).toHaveBeenCalledTimes(2);
    // Task should still be reported as completed
    expect(poller.tasksCompleted).toBe(1);
  });

  it("logs subtask creation with role target", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      '```subtasks\n[{"title":"Code review","roleTarget":"tech-lead"}]\n```',
    );

    poller.start();
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    const subtaskLog = logBuffer.find((l) => l.message.includes("Subtask created"));
    expect(subtaskLog).toBeDefined();
    expect(subtaskLog!.message).toContain("tech-lead");
  });
});

// =============================================================================
// TaskPoller — Full Flow (End-to-End)
// =============================================================================

describe("TaskPoller — Full Execution Flow", () => {
  let config: DaemonConfig;
  let registry: IRegistryClient;
  let openclaw: IOpenClawClient;
  let logBuffer: LogEntry[];
  let poller: TaskPoller;

  beforeEach(() => {
    config = makeConfig({ roleName: "developer" });
    registry = makeMockRegistry();
    openclaw = makeMockOpenClaw();
    logBuffer = [];
    poller = new TaskPoller(config, registry, openclaw, silentLogger, logBuffer);
  });

  afterEach(() => {
    poller.stop();
  });

  it("complete flow: poll → execute → report → idle", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Feature implemented successfully",
    );

    poller.start();
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    // 1. Status set to working
    expect(registry.updateStatus).toHaveBeenCalledWith("working");

    // 2. Task executed via OpenClaw
    expect(openclaw.executeTask).toHaveBeenCalled();

    // 3. Result reported to registry
    expect(registry.reportTaskResult).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: "completed",
        output: expect.stringContaining("Feature implemented"),
      }),
    );

    // 4. Status set back to idle
    expect(registry.updateStatus).toHaveBeenCalledWith("idle");

    // 5. Session destroyed
    expect(openclaw.destroySession).toHaveBeenCalled();

    expect(poller.tasksCompleted).toBe(1);
    expect(poller.tasksFailed).toBe(0);
  });

  it("reports failure when execution times out", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    const timeoutError = new Error("Timeout");
    timeoutError.name = "TimeoutError";
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockRejectedValue(timeoutError);

    poller.start();
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    expect(registry.reportTaskResult).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("timeout"),
      }),
    );

    expect(poller.tasksFailed).toBe(1);
    expect(registry.updateStatus).toHaveBeenCalledWith("idle");
  });

  it("activeTask is set during execution and cleared after", async () => {
    const task = makeTask();
    let capturedActiveTask: DaemonTask | null = null;

    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => {
        capturedActiveTask = poller.activeTask;
        setTimeout(() => resolve("done"), 50);
      }),
    );

    poller.start();
    await new Promise((r) => setTimeout(r, 300));
    poller.stop();

    // During execution, activeTask should have been set
    expect(capturedActiveTask).not.toBeNull();
    expect(capturedActiveTask!.id).toBe(task.id);

    // After execution, activeTask should be cleared
    expect(poller.activeTask).toBeNull();
  });

  it("handles OpenClaw unavailable error gracefully", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    (openclaw.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue("stopped");
    (openclaw.restart as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    poller.start();
    // Need enough time for 3 health check retries × 2s delay + execution overhead
    await new Promise((r) => setTimeout(r, 8_000));
    poller.stop();

    expect(registry.reportTaskResult).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("unavailable"),
      }),
    );

    expect(poller.tasksFailed).toBe(1);
    expect(registry.updateStatus).toHaveBeenCalledWith("idle");
  }, 15_000);

  it("does not poll while executing a task (concurrency guard)", async () => {
    const task = makeTask();
    let pollCount = 0;

    (registry.pollTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      pollCount++;
      if (pollCount === 1) return task;
      return null;
    });

    // Simulate slow execution
    (openclaw.executeTask as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => setTimeout(() => r("done"), 400)),
    );

    poller.start();
    await new Promise((r) => setTimeout(r, 800));
    poller.stop();

    // Should complete 1 task, not start another during execution
    expect(poller.tasksCompleted).toBe(1);
  });

  it("resumes polling after task completes", async () => {
    let pollCount = 0;
    const task1 = makeTask({ id: "task-1" });
    const task2 = makeTask({ id: "task-2" });

    (registry.pollTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      pollCount++;
      if (pollCount === 1) return task1;
      if (pollCount === 3) return task2; // After first task completes, next poll finds task2
      return null;
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 3000));
    poller.stop();

    expect(poller.tasksCompleted).toBe(2);
  });

  it("handles report failure gracefully", async () => {
    const task = makeTask();
    (registry.pollTask as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    (registry.reportTaskResult as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Report failed"),
    );

    poller.start();
    await new Promise((r) => setTimeout(r, 500));
    poller.stop();

    // Should not crash — error is handled
    expect(poller.tasksFailed).toBe(1);
    expect(registry.updateStatus).toHaveBeenCalledWith("idle");
  });
});

// =============================================================================
// Heartbeat During Execution
// =============================================================================

describe("Heartbeat During Execution", () => {
  it("AgentDaemon heartbeat reports working status while task executes", async () => {
    const config = makeConfig({ heartbeatIntervalMs: 100, roleName: "developer" });

    let heartbeatCalls: Array<{ status: string; taskId: string | null }> = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);

      // Track heartbeat calls
      if (urlStr.includes("heartbeat")) {
        const body = JSON.parse(init?.body as string || "{}");
        heartbeatCalls.push({
          status: body.status,
          taskId: body.currentTaskId,
        });
        return new Response(JSON.stringify({ ack: true }), { status: 200 });
      }

      // Registration
      if (urlStr.includes("/api/agents") && init?.method === "POST") {
        return new Response(JSON.stringify({ success: true }), { status: 201 });
      }
      if (urlStr.includes("/api/agents/")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      // OpenClaw health check
      if (urlStr.includes("/v1/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      // Task poll — return a task on first call
      if (urlStr.includes("/api/tasks/next")) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            id: "exec-task-1",
            title: "Slow task",
            description: null,
            input: null,
            priority: "medium",
            roleTarget: null,
            parentTaskId: null,
            teamId: "team-1",
          },
        }), { status: 200 });
      }

      // Chat completions — simulate slow execution
      if (urlStr.includes("/v1/chat/completions")) {
        await new Promise((r) => setTimeout(r, 500));
        return new Response(JSON.stringify({
          id: "sess-1",
          choices: [{ message: { content: "Task completed successfully" } }],
        }), { status: 200 });
      }

      // Task completion
      if (urlStr.includes("/complete")) {
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
      }

      // Telemetry
      if (urlStr.includes("/telemetry")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      // Session cleanup
      if (urlStr.includes("/v1/sessions/")) {
        return new Response("", { status: 200 });
      }

      return new Response("", { status: 200 });
    }) as typeof fetch;

    try {
      const { AgentDaemon } = await import("../index.js");
      const daemon = new AgentDaemon(config, silentLogger);
      await daemon.start();

      // Wait for task execution + some heartbeats
      await new Promise((r) => setTimeout(r, 1000));
      await daemon.stop();

      // Should have heartbeats with "working" status during task execution
      const workingBeats = heartbeatCalls.filter((h) => h.status === "working");
      expect(workingBeats.length).toBeGreaterThan(0);

      // Working heartbeats should include currentTaskId
      for (const beat of workingBeats) {
        expect(beat.taskId).toBe("exec-task-1");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// =============================================================================
// Session Cleanup
// =============================================================================

describe("Session Cleanup", () => {
  it("OpenClawClient stores session ID from response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);

      if (urlStr.includes("/v1/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      if (urlStr.includes("/v1/chat/completions")) {
        return new Response(JSON.stringify({
          id: "session-abc-123",
          choices: [{ message: { content: "Done" } }],
        }), { status: 200 });
      }

      if (urlStr.includes("/v1/sessions/session-abc-123")) {
        return new Response("", { status: 200 });
      }

      return new Response("", { status: 200 });
    }) as typeof fetch;

    try {
      const { OpenClawClient } = await import("../openclaw-client.js");
      const config = makeConfig({ useStreaming: false });
      const client = new OpenClawClient(config, silentLogger);

      await client.executeTask("test", 30_000);

      // Should call DELETE on the session
      const destroyed = await client.destroySession();
      expect(destroyed).toBe(true);

      // Should have called DELETE on the correct session ID
      const deleteCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCalls.length).toBe(1);
      expect(String(deleteCalls[0][0])).toContain("session-abc-123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("destroySession returns true when no session exists", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn() as typeof fetch;

    try {
      const { OpenClawClient } = await import("../openclaw-client.js");
      const config = makeConfig();
      const client = new OpenClawClient(config, silentLogger);

      // No task executed — no session to destroy
      const destroyed = await client.destroySession();
      expect(destroyed).toBe(true);

      // No DELETE requests should have been made
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("destroySession handles 404 gracefully (session already gone)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr.includes("/v1/chat/completions")) {
        return new Response(JSON.stringify({
          id: "sess-xyz",
          choices: [{ message: { content: "Done" } }],
        }), { status: 200 });
      }

      if (init?.method === "DELETE") {
        return new Response("Not found", { status: 404 });
      }

      return new Response("", { status: 200 });
    }) as typeof fetch;

    try {
      const { OpenClawClient } = await import("../openclaw-client.js");
      const config = makeConfig({ useStreaming: false });
      const client = new OpenClawClient(config, silentLogger);

      await client.executeTask("test", 30_000);
      const destroyed = await client.destroySession();
      expect(destroyed).toBe(true); // 404 = already cleaned up = success
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// =============================================================================
// RegistryClient — Subtask Creation
// =============================================================================

describe("RegistryClient — createSubtask", () => {
  let config: DaemonConfig;

  beforeEach(() => {
    config = makeConfig();
  });

  it("sends POST to correct endpoint with subtask payload", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({
        success: true,
        data: { id: "subtask-123" },
      }), { status: 201 });
    }) as typeof fetch;

    try {
      const { RegistryClient } = await import("../registry-client.js");
      const client = new RegistryClient(config, silentLogger);

      const id = await client.createSubtask("parent-task-1", {
        title: "Implement feature",
        description: "Add the feature",
        priority: "high",
        roleTarget: "developer-role-id",
      });

      expect(capturedUrl).toContain("/api/tasks/parent-task-1/subtasks");
      expect(id).toBe("subtask-123");

      const body = JSON.parse(capturedBody);
      expect(body.title).toBe("Implement feature");
      expect(body.description).toBe("Add the feature");
      expect(body.priority).toBe("high");
      expect(body.roleTarget).toBe("developer-role-id");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns null on creation failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "Parent not found" }), { status: 404 }),
    ) as typeof fetch;

    try {
      const { RegistryClient } = await import("../registry-client.js");
      const client = new RegistryClient(config, silentLogger);

      const id = await client.createSubtask("nonexistent", {
        title: "Test",
        description: null,
        priority: null,
        roleTarget: null,
      });

      expect(id).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("defaults priority to medium", async () => {
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ success: true, data: { id: "sub-1" } }), { status: 201 });
    }) as typeof fetch;

    try {
      const { RegistryClient } = await import("../registry-client.js");
      const client = new RegistryClient(config, silentLogger);

      await client.createSubtask("parent-1", {
        title: "Task",
        description: null,
        priority: null,
        roleTarget: null,
      });

      const body = JSON.parse(capturedBody);
      expect(body.priority).toBe("medium");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("omits roleTarget when null", async () => {
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ success: true, data: { id: "sub-1" } }), { status: 201 });
    }) as typeof fetch;

    try {
      const { RegistryClient } = await import("../registry-client.js");
      const client = new RegistryClient(config, silentLogger);

      await client.createSubtask("parent-1", {
        title: "Task",
        description: null,
        priority: null,
        roleTarget: null,
      });

      const body = JSON.parse(capturedBody);
      expect(body.roleTarget).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("includes input when provided", async () => {
    let capturedBody = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string || "";
      return new Response(JSON.stringify({ success: true, data: { id: "sub-1" } }), { status: 201 });
    }) as typeof fetch;

    try {
      const { RegistryClient } = await import("../registry-client.js");
      const client = new RegistryClient(config, silentLogger);

      await client.createSubtask("parent-1", {
        title: "Task",
        description: null,
        priority: null,
        roleTarget: null,
        input: "Additional context for the subtask",
      });

      const body = JSON.parse(capturedBody);
      expect(body.input).toBe("Additional context for the subtask");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

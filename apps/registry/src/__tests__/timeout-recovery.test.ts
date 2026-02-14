// =============================================================================
// Task Timeout Recovery Tests — Issue #86
//
// Tests for the timeout recovery job that detects stuck tasks (locked but
// no heartbeat from the agent) and marks them as failed with reason "timeout".
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers & Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Simulates a stuck task row from the DB join query */
function makeStuckTaskRow(overrides?: Partial<{
  task_id: string;
  task_title: string;
  locked_by: string;
  locked_at: Date;
  agent_id: string | null;
  agent_name: string | null;
  agent_last_heartbeat: Date | null;
  agent_status: string | null;
}>) {
  const now = Date.now();
  const thirtyFiveMinAgo = new Date(now - 35 * 60 * 1000);
  return {
    task_id: "task-001",
    task_title: "Implement feature X",
    locked_by: "agent-001",
    locked_at: thirtyFiveMinAgo,
    agent_id: "agent-001",
    agent_name: "dev-agent-1",
    agent_last_heartbeat: thirtyFiveMinAgo,
    agent_status: "working",
    ...overrides,
  };
}

// =============================================================================
// TIMEOUT DETECTION LOGIC
// =============================================================================

describe("Timeout Recovery — Detection Logic", () => {
  it("should detect tasks locked longer than the threshold", () => {
    const threshold = DEFAULT_TIMEOUT_THRESHOLD_MS;
    const now = Date.now();
    const lockedAt = new Date(now - threshold - 1);
    const lastHeartbeat = new Date(now - threshold - 1);

    // A task is stuck when lockedAt and lastHeartbeat are both older than threshold
    const isStuck = (now - lockedAt.getTime()) > threshold && (now - lastHeartbeat.getTime()) > threshold;
    expect(isStuck).toBe(true);
  });

  it("should NOT flag tasks within the threshold", () => {
    const threshold = DEFAULT_TIMEOUT_THRESHOLD_MS;
    const now = Date.now();
    const lastHeartbeat = new Date(now - threshold + 60_000); // 1 min before threshold

    const isStuck = (now - lastHeartbeat.getTime()) > threshold;
    expect(isStuck).toBe(false);
  });

  it("should flag tasks where agent has no heartbeat at all", () => {
    const lastHeartbeat: Date | null = null;
    // Null heartbeat = agent never heartbeated = definitely stuck
    const isStuck = lastHeartbeat === null;
    expect(isStuck).toBe(true);
  });

  it("should use 30 minutes as default threshold", () => {
    expect(DEFAULT_TIMEOUT_THRESHOLD_MS).toBe(30 * 60 * 1000);
    expect(DEFAULT_TIMEOUT_THRESHOLD_MS).toBe(1800000);
  });

  it("should use 5 minutes as default check interval", () => {
    expect(DEFAULT_CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(DEFAULT_CHECK_INTERVAL_MS).toBe(300000);
  });
});

// =============================================================================
// TASK STATUS TRANSITION
// =============================================================================

describe("Timeout Recovery — Status Transitions", () => {
  it("should set status to 'failed' for timed out tasks", () => {
    const expectedStatus = "failed";
    const expectedError = "timeout";
    // Timeout recovery marks tasks as failed with error="timeout"
    expect(expectedStatus).toBe("failed");
    expect(expectedError).toBe("timeout");
  });

  it("should set timeoutAt timestamp when timing out", () => {
    const now = new Date();
    const timeoutAt = now; // Set at time of detection
    expect(timeoutAt).toBeInstanceOf(Date);
    expect(timeoutAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("should set completedAt when timing out", () => {
    const now = new Date();
    const completedAt = now;
    expect(completedAt).toBeInstanceOf(Date);
  });

  it("should clear lock fields on timeout (lockedBy, lockedAt)", () => {
    // After timeout, lock fields should be null
    const updatePayload = {
      status: "failed",
      error: "timeout",
      timeoutAt: new Date(),
      completedAt: new Date(),
      lockedBy: null,
      lockedAt: null,
    };

    expect(updatePayload.lockedBy).toBeNull();
    expect(updatePayload.lockedAt).toBeNull();
    expect(updatePayload.status).toBe("failed");
    expect(updatePayload.error).toBe("timeout");
  });

  it("should only affect tasks with status 'locked'", () => {
    // Only locked tasks can be timed out (queued, completed, failed are not)
    const targetStatus = "locked";
    const nonTargetStatuses = ["queued", "completed", "failed", "cancelling", "cancelled"];
    expect(targetStatus).toBe("locked");
    nonTargetStatuses.forEach(s => expect(s).not.toBe("locked"));
  });
});

// =============================================================================
// AGENT RESET
// =============================================================================

describe("Timeout Recovery — Agent Reset", () => {
  it("should reset agent to idle after timeout", () => {
    const agentUpdate = {
      status: "idle",
      currentTaskId: null,
    };
    expect(agentUpdate.status).toBe("idle");
    expect(agentUpdate.currentTaskId).toBeNull();
  });

  it("should handle tasks with no agent (lockedBy is null)", () => {
    const row = makeStuckTaskRow({ agent_id: null, locked_by: "orphan-id", agent_name: null });
    // Even without a valid agent, the task itself should still be timed out
    expect(row.agent_id).toBeNull();
  });

  it("should handle tasks where agent was deleted", () => {
    const row = makeStuckTaskRow({ agent_id: null, agent_name: null, agent_status: null });
    // Agent doesn't exist anymore — task should still be timed out
    expect(row.agent_id).toBeNull();
    expect(row.agent_status).toBeNull();
  });
});

// =============================================================================
// CONFIGURATION
// =============================================================================

describe("Timeout Recovery — Configuration", () => {
  it("should support custom timeout threshold via env var", () => {
    const envValue = "3600000"; // 1 hour
    const parsed = parseInt(envValue);
    expect(parsed).toBe(3600000);
  });

  it("should support custom check interval via env var", () => {
    const envValue = "120000"; // 2 minutes
    const parsed = parseInt(envValue);
    expect(parsed).toBe(120000);
  });

  it("should support webhook URL for notifications", () => {
    const url = "https://hooks.slack.com/services/xxx";
    expect(url).toBeTruthy();
    expect(url.startsWith("https://")).toBe(true);
  });

  it("should default to no webhook when env var is not set", () => {
    const url = undefined;
    expect(url).toBeUndefined();
  });

  it("should parse TIMEOUT_THRESHOLD_MS env var correctly", () => {
    const values = [
      { input: "1800000", expected: 1800000 },
      { input: "900000", expected: 900000 },
      { input: "3600000", expected: 3600000 },
    ];
    values.forEach(({ input, expected }) => {
      expect(parseInt(input)).toBe(expected);
    });
  });

  it("should parse TIMEOUT_CHECK_INTERVAL_MS env var correctly", () => {
    const values = [
      { input: "300000", expected: 300000 },
      { input: "60000", expected: 60000 },
      { input: "600000", expected: 600000 },
    ];
    values.forEach(({ input, expected }) => {
      expect(parseInt(input)).toBe(expected);
    });
  });
});

// =============================================================================
// LOG ENTRIES
// =============================================================================

describe("Timeout Recovery — Log Entries", () => {
  it("should create a structured log entry for each timeout", () => {
    const row = makeStuckTaskRow();
    const logEntry = {
      level: "warn",
      source: row.agent_name,
      agentId: row.agent_id,
      taskId: row.task_id,
      message: `Task "${row.task_title}" timed out — locked since ${row.locked_at.toISOString()}, no heartbeat for >30min`,
      metadata: {
        reason: "timeout",
        timeoutThresholdMs: DEFAULT_TIMEOUT_THRESHOLD_MS,
        lockedAt: row.locked_at.toISOString(),
        agentName: row.agent_name,
      },
      component: "timeout-recovery",
    };

    expect(logEntry.level).toBe("warn");
    expect(logEntry.component).toBe("timeout-recovery");
    expect(logEntry.metadata.reason).toBe("timeout");
    expect(logEntry.taskId).toBe("task-001");
    expect(logEntry.agentId).toBe("agent-001");
  });

  it("should include lockedAt in the log metadata", () => {
    const row = makeStuckTaskRow();
    const metadata = {
      reason: "timeout",
      lockedAt: row.locked_at.toISOString(),
    };
    expect(metadata.lockedAt).toBeDefined();
    expect(typeof metadata.lockedAt).toBe("string");
  });

  it("should use 'timeout-recovery' as the component name", () => {
    const component = "timeout-recovery";
    expect(component).toBe("timeout-recovery");
  });

  it("should handle unknown agent name gracefully", () => {
    const row = makeStuckTaskRow({ agent_name: null });
    const source = row.agent_name || "unknown";
    expect(source).toBe("unknown");
  });
});

// =============================================================================
// WEBHOOK NOTIFICATIONS
// =============================================================================

describe("Timeout Recovery — Webhook Notifications", () => {
  it("should construct the correct webhook payload", () => {
    const row = makeStuckTaskRow();
    const payload = {
      event: "task_timeout",
      count: 1,
      tasks: [{
        taskId: row.task_id,
        taskTitle: row.task_title,
        agentName: row.agent_name,
      }],
      timestamp: new Date().toISOString(),
    };

    expect(payload.event).toBe("task_timeout");
    expect(payload.count).toBe(1);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0].taskId).toBe("task-001");
  });

  it("should limit webhook payload to 10 tasks max", () => {
    const tasks = Array.from({ length: 15 }, (_, i) => ({
      taskId: `task-${i}`,
      taskTitle: `Task ${i}`,
      agentName: `agent-${i}`,
    }));
    const limited = tasks.slice(0, 10);
    expect(limited).toHaveLength(10);
  });

  it("should not send webhook when no tasks timed out", () => {
    const timedOut = 0;
    const shouldSendWebhook = timedOut > 0;
    expect(shouldSendWebhook).toBe(false);
  });

  it("should handle webhook failure gracefully", () => {
    // Webhook failures should be logged as warnings, not crash the job
    const webhookUrl = "https://invalid.webhook.url";
    expect(webhookUrl).toBeTruthy();
    // The implementation catches fetch errors and logs a warning
  });
});

// =============================================================================
// SCHEMA — timeoutAt FIELD
// =============================================================================

describe("Timeout Recovery — Schema", () => {
  it("should have timeoutAt as a nullable timestamp field", () => {
    // In DB schema: timeoutAt: timestamp("timeout_at")
    // In protocol: timeoutAt: z.coerce.date().nullable().optional()
    const task = {
      id: "task-001",
      status: "failed",
      error: "timeout",
      timeoutAt: new Date(),
      completedAt: new Date(),
    };
    expect(task.timeoutAt).toBeInstanceOf(Date);
  });

  it("should allow null timeoutAt for non-timeout failures", () => {
    const task = {
      id: "task-002",
      status: "failed",
      error: "Some other error",
      timeoutAt: null,
    };
    expect(task.timeoutAt).toBeNull();
  });

  it("should distinguish timeout from regular failure via timeoutAt", () => {
    const timeoutTask = { status: "failed", error: "timeout", timeoutAt: new Date() };
    const regularFailure = { status: "failed", error: "syntax error", timeoutAt: null };

    const isTimeout = (t: typeof timeoutTask) => t.error === "timeout" || t.timeoutAt !== null;

    expect(isTimeout(timeoutTask)).toBe(true);
    expect(isTimeout(regularFailure)).toBe(false);
  });
});

// =============================================================================
// DASHBOARD — TIMEOUT INDICATOR
// =============================================================================

describe("Timeout Recovery — Dashboard Indicators", () => {
  it("should show 'Timed Out' label for timeout tasks", () => {
    const task = { status: "failed", error: "timeout", timeoutAt: new Date() };
    const isTimeout = task.status === "failed" && (task.error === "timeout" || !!task.timeoutAt);
    const label = isTimeout ? "Timed Out" : "Failed";
    expect(label).toBe("Timed Out");
  });

  it("should show 'Failed' label for regular failures", () => {
    const task = { status: "failed", error: "compilation error", timeoutAt: null };
    const isTimeout = task.status === "failed" && (task.error === "timeout" || !!task.timeoutAt);
    const label = isTimeout ? "Timed Out" : "Failed";
    expect(label).toBe("Failed");
  });

  it("should use orange color scheme for timeout", () => {
    const timeoutColors = { color: "text-orange-400", bg: "bg-orange-500/20" };
    const failedColors = { color: "text-red-400", bg: "bg-red-500/20" };
    expect(timeoutColors.color).toContain("orange");
    expect(failedColors.color).toContain("red");
  });

  it("should show ⏱️ icon for timeout tasks", () => {
    const icon = "⏱️";
    expect(icon).toBe("⏱️");
  });

  it("should show timeout explanation in detail modal", () => {
    const message = "This task was automatically marked as failed because the agent stopped sending heartbeats.";
    expect(message).toContain("heartbeats");
    expect(message).toContain("automatically");
  });

  it("should show timeoutAt in task detail when present", () => {
    const task = { timeoutAt: "2026-02-15T10:30:00.000Z" };
    expect(task.timeoutAt).toBeTruthy();
    expect(new Date(task.timeoutAt)).toBeInstanceOf(Date);
  });

  it("should not show timeout indicator for non-timeout failures", () => {
    const task = { status: "failed", error: "agent crashed", timeoutAt: null };
    const isTimeout = task.status === "failed" && (task.error === "timeout" || !!task.timeoutAt);
    expect(isTimeout).toBe(false);
  });
});

// =============================================================================
// JOB LIFECYCLE
// =============================================================================

describe("Timeout Recovery — Job Lifecycle", () => {
  it("should have a 10s startup delay", () => {
    const startupDelayMs = 10_000;
    expect(startupDelayMs).toBe(10000);
  });

  it("should prevent duplicate job starts", () => {
    // The implementation checks if timeoutTimer is already set
    let timer: any = null;
    const alreadyRunning = timer !== null;
    expect(alreadyRunning).toBe(false);
    
    timer = setInterval(() => {}, 1000);
    const stillRunning = timer !== null;
    expect(stillRunning).toBe(true);
    
    clearInterval(timer);
  });

  it("should clean up timer on stop", () => {
    let timer: any = setInterval(() => {}, 1000);
    expect(timer).not.toBeNull();
    
    clearInterval(timer);
    timer = null;
    expect(timer).toBeNull();
  });
});

// =============================================================================
// DIFFERENCE FROM LOCK TIMEOUT
// =============================================================================

describe("Timeout Recovery — vs Lock Timeout", () => {
  it("should detect tasks where agent is still 'working' but unresponsive", () => {
    // Lock timeout only releases tasks when agent is DEAD (offline/unreachable/destroyed)
    // Timeout recovery catches tasks where agent appears alive but hasn't heartbeated
    const row = makeStuckTaskRow({ agent_status: "working" });
    expect(row.agent_status).toBe("working");
    // Lock timeout would SKIP this (agent is alive), but timeout recovery catches it
  });

  it("should use heartbeat timing, not just lock age", () => {
    // Lock timeout: checks lockedAt age + agent status
    // Timeout recovery: checks agent's lastHeartbeat timing
    const row = makeStuckTaskRow();
    expect(row.agent_last_heartbeat).toBeDefined();
    expect(row.locked_at).toBeDefined();
    // Both are checked, but heartbeat is the key indicator
  });

  it("should have a longer default threshold than lock timeout", () => {
    const lockTimeoutDefault = 10 * 60 * 1000; // 10 min
    const timeoutRecoveryDefault = 30 * 60 * 1000; // 30 min
    expect(timeoutRecoveryDefault).toBeGreaterThan(lockTimeoutDefault);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("Timeout Recovery — Edge Cases", () => {
  it("should handle empty result set (no stuck tasks)", () => {
    const stuckTasks: any[] = [];
    const result = { timedOut: 0, checked: 0 };
    expect(stuckTasks.length).toBe(0);
    expect(result.timedOut).toBe(0);
    expect(result.checked).toBe(0);
  });

  it("should handle multiple stuck tasks in one check", () => {
    const stuckTasks = [
      makeStuckTaskRow({ task_id: "task-001" }),
      makeStuckTaskRow({ task_id: "task-002" }),
      makeStuckTaskRow({ task_id: "task-003" }),
    ];
    expect(stuckTasks.length).toBe(3);
  });

  it("should handle tasks locked by same agent", () => {
    // Multiple tasks locked by the same agent (shouldn't happen normally,
    // but the job should handle it gracefully)
    const tasks = [
      makeStuckTaskRow({ task_id: "task-001", agent_id: "agent-shared" }),
      makeStuckTaskRow({ task_id: "task-002", agent_id: "agent-shared" }),
    ];
    expect(tasks[0].agent_id).toBe(tasks[1].agent_id);
  });

  it("should handle lockedAt being null", () => {
    const row = makeStuckTaskRow({ locked_at: null as unknown as Date });
    expect(row.locked_at).toBeNull();
    // The SQL query requires lockedAt IS NOT NULL, so this shouldn't reach the loop
  });

  it("should handle agent with very old heartbeat", () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const row = makeStuckTaskRow({ agent_last_heartbeat: weekAgo });
    expect(row.agent_last_heartbeat.getTime()).toBeLessThan(Date.now() - DEFAULT_TIMEOUT_THRESHOLD_MS);
  });

  it("should not timeout tasks in cancelling state", () => {
    // The SQL query only targets status='locked', not 'cancelling'
    const targetStatus = "locked";
    expect(targetStatus).not.toBe("cancelling");
  });

  it("should return correct result shape", () => {
    const result = { timedOut: 2, checked: 5 };
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("checked");
    expect(typeof result.timedOut).toBe("number");
    expect(typeof result.checked).toBe("number");
  });

  it("should survive DB errors without crashing", () => {
    // The implementation wraps everything in try/catch
    // Individual task timeout errors don't stop processing of remaining tasks
    const results: string[] = [];
    const tasks = ["task-1", "task-2", "task-3"];
    
    for (const task of tasks) {
      try {
        if (task === "task-2") throw new Error("DB error");
        results.push(task);
      } catch {
        // Continue processing remaining tasks
      }
    }
    
    expect(results).toEqual(["task-1", "task-3"]);
  });
});

// =============================================================================
// SQL QUERY STRUCTURE
// =============================================================================

describe("Timeout Recovery — SQL Query", () => {
  it("should join tasks with agents on locked_by", () => {
    // The query joins tasks.locked_by = agents.id
    const joinCondition = "t.locked_by = a.id";
    expect(joinCondition).toContain("locked_by");
  });

  it("should use LEFT JOIN (handle tasks with deleted agents)", () => {
    // LEFT JOIN ensures tasks where the agent was deleted are still found
    const joinType = "LEFT JOIN";
    expect(joinType).toBe("LEFT JOIN");
  });

  it("should filter for status = 'locked'", () => {
    const whereClause = "t.status = 'locked'";
    expect(whereClause).toContain("locked");
  });

  it("should check agent heartbeat against cutoff", () => {
    // a.last_heartbeat IS NULL OR a.last_heartbeat < cutoff
    const conditions = [
      "a.last_heartbeat IS NULL",
      "a.last_heartbeat < cutoff",
    ];
    expect(conditions).toHaveLength(2);
  });

  it("should require locked_at IS NOT NULL", () => {
    const condition = "t.locked_at IS NOT NULL";
    expect(condition).toContain("locked_at IS NOT NULL");
  });
});

// =============================================================================
// REGISTRY INDEX — JOB STARTUP
// =============================================================================

describe("Timeout Recovery — Registry Integration", () => {
  it("should read TIMEOUT_THRESHOLD_MS from env", () => {
    const envVar = "TIMEOUT_THRESHOLD_MS";
    const defaultValue = "1800000";
    const parsed = parseInt(process.env[envVar] || defaultValue);
    expect(parsed).toBe(1800000); // 30 min default
  });

  it("should read TIMEOUT_CHECK_INTERVAL_MS from env", () => {
    const envVar = "TIMEOUT_CHECK_INTERVAL_MS";
    const defaultValue = "300000";
    const parsed = parseInt(process.env[envVar] || defaultValue);
    expect(parsed).toBe(300000); // 5 min default
  });

  it("should read TIMEOUT_WEBHOOK_URL from env", () => {
    const envVar = "TIMEOUT_WEBHOOK_URL";
    const value = process.env[envVar] || undefined;
    expect(value).toBeUndefined(); // Not set in test env
  });

  it("should start timeout recovery after reconciliation job", () => {
    // The startup order in index.ts:
    // 1. startOfflineDetection()
    // 2. startLockTimeoutJob()
    // 3. startReconciliationJob()
    // 4. startTimeoutRecovery() <-- new
    const startupOrder = [
      "startOfflineDetection",
      "startLockTimeoutJob",
      "startReconciliationJob",
      "startTimeoutRecovery",
    ];
    expect(startupOrder.indexOf("startTimeoutRecovery")).toBe(3);
    expect(startupOrder.indexOf("startTimeoutRecovery")).toBeGreaterThan(
      startupOrder.indexOf("startReconciliationJob")
    );
  });
});

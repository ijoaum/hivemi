// =============================================================================
// Task Timeout Recovery Job
// Issue #86: Detects stuck tasks (status=locked, no heartbeat for too long)
// and marks them as failed with reason "timeout".
//
// Runs every 5 minutes (configurable):
// - Finds tasks with status="locked" whose agent's lastHeartbeat is older
//   than the timeout threshold (default 30 minutes)
// - Marks those tasks as failed with error="timeout" and sets timeoutAt
// - Updates the agent status to "idle" and clears currentTaskId
// - Logs each timeout for audit trail
// - Writes structured log entries to the logs table
//
// Difference from lock-timeout.ts:
// - lock-timeout releases stale locks when the agent is DEAD (offline/unreachable)
// - timeout-recovery catches tasks where the agent is still "working" but hasn't
//   sent a heartbeat in a long time — indicating a hung process
// =============================================================================

import { db, tasks, agents, logs as logsTable } from "../db/index.js";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/** Default timeout: 30 minutes without heartbeat */
const DEFAULT_TIMEOUT_THRESHOLD_MS = 30 * 60 * 1000;

/** Default check interval: 5 minutes */
const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface TimeoutRecoveryConfig {
  /** How long a task can run without a heartbeat before being timed out (ms) */
  timeoutThresholdMs?: number;
  /** Interval between checks (ms) */
  intervalMs?: number;
  /** Optional webhook URL for notifications */
  notifyWebhookUrl?: string;
}

export interface TimeoutRecoveryResult {
  timedOut: number;
  checked: number;
}

/**
 * Run a single timeout recovery check.
 *
 * Finds locked tasks where the agent's lastHeartbeat is older than the
 * timeout threshold. These are tasks where the agent appears to have
 * hung or lost connectivity without being detected as offline.
 *
 * For each stuck task:
 *   1. Mark task as failed with error="timeout" and set timeoutAt
 *   2. Reset agent to idle (clear currentTaskId)
 *   3. Write a log entry to the logs table
 *   4. Send webhook notification if configured
 */
export async function checkTaskTimeouts(
  timeoutThresholdMs: number = DEFAULT_TIMEOUT_THRESHOLD_MS,
  notifyWebhookUrl?: string,
): Promise<TimeoutRecoveryResult> {
  let timedOut = 0;
  let checked = 0;

  try {
    const cutoff = new Date(Date.now() - timeoutThresholdMs);

    // Find locked tasks whose agent's lastHeartbeat is older than the threshold.
    // We join tasks with agents to check the agent's heartbeat timestamp.
    // A task is "stuck" when:
    //   - status = "locked"
    //   - agent's lastHeartbeat < cutoff (or agent has no heartbeat at all)
    //
    // We use raw SQL for the join query to avoid complex Drizzle join syntax
    // and to ensure we get exactly the fields we need.
    const stuckTasks = await db.execute(sql`
      SELECT
        t.id AS task_id,
        t.title AS task_title,
        t.locked_by AS locked_by,
        t.locked_at AS locked_at,
        a.id AS agent_id,
        a.name AS agent_name,
        a.last_heartbeat AS agent_last_heartbeat,
        a.status AS agent_status
      FROM tasks t
      LEFT JOIN agents a ON t.locked_by = a.id
      WHERE t.status = 'locked'
        AND t.locked_at IS NOT NULL
        AND (
          a.last_heartbeat IS NULL
          OR a.last_heartbeat < ${cutoff}
        )
    `);

    checked = stuckTasks.length;

    if (checked === 0) {
      return { timedOut: 0, checked: 0 };
    }

    logger.info(
      { count: checked, thresholdMs: timeoutThresholdMs },
      "Found stuck tasks — checking for timeout recovery",
    );

    const now = new Date();

    for (const row of stuckTasks) {
      const taskId = row.task_id as string;
      const taskTitle = row.task_title as string;
      const agentId = row.agent_id as string | null;
      const agentName = row.agent_name as string | null;
      const lockedAt = row.locked_at as Date | null;

      try {
        // 1. Mark task as failed with timeout reason
        await db
          .update(tasks)
          .set({
            status: "failed",
            error: "timeout",
            timeoutAt: now,
            completedAt: now,
            lockedBy: null,
            lockedAt: null,
          })
          .where(eq(tasks.id, taskId));

        // 2. Reset agent to idle if it exists
        if (agentId) {
          await db
            .update(agents)
            .set({
              status: "idle",
              currentTaskId: null,
              updatedAt: now,
            })
            .where(eq(agents.id, agentId));
        }

        // 3. Write structured log entry
        await db.insert(logsTable).values({
          timestamp: now,
          level: "warn",
          source: agentName || "unknown",
          agentId: agentId || undefined,
          taskId,
          message: `Task "${taskTitle}" timed out — locked since ${lockedAt?.toISOString() || "unknown"}, no heartbeat for >${Math.round(timeoutThresholdMs / 60000)}min`,
          metadata: {
            reason: "timeout",
            timeoutThresholdMs,
            lockedAt: lockedAt?.toISOString() || null,
            agentName,
          },
          component: "timeout-recovery",
        });

        timedOut++;

        logger.warn(
          {
            taskId,
            taskTitle,
            agentId,
            agentName,
            lockedAt: lockedAt?.toISOString(),
          },
          "Task timed out — marked as failed",
        );
      } catch (err) {
        logger.error(
          { taskId, error: err instanceof Error ? err.message : String(err) },
          "Failed to process timeout for task",
        );
      }
    }

    // 4. Send webhook notification if configured and we had timeouts
    if (notifyWebhookUrl && timedOut > 0) {
      try {
        await fetch(notifyWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "task_timeout",
            count: timedOut,
            tasks: stuckTasks.slice(0, 10).map((r) => ({
              taskId: r.task_id,
              taskTitle: r.task_title,
              agentName: r.agent_name,
            })),
            timestamp: now.toISOString(),
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to send timeout notification webhook",
        );
      }
    }

    if (timedOut > 0) {
      logger.info(
        { timedOut, checked },
        "Timeout recovery check completed",
      );
    }
  } catch (error) {
    logger.error(error, "Timeout recovery check failed");
  }

  return { timedOut, checked };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let timeoutTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the timeout recovery job.
 * Runs every intervalMs (default 5 min) to check for stuck tasks.
 */
export function startTimeoutRecovery(config: TimeoutRecoveryConfig = {}): void {
  const {
    timeoutThresholdMs = DEFAULT_TIMEOUT_THRESHOLD_MS,
    intervalMs = DEFAULT_CHECK_INTERVAL_MS,
    notifyWebhookUrl,
  } = config;

  if (timeoutTimer) {
    logger.warn("Timeout recovery job already running — skipping start");
    return;
  }

  logger.info(
    { timeoutThresholdMs, intervalMs, hasWebhook: !!notifyWebhookUrl },
    "Starting timeout recovery job",
  );

  // Run after a short delay (10s) on startup, then on interval
  setTimeout(() => void checkTaskTimeouts(timeoutThresholdMs, notifyWebhookUrl), 10_000);
  timeoutTimer = setInterval(
    () => void checkTaskTimeouts(timeoutThresholdMs, notifyWebhookUrl),
    intervalMs,
  );
}

/**
 * Stop the timeout recovery job.
 */
export function stopTimeoutRecovery(): void {
  if (timeoutTimer) {
    clearInterval(timeoutTimer);
    timeoutTimer = null;
    logger.info("Timeout recovery job stopped");
  }
}

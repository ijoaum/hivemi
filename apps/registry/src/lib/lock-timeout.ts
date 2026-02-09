// =============================================================================
// Lock Timeout Job
// Issue #55: Detects locked tasks whose agents have gone offline/unreachable
// and releases them back to the queue.
//
// Runs every 60 seconds:
// - Tasks locked for > lockTimeoutMs (default 10 minutes)
// - Agent is offline/unreachable/destroyed → release task back to queued
// - Agent is still alive (idle/working/error) → don't release (task may be heavy)
//
// This prevents tasks from being permanently stuck when an agent crashes.
// =============================================================================

import { db, tasks, agents } from "../db/index.js";
import { and, eq, lt, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/** Default lock timeout: 10 minutes */
const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

/** Agent statuses that indicate the agent is dead/unreachable */
const DEAD_AGENT_STATUSES = ["offline", "unreachable", "destroyed"] as const;

export interface LockTimeoutConfig {
  /** How long a task can stay locked before being considered stale (ms) */
  lockTimeoutMs?: number;
  /** Interval between checks (ms) */
  intervalMs?: number;
}

/**
 * Run a single lock timeout check.
 * Finds locked tasks where:
 *   1. lockedAt is older than lockTimeoutMs
 *   2. The agent that locked it is dead (offline/unreachable/destroyed)
 * Releases those tasks back to "queued" status.
 */
export async function checkLockTimeouts(
  lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
): Promise<{ released: number; kept: number }> {
  let released = 0;
  let kept = 0;

  try {
    const cutoff = new Date(Date.now() - lockTimeoutMs);

    // Find all locked tasks that have been locked for too long
    const staleTasks = await db
      .select({
        taskId: tasks.id,
        taskTitle: tasks.title,
        lockedBy: tasks.lockedBy,
        lockedAt: tasks.lockedAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "locked"),
          isNotNull(tasks.lockedAt),
          lt(tasks.lockedAt, cutoff),
        ),
      );

    if (staleTasks.length === 0) {
      return { released: 0, kept: 0 };
    }

    logger.info(
      { count: staleTasks.length },
      "Found stale locked tasks, checking agent status",
    );

    // For each stale task, check if the agent is still alive
    for (const staleTask of staleTasks) {
      if (!staleTask.lockedBy) {
        // No agent recorded — release it
        await releaseTask(staleTask.taskId, staleTask.taskTitle);
        released++;
        continue;
      }

      // Check agent status
      const agentResult = await db
        .select({ id: agents.id, status: agents.status, name: agents.name })
        .from(agents)
        .where(eq(agents.id, staleTask.lockedBy));

      if (agentResult.length === 0) {
        // Agent doesn't exist anymore — release the task
        await releaseTask(staleTask.taskId, staleTask.taskTitle);
        released++;
        continue;
      }

      const agent = agentResult[0];

      if (DEAD_AGENT_STATUSES.includes(agent.status as any)) {
        // Agent is dead — release the task
        logger.warn(
          {
            taskId: staleTask.taskId,
            taskTitle: staleTask.taskTitle,
            agentId: agent.id,
            agentName: agent.name,
            agentStatus: agent.status,
          },
          "Releasing stale task — agent is dead",
        );
        await releaseTask(staleTask.taskId, staleTask.taskTitle);
        released++;
      } else {
        // Agent is still alive — task may be heavy, don't release
        logger.debug(
          {
            taskId: staleTask.taskId,
            agentId: agent.id,
            agentStatus: agent.status,
          },
          "Keeping locked task — agent is still alive",
        );
        kept++;
      }
    }
  } catch (error) {
    logger.error(error, "Lock timeout check failed");
  }

  if (released > 0) {
    logger.info({ released, kept }, "Lock timeout check completed");
  }

  return { released, kept };
}

/**
 * Release a locked task back to the queue.
 */
async function releaseTask(taskId: string, taskTitle: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: "queued",
      lockedBy: null,
      lockedAt: null,
      startedAt: null,
      agentId: null,
    })
    .where(eq(tasks.id, taskId));

  logger.info({ taskId, taskTitle }, "Task released back to queue");
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let timeoutTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the lock timeout job.
 * Runs every intervalMs (default 60s) to check for stale locks.
 */
export function startLockTimeoutJob(config: LockTimeoutConfig = {}): void {
  const { lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS, intervalMs = 60_000 } = config;

  if (timeoutTimer) {
    logger.warn("Lock timeout job already running — skipping start");
    return;
  }

  logger.info(
    { lockTimeoutMs, intervalMs },
    "Starting lock timeout job",
  );

  // Run immediately on start, then on interval
  void checkLockTimeouts(lockTimeoutMs);
  timeoutTimer = setInterval(() => void checkLockTimeouts(lockTimeoutMs), intervalMs);
}

/**
 * Stop the lock timeout job.
 */
export function stopLockTimeoutJob(): void {
  if (timeoutTimer) {
    clearInterval(timeoutTimer);
    timeoutTimer = null;
    logger.info("Lock timeout job stopped");
  }
}

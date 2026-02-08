// =============================================================================
// Offline Detection Job
//
// Runs every 30 seconds to detect agents that have stopped sending heartbeats.
// - 90s without heartbeat (3 cycles) → mark as "offline"
// - 5min without heartbeat → mark as "unreachable"
// - Agent is NOT deleted — stays in registry for Dashboard visibility
// - When daemon resumes heartbeats, the heartbeat endpoint restores the status
// =============================================================================

import { db, agents } from "../db/index.js";
import { and, lt, notInArray, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/** Thresholds in milliseconds */
const OFFLINE_THRESHOLD_MS = 90_000;    // 90s = 3 missed heartbeats
const UNREACHABLE_THRESHOLD_MS = 300_000; // 5min = 10 missed heartbeats

/** Statuses that should NOT be checked for liveness */
const EXCLUDED_STATUSES = ["provisioning", "destroyed", "offline", "unreachable"] as const;

/** Statuses excluded from the unreachable check (already marked) */
const UNREACHABLE_EXCLUDED = ["provisioning", "destroyed", "unreachable"] as const;

/**
 * Run a single detection cycle.
 * Called by the interval timer from startOfflineDetection().
 */
export async function detectOfflineAgents(): Promise<{
  markedOffline: number;
  markedUnreachable: number;
}> {
  const now = Date.now();
  let markedOffline = 0;
  let markedUnreachable = 0;

  try {
    // -----------------------------------------------------------------------
    // Phase 1: Mark agents unreachable (5min without heartbeat)
    // Must run before offline check to avoid re-marking unreachable as offline
    // -----------------------------------------------------------------------
    const unreachableCutoff = new Date(now - UNREACHABLE_THRESHOLD_MS);

    const unreachableResult = await db
      .update(agents)
      .set({
        status: "unreachable",
        updatedAt: new Date(),
      })
      .where(
        and(
          isNotNull(agents.lastHeartbeat),
          lt(agents.lastHeartbeat, unreachableCutoff),
          notInArray(agents.status, [...UNREACHABLE_EXCLUDED]),
        ),
      )
      .returning({ id: agents.id, name: agents.name });

    markedUnreachable = unreachableResult.length;

    if (markedUnreachable > 0) {
      logger.warn(
        { agents: unreachableResult.map((a) => a.name), count: markedUnreachable },
        "Agents marked as unreachable (>5min without heartbeat)",
      );
    }

    // -----------------------------------------------------------------------
    // Phase 2: Mark agents offline (90s without heartbeat)
    // Only targets agents that are still "idle", "working", or "error"
    // -----------------------------------------------------------------------
    const offlineCutoff = new Date(now - OFFLINE_THRESHOLD_MS);

    const offlineResult = await db
      .update(agents)
      .set({
        status: "offline",
        updatedAt: new Date(),
      })
      .where(
        and(
          isNotNull(agents.lastHeartbeat),
          lt(agents.lastHeartbeat, offlineCutoff),
          notInArray(agents.status, [...EXCLUDED_STATUSES]),
        ),
      )
      .returning({ id: agents.id, name: agents.name });

    markedOffline = offlineResult.length;

    if (markedOffline > 0) {
      logger.info(
        { agents: offlineResult.map((a) => a.name), count: markedOffline },
        "Agents marked as offline (>90s without heartbeat)",
      );
    }
  } catch (error) {
    logger.error(error, "Offline detection job failed");
  }

  return { markedOffline, markedUnreachable };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let detectionTimer: ReturnType<typeof setInterval> | null = null;

/** Start the offline detection job (runs every 30s). */
export function startOfflineDetection(): void {
  if (detectionTimer) {
    logger.warn("Offline detection already running — skipping start");
    return;
  }

  logger.info("Starting offline detection job (interval: 30s)");

  // Run immediately on start, then every 30s
  void detectOfflineAgents();
  detectionTimer = setInterval(() => void detectOfflineAgents(), 30_000);
}

/** Stop the offline detection job. */
export function stopOfflineDetection(): void {
  if (detectionTimer) {
    clearInterval(detectionTimer);
    detectionTimer = null;
    logger.info("Offline detection job stopped");
  }
}

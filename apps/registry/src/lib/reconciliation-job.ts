// =============================================================================
// Reconciliation Job
// Issue #83: Periodic reconciliation between cloud VMs and registry agents.
//
// Runs every 1 hour (configurable via RECONCILIATION_INTERVAL_MS):
// - Lists VMs with tag "hivemi" from the cloud provider
// - Compares with agents registered in the DB
// - Detects orphaned VMs (VM exists, no agent references it)
// - Detects phantom agents (agent has instanceId but VM doesn't exist)
// - Validates IP matches between agents and their VMs
// - Optionally auto-fixes: marks phantom agents as offline
// - Logs detailed report and notifies admin via configurable webhook
//
// Requires cloud config to be set up (provider + API token).
// If no cloud config, the job silently skips until configured.
// =============================================================================

import { db, agents, logs } from "../db/index.js";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { getCloudConfig } from "./cloud-config.js";

// Re-export types for consumers
export interface ReconciliationJobConfig {
  /** Interval between reconciliation runs (default: 1 hour) */
  intervalMs?: number;
  /** Auto-fix phantom agents by marking them offline (default: true) */
  autoFixPhantoms?: boolean;
  /** Tag to filter cloud instances (default: "hivemi") */
  tag?: string;
  /** Webhook URL for admin notifications (optional) */
  notifyWebhookUrl?: string;
}

export interface ReconciliationJobResult {
  /** Whether reconciliation ran successfully */
  ran: boolean;
  /** Skip reason if it didn't run */
  skipReason?: string;
  /** Number of healthy agent/VM pairs */
  healthy: number;
  /** Number of orphaned VMs detected */
  orphaned: number;
  /** Number of phantom agents detected */
  phantom: number;
  /** Number of IP mismatches found */
  ipMismatches: number;
  /** Number of phantom agents auto-fixed (marked offline) */
  autoFixed: number;
  /** Overall status */
  status: "clean" | "warning" | "critical";
  /** When this reconciliation ran */
  timestamp: string;
  /** Provider name */
  provider?: string;
}

/** Default interval: 1 hour */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/** Last reconciliation result (accessible via API) */
let lastResult: ReconciliationJobResult | null = null;

/** Track whether a reconciliation is currently running */
let isRunning = false;

/**
 * Run a single reconciliation cycle.
 *
 * This function:
 * 1. Loads cloud config from DB
 * 2. Creates the cloud provider (lazy import)
 * 3. Lists VMs with hivemi tag
 * 4. Loads agents from DB
 * 5. Runs reconciliation logic
 * 6. Optionally auto-fixes phantom agents
 * 7. Logs results and sends notifications
 */
export async function runReconciliation(
  config: ReconciliationJobConfig = {},
): Promise<ReconciliationJobResult> {
  const {
    autoFixPhantoms = true,
    tag = "hivemi",
    notifyWebhookUrl,
  } = config;

  const timestamp = new Date().toISOString();

  // Guard against concurrent runs
  if (isRunning) {
    logger.debug("Reconciliation already in progress, skipping");
    return {
      ran: false,
      skipReason: "already_running",
      healthy: 0,
      orphaned: 0,
      phantom: 0,
      ipMismatches: 0,
      autoFixed: 0,
      status: "clean",
      timestamp,
    };
  }

  isRunning = true;

  try {
    // Step 1: Load cloud config
    const cloudConfig = await getCloudConfig();
    if (!cloudConfig || !cloudConfig.apiToken) {
      logger.debug("Reconciliation skipped: no cloud config or API token");
      const result: ReconciliationJobResult = {
        ran: false,
        skipReason: "no_cloud_config",
        healthy: 0,
        orphaned: 0,
        phantom: 0,
        ipMismatches: 0,
        autoFixed: 0,
        status: "clean",
        timestamp,
      };
      lastResult = result;
      return result;
    }

    // Step 2: Create provider (dynamic import to avoid startup dependency)
    const { createProvider, generateReconciliationReport } = await import("@hivemi/provisioner");

    const provider = createProvider(cloudConfig.provider, {
      token: cloudConfig.apiToken,
      defaultRegion: cloudConfig.region,
    });

    // Step 3: Get agents from DB
    const dbAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
        host: agents.host,
        privateIp: agents.privateIp,
        cloud: agents.cloud,
      })
      .from(agents);

    // Map to RegistryAgent shape for the provisioner
    const registryAgents = dbAgents.map((a) => ({
      id: a.id,
      name: a.name,
      instanceId: a.cloud?.instanceId || null,
      status: a.status,
      host: a.host || undefined,
      privateIp: a.privateIp || null,
    }));

    // Step 4: Generate reconciliation report
    const report = await generateReconciliationReport(
      provider,
      registryAgents,
      tag,
      {
        debug: (msg) => logger.debug(msg),
        info: (msg) => logger.info(msg),
        warn: (msg) => logger.warn(msg),
        error: (msg) => logger.error(msg),
      },
    );

    // Step 5: Auto-fix phantom agents
    let autoFixed = 0;
    if (autoFixPhantoms && report.result.phantomAgentIds.length > 0) {
      autoFixed = await fixPhantomAgents(report.result.phantomAgentIds);
    }

    // Step 6: Log detailed results
    await logReconciliationResult(report, autoFixed);

    // Step 7: Send notification if there are issues
    if (report.status !== "clean" && notifyWebhookUrl) {
      await sendNotification(notifyWebhookUrl, report, autoFixed);
    }

    const result: ReconciliationJobResult = {
      ran: true,
      healthy: report.stats.healthy,
      orphaned: report.stats.orphaned,
      phantom: report.stats.phantom,
      ipMismatches: report.stats.ipMismatches,
      autoFixed,
      status: report.status,
      timestamp,
      provider: report.provider,
    };

    lastResult = result;

    logger.info(
      {
        status: result.status,
        healthy: result.healthy,
        orphaned: result.orphaned,
        phantom: result.phantom,
        ipMismatches: result.ipMismatches,
        autoFixed: result.autoFixed,
      },
      "Reconciliation job completed",
    );

    return result;
  } catch (error) {
    logger.error(error, "Reconciliation job failed");

    const result: ReconciliationJobResult = {
      ran: false,
      skipReason: `error: ${(error as Error).message}`,
      healthy: 0,
      orphaned: 0,
      phantom: 0,
      ipMismatches: 0,
      autoFixed: 0,
      status: "clean",
      timestamp,
    };

    lastResult = result;
    return result;
  } finally {
    isRunning = false;
  }
}

/**
 * Mark phantom agents as offline in the database.
 * These are agents that reference a VM that no longer exists.
 */
async function fixPhantomAgents(phantomAgentIds: string[]): Promise<number> {
  if (phantomAgentIds.length === 0) return 0;

  try {
    const result = await db
      .update(agents)
      .set({
        status: "offline",
        updatedAt: new Date(),
      })
      .where(inArray(agents.id, phantomAgentIds))
      .returning({ id: agents.id, name: agents.name });

    for (const agent of result) {
      logger.warn(
        { agentId: agent.id, agentName: agent.name },
        "Phantom agent marked as offline (VM no longer exists)",
      );
    }

    return result.length;
  } catch (error) {
    logger.error(error, "Failed to fix phantom agents");
    return 0;
  }
}

/**
 * Log reconciliation results to the logs table for audit trail.
 */
async function logReconciliationResult(
  report: any,
  autoFixed: number,
): Promise<void> {
  try {
    const level = report.status === "clean" ? "info"
      : report.status === "warning" ? "warn"
      : "error";

    const message = [
      `Reconciliation: ${report.status}`,
      `${report.stats.healthy} healthy`,
      `${report.stats.orphaned} orphaned VMs`,
      `${report.stats.phantom} phantom agents`,
      `${report.stats.ipMismatches} IP mismatches`,
      autoFixed > 0 ? `${autoFixed} auto-fixed` : null,
    ]
      .filter(Boolean)
      .join(", ");

    await db.insert(logs).values({
      timestamp: new Date(),
      level: level as any,
      source: "reconciliation",
      message,
      component: "reconciliation-job",
      metadata: {
        status: report.status,
        stats: report.stats,
        autoFixed,
        issues: report.issues.map((i: any) => ({
          type: i.type,
          severity: i.severity,
          message: i.message,
        })),
      },
    });
  } catch (error) {
    logger.error(error, "Failed to log reconciliation result");
  }
}

/**
 * Send a webhook notification when reconciliation finds issues.
 */
async function sendNotification(
  webhookUrl: string,
  report: any,
  autoFixed: number,
): Promise<void> {
  try {
    const severity = report.status === "critical" ? "🔴 CRITICAL" : "🟡 WARNING";
    const issueLines = report.issues.map((i: any) => `- [${i.severity}] ${i.message}`);

    const payload = {
      text: [
        `${severity}: HiveMI Reconciliation Alert`,
        "",
        `Provider: ${report.provider}`,
        `Status: ${report.status}`,
        `Healthy: ${report.stats.healthy} | Orphaned: ${report.stats.orphaned} | Phantom: ${report.stats.phantom} | IP Mismatches: ${report.stats.ipMismatches}`,
        autoFixed > 0 ? `Auto-fixed: ${autoFixed} phantom agents marked offline` : "",
        "",
        "Issues:",
        ...issueLines,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    logger.info("Reconciliation notification sent");
  } catch (error) {
    logger.error(error, "Failed to send reconciliation notification");
  }
}

/**
 * Get the last reconciliation result (for the API).
 */
export function getLastReconciliationResult(): ReconciliationJobResult | null {
  return lastResult;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let reconciliationTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic reconciliation job.
 */
export function startReconciliationJob(config: ReconciliationJobConfig = {}): void {
  const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;

  if (reconciliationTimer) {
    logger.warn("Reconciliation job already running — skipping start");
    return;
  }

  logger.info(
    { intervalMs, intervalHours: (intervalMs / 3600000).toFixed(1) },
    "Starting reconciliation job",
  );

  // Run after a 30s delay on start (give the server time to warm up)
  setTimeout(() => void runReconciliation(config), 30_000);
  reconciliationTimer = setInterval(() => void runReconciliation(config), intervalMs);
}

/**
 * Stop the periodic reconciliation job.
 */
export function stopReconciliationJob(): void {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
    logger.info("Reconciliation job stopped");
  }
}

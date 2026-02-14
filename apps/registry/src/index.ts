import { serve } from "@hono/node-server";
import app from "./routes.js";
import { logger } from "./lib/logger.js";
import { startOfflineDetection } from "./lib/offline-detection.js";
import { startLockTimeoutJob } from "./lib/lock-timeout.js";
import { startReconciliationJob } from "./lib/reconciliation-job.js";

const port = parseInt(process.env.PORT || "4001");
// BIND_ADDRESS controls which interface the registry listens on.
// In production, set to the private VPC IP (e.g. 10.x.x.x) to restrict access
// to agents within the private network only.
//
// Examples:
//   BIND_ADDRESS=10.116.0.2   → only VPC traffic (production)
//   BIND_ADDRESS=127.0.0.1    → localhost only (default, safe)
//   BIND_ADDRESS=0.0.0.0      → all interfaces (dev only, NOT recommended in production)
//
// Legacy: REGISTRY_HOST is still supported for backward compatibility.
const host = process.env.BIND_ADDRESS || process.env.REGISTRY_HOST || "127.0.0.1";

// Lock timeout configuration (from env vars or defaults)
const lockTimeoutMs = parseInt(process.env.LOCK_TIMEOUT_MS || "600000"); // 10 minutes
const lockCheckIntervalMs = parseInt(process.env.LOCK_CHECK_INTERVAL_MS || "60000"); // 60 seconds

// Reconciliation configuration (from env vars or defaults)
const reconciliationIntervalMs = parseInt(process.env.RECONCILIATION_INTERVAL_MS || "3600000"); // 1 hour
const reconciliationAutoFix = process.env.RECONCILIATION_AUTO_FIX !== "false"; // default: true
const reconciliationWebhookUrl = process.env.RECONCILIATION_WEBHOOK_URL || undefined;

logger.info({ port, host }, "Starting HiveMI Registry...");

serve({
  fetch: app.fetch,
  port,
  hostname: host,
}, (info) => {
  logger.info({ port: info.port, host }, "🐝 HiveMI Registry running");

  // Start the offline detection job once the server is listening
  startOfflineDetection();

  // Start the lock timeout job to release stale task locks (Issue #55)
  startLockTimeoutJob({ lockTimeoutMs, intervalMs: lockCheckIntervalMs });

  // Start the reconciliation job to detect VM/agent drift (Issue #83)
  startReconciliationJob({
    intervalMs: reconciliationIntervalMs,
    autoFixPhantoms: reconciliationAutoFix,
    notifyWebhookUrl: reconciliationWebhookUrl,
  });
});

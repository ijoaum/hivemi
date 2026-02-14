// =============================================================================
// Reconciliation Routes (Registry-side)
// Issue #83: Expose reconciliation status and trigger endpoints
//
// GET  /api/infra/reconcile         — Get last reconciliation result
// POST /api/infra/reconcile         — Trigger immediate reconciliation
// GET  /api/infra/reconcile/history — Get reconciliation logs
// =============================================================================

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { db, logs } from "../db/index.js";
import { logger } from "../lib/logger.js";
import {
  runReconciliation,
  getLastReconciliationResult,
} from "../lib/reconciliation-job.js";

const reconcileRoutes = new Hono();

// =============================================================================
// GET / — Return last reconciliation result (cached from periodic job)
// =============================================================================

reconcileRoutes.get("/", async (c) => {
  try {
    const lastResult = getLastReconciliationResult();

    if (!lastResult) {
      return c.json({
        success: true,
        data: {
          ran: false,
          skipReason: "no_results_yet",
          message: "Reconciliation has not run yet. It runs automatically every hour, or trigger manually via POST.",
          healthy: 0,
          orphaned: 0,
          phantom: 0,
          ipMismatches: 0,
          autoFixed: 0,
          status: "clean",
          timestamp: new Date().toISOString(),
        },
      });
    }

    return c.json({ success: true, data: lastResult });
  } catch (error) {
    logger.error(error, "Failed to get reconciliation result");
    return c.json({ success: false, error: "Failed to get reconciliation result" }, 500);
  }
});

// =============================================================================
// POST / — Trigger immediate reconciliation
// =============================================================================

reconcileRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { autoFix, tag } = body as { autoFix?: boolean; tag?: string };

    logger.info({ autoFix, tag }, "Manual reconciliation triggered");

    const result = await runReconciliation({
      autoFixPhantoms: autoFix ?? true,
      tag: tag ?? "hivemi",
    });

    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Manual reconciliation failed");
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// =============================================================================
// GET /history — Return reconciliation log entries
// =============================================================================

reconcileRoutes.get("/history", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "20");

    const entries = await db
      .select()
      .from(logs)
      .where(eq(logs.component, "reconciliation-job"))
      .orderBy(desc(logs.timestamp))
      .limit(Math.min(limit, 100));

    return c.json({ success: true, data: entries });
  } catch (error) {
    logger.error(error, "Failed to get reconciliation history");
    return c.json({ success: false, error: "Failed to get reconciliation history" }, 500);
  }
});

export default reconcileRoutes;

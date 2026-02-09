// =============================================================================
// Log Routes — Issue #57: Batch Log Shipping Protocol
//
// POST /api/logs — batch log submission from daemon (every 5 min)
// GET  /api/logs — query logs with filters (agentId, level, limit, from, to)
// =============================================================================

import { Hono } from "hono";
import { db, agents, logs } from "../db/index.js";
import { eq, desc, and, gte, lte, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { SubmitLogBatchSchema } from "@hivemi/protocol";

const app = new Hono();

// =============================================================================
// POST /api/logs — Batch log submission
//
// Daemon sends { agentId, entries[] } every 5 minutes.
// Only accepts warn, error, lifecycle levels (protocol enforced via Zod).
// =============================================================================

app.post("/", async (c) => {
  try {
    const body = await c.req.json();

    // Validate with protocol schema
    const parsed = SubmitLogBatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        success: false,
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      }, 400);
    }

    const { agentId, entries } = parsed.data;

    // Verify agent exists
    const agent = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agent.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    const agentName = agent[0].name;

    // Build log rows for batch insert
    const rows = entries.map((entry) => ({
      timestamp: new Date(entry.timestamp),
      level: entry.level as "warn" | "error" | "lifecycle",
      source: agentName,
      agentId,
      taskId: entry.metadata?.taskId as string | undefined ?? null,
      message: entry.message,
      metadata: entry.metadata ?? null,
      component: (entry.metadata?.component as string | undefined) ?? null,
    }));

    // Batch insert all entries
    const inserted = await db.insert(logs).values(rows).returning({ id: logs.id });

    logger.info(
      { agentId, count: inserted.length },
      `Received ${inserted.length} log entries from ${agentName}`,
    );

    return c.json({
      success: true,
      data: { received: inserted.length },
    }, 201);
  } catch (error) {
    logger.error(error, "Failed to process log batch");
    return c.json({ success: false, error: "Failed to process log batch" }, 500);
  }
});

// =============================================================================
// GET /api/logs — Query logs with filters
//
// Query params:
//   limit    — max entries (default 100, max 1000)
//   agentId  — filter by agent UUID
//   level    — filter by level (warn, error, lifecycle)
//   from     — ISO 8601 start time
//   to       — ISO 8601 end time
// =============================================================================

app.get("/", async (c) => {
  try {
    const limitParam = c.req.query("limit");
    const agentIdParam = c.req.query("agentId");
    const levelParam = c.req.query("level");
    const fromParam = c.req.query("from");
    const toParam = c.req.query("to");

    const limit = Math.min(parseInt(limitParam || "100", 10) || 100, 1000);

    // Build conditions array
    const conditions = [];

    if (agentIdParam) {
      conditions.push(eq(logs.agentId, agentIdParam));
    }

    if (levelParam) {
      // Support comma-separated levels: ?level=warn,error
      const levels = levelParam.split(",").map((l) => l.trim());
      if (levels.length === 1) {
        conditions.push(eq(logs.level, levels[0] as any));
      } else {
        conditions.push(inArray(logs.level, levels as any[]));
      }
    }

    if (fromParam) {
      const fromDate = new Date(fromParam);
      if (!isNaN(fromDate.getTime())) {
        conditions.push(gte(logs.timestamp, fromDate));
      }
    }

    if (toParam) {
      const toDate = new Date(toParam);
      if (!isNaN(toDate.getTime())) {
        conditions.push(lte(logs.timestamp, toDate));
      }
    }

    let query = db
      .select()
      .from(logs)
      .orderBy(desc(logs.timestamp))
      .limit(limit)
      .$dynamic();

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const result = await query;
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Failed to fetch logs");
    return c.json({ success: false, error: "Failed to fetch logs" }, 500);
  }
});

export default app;

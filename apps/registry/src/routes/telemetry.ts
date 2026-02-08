// =============================================================================
// Agent Telemetry Routes
// POST /api/agents/:id/telemetry — daemon submits metrics
// GET /api/agents/:id/telemetry — latest metrics
// GET /api/agents/:id/telemetry/history — historical with time range
// POST /api/telemetry/cleanup — retention: prune old detailed, keep hourly aggregates
// =============================================================================

import { Hono } from "hono";
import { eq, desc, and, gte, lte, lt, sql } from "drizzle-orm";
import { db, agents, agentTelemetry } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { SubmitTelemetrySchema } from "@hivemi/protocol";

const app = new Hono();

// =============================================================================
// POST /api/agents/:id/telemetry — Daemon submits metrics
// =============================================================================

app.post("/:id/telemetry", async (c) => {
  try {
    const agentId = c.req.param("id");

    // Verify agent exists
    const agent = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
    if (agent.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = SubmitTelemetrySchema.parse(body);

    const record = await db.insert(agentTelemetry).values({
      agentId,
      timestamp: new Date(),
      infra: parsed.infra ?? null,
      llm: parsed.llm ?? null,
      tasks: parsed.tasks ?? null,
      daemon: parsed.daemon ?? null,
    }).returning();

    // Also update agent's last heartbeat when telemetry is received
    await db.update(agents)
      .set({ lastHeartbeat: new Date(), updatedAt: new Date() })
      .where(eq(agents.id, agentId));

    return c.json({ success: true, data: record[0] }, 201);
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return c.json({ success: false, error: "Validation failed", details: error.issues }, 400);
    }
    logger.error(error, "Failed to submit telemetry");
    return c.json({ success: false, error: "Failed to submit telemetry" }, 500);
  }
});

// =============================================================================
// GET /api/agents/:id/telemetry — Latest metrics (most recent record)
// =============================================================================

app.get("/:id/telemetry", async (c) => {
  try {
    const agentId = c.req.param("id");
    const limit = Math.min(parseInt(c.req.query("limit") || "1"), 100);

    // Verify agent exists
    const agent = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
    if (agent.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    const result = await db.select()
      .from(agentTelemetry)
      .where(eq(agentTelemetry.agentId, agentId))
      .orderBy(desc(agentTelemetry.timestamp))
      .limit(limit);

    if (limit === 1) {
      return c.json({
        success: true,
        data: result[0] ?? null,
      });
    }

    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Failed to fetch telemetry");
    return c.json({ success: false, error: "Failed to fetch telemetry" }, 500);
  }
});

// =============================================================================
// GET /api/agents/:id/telemetry/history — Historical with time range
// Query params: from (ISO), to (ISO), limit (default 100)
// =============================================================================

app.get("/:id/telemetry/history", async (c) => {
  try {
    const agentId = c.req.param("id");
    const fromParam = c.req.query("from");
    const toParam = c.req.query("to");
    const limit = Math.min(parseInt(c.req.query("limit") || "100"), 1000);

    // Verify agent exists
    const agent = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
    if (agent.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    // Default: last 24 hours
    const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = toParam ? new Date(toParam) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return c.json({ success: false, error: "Invalid date format. Use ISO 8601." }, 400);
    }

    const result = await db.select()
      .from(agentTelemetry)
      .where(
        and(
          eq(agentTelemetry.agentId, agentId),
          gte(agentTelemetry.timestamp, from),
          lte(agentTelemetry.timestamp, to),
        )
      )
      .orderBy(desc(agentTelemetry.timestamp))
      .limit(limit);

    return c.json({
      success: true,
      data: result,
      meta: {
        from: from.toISOString(),
        to: to.toISOString(),
        count: result.length,
        limit,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to fetch telemetry history");
    return c.json({ success: false, error: "Failed to fetch telemetry history" }, 500);
  }
});

// =============================================================================
// POST /api/telemetry/cleanup — Retention: prune old detailed records
// Keeps last 24h detailed, aggregates older data by hour, deletes raw >7d
// =============================================================================

app.post("/cleanup", async (c) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Step 1: Delete records older than 7 days (beyond aggregation window)
    const deleted = await db.delete(agentTelemetry)
      .where(lt(agentTelemetry.timestamp, sevenDaysAgo))
      .returning({ id: agentTelemetry.id });

    // Step 2: Aggregate records between 24h-7d into hourly summaries
    // For each agent, group by hour and keep only one record per hour
    // We do this by finding hours with multiple records and deleting extras
    const duplicateHours = await db.execute(sql`
      WITH hourly AS (
        SELECT
          agent_id,
          date_trunc('hour', timestamp) AS hour,
          count(*) AS cnt,
          array_agg(id ORDER BY timestamp DESC) AS ids
        FROM agent_telemetry
        WHERE timestamp < ${oneDayAgo}
          AND timestamp >= ${sevenDaysAgo}
        GROUP BY agent_id, date_trunc('hour', timestamp)
        HAVING count(*) > 1
      )
      SELECT unnest(ids[2:]) AS id_to_delete FROM hourly
    `);

    let aggregatedDeleted = 0;
    if (duplicateHours.length > 0) {
      const idsToDelete = (duplicateHours as unknown as { id_to_delete: string }[]).map((r) => r.id_to_delete);

      // Delete in batches of 100
      for (let i = 0; i < idsToDelete.length; i += 100) {
        const batch = idsToDelete.slice(i, i + 100);
        const result = await db.delete(agentTelemetry)
          .where(sql`${agentTelemetry.id} = ANY(${batch}::uuid[])`)
          .returning({ id: agentTelemetry.id });
        aggregatedDeleted += result.length;
      }
    }

    const totalDeleted = deleted.length + aggregatedDeleted;
    logger.info({ totalDeleted, expired: deleted.length, aggregated: aggregatedDeleted }, "Telemetry cleanup completed");

    return c.json({
      success: true,
      data: {
        deletedExpired: deleted.length,
        deletedAggregated: aggregatedDeleted,
        totalDeleted,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to run telemetry cleanup");
    return c.json({ success: false, error: "Failed to run telemetry cleanup" }, 500);
  }
});

export default app;

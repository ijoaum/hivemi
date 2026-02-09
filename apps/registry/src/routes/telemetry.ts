// =============================================================================
// Agent Telemetry Routes
// POST /api/agents/:id/telemetry — daemon submits metrics (every 60s)
// GET /api/agents/:id/telemetry — latest metrics
// GET /api/agents/:id/telemetry/history — historical with time range
// POST /api/telemetry/cleanup — retention: 24h granular → hourly → daily
//
// Protocol: Issue #54 — Agent Telemetry
// Payload includes `ts` (ISO 8601 from daemon), infra (snapshot),
// llm (deltas), tasks (snapshot), daemon (snapshot).
// =============================================================================

import { Hono } from "hono";
import { eq, desc, and, gte, lte, lt, sql } from "drizzle-orm";
import { db, agents, agentTelemetry } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { SubmitTelemetrySchema } from "@hivemi/protocol";

const app = new Hono();

// =============================================================================
// POST /api/agents/:id/telemetry — Daemon submits metrics
//
// Accepts the protocol-defined payload with optional `ts` field.
// If `ts` is provided, it's used as the record timestamp (daemon clock).
// Otherwise, server time is used.
// Also updates agent lastHeartbeat (proof of liveness).
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

    // Use daemon-provided timestamp if available, otherwise server time
    const timestamp = parsed.ts ? new Date(parsed.ts) : new Date();

    const record = await db.insert(agentTelemetry).values({
      agentId,
      timestamp,
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
// Query params: limit (default 1, max 100)
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
// Query params: from (ISO), to (ISO), limit (default 100, max 1000)
// Default range: last 24 hours
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
// POST /api/telemetry/cleanup — Retention policy
//
// Three-tier retention (Issue #54):
// 1. Last 24h: keep granular (every 60s)
// 2. 24h → 7d: aggregate to 1 record per hour
// 3. 7d → 30d: aggregate to 1 record per day
// 4. >30d: delete
// =============================================================================

app.post("/cleanup", async (c) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Step 1: Delete records older than 30 days
    const deleted = await db.delete(agentTelemetry)
      .where(lt(agentTelemetry.timestamp, thirtyDaysAgo))
      .returning({ id: agentTelemetry.id });

    // Step 2: Aggregate records between 7d-30d into daily summaries
    // Keep only one record per agent per day
    const dailyDuplicates = await db.execute(sql`
      WITH daily AS (
        SELECT
          agent_id,
          date_trunc('day', timestamp) AS day,
          count(*) AS cnt,
          array_agg(id ORDER BY timestamp DESC) AS ids
        FROM agent_telemetry
        WHERE timestamp < ${sevenDaysAgo}
          AND timestamp >= ${thirtyDaysAgo}
        GROUP BY agent_id, date_trunc('day', timestamp)
        HAVING count(*) > 1
      )
      SELECT unnest(ids[2:]) AS id_to_delete FROM daily
    `);

    let dailyAggregatedDeleted = 0;
    if (dailyDuplicates.length > 0) {
      const idsToDelete = (dailyDuplicates as unknown as { id_to_delete: string }[]).map((r) => r.id_to_delete);

      for (let i = 0; i < idsToDelete.length; i += 100) {
        const batch = idsToDelete.slice(i, i + 100);
        const result = await db.delete(agentTelemetry)
          .where(sql`${agentTelemetry.id} = ANY(${batch}::uuid[])`)
          .returning({ id: agentTelemetry.id });
        dailyAggregatedDeleted += result.length;
      }
    }

    // Step 3: Aggregate records between 24h-7d into hourly summaries
    // Keep only one record per agent per hour
    const hourlyDuplicates = await db.execute(sql`
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

    let hourlyAggregatedDeleted = 0;
    if (hourlyDuplicates.length > 0) {
      const idsToDelete = (hourlyDuplicates as unknown as { id_to_delete: string }[]).map((r) => r.id_to_delete);

      for (let i = 0; i < idsToDelete.length; i += 100) {
        const batch = idsToDelete.slice(i, i + 100);
        const result = await db.delete(agentTelemetry)
          .where(sql`${agentTelemetry.id} = ANY(${batch}::uuid[])`)
          .returning({ id: agentTelemetry.id });
        hourlyAggregatedDeleted += result.length;
      }
    }

    const totalDeleted = deleted.length + dailyAggregatedDeleted + hourlyAggregatedDeleted;
    logger.info({
      totalDeleted,
      expired: deleted.length,
      hourlyAggregated: hourlyAggregatedDeleted,
      dailyAggregated: dailyAggregatedDeleted,
    }, "Telemetry cleanup completed");

    return c.json({
      success: true,
      data: {
        deletedExpired: deleted.length,
        deletedHourlyAggregated: hourlyAggregatedDeleted,
        deletedDailyAggregated: dailyAggregatedDeleted,
        totalDeleted,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to run telemetry cleanup");
    return c.json({ success: false, error: "Failed to run telemetry cleanup" }, 500);
  }
});

export default app;

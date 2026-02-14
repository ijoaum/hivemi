// =============================================================================
// Agent Heartbeat Route
// POST /api/agents/:id/heartbeat — daemon heartbeat
//
// Every 30 seconds the daemon sends a heartbeat with its current status.
// - 200 { ack: true } — acknowledged
// - 404 — agent not found (daemon should re-register or stop)
// =============================================================================

import { Hono } from "hono";
import { db, agents } from "../db/index.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { HeartbeatPayloadSchema } from "@hivemi/protocol";

const app = new Hono();

app.post("/:id/heartbeat", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    // Validate payload with Zod
    const parsed = HeartbeatPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const data = parsed.data;
    const now = new Date();

    // Update agent with heartbeat data
    const updateSet: Record<string, unknown> = {
      lastHeartbeat: now,
      status: data.status,
      currentTaskId: data.currentTaskId,
      updatedAt: now,
    };

    // Update privateIp if provided (keeps registry in sync if IP changes)
    if (data.privateIp) {
      updateSet.privateIp = data.privateIp;
    }

    const result = await db
      .update(agents)
      .set(updateSet)
      .where(eq(agents.id, id))
      .returning({ id: agents.id });

    if (result.length === 0) {
      // Agent not found — daemon should re-register
      logger.warn({ agentId: id }, "Heartbeat for unknown agent — returning 404");
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    return c.json({ ack: true }, 200);
  } catch (error) {
    logger.error(error, "Heartbeat processing failed");
    return c.json({ success: false, error: "Heartbeat processing failed" }, 500);
  }
});

export default app;

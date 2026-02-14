// =============================================================================
// Agent Heartbeat Route
// POST /api/agents/:id/heartbeat — daemon heartbeat
//
// Every 30 seconds the daemon sends a heartbeat with its current status.
// - 200 { ack: true } — acknowledged (no pending cancellation)
// - 200 { ack: true, cancelTask: "<taskId>" } — agent should cancel this task
// - 404 — agent not found (daemon should re-register or stop)
//
// Issue #85: The heartbeat response now includes a `cancelTask` field when
// the agent's current task has been marked as "cancelling". The daemon
// should kill the running OpenClaw process and report the task as cancelled.
// =============================================================================

import { Hono } from "hono";
import { db, agents, tasks } from "../db/index.js";
import { eq, and } from "drizzle-orm";
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

    // -----------------------------------------------------------------------
    // Issue #85: Check for tasks that need cancellation
    //
    // If the daemon reports a currentTaskId, check if that task has been
    // marked as "cancelling" (via PUT /api/tasks/:id/cancel). If so,
    // include the task ID in the response so the daemon can kill the process.
    // -----------------------------------------------------------------------
    let cancelTask: string | null = null;

    if (data.currentTaskId) {
      try {
        const cancellingTasks = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.id, data.currentTaskId),
              eq(tasks.status, "cancelling"),
            ),
          );

        if (cancellingTasks.length > 0) {
          cancelTask = cancellingTasks[0].id;
          logger.info(
            { agentId: id, taskId: cancelTask },
            "Heartbeat response includes cancelTask — task is cancelling",
          );
        }
      } catch (err) {
        // Non-critical — if we can't check for cancellation, just skip it
        logger.warn(
          { agentId: id, error: err instanceof Error ? err.message : String(err) },
          "Failed to check for cancelling tasks in heartbeat",
        );
      }
    }

    const response: { ack: true; cancelTask?: string } = { ack: true };
    if (cancelTask) {
      response.cancelTask = cancelTask;
    }

    return c.json(response, 200);
  } catch (error) {
    logger.error(error, "Heartbeat processing failed");
    return c.json({ success: false, error: "Heartbeat processing failed" }, 500);
  }
});

export default app;

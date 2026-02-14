// =============================================================================
// Task Progress Routes — Issue #88
//
// POST /api/tasks/:id/progress   — Add a progress step to a task
// GET  /api/tasks/:id/progress   — List progress steps (ordered, paginated)
// =============================================================================

import { Hono } from "hono";
import { db, tasks, taskProgress } from "../db/index.js";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { CreateTaskProgressSchema } from "@hivemi/protocol";

const app = new Hono();

// =============================================================================
// POST /:id/progress — Add a progress step
//
// Body (validated by CreateTaskProgressSchema):
//   step      (required) — human-readable step description
//   timestamp (required) — ISO-8601 timestamp of when the step occurred
//   toolCall  (optional) — tool/function call name associated with this step
//
// Validates that the task exists before inserting.
//
// Returns:
//   201 { success: true, data: <progress record> }
//   400 — validation error
//   404 — task not found
// =============================================================================

app.post("/:id/progress", async (c) => {
  const taskId = c.req.param("id");

  try {
    const body = await c.req.json();
    const parsed = CreateTaskProgressSchema.safeParse(body);

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

    // Verify the task exists
    const existing = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId));

    if (existing.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }

    const { step, timestamp, toolCall } = parsed.data;

    const [created] = await db
      .insert(taskProgress)
      .values({
        taskId,
        step,
        timestamp,
        toolCall: toolCall || null,
      })
      .returning();

    logger.info(
      { taskId, progressId: created.id, step, toolCall },
      "Task progress step recorded",
    );

    return c.json({ success: true, data: created }, 201);
  } catch (error) {
    logger.error(error, "Failed to record task progress");
    return c.json({ success: false, error: "Failed to record task progress" }, 500);
  }
});

// =============================================================================
// GET /:id/progress — List progress steps for a task
//
// Query params:
//   limit   (optional) — max number of steps to return (default: 100, max: 500)
//   offset  (optional) — number of steps to skip (default: 0)
//
// Returns steps ordered by timestamp ascending (oldest first).
//
// Returns:
//   200 { success: true, data: [...], pagination: { limit, offset, count } }
//   404 — task not found
// =============================================================================

app.get("/:id/progress", async (c) => {
  const taskId = c.req.param("id");

  try {
    // Verify the task exists
    const existing = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId));

    if (existing.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }

    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");

    const limit = Math.min(Math.max(parseInt(limitParam || "100", 10) || 100, 1), 500);
    const offset = Math.max(parseInt(offsetParam || "0", 10) || 0, 0);

    const steps = await db
      .select()
      .from(taskProgress)
      .where(eq(taskProgress.taskId, taskId))
      .orderBy(asc(taskProgress.timestamp))
      .limit(limit)
      .offset(offset);

    return c.json({
      success: true,
      data: steps,
      pagination: {
        limit,
        offset,
        count: steps.length,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to fetch task progress");
    return c.json({ success: false, error: "Failed to fetch task progress" }, 500);
  }
});

export default app;

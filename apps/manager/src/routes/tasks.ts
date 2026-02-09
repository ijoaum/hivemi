// =============================================================================
// Task Routes
// Manager API endpoints for task lifecycle management
//
// POST /api/tasks     — Create a new task in the queue
// GET  /api/tasks     — List tasks with filters
// GET  /api/tasks/:id — Get a single task
// =============================================================================

import { Hono } from "hono";
import { logger } from "../lib/logger.js";
import { registryClient } from "../lib/registry-client.js";

const app = new Hono();

// =============================================================================
// POST /api/tasks — Create a new task in the queue
// =============================================================================

app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, roleTarget, priority, parentTaskId, teamId, input } = body;

    // Validate required fields
    if (!title || !teamId) {
      return c.json(
        { success: false, error: "Missing required fields: title, teamId" },
        400,
      );
    }

    // Create task in registry — born with status "queued"
    // Agents of the matching role will pick it up automatically
    const result = await registryClient.createTask({
      title,
      description: description || null,
      priority: priority || "medium",
      teamId,
      roleTarget: roleTarget || null,
      parentTaskId: parentTaskId || null,
      input: input || null,
    });

    if (!result.success || !result.data) {
      return c.json(
        { success: false, error: result.error || "Failed to create task" },
        500,
      );
    }

    logger.info(
      {
        taskId: result.data.id,
        title,
        roleTarget,
        priority: priority || "medium",
      },
      "Task created in queue",
    );

    return c.json({ success: true, data: result.data }, 201);
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message }, "Failed to create task");
    return c.json({ success: false, error: "Failed to create task" }, 500);
  }
});

// =============================================================================
// GET /api/tasks — List tasks with filters
// Query params: status, teamId, roleTarget, limit
// =============================================================================

app.get("/", async (c) => {
  try {
    const status = c.req.query("status");
    const teamId = c.req.query("teamId");
    const roleTarget = c.req.query("roleTarget");
    const limit = c.req.query("limit");

    const result = await registryClient.getTasks({
      status: status || undefined,
      teamId: teamId || undefined,
      roleTarget: roleTarget || undefined,
      limit: limit ? parseInt(limit) : undefined,
    });

    if (!result.success) {
      return c.json(
        { success: false, error: result.error || "Failed to fetch tasks" },
        500,
      );
    }

    return c.json({ success: true, data: result.data || [] });
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message }, "Failed to list tasks");
    return c.json({ success: false, error: "Failed to list tasks" }, 500);
  }
});

// =============================================================================
// GET /api/tasks/:id — Get single task
// =============================================================================

app.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await registryClient.getTask(id);

    if (!result.success || !result.data) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }

    return c.json({ success: true, data: result.data });
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message }, "Failed to get task");
    return c.json({ success: false, error: "Failed to get task" }, 500);
  }
});

export default app;

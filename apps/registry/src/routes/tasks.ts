// =============================================================================
// Task Queue Routes
// Issue #55: Pull-model task queue with SELECT FOR UPDATE SKIP LOCKED
//
// GET  /api/tasks/next       — Atomic claim: next queued task for a role
// PUT  /api/tasks/:id        — Complete/fail a task (with output, artifacts, subtasks)
// POST /api/tasks            — Create a task (supports parentTaskId for subtasks)
// =============================================================================

import { Hono } from "hono";
import { db, tasks, agents, roles } from "../db/index.js";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  CompleteTaskSchema,
  CreateSubtaskSchema,
} from "@hivemi/protocol";

const app = new Hono();

// =============================================================================
// GET /next — Atomic task claim with SELECT FOR UPDATE SKIP LOCKED
//
// Query params:
//   role    (required) — roleId to match against roleTarget
//   agentId (required) — the agent claiming the task
//
// Logic:
//   1. Find the oldest queued task matching the role (or no role target)
//   2. Lock the row atomically (no other agent can grab it)
//   3. Update status to "locked", set lockedBy/lockedAt/startedAt
//   4. Return the task
//
// Returns:
//   200 { success: true, data: <task> }   — task claimed
//   204 (no body)                         — no tasks available
//   400                                   — missing role/agentId param
// =============================================================================

app.get("/next", async (c) => {
  const roleId = c.req.query("role");
  const agentId = c.req.query("agentId");

  if (!roleId) {
    return c.json({ success: false, error: "Missing required query param: role" }, 400);
  }
  if (!agentId) {
    return c.json({ success: false, error: "Missing required query param: agentId" }, 400);
  }

  try {
    // Validate that the role exists
    const roleExists = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
    if (roleExists.length === 0) {
      return c.json({ success: false, error: "Role not found" }, 400);
    }

    // Validate that the agent exists
    const agentExists = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
    if (agentExists.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 400);
    }

    // Atomic claim using raw SQL with FOR UPDATE SKIP LOCKED
    // This is the core of the pull model:
    // - Finds the highest-priority, oldest queued task for this role
    // - Locks the row so no other concurrent request can claim it
    // - SKIP LOCKED means other agents don't block — they just skip locked rows
    // - Updates in the same transaction: status, lockedBy, lockedAt, startedAt
    const result = await db.execute(sql`
      WITH next_task AS (
        SELECT id
        FROM tasks
        WHERE status = 'queued'
          AND (role_target = ${roleId} OR role_target IS NULL)
        ORDER BY
          CASE priority
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 1
            ELSE 0
          END DESC,
          created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE tasks
      SET
        status = 'locked',
        locked_by = ${agentId}::uuid,
        locked_at = NOW(),
        started_at = NOW(),
        agent_id = ${agentId}::uuid
      FROM next_task
      WHERE tasks.id = next_task.id
      RETURNING tasks.*
    `);

    if (!result || result.length === 0) {
      // No tasks available — 204 No Content
      return c.body(null, 204);
    }

    const task = result[0];
    logger.info(
      { taskId: task.id, agentId, roleId, title: task.title },
      "Task claimed by agent",
    );

    return c.json({ success: true, data: task });
  } catch (error) {
    logger.error(error, "Failed to claim next task");
    return c.json({ success: false, error: "Failed to claim next task" }, 500);
  }
});

// =============================================================================
// PUT /:id/complete — Complete or fail a task
//
// Body (validated by CompleteTaskSchema):
//   status     — "completed" | "failed" (required)
//   output     — text describing what was done (optional)
//   error      — error message if failed (optional)
//   artifacts  — list of { type, url, description } (optional)
//   subtasks   — list of subtask creation payloads (optional)
//   duration   — elapsed time in ms (optional)
//   tokensUsed — { prompt, completion } (optional)
//
// On completion:
//   1. Updates task status, output, artifacts, elapsed time
//   2. Clears lock fields
//   3. Creates any subtasks with parentTaskId set
//   4. Updates agent status to idle and clears currentTaskId
// =============================================================================

app.put("/:id/complete", async (c) => {
  const taskId = c.req.param("id");

  try {
    const body = await c.req.json();
    const parsed = CompleteTaskSchema.safeParse(body);

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

    const { status, output, error: taskError, artifacts, subtasks, duration, tokensUsed } = parsed.data;

    // Verify the task exists and is locked
    const existing = await db.select().from(tasks).where(eq(tasks.id, taskId));
    if (existing.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }

    const task = existing[0];
    if (task.status !== "locked") {
      return c.json(
        { success: false, error: `Cannot complete task with status "${task.status}" — must be "locked"` },
        409,
      );
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {
      status,
      output: output || null,
      error: taskError || null,
      completedAt: new Date(),
      // Clear lock fields
      lockedBy: null,
      lockedAt: null,
    };

    if (artifacts && artifacts.length > 0) {
      updatePayload.artifacts = artifacts;
    }

    if (duration !== undefined) {
      updatePayload.elapsedMs = duration;
    }

    // Store token usage in output metadata if provided
    if (tokensUsed) {
      updatePayload.output = output
        ? `${output}\n\n---\nTokens used: ${tokensUsed.prompt} prompt, ${tokensUsed.completion} completion`
        : `Tokens used: ${tokensUsed.prompt} prompt, ${tokensUsed.completion} completion`;
    }

    // Update the task
    const updated = await db
      .update(tasks)
      .set(updatePayload)
      .where(eq(tasks.id, taskId))
      .returning();

    // Update agent status back to idle if we know who locked it
    if (task.lockedBy) {
      await db
        .update(agents)
        .set({
          status: "idle",
          currentTaskId: null,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, task.lockedBy));
    }

    // Create subtasks if provided
    const createdSubtasks = [];
    if (subtasks && subtasks.length > 0) {
      for (const subtask of subtasks) {
        const [created] = await db
          .insert(tasks)
          .values({
            title: subtask.title,
            description: subtask.description || null,
            priority: subtask.priority || "medium",
            teamId: task.teamId,
            roleTarget: subtask.roleTarget || null,
            parentTaskId: taskId,
            input: subtask.input || null,
            status: "queued",
          })
          .returning();

        createdSubtasks.push(created);
        logger.info(
          { subtaskId: created.id, parentTaskId: taskId, roleTarget: subtask.roleTarget },
          "Subtask created",
        );
      }
    }

    logger.info(
      {
        taskId,
        status,
        duration,
        subtasksCreated: createdSubtasks.length,
      },
      `Task ${status}`,
    );

    return c.json({
      success: true,
      data: {
        task: updated[0],
        subtasks: createdSubtasks,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to complete task");
    return c.json({ success: false, error: "Failed to complete task" }, 500);
  }
});

// =============================================================================
// POST /:id/subtasks — Create subtasks for a parent task
//
// Used during task execution when an agent needs to delegate work to other roles.
// E.g., PM creates dev tasks, dev creates QA review tasks.
//
// Body (validated by CreateSubtaskSchema):
//   title       — subtask title (required)
//   description — detailed description (optional)
//   roleTarget  — roleId for the agent that should pick it up (optional)
//   priority    — high | medium | low (default: medium)
//   input       — additional input/context (optional)
// =============================================================================

app.post("/:id/subtasks", async (c) => {
  const parentTaskId = c.req.param("id");

  try {
    const body = await c.req.json();
    const parsed = CreateSubtaskSchema.safeParse(body);

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

    // Verify parent task exists
    const parent = await db.select().from(tasks).where(eq(tasks.id, parentTaskId));
    if (parent.length === 0) {
      return c.json({ success: false, error: "Parent task not found" }, 404);
    }

    const { title, description, roleTarget, priority, input } = parsed.data;

    // Validate roleTarget if provided
    if (roleTarget) {
      const roleExists = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleTarget));
      if (roleExists.length === 0) {
        return c.json({ success: false, error: "Role target not found" }, 400);
      }
    }

    const [created] = await db
      .insert(tasks)
      .values({
        title,
        description: description || null,
        priority: priority || "medium",
        teamId: parent[0].teamId,
        roleTarget: roleTarget || null,
        parentTaskId,
        input: input || null,
        status: "queued",
      })
      .returning();

    logger.info(
      { subtaskId: created.id, parentTaskId, roleTarget, title },
      "Subtask created",
    );

    return c.json({ success: true, data: created }, 201);
  } catch (error) {
    logger.error(error, "Failed to create subtask");
    return c.json({ success: false, error: "Failed to create subtask" }, 500);
  }
});

// =============================================================================
// POST /requeue — Requeue all tasks locked by a specific agent
//
// Used during undeploy to return tasks to the queue when an agent is destroyed.
// Sets locked tasks back to "queued" and clears lock fields.
//
// Body:
//   agentId (required) — the agent whose tasks should be requeued
// =============================================================================

app.post("/requeue", async (c) => {
  try {
    const body = await c.req.json();
    const { agentId } = body;

    if (!agentId) {
      return c.json({ success: false, error: "Missing required field: agentId" }, 400);
    }

    // Find all tasks locked by this agent
    const lockedTasks = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(eq(tasks.lockedBy, agentId));

    if (lockedTasks.length === 0) {
      return c.json({ success: true, data: { requeued: 0 } });
    }

    // Requeue them: set status back to queued, clear lock fields
    const now = new Date();
    let requeued = 0;
    for (const task of lockedTasks) {
      await db
        .update(tasks)
        .set({
          status: "queued",
          lockedBy: null,
          lockedAt: null,
          startedAt: null,
          agentId: null,
          error: null,
        })
        .where(eq(tasks.id, task.id));

      requeued++;
      logger.info({ taskId: task.id, agentId, title: task.title }, "Task requeued after agent destroy");
    }

    logger.info({ agentId, requeued }, "Tasks requeued for destroyed agent");

    return c.json({ success: true, data: { requeued } });
  } catch (error) {
    logger.error(error, "Failed to requeue tasks");
    return c.json({ success: false, error: "Failed to requeue tasks" }, 500);
  }
});

// =============================================================================
// PUT /:id/cancel — Mark a locked task as "cancelling"
//
// Issue #85: Task cancellation via heartbeat.
// When a task is locked (being executed by an agent), this endpoint marks it
// as "cancelling". The next heartbeat response will include the cancelTask
// field, signaling the daemon to kill the OpenClaw process.
//
// Status transitions:
//   queued     → cancelled (immediate, no daemon involvement needed)
//   locked     → cancelling (daemon will handle via heartbeat)
//   cancelling → 409 (already cancelling, idempotent-ish)
//   completed  → 409 (can't cancel a completed task)
//   failed     → 409 (can't cancel a failed task)
//   cancelled  → 409 (already cancelled)
//
// After the daemon confirms the kill, it reports the task via
// PUT /api/tasks/:id/complete with status=failed and error="cancelled".
// The Registry then sets the final status to "cancelled".
// =============================================================================

app.put("/:id/cancel", async (c) => {
  const taskId = c.req.param("id");

  try {
    // Get current task state
    const existing = await db
      .select({
        id: tasks.id,
        status: tasks.status,
        lockedBy: tasks.lockedBy,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId));

    if (existing.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }

    const task = existing[0];

    // Terminal states — cannot cancel
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return c.json(
        { success: false, error: `Cannot cancel task with status "${task.status}"` },
        409,
      );
    }

    // Already cancelling — idempotent
    if (task.status === "cancelling") {
      logger.info({ taskId }, "Task already in cancelling state");
      return c.json({
        success: true,
        data: { id: taskId, status: "cancelling" },
        message: "Task is already cancelling",
      });
    }

    if (task.status === "locked") {
      // Task is being executed — mark as cancelling
      // Daemon will pick this up in the next heartbeat cycle
      const updated = await db
        .update(tasks)
        .set({ status: "cancelling" })
        .where(eq(tasks.id, taskId))
        .returning();

      logger.info(
        { taskId, lockedBy: task.lockedBy },
        "Task marked as cancelling — daemon will be notified via heartbeat",
      );

      return c.json({ success: true, data: updated[0] });
    }

    // Queued or any other non-active state — cancel immediately
    const updated = await db
      .update(tasks)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
      })
      .where(eq(tasks.id, taskId))
      .returning();

    logger.info({ taskId }, "Task cancelled immediately (was not locked)");
    return c.json({ success: true, data: updated[0] });
  } catch (error) {
    logger.error(error, "Failed to cancel task");
    return c.json({ success: false, error: "Failed to cancel task" }, 500);
  }
});

export default app;

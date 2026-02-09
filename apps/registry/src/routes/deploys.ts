// =============================================================================
// Deploy Status Routes
// POST /api/deploys — register new deploy
// GET /api/deploys — list recent deploys
// GET /api/deploys/:id — get deploy by id
// PUT /api/deploys/:id — update deploy phase/status
// =============================================================================

import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db, agents, deploys } from "../db/index.js";
import type { DeployPhase } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import {
  CreateDeploySchema,
  UpdateDeploySchema,
} from "@hivemi/protocol";

const app = new Hono();

// =============================================================================
// POST /api/deploys — Register a new deploy
// =============================================================================

app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateDeploySchema.parse(body);

    const now = new Date();

    // Create initial phases
    const initialPhases: DeployPhase[] = [
      { name: "provisioning", status: "active", startedAt: now.toISOString(), completedAt: null, error: null },
      { name: "installing", status: "pending", startedAt: null, completedAt: null, error: null },
      { name: "configuring", status: "pending", startedAt: null, completedAt: null, error: null },
      { name: "registering", status: "pending", startedAt: null, completedAt: null, error: null },
    ];

    const result = await db.insert(deploys).values({
      agentName: parsed.agentName,
      cloudProvider: parsed.cloudProvider,
      region: parsed.region,
      instanceSize: parsed.instanceSize,
      status: "provisioning",
      phases: initialPhases,
      startedAt: now,
    }).returning();

    logger.info({ deployId: result[0].id, agentName: parsed.agentName }, "Deploy registered");

    return c.json({ success: true, data: result[0] }, 201);
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return c.json({ success: false, error: "Validation failed", details: error.issues }, 400);
    }
    logger.error(error, "Failed to create deploy");
    return c.json({ success: false, error: "Failed to create deploy" }, 500);
  }
});

// =============================================================================
// GET /api/deploys — List recent deploys
// Query params: limit (default 20), status (optional filter)
// =============================================================================

app.get("/", async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
    const statusFilter = c.req.query("status");

    let query = db.select().from(deploys).orderBy(desc(deploys.startedAt)).$dynamic();

    if (statusFilter) {
      query = query.where(eq(deploys.status, statusFilter as any));
    }

    const result = await query.limit(limit);

    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Failed to list deploys");
    return c.json({ success: false, error: "Failed to list deploys" }, 500);
  }
});

// =============================================================================
// GET /api/deploys/:id — Get deploy status
// =============================================================================

app.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const result = await db.select().from(deploys).where(eq(deploys.id, id));
    if (result.length === 0) {
      return c.json({ success: false, error: "Deploy not found" }, 404);
    }

    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to fetch deploy");
    return c.json({ success: false, error: "Failed to fetch deploy" }, 500);
  }
});

// =============================================================================
// PUT /api/deploys/:id — Update deploy phase/status
// Used by the Deploy Orchestrator to update progress
// =============================================================================

app.put("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = UpdateDeploySchema.parse(body);

    // Fetch current deploy
    const current = await db.select().from(deploys).where(eq(deploys.id, id));
    if (current.length === 0) {
      return c.json({ success: false, error: "Deploy not found" }, 404);
    }

    const deploy = current[0];
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    // Update status if provided
    if (parsed.status) {
      updates.status = parsed.status;

      // If transitioning to a terminal state, set completedAt
      if (parsed.status === "ready" || parsed.status === "failed" || parsed.status === "destroyed") {
        updates.completedAt = parsed.completedAt ?? now;
      }
    }

    // Update instanceId if provided
    if (parsed.instanceId) {
      updates.instanceId = parsed.instanceId;
    }

    // Update agentId if provided
    if (parsed.agentId) {
      updates.agentId = parsed.agentId;
    }

    // Update error if provided
    if (parsed.error !== undefined) {
      updates.error = parsed.error;
    }

    // Update phases if a new phase is provided
    if (parsed.phase) {
      const phases = [...(deploy.phases as DeployPhase[])];

      // Find existing phase by name and update it
      const existingIdx = phases.findIndex((p) => p.name === parsed.phase!.name);
      if (existingIdx >= 0) {
        phases[existingIdx] = parsed.phase;
      } else {
        phases.push(parsed.phase);
      }

      updates.phases = phases;
    }

    const result = await db.update(deploys)
      .set(updates)
      .where(eq(deploys.id, id))
      .returning();

    // If deploy becomes "ready", update the linked agent status
    if (parsed.status === "ready" && parsed.agentId) {
      await db.update(agents)
        .set({
          status: "idle",
          deployId: id,
          updatedAt: now,
        })
        .where(eq(agents.id, parsed.agentId));

      logger.info({ deployId: id, agentId: parsed.agentId }, "Deploy completed, agent set to idle");
    }

    // If deploy failed, update linked agent if we have one
    if (parsed.status === "failed" && deploy.agentId) {
      await db.update(agents)
        .set({
          status: "error",
          updatedAt: now,
        })
        .where(eq(agents.id, deploy.agentId));
    }

    logger.info({ deployId: id, status: parsed.status }, "Deploy updated");

    return c.json({ success: true, data: result[0] });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return c.json({ success: false, error: "Validation failed", details: error.issues }, 400);
    }
    logger.error(error, "Failed to update deploy");
    return c.json({ success: false, error: "Failed to update deploy" }, 500);
  }
});

export default app;

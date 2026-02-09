// =============================================================================
// Agent Registration Route
// POST /api/agents — daemon registration (upsert)
//
// When an agent daemon boots, it announces itself here.
// - If the agent ID already exists → update (return 200)
// - If new → create (return 201)
// - Validates roleId/teamId exist (returns 400 if not)
// =============================================================================

import { Hono } from "hono";
import { db, agents, roles, teams } from "../db/index.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { RegisterAgentSchema } from "@hivemi/protocol";

const app = new Hono();

app.post("/", async (c) => {
  try {
    const body = await c.req.json();

    // Validate payload with Zod
    const parsed = RegisterAgentSchema.safeParse(body);
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

    // Validate that roleId exists
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.id, data.roleId))
      .limit(1);

    if (!role) {
      return c.json(
        { success: false, error: `Role not found: ${data.roleId}` },
        400,
      );
    }

    // Validate that teamId exists
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, data.teamId))
      .limit(1);

    if (!team) {
      return c.json(
        { success: false, error: `Team not found: ${data.teamId}` },
        400,
      );
    }

    // Check if agent with this ID already exists
    const [existing] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, data.id))
      .limit(1);

    const now = new Date();

    if (existing) {
      // UPDATE existing agent (redeploy scenario)
      const [updated] = await db
        .update(agents)
        .set({
          name: data.name,
          roleId: data.roleId,
          teamId: data.teamId,
          model: data.model,
          host: data.host,
          port: data.port,
          status: "idle",
          lastHeartbeat: now,
          version: data.version ?? null,
          openclawVersion: data.openclawVersion ?? null,
          cloud: data.cloud ?? null,
          capabilities: data.capabilities,
          updatedAt: now,
        })
        .where(eq(agents.id, data.id))
        .returning();

      logger.info({ agentId: data.id, name: data.name }, "Agent registered (updated)");
      return c.json({ success: true, data: updated }, 200);
    }

    // CREATE new agent
    const [created] = await db
      .insert(agents)
      .values({
        id: data.id,
        name: data.name,
        roleId: data.roleId,
        teamId: data.teamId,
        model: data.model,
        host: data.host,
        port: data.port,
        status: "idle",
        lastHeartbeat: now,
        version: data.version ?? null,
        openclawVersion: data.openclawVersion ?? null,
        cloud: data.cloud ?? null,
        capabilities: data.capabilities,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ agentId: data.id, name: data.name }, "Agent registered (created)");
    return c.json({ success: true, data: created }, 201);
  } catch (error) {
    logger.error(error, "Agent registration failed");
    return c.json(
      { success: false, error: "Agent registration failed" },
      500,
    );
  }
});

export default app;

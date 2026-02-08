// =============================================================================
// Agent Discovery — P2P Communication Support (Issue #56)
//
// Provides endpoint resolution for agent-to-agent direct messaging.
// An agent that wants to send a P2P message first calls:
//   GET /api/agents/:id/endpoint → { host, port, status, privateIp }
// Then sends the message directly to the agent's daemon HTTP server.
// =============================================================================

import { Hono } from "hono";
import { db, agents } from "../db/index.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const app = new Hono();

/**
 * GET /api/agents/:id/endpoint
 *
 * Returns the network endpoint for a specific agent, used for P2P discovery.
 * The caller can then directly POST messages to http://<host>:<port>/message.
 *
 * If the agent has a privateIp, callers on the same VPC should prefer it
 * over the public host for lower latency and no egress costs.
 *
 * Returns 404 if agent not found.
 * Returns 200 with status info even if agent is offline — the caller decides
 * whether to attempt communication based on the status field.
 */
app.get("/:id/endpoint", async (c) => {
  try {
    const id = c.req.param("id");

    const result = await db
      .select({
        id: agents.id,
        name: agents.name,
        host: agents.host,
        port: agents.port,
        status: agents.status,
        privateIp: agents.privateIp,
      })
      .from(agents)
      .where(eq(agents.id, id));

    if (result.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    const agent = result[0];

    return c.json({
      success: true,
      data: {
        id: agent.id,
        name: agent.name,
        host: agent.host,
        port: agent.port,
        status: agent.status,
        privateIp: agent.privateIp,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to resolve agent endpoint");
    return c.json({ success: false, error: "Failed to resolve agent endpoint" }, 500);
  }
});

/**
 * GET /api/agents/endpoints
 *
 * Returns endpoints for all active agents (status = idle | working).
 * Used for broadcast discovery — e.g., finding all agents available
 * for a brainstorming session.
 *
 * Supports optional query params:
 * - ?status=idle — filter by specific status
 * - ?roleId=<uuid> — filter by role
 * - ?teamId=<uuid> — filter by team
 */
app.get("/endpoints", async (c) => {
  try {
    const statusFilter = c.req.query("status");
    const roleId = c.req.query("roleId");
    const teamId = c.req.query("teamId");

    let query = db
      .select({
        id: agents.id,
        name: agents.name,
        host: agents.host,
        port: agents.port,
        status: agents.status,
        privateIp: agents.privateIp,
      })
      .from(agents)
      .$dynamic();

    if (statusFilter) {
      query = query.where(eq(agents.status, statusFilter as any));
    }
    if (roleId) {
      query = query.where(eq(agents.roleId, roleId));
    }
    if (teamId) {
      query = query.where(eq(agents.teamId, teamId));
    }

    const result = await query;

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(error, "Failed to list agent endpoints");
    return c.json({ success: false, error: "Failed to list agent endpoints" }, 500);
  }
});

export default app;

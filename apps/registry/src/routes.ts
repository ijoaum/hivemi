import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { db, agents, roles, teams, tasks, logs } from "./db/index.js";
import { eq, desc } from "drizzle-orm";
import { logger } from "./lib/logger.js";
import { 
  CreateAgentSchema, 
  CreateRoleSchema, 
  CreateTaskSchema 
} from "@hivemi/protocol";
import cloudSettings from "./routes/cloud-settings.js";
import telemetryRoutes from "./routes/telemetry.js";
import deployRoutes from "./routes/deploys.js";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", honoLogger());

// =============================================================================
// HEALTH
// =============================================================================

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// =============================================================================
// TEAMS
// =============================================================================

app.get("/api/teams", async (c) => {
  try {
    const result = await db.select().from(teams);
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Failed to fetch teams");
    return c.json({ success: false, error: "Failed to fetch teams" }, 500);
  }
});

app.post("/api/teams", async (c) => {
  try {
    const body = await c.req.json();
    const result = await db.insert(teams).values(body).returning();
    return c.json({ success: true, data: result[0] }, 201);
  } catch (error) {
    logger.error(error, "Failed to create team");
    return c.json({ success: false, error: "Failed to create team" }, 500);
  }
});

// =============================================================================
// ROLES
// =============================================================================

app.get("/api/roles", async (c) => {
  try {
    const result = await db.select().from(roles);
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Failed to fetch roles");
    return c.json({ success: false, error: "Failed to fetch roles" }, 500);
  }
});

app.get("/api/roles/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db.select().from(roles).where(eq(roles.id, id));
    if (result.length === 0) {
      return c.json({ success: false, error: "Role not found" }, 404);
    }
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to fetch role");
    return c.json({ success: false, error: "Failed to fetch role" }, 500);
  }
});

app.post("/api/roles", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateRoleSchema.parse(body);
    const result = await db.insert(roles).values(parsed).returning();
    return c.json({ success: true, data: result[0] }, 201);
  } catch (error) {
    logger.error(error, "Failed to create role");
    return c.json({ success: false, error: "Failed to create role" }, 500);
  }
});

app.put("/api/roles/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const result = await db.update(roles)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Role not found" }, 404);
    }
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to update role");
    return c.json({ success: false, error: "Failed to update role" }, 500);
  }
});

app.delete("/api/roles/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db.delete(roles).where(eq(roles.id, id)).returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Role not found" }, 404);
    }
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to delete role");
    return c.json({ success: false, error: "Failed to delete role" }, 500);
  }
});

// =============================================================================
// AGENTS
// =============================================================================

app.get("/api/agents", async (c) => {
  try {
    const result = await db
      .select({
        id: agents.id,
        name: agents.name,
        roleId: agents.roleId,
        teamId: agents.teamId,
        status: agents.status,
        model: agents.model,
        host: agents.host,
        port: agents.port,
        currentTaskId: agents.currentTaskId,
        lastHeartbeat: agents.lastHeartbeat,
        createdAt: agents.createdAt,
        updatedAt: agents.updatedAt,
        role: {
          id: roles.id,
          name: roles.name,
          slug: roles.slug,
          icon: roles.icon,
          color: roles.color,
          description: roles.description,
          capabilities: roles.capabilities,
        },
        team: {
          id: teams.id,
          name: teams.name,
          emoji: teams.emoji,
          color: teams.color,
        },
      })
      .from(agents)
      .leftJoin(roles, eq(agents.roleId, roles.id))
      .leftJoin(teams, eq(agents.teamId, teams.id));
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Failed to fetch agents");
    return c.json({ success: false, error: "Failed to fetch agents" }, 500);
  }
});

app.get("/api/agents/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db
      .select({
        id: agents.id,
        name: agents.name,
        roleId: agents.roleId,
        teamId: agents.teamId,
        status: agents.status,
        model: agents.model,
        host: agents.host,
        port: agents.port,
        currentTaskId: agents.currentTaskId,
        lastHeartbeat: agents.lastHeartbeat,
        createdAt: agents.createdAt,
        updatedAt: agents.updatedAt,
        role: {
          id: roles.id,
          name: roles.name,
          slug: roles.slug,
          icon: roles.icon,
          color: roles.color,
          description: roles.description,
          capabilities: roles.capabilities,
        },
        team: {
          id: teams.id,
          name: teams.name,
          emoji: teams.emoji,
          color: teams.color,
        },
      })
      .from(agents)
      .leftJoin(roles, eq(agents.roleId, roles.id))
      .leftJoin(teams, eq(agents.teamId, teams.id))
      .where(eq(agents.id, id));
    if (result.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to fetch agent");
    return c.json({ success: false, error: "Failed to fetch agent" }, 500);
  }
});

app.post("/api/agents", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateAgentSchema.parse(body);
    const result = await db.insert(agents).values(parsed).returning();
    logger.info({ agent: result[0] }, "Agent created");
    return c.json({ success: true, data: result[0] }, 201);
  } catch (error) {
    logger.error(error, "Failed to create agent");
    return c.json({ success: false, error: "Failed to create agent" }, 500);
  }
});

app.put("/api/agents/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const result = await db.update(agents)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to update agent");
    return c.json({ success: false, error: "Failed to update agent" }, 500);
  }
});

app.delete("/api/agents/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db.delete(agents).where(eq(agents.id, id)).returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }
    logger.info({ agentId: id }, "Agent deleted");
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to delete agent");
    return c.json({ success: false, error: "Failed to delete agent" }, 500);
  }
});

app.post("/api/agents/:id/heartbeat", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db.update(agents)
      .set({ lastHeartbeat: new Date(), status: "idle" })
      .where(eq(agents.id, id))
      .returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to update heartbeat");
    return c.json({ success: false, error: "Failed to update heartbeat" }, 500);
  }
});

// =============================================================================
// TASKS
// =============================================================================

app.get("/api/tasks", async (c) => {
  try {
    const status = c.req.query("status");
    const teamId = c.req.query("teamId");
    const roleTarget = c.req.query("roleTarget");
    const limit = c.req.query("limit");
    
    let query = db.select().from(tasks).orderBy(desc(tasks.createdAt)).$dynamic();
    
    if (status) {
      query = query.where(eq(tasks.status, status as any));
    }
    if (teamId) {
      query = query.where(eq(tasks.teamId, teamId));
    }
    if (roleTarget) {
      query = query.where(eq(tasks.roleTarget, roleTarget));
    }
    if (limit) {
      query = query.limit(Math.min(parseInt(limit), 500));
    }
    
    const result = await query;
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Failed to fetch tasks");
    return c.json({ success: false, error: "Failed to fetch tasks" }, 500);
  }
});

app.get("/api/tasks/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db.select().from(tasks).where(eq(tasks.id, id));
    if (result.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to fetch task");
    return c.json({ success: false, error: "Failed to fetch task" }, 500);
  }
});

app.post("/api/tasks", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateTaskSchema.parse(body);
    const result = await db.insert(tasks).values(parsed).returning();
    logger.info({ task: result[0] }, "Task created");
    return c.json({ success: true, data: result[0] }, 201);
  } catch (error) {
    logger.error(error, "Failed to create task");
    return c.json({ success: false, error: "Failed to create task" }, 500);
  }
});

app.put("/api/tasks/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const result = await db.update(tasks)
      .set(body)
      .where(eq(tasks.id, id))
      .returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to update task");
    return c.json({ success: false, error: "Failed to update task" }, 500);
  }
});

app.post("/api/tasks/:id/retry", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db.update(tasks)
      .set({ status: "queued", error: null, startedAt: null, completedAt: null })
      .where(eq(tasks.id, id))
      .returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    logger.info({ taskId: id }, "Task retried");
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to retry task");
    return c.json({ success: false, error: "Failed to retry task" }, 500);
  }
});

app.post("/api/tasks/:id/cancel", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db.update(tasks)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    logger.info({ taskId: id }, "Task cancelled");
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to cancel task");
    return c.json({ success: false, error: "Failed to cancel task" }, 500);
  }
});

app.delete("/api/tasks/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await db.delete(tasks).where(eq(tasks.id, id)).returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Task not found" }, 404);
    }
    logger.info({ taskId: id }, "Task deleted");
    return c.json({ success: true, data: result[0] });
  } catch (error) {
    logger.error(error, "Failed to delete task");
    return c.json({ success: false, error: "Failed to delete task" }, 500);
  }
});

// =============================================================================
// LOGS
// =============================================================================

app.get("/api/logs", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "100");
    const result = await db.select().from(logs).orderBy(desc(logs.timestamp)).limit(limit);
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error(error, "Failed to fetch logs");
    return c.json({ success: false, error: "Failed to fetch logs" }, 500);
  }
});

app.post("/api/logs", async (c) => {
  try {
    const body = await c.req.json();
    const result = await db.insert(logs).values(body).returning();
    return c.json({ success: true, data: result[0] }, 201);
  } catch (error) {
    logger.error(error, "Failed to create log");
    return c.json({ success: false, error: "Failed to create log" }, 500);
  }
});

// =============================================================================
// SETTINGS — Cloud Config
// =============================================================================

app.route("/api/settings/cloud", cloudSettings);

// =============================================================================
// TELEMETRY
// =============================================================================

app.route("/api/agents", telemetryRoutes);
app.route("/api/telemetry", telemetryRoutes);

// =============================================================================
// DEPLOYS
// =============================================================================

app.route("/api/deploys", deployRoutes);

export default app;

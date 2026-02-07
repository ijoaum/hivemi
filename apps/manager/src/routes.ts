import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "./lib/logger.js";
import { registryClient } from "./lib/registry-client.js";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", honoLogger());

// =============================================================================
// HEALTH
// =============================================================================

app.get("/", (c) => {
  return c.json({ 
    name: "HiveMI Manager",
    version: "0.1.0",
    docs: "/health, /api/status, /api/demands",
    timestamp: new Date().toISOString() 
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok", service: "manager", timestamp: new Date().toISOString() });
});

// =============================================================================
// DEMANDS - External task entry point
// =============================================================================

app.post("/api/demands", async (c) => {
  try {
    const body = await c.req.json();
    
    // Validate input
    const { title, description, priority, teamId, input } = body;
    if (!title || !teamId) {
      return c.json({ success: false, error: "title and teamId are required" }, 400);
    }

    logger.info({ title, teamId }, "Received new demand");

    // Create task in registry
    const taskResult = await registryClient.createTask({
      title,
      description,
      priority: priority || "medium",
      teamId,
      input,
    });

    if (!taskResult.success || !taskResult.data) {
      return c.json({ success: false, error: "Failed to create task" }, 500);
    }

    const task = taskResult.data;
    logger.info({ taskId: task.id }, "Task created");

    // Try to assign to an available agent
    const agent = await registryClient.getAvailableAgent(teamId);
    
    if (agent) {
      // Assign task to agent
      await registryClient.updateTaskStatus(task.id, "running");
      await registryClient.updateAgentStatus(agent.id, "working", task.id);
      
      logger.info({ taskId: task.id, agentId: agent.id, agentName: agent.name }, "Task assigned to agent");
      
      // In a real implementation, we would send the task to the agent via P2P
      // For now, just mark it as assigned
      
      return c.json({ 
        success: true, 
        data: { 
          task: { ...task, status: "running" }, 
          assignedTo: { id: agent.id, name: agent.name } 
        } 
      }, 201);
    } else {
      logger.info({ taskId: task.id }, "No available agent, task queued");
      return c.json({ 
        success: true, 
        data: { task, assignedTo: null, message: "Task queued, waiting for available agent" } 
      }, 201);
    }
  } catch (error) {
    logger.error(error, "Failed to process demand");
    return c.json({ success: false, error: "Failed to process demand" }, 500);
  }
});

// =============================================================================
// STATUS - Dashboard data
// =============================================================================

app.get("/api/status", async (c) => {
  try {
    const [agentsRes, rolesRes, teamsRes] = await Promise.all([
      registryClient.getAgents(),
      registryClient.getRoles(),
      registryClient.getTeams(),
    ]);

    const agents = agentsRes.data || [];
    const roles = rolesRes.data || [];
    const teams = teamsRes.data || [];

    const status = {
      agents: {
        total: agents.length,
        online: agents.filter((a) => a.status !== "offline").length,
        working: agents.filter((a) => a.status === "working").length,
        idle: agents.filter((a) => a.status === "idle").length,
        error: agents.filter((a) => a.status === "error").length,
      },
      roles: roles.length,
      teams: teams.length,
      timestamp: new Date().toISOString(),
    };

    return c.json({ success: true, data: status });
  } catch (error) {
    logger.error(error, "Failed to fetch status");
    return c.json({ success: false, error: "Failed to fetch status" }, 500);
  }
});

// =============================================================================
// PROXY - Pass through to registry for dashboard
// =============================================================================

app.get("/api/agents", async (c) => {
  const result = await registryClient.getAgents();
  return c.json(result);
});

app.get("/api/roles", async (c) => {
  const result = await registryClient.getRoles();
  return c.json(result);
});

app.get("/api/teams", async (c) => {
  const result = await registryClient.getTeams();
  return c.json(result);
});

export default app;

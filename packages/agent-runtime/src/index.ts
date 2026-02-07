import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { v4 as uuid } from "crypto";
import type { P2PMessage, Task } from "@hivemi/protocol";
import type { AgentConfig, AgentRuntime, TaskHandler, MessageHandler } from "./types.js";
import { createLogger } from "./logger.js";

export function createAgent(config: AgentConfig): AgentRuntime {
  const logger = createLogger(`agent:${config.name}`);
  const app = new Hono();
  
  let taskHandler: TaskHandler | null = null;
  let messageHandler: MessageHandler | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let server: ReturnType<typeof serve> | null = null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.secret) {
    headers["Authorization"] = `Bearer ${config.secret}`;
  }

  // Health endpoint
  app.get("/health", (c) => {
    return c.json({ 
      status: "ok", 
      agent: config.name, 
      id: config.id,
      timestamp: new Date().toISOString() 
    });
  });

  // Receive task assignment
  app.post("/task", async (c) => {
    try {
      const task = await c.req.json() as Task;
      logger.info({ taskId: task.id, title: task.title }, "Received task");
      
      if (!taskHandler) {
        return c.json({ success: false, error: "No task handler registered" }, 500);
      }

      // Process task asynchronously
      processTask(task).catch(err => {
        logger.error(err, "Task processing failed");
      });

      return c.json({ success: true, message: "Task accepted" });
    } catch (error) {
      logger.error(error, "Failed to receive task");
      return c.json({ success: false, error: "Failed to process task" }, 500);
    }
  });

  // Receive P2P message
  app.post("/message", async (c) => {
    try {
      const message = await c.req.json() as P2PMessage;
      logger.info({ type: message.type, from: message.from }, "Received message");
      
      if (message.type === "agent:ping") {
        return c.json({ 
          id: crypto.randomUUID(),
          type: "agent:pong",
          from: config.id,
          to: message.from,
          payload: { timestamp: new Date().toISOString() },
          timestamp: new Date(),
        });
      }

      if (messageHandler) {
        const response = await messageHandler(message);
        return c.json({ success: true, data: response });
      }

      return c.json({ success: true });
    } catch (error) {
      logger.error(error, "Failed to process message");
      return c.json({ success: false, error: "Failed to process message" }, 500);
    }
  });

  async function processTask(task: Task) {
    if (!taskHandler) return;

    // Update status to working
    await updateStatus("working", task.id);

    try {
      const result = await taskHandler(task);
      
      // Report completion
      await fetch(`${config.registryUrl}/api/tasks/${task.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          status: result.error ? "failed" : "completed",
          output: result.output,
          error: result.error,
          completedAt: new Date(),
        }),
      });

      await updateStatus("idle", null);
      logger.info({ taskId: task.id }, "Task completed");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      await fetch(`${config.registryUrl}/api/tasks/${task.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          status: "failed",
          error: errorMessage,
          completedAt: new Date(),
        }),
      });

      await updateStatus("error", null);
      logger.error(error, "Task failed");
    }
  }

  async function updateStatus(status: string, currentTaskId: string | null) {
    try {
      await fetch(`${config.registryUrl}/api/agents/${config.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status, currentTaskId }),
      });
    } catch (error) {
      logger.error(error, "Failed to update status");
    }
  }

  async function sendHeartbeat() {
    try {
      await fetch(`${config.registryUrl}/api/agents/${config.id}/heartbeat`, {
        method: "POST",
        headers,
      });
    } catch (error) {
      logger.error(error, "Heartbeat failed");
    }
  }

  async function register() {
    try {
      // Check if agent exists
      const checkRes = await fetch(`${config.registryUrl}/api/agents/${config.id}`, { headers });
      
      if (checkRes.status === 404) {
        // Register new agent
        await fetch(`${config.registryUrl}/api/agents`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: config.id,
            name: config.name,
            roleId: config.roleId,
            teamId: config.teamId,
            model: config.model,
            host: `http://localhost`,
            port: config.port,
          }),
        });
        logger.info("Registered with registry");
      } else {
        // Update existing
        await updateStatus("idle", null);
        logger.info("Reconnected to registry");
      }
    } catch (error) {
      logger.error(error, "Failed to register with registry");
      throw error;
    }
  }

  return {
    async start() {
      logger.info({ port: config.port }, "Starting agent...");
      
      await register();
      
      server = serve({ fetch: app.fetch, port: config.port }, (info) => {
        logger.info({ port: info.port }, `🐝 Agent ${config.name} running`);
      });

      // Start heartbeat
      heartbeatInterval = setInterval(sendHeartbeat, 30000);
      await sendHeartbeat();
    },

    async stop() {
      logger.info("Stopping agent...");
      
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      
      await updateStatus("offline", null);
      
      // Note: @hono/node-server doesn't expose close() directly
      // In production, would need to handle this differently
      logger.info("Agent stopped");
    },

    async sendMessage(to: string, type: P2PMessage["type"], payload: unknown) {
      // First, lookup agent address from registry
      const res = await fetch(`${config.registryUrl}/api/agents/${to}`, { headers });
      const data = await res.json() as { success: boolean; data?: { host: string; port: number } };
      
      if (!data.success || !data.data) {
        throw new Error(`Agent ${to} not found`);
      }

      const { host, port } = data.data;
      const message: P2PMessage = {
        id: crypto.randomUUID(),
        type,
        from: config.id,
        to,
        payload,
        timestamp: new Date(),
      };

      const msgRes = await fetch(`${host}:${port}/message`, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      });

      return msgRes.json();
    },

    onTask(handler: TaskHandler) {
      taskHandler = handler;
    },

    onMessage(handler: MessageHandler) {
      messageHandler = handler;
    },
  };
}

export * from "./types.js";
export { createLogger } from "./logger.js";

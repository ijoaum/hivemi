// =============================================================================
// Deploy Routes
// Manager API endpoints for deploy lifecycle management
//
// POST   /api/deploy              — Start a new deploy
// GET    /api/deploy/:id          — Get deploy status
// DELETE /api/deploy/:id          — Undeploy (destroy VM)
// POST   /api/deploy/:id/redeploy — Destroy and recreate
// POST   /api/deploy/:id/retry    — Retry failed deploy from a phase
// GET    /api/deploy/:id/stream   — SSE event stream for deploy progress
// =============================================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../lib/logger.js";
import type { DeployOrchestrator, DeployEvent } from "../lib/deploy-orchestrator.js";
import { UndeployBlockedError } from "../lib/deploy-orchestrator.js";
import { registryClient } from "../lib/registry-client.js";

export function createDeployRoutes(orchestrator: DeployOrchestrator): Hono {
  const app = new Hono();

  // ===========================================================================
  // POST /api/deploy — Start a new deploy
  // ===========================================================================

  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { name, roleId, teamId, model, cloudProvider, region, instanceSize } = body;

      // Validate required fields
      if (!name || !roleId || !teamId || !model) {
        return c.json(
          {
            success: false,
            error: "Missing required fields: name, roleId, teamId, model",
          },
          400,
        );
      }

      const result = await orchestrator.startDeploy({
        name,
        roleId,
        teamId,
        model,
        cloudProvider,
        region,
        instanceSize,
      });

      logger.info({ deployId: result.deployId, agentId: result.agentId }, "Deploy initiated");

      return c.json(
        {
          success: true,
          data: {
            deployId: result.deployId,
            agentId: result.agentId,
            message: "Deploy initiated. Use GET /api/deploy/:id/stream for progress.",
          },
        },
        202,
      );
    } catch (err) {
      const error = err as Error;
      logger.error({ error: error.message }, "Failed to start deploy");
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  // ===========================================================================
  // GET /api/deploy/:id — Get deploy status
  // ===========================================================================

  app.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");

      // Check in-memory state first (for active deploys)
      const activeState = orchestrator.getDeployState(id);
      if (activeState) {
        return c.json({
          success: true,
          data: activeState,
          source: "live",
        });
      }

      // Fall back to registry
      const result = await registryClient.getDeploy(id);
      if (!result.success || !result.data) {
        return c.json({ success: false, error: "Deploy not found" }, 404);
      }

      return c.json({
        success: true,
        data: result.data,
        source: "registry",
      });
    } catch (err) {
      logger.error({ error: (err as Error).message }, "Failed to get deploy status");
      return c.json({ success: false, error: "Failed to get deploy status" }, 500);
    }
  });

  // ===========================================================================
  // DELETE /api/deploy/:id — Undeploy (destroy VM and cleanup)
  //
  // Query params:
  //   force (optional) — "true" to force destroy even if agent is working
  //
  // Returns:
  //   200 — destroyed successfully
  //   409 — agent is working, use force=true to override
  //   404 — deploy not found
  // ===========================================================================

  app.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const force = c.req.query("force") === "true";

      await orchestrator.undeploy(id, { force });

      return c.json({
        success: true,
        data: { message: "Deploy destroyed successfully" },
      });
    } catch (err) {
      if (err instanceof UndeployBlockedError) {
        return c.json({
          success: false,
          error: err.message,
          agentId: err.agentId,
          deployId: err.deployId,
          blocked: true,
        }, 409);
      }
      const error = err as Error;
      logger.error({ error: error.message }, "Failed to undeploy");
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  // ===========================================================================
  // POST /api/deploy/:id/redeploy — Destroy and recreate
  // ===========================================================================

  app.post("/:id/redeploy", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const { name, roleId, teamId, model, cloudProvider, region, instanceSize } = body;

      if (!name || !roleId || !teamId || !model) {
        return c.json(
          {
            success: false,
            error: "Missing required fields: name, roleId, teamId, model",
          },
          400,
        );
      }

      const result = await orchestrator.redeploy(id, {
        name,
        roleId,
        teamId,
        model,
        cloudProvider,
        region,
        instanceSize,
      });

      return c.json(
        {
          success: true,
          data: {
            deployId: result.deployId,
            agentId: result.agentId,
            message: "Redeploy initiated",
          },
        },
        202,
      );
    } catch (err) {
      const error = err as Error;
      logger.error({ error: error.message }, "Failed to redeploy");
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  // ===========================================================================
  // GET /api/deploy/:id/stream — SSE event stream for deploy progress
  // ===========================================================================

  app.get("/:id/stream", async (c) => {
    const deployId = c.req.param("id");

    // Verify deploy exists
    const activeState = orchestrator.getDeployState(deployId);
    if (!activeState) {
      const result = await registryClient.getDeploy(deployId);
      if (!result.success || !result.data) {
        return c.json({ success: false, error: "Deploy not found" }, 404);
      }

      // Deploy exists but is no longer active (completed/failed)
      // Send final state and close
      const deploy = result.data;
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: "status_change",
          data: JSON.stringify({
            type: "status_change",
            deployId,
            timestamp: new Date().toISOString(),
            data: { status: deploy.status, phases: deploy.phases },
          }),
        });
        await stream.writeSSE({
          event: "complete",
          data: JSON.stringify({
            type: "complete",
            deployId,
            timestamp: new Date().toISOString(),
            data: { status: deploy.status },
          }),
        });
      });
    }

    // Stream live events
    return streamSSE(c, async (stream) => {
      // Send current state immediately
      await stream.writeSSE({
        event: "status_change",
        data: JSON.stringify({
          type: "status_change",
          deployId,
          timestamp: new Date().toISOString(),
          data: { status: activeState.status, phases: activeState.phases },
        }),
      });

      // Listen for events
      const listener = async (event: DeployEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });

          // Close stream on completion or error
          if (event.type === "complete" || event.type === "error") {
            stream.abort();
          }
        } catch {
          // Client disconnected
          orchestrator.removeListener(`deploy:${deployId}`, listener);
        }
      };

      orchestrator.on(`deploy:${deployId}`, listener);

      // Heartbeat to keep connection alive
      const heartbeatInterval = setInterval(async () => {
        try {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: new Date().toISOString() }),
          });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15_000);

      // Cleanup on stream close
      stream.onAbort(() => {
        clearInterval(heartbeatInterval);
        orchestrator.removeListener(`deploy:${deployId}`, listener);
      });

      // Keep stream alive until deploy completes or client disconnects
      // We rely on the listener callback to close the stream
      await new Promise<void>((resolve) => {
        const checkDone = () => {
          const state = orchestrator.getDeployState(deployId);
          if (!state || state.status === "ready" || state.status === "failed" || state.status === "destroyed") {
            resolve();
          }
        };

        // Check periodically
        const pollInterval = setInterval(() => {
          checkDone();
        }, 5_000);

        stream.onAbort(() => {
          clearInterval(pollInterval);
          resolve();
        });
      });
    });
  });

  return app;
}

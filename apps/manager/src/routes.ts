// =============================================================================
// Manager Routes
// Central API for the HiveMI Manager — orchestrates deploys and tasks
// =============================================================================

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { authMiddleware } from "@hivemi/protocol";
import { logger } from "./lib/logger.js";
import { registryClient } from "./lib/registry-client.js";
import { DeployOrchestrator } from "./lib/deploy-orchestrator.js";
import { createDeployRoutes } from "./routes/deploy.js";
import taskRoutes from "./routes/tasks.js";
import infraRoutes from "./routes/infra.js";
import { invalidateManagerCostCache } from "./routes/infra.js";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", honoLogger());

// HIVEMI_SECRET auth — validates Bearer token on all /api/* routes.
// Skips /health for load balancer probes. In dev (no HIVEMI_SECRET), allows all.
app.use("/api/*", authMiddleware);

// =============================================================================
// HEALTH
// =============================================================================

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "manager",
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// DEPLOY ORCHESTRATOR SETUP
// =============================================================================

// The orchestrator is initialized lazily on first deploy request.
// This avoids requiring cloud config at startup.
let _orchestrator: DeployOrchestrator | null = null;

async function getOrchestrator(): Promise<DeployOrchestrator> {
  if (_orchestrator) return _orchestrator;

  const controlPlaneIp = process.env.CONTROL_PLANE_IP || "127.0.0.1";

  // Create a lightweight provisioner wrapper that calls the registry
  // for cloud config, then delegates to the actual provider.
  // The real provider is created on-demand based on cloud config.
  const provisionerProxy = createProvisionerProxy();
  const bootstrapperProxy = createBootstrapperProxy();

  _orchestrator = new DeployOrchestrator({
    registry: registryClient,
    provisioner: provisionerProxy,
    bootstrapper: bootstrapperProxy,
    controlPlaneIp,
  });

  logger.info("Deploy orchestrator initialized");
  return _orchestrator;
}

// ---------------------------------------------------------------------------
// Provisioner Proxy — lazy loads the actual cloud provider
// ---------------------------------------------------------------------------

function createProvisionerProxy() {
  let _provider: any = null;

  async function getProvider() {
    if (_provider) return _provider;

    // Dynamic import to avoid requiring provisioner at startup
    const { createProvider } = await import("@hivemi/provisioner");
    const cloudConfig = await registryClient.getCloudConfig();
    if (!cloudConfig || !cloudConfig.apiToken) {
      throw new Error("Cloud config not available. Configure cloud settings first.");
    }

    _provider = createProvider(cloudConfig.provider as "digitalocean" | "gcp", {
      token: cloudConfig.apiToken,
      defaultRegion: cloudConfig.region,
    });

    return _provider;
  }

  return {
    async createInstance(spec: any) {
      const provider = await getProvider();
      return provider.createInstance(spec);
    },
    async waitReady(id: string, options?: any) {
      const provider = await getProvider();
      return provider.waitReady(id, options);
    },
    async destroyInstance(id: string) {
      const provider = await getProvider();
      return provider.destroyInstance(id);
    },
    async ensureSSHKey(name: string, publicKey: string) {
      const provider = await getProvider();
      return provider.ensureSSHKey(name, publicKey);
    },
    async ensureFirewall(name: string, _rules: any[]) {
      const provider = await getProvider();
      const { createDefaultRules } = await import("@hivemi/provisioner");
      const controlPlaneIp = process.env.CONTROL_PLANE_IP || "127.0.0.1";
      const defaultRules = createDefaultRules(controlPlaneIp);
      return provider.ensureFirewall(name, defaultRules);
    },
    async addInstanceToFirewall(firewallId: string, instanceId: string) {
      const provider = await getProvider();
      return provider.addInstanceToFirewall(firewallId, instanceId);
    },
    async removeInstanceFromFirewall(firewallId: string, instanceId: string) {
      const provider = await getProvider();
      return provider.removeInstanceFromFirewall(firewallId, instanceId);
    },
  };
}

// ---------------------------------------------------------------------------
// Bootstrapper Proxy — lazy loads the bootstrapper
// ---------------------------------------------------------------------------

function createBootstrapperProxy() {
  // Cache the imported generateCloudInit function
  let cachedGenerateCloudInit: ((sshPublicKey: string, context?: any) => string) | null = null;

  return {
    async bootstrap(config: any, options?: any) {
      const { bootstrap } = await import("@hivemi/bootstrapper");
      return bootstrap(config, options);
    },
    generateCloudInit(sshPublicKey: string, context?: any) {
      // Lazy-load the real implementation from @hivemi/bootstrapper
      // Since generateCloudInit is synchronous, we cache it on first call
      if (!cachedGenerateCloudInit) {
        try {
          // Dynamic require for synchronous access — the module should be available
          // since @hivemi/bootstrapper is a workspace dependency
          const mod = require("@hivemi/bootstrapper");
          cachedGenerateCloudInit = mod.generateCloudInit;
        } catch {
          // Fallback: shouldn't happen in production, but provide a safe default
          cachedGenerateCloudInit = (key: string, ctx: any = {}) => {
            const { enableSwap = true, swapSizeMb = 2048, hostname = "hivemi-agent" } = ctx;
            const swapSection = enableSwap
              ? `swap:\n  filename: /swapfile\n  size: ${swapSizeMb * 1024 * 1024}\n  maxsize: ${swapSizeMb * 1024 * 1024}`
              : "# swap disabled";
            return `#cloud-config\nhostname: ${hostname}\nmanage_etc_hosts: true\nusers:\n  - name: openclaw\n    shell: /bin/bash\n    sudo: ALL=(ALL) NOPASSWD:ALL\n    lock_passwd: true\n    ssh_authorized_keys:\n      - ${key}\npackage_update: true\npackages:\n  - curl\n  - jq\n  - git\n${swapSection}\nruncmd:\n  - touch /tmp/hivemi-cloud-init-done\n  - chown openclaw:openclaw /tmp/hivemi-cloud-init-done\nfinal_message: "HiveMI cloud-init complete for ${hostname} after $UPTIME seconds"\n`;
          };
        }
      }
      return cachedGenerateCloudInit!(sshPublicKey, context);
    },
  };
}

// =============================================================================
// DEPLOY ROUTES — Proxied through lazy orchestrator
// =============================================================================

// GET /api/deploy — List all deploys
app.get("/api/deploy", async (c) => {
  try {
    const status = c.req.query("status");
    const limit = c.req.query("limit");
    const result = await registryClient.getDeploys({
      status: status || undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
    if (!result.success) {
      return c.json({ success: false, error: result.error || "Failed to list deploys" }, 500);
    }

    // Enrich with live state for active deploys
    const orch = _orchestrator;
    const deploys = (result.data || []).map((d: any) => {
      if (orch) {
        const live = orch.getDeployState(d.id);
        if (live) {
          return { ...d, ...live, source: "live" };
        }
      }
      return { ...d, source: "registry" };
    });

    return c.json({ success: true, data: deploys });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500);
  }
});

// We need to wrap the deploy routes to inject the orchestrator lazily
app.post("/api/deploy", async (c) => {
  const orch = await getOrchestrator();
  const routes = createDeployRoutes(orch);
  return routes.fetch(new Request(c.req.url, {
    method: "POST",
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  }), c.env);
});

app.get("/api/deploy/:id", async (c) => {
  const orch = await getOrchestrator();
  const id = c.req.param("id");

  // Check in-memory state first
  const activeState = orch.getDeployState(id);
  if (activeState) {
    return c.json({ success: true, data: activeState, source: "live" });
  }

  // Fall back to registry
  const result = await registryClient.getDeploy(id);
  if (!result.success || !result.data) {
    return c.json({ success: false, error: "Deploy not found" }, 404);
  }

  return c.json({ success: true, data: result.data, source: "registry" });
});

app.delete("/api/deploy/:id", async (c) => {
  try {
    const orch = await getOrchestrator();
    const id = c.req.param("id");
    await orch.undeploy(id);
    invalidateManagerCostCache(); // Infra changed — invalidate cost cache
    return c.json({ success: true, data: { message: "Deploy destroyed successfully" } });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500);
  }
});

app.post("/api/deploy/:id/redeploy", async (c) => {
  try {
    const orch = await getOrchestrator();
    const id = c.req.param("id");
    const body = await c.req.json();
    const { name, roleId, teamId, model, cloudProvider, region, instanceSize } = body;

    if (!name || !roleId || !teamId || !model) {
      return c.json(
        { success: false, error: "Missing required fields: name, roleId, teamId, model" },
        400,
      );
    }

    const result = await orch.redeploy(id, {
      name, roleId, teamId, model, cloudProvider, region, instanceSize,
    });

    invalidateManagerCostCache(); // Infra changed — invalidate cost cache
    return c.json({ success: true, data: { ...result, message: "Redeploy initiated" } }, 202);
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500);
  }
});

app.post("/api/deploy/:id/retry", async (c) => {
  try {
    const orch = await getOrchestrator();
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const { phase } = body as { phase?: string };

    await orch.retryPhase(id, phase);

    return c.json({
      success: true,
      data: { message: `Retry initiated${phase ? ` from phase "${phase}"` : ""}` },
    }, 202);
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500);
  }
});

app.get("/api/deploy/:id/stream", async (c) => {
  const orch = await getOrchestrator();
  const deployId = c.req.param("id");

  // Verify deploy exists
  const activeState = orch.getDeployState(deployId);

  if (!activeState) {
    const result = await registryClient.getDeploy(deployId);
    if (!result.success || !result.data) {
      return c.json({ success: false, error: "Deploy not found" }, 404);
    }

    // Already completed — send final state
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    const deploy = result.data;
    const event = JSON.stringify({
      type: "complete",
      deployId,
      timestamp: new Date().toISOString(),
      data: { status: deploy.status, phases: deploy.phases, error: deploy.error },
    });

    return c.body(`event: complete\ndata: ${event}\n\n`);
  }

  // Stream live events using SSE
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send current state
      const initialEvent = JSON.stringify({
        type: "status_change",
        deployId,
        timestamp: new Date().toISOString(),
        data: { status: activeState.status, phases: activeState.phases },
      });
      controller.enqueue(encoder.encode(`event: status_change\ndata: ${initialEvent}\n\n`));

      // Listen for events
      const listener = (event: any) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));

          if (event.type === "complete" || event.type === "error") {
            cleanup();
            controller.close();
          }
        } catch {
          cleanup();
        }
      };

      // Heartbeat
      const heartbeat = setInterval(() => {
        try {
          const hb = JSON.stringify({ timestamp: new Date().toISOString() });
          controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${hb}\n\n`));
        } catch {
          cleanup();
        }
      }, 15_000);

      function cleanup() {
        clearInterval(heartbeat);
        orch.removeListener(`deploy:${deployId}`, listener);
      }

      orch.on(`deploy:${deployId}`, listener);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});

// =============================================================================
// TASK ROUTES
// =============================================================================

app.route("/api/tasks", taskRoutes);

// =============================================================================
// INFRA ROUTES — Reconciliation & Cost Estimation
// =============================================================================

app.route("/api/infra", infraRoutes);

// =============================================================================
// DEMANDS — Legacy task entry point (kept for backward compatibility)
// =============================================================================

app.post("/api/demands", async (c) => {
  try {
    const body = await c.req.json();

    const { title, description, priority, teamId, input } = body;
    if (!title || !teamId) {
      return c.json({ success: false, error: "title and teamId are required" }, 400);
    }

    logger.info({ title, teamId }, "Received new demand");

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
      await registryClient.updateTaskStatus(task.id, "locked");
      await registryClient.updateAgentStatus(agent.id, "working", task.id);

      logger.info(
        { taskId: task.id, agentId: agent.id, agentName: agent.name },
        "Task assigned to agent",
      );

      return c.json(
        {
          success: true,
          data: {
            task: { ...task, status: "locked" },
            assignedTo: { id: agent.id, name: agent.name },
          },
        },
        201,
      );
    }

    logger.info({ taskId: task.id }, "No available agent, task queued");
    return c.json(
      {
        success: true,
        data: { task, assignedTo: null, message: "Task queued, waiting for available agent" },
      },
      201,
    );
  } catch (error) {
    logger.error(error, "Failed to process demand");
    return c.json({ success: false, error: "Failed to process demand" }, 500);
  }
});

// =============================================================================
// STATUS — Dashboard data
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
        online: agents.filter((a: any) => a.status !== "offline" && a.status !== "destroyed").length,
        working: agents.filter((a: any) => a.status === "working").length,
        idle: agents.filter((a: any) => a.status === "idle").length,
        error: agents.filter((a: any) => a.status === "error").length,
        provisioning: agents.filter((a: any) => a.status === "provisioning").length,
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
// PROXY — Pass through to registry for dashboard
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

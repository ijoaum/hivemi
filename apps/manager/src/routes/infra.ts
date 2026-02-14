// =============================================================================
// Infra Routes
// Reconciliation and cost estimation API endpoints
// Issue #83: Enhanced with trigger endpoint, auto-fix, and last result caching
// =============================================================================

import { Hono } from "hono";
import { registryClient } from "../lib/registry-client.js";
import { logger } from "../lib/logger.js";

const infraRoutes = new Hono();

// ---------------------------------------------------------------------------
// Shared: Lazy-load provider and provisioner utilities
// ---------------------------------------------------------------------------

let _cachedProvider: any = null;
let _provisioner: any = null;

async function loadProvisioner(): Promise<any> {
  if (_provisioner) return _provisioner;
  _provisioner = await import("@hivemi/provisioner");
  return _provisioner;
}

async function getProvider(): Promise<any> {
  if (_cachedProvider) return _cachedProvider;

  const prov = await loadProvisioner();
  const cloudConfig = await registryClient.getCloudConfig();
  if (!cloudConfig || !cloudConfig.apiToken) {
    throw new Error("Cloud config not available. Configure cloud settings first.");
  }

  _cachedProvider = prov.createProvider(cloudConfig.provider as "digitalocean" | "gcp", {
    token: cloudConfig.apiToken,
    defaultRegion: cloudConfig.region,
  });

  return _cachedProvider;
}

/**
 * Get registry agents in the format needed for reconciliation.
 */
async function getRegistryAgents() {
  const result = await registryClient.getAgents();
  if (!result.success || !result.data) return [];

  return result.data.map((a: any) => ({
    id: a.id,
    name: a.name,
    instanceId: a.cloud?.instanceId || null,
    status: a.status,
    host: a.host || undefined,
    privateIp: a.privateIp || a.cloud?.privateIp || null,
  }));
}

// =============================================================================
// GET /reconcile — Run reconciliation report
// =============================================================================

infraRoutes.get("/reconcile", async (c) => {
  try {
    const provider = await getProvider();
    const agents = await getRegistryAgents();

    const prov = await loadProvisioner();
    const report = await prov.generateReconciliationReport(provider, agents, "hivemi", logger);

    return c.json({ success: true, data: report });
  } catch (err) {
    logger.error(err, "Reconciliation failed");
    return c.json(
      { success: false, error: (err as Error).message },
      500,
    );
  }
});

// =============================================================================
// POST /reconcile — Trigger reconciliation with optional auto-fix
// =============================================================================

infraRoutes.post("/reconcile", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { autoFix = false } = body as { autoFix?: boolean };

    const provider = await getProvider();
    const agents = await getRegistryAgents();

    const prov = await loadProvisioner();
    const report = await prov.generateReconciliationReport(provider, agents, "hivemi", logger);

    let autoFixed = 0;

    // Auto-fix: mark phantom agents as offline
    if (autoFix && report.result.phantomAgentIds.length > 0) {
      for (const agentId of report.result.phantomAgentIds) {
        try {
          const updateResult = await registryClient.updateAgent(agentId, {
            status: "offline",
          });
          if (updateResult.success) {
            autoFixed++;
            logger.warn({ agentId }, "Phantom agent marked as offline via auto-fix");
          }
        } catch (err) {
          logger.error({ agentId, err }, "Failed to auto-fix phantom agent");
        }
      }
    }

    return c.json({
      success: true,
      data: {
        ...report,
        autoFix: {
          enabled: autoFix,
          phantomsFixed: autoFixed,
        },
      },
    });
  } catch (err) {
    logger.error(err, "Reconciliation with auto-fix failed");
    return c.json(
      { success: false, error: (err as Error).message },
      500,
    );
  }
});

// =============================================================================
// GET /reconcile/status — Get last periodic reconciliation result
// (Proxied from Registry's reconciliation job)
// =============================================================================

infraRoutes.get("/reconcile/status", async (c) => {
  try {
    const result = await registryClient.getReconciliationStatus();
    return c.json(result);
  } catch (err) {
    logger.error(err, "Failed to get reconciliation status");
    return c.json(
      { success: false, error: (err as Error).message },
      500,
    );
  }
});

// =============================================================================
// GET /reconcile/history — Get reconciliation log history
// =============================================================================

infraRoutes.get("/reconcile/history", async (c) => {
  try {
    const limit = c.req.query("limit") || "20";
    const result = await registryClient.getReconciliationHistory(parseInt(limit));
    return c.json(result);
  } catch (err) {
    logger.error(err, "Failed to get reconciliation history");
    return c.json(
      { success: false, error: (err as Error).message },
      500,
    );
  }
});

// =============================================================================
// GET /costs — Cost estimation with caching and per-agent breakdown
// Issue #84: Cost Estimation: Completar e Expor
// =============================================================================

// In-memory cache for cost reports
let _costCache: { data: any; cachedAt: number; expiresAt: number } | null = null;
const COST_CACHE_TTL_MS = 60_000; // 1 minute

function getCostCached(): any | null {
  if (!_costCache) return null;
  if (Date.now() > _costCache.expiresAt) {
    _costCache = null;
    return null;
  }
  return _costCache.data;
}

function setCostCache(data: any): void {
  const now = Date.now();
  _costCache = { data, cachedAt: now, expiresAt: now + COST_CACHE_TTL_MS };
}

/**
 * Invalidate cost cache. Call when infra changes (deploy, destroy).
 */
export function invalidateManagerCostCache(): void {
  _costCache = null;
}

infraRoutes.get("/costs", async (c) => {
  try {
    // Check cache first
    const cached = getCostCached();
    if (cached) {
      return c.json({ success: true, data: cached, cached: true });
    }

    const provider = await getProvider();

    // List active instances
    const instances = await provider.listInstances(["hivemi"]);

    // Get agents for mapping
    const agentsResult = await registryClient.getAgents();
    const agentMappings: Array<{ agentId: string; agentName: string; instanceId: string }> = [];

    if (agentsResult.success && agentsResult.data) {
      for (const agent of agentsResult.data as any[]) {
        const instanceId = agent.cloud?.instanceId;
        if (instanceId) {
          agentMappings.push({
            agentId: agent.id,
            agentName: agent.name,
            instanceId,
          });
        }
      }
    }

    const prov = await loadProvisioner();
    const report = prov.generateCostReport(provider, instances, new Date(), agentMappings);

    // Cache the result
    setCostCache(report);

    return c.json({ success: true, data: report, cached: false });
  } catch (err) {
    logger.error(err, "Cost estimation failed");
    return c.json(
      { success: false, error: (err as Error).message },
      500,
    );
  }
});

// =============================================================================
// DELETE /reconcile/orphan/:instanceId — Destroy orphaned VM
// =============================================================================

infraRoutes.delete("/reconcile/orphan/:instanceId", async (c) => {
  try {
    const instanceId = c.req.param("instanceId");
    const provider = await getProvider();

    logger.warn({ instanceId }, "Destroying orphaned instance");
    await provider.destroyInstance(instanceId);

    invalidateManagerCostCache(); // Infra changed — invalidate cost cache

    return c.json({
      success: true,
      data: { message: `Instance ${instanceId} destroyed` },
    });
  } catch (err) {
    logger.error(err, "Failed to destroy orphaned instance");
    return c.json(
      { success: false, error: (err as Error).message },
      500,
    );
  }
});

export default infraRoutes;

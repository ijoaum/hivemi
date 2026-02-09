// =============================================================================
// Infra Routes
// Reconciliation and cost estimation API endpoints
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
// GET /reconcile — Run reconciliation
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
// GET /costs — Cost estimation
// =============================================================================

infraRoutes.get("/costs", async (c) => {
  try {
    const provider = await getProvider();

    // List active instances
    const instances = await provider.listInstances(["hivemi"]);

    const prov = await loadProvisioner();
    const report = prov.generateCostReport(provider, instances);

    return c.json({ success: true, data: report });
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

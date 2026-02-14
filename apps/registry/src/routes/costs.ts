// =============================================================================
// Registry Cost Routes
// GET /api/infra/costs — Cost estimation with caching
// Issue #84: Cost Estimation: Completar e Expor
// =============================================================================

import { Hono } from "hono";
import { db, agents } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { getCloudConfig } from "../lib/cloud-config.js";
import { ne } from "drizzle-orm";

const costRoutes = new Hono();

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CostCacheEntry {
  data: unknown;
  cachedAt: number;
  expiresAt: number;
}

let _cache: CostCacheEntry | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

function getCached(): unknown | null {
  if (!_cache) return null;
  if (Date.now() > _cache.expiresAt) {
    _cache = null;
    return null;
  }
  return _cache.data;
}

function setCache(data: unknown): void {
  const now = Date.now();
  _cache = { data, cachedAt: now, expiresAt: now + CACHE_TTL_MS };
}

/**
 * Invalidate the cost cache. Exported for use by deploy/destroy handlers.
 */
export function invalidateCostCache(): void {
  _cache = null;
}

// =============================================================================
// GET / — Full cost report with per-agent breakdown
// =============================================================================

costRoutes.get("/", async (c) => {
  try {
    // Check cache first
    const cached = getCached();
    if (cached) {
      return c.json({ success: true, data: cached, cached: true });
    }

    // Load cloud config
    const cloudConfig = await getCloudConfig();
    if (!cloudConfig || !cloudConfig.apiToken) {
      return c.json({
        success: false,
        error: "Cloud config not available. Configure cloud settings first.",
      }, 503);
    }

    // Dynamic import of provisioner
    const prov = await import("@hivemi/provisioner");

    // Create provider
    const provider = prov.createProvider(
      cloudConfig.provider as "digitalocean" | "gcp",
      {
        token: cloudConfig.apiToken,
        defaultRegion: cloudConfig.region,
      },
    );

    // List active instances
    const instances = await provider.listInstances(["hivemi"]);

    // Get agents from DB for agent-to-instance mapping
    const agentRows = await db
      .select({
        id: agents.id,
        name: agents.name,
        cloud: agents.cloud,
        status: agents.status,
      })
      .from(agents)
      .where(ne(agents.status, "destroyed"));

    // Build agent mappings
    const agentMappings: Array<{
      agentId: string;
      agentName: string;
      instanceId: string;
    }> = [];

    for (const agent of agentRows) {
      const cloud = agent.cloud as { instanceId?: string } | null;
      if (cloud?.instanceId) {
        agentMappings.push({
          agentId: agent.id,
          agentName: agent.name,
          instanceId: cloud.instanceId,
        });
      }
    }

    // Generate report with agent mappings
    const report = prov.generateCostReport(provider, instances, new Date(), agentMappings);

    // Cache the result
    setCache(report);

    return c.json({ success: true, data: report, cached: false });
  } catch (err) {
    logger.error(err, "Cost estimation failed");
    return c.json(
      { success: false, error: (err as Error).message },
      500,
    );
  }
});

export default costRoutes;

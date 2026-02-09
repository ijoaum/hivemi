// =============================================================================
// Reconciliation
// Compare provider VMs against registry to detect drift
// =============================================================================

import type {
  ICloudProvider,
  Instance,
  RegistryAgent,
  ReconciliationResult,
  ReconciliationReport,
  ReconciliationIssue,
  ProvisionerLogger,
} from "./types.js";
import { consoleLogger } from "./types.js";

const DEFAULT_TAG = "hivemi";

/**
 * Reconcile provider instances against registry agents.
 *
 * Detects:
 * - Orphaned instances: VM exists in provider but no agent references it
 * - Phantom agents: Agent has an instanceId but no matching VM
 * - Healthy: VM exists and is tracked by an agent
 *
 * @param provider - Cloud provider to list instances from
 * @param agents - Registry agents with cloud info
 * @param tag - Tag to filter provider instances (default: "hivemi")
 * @param logger - Optional logger
 */
export async function reconcile(
  provider: ICloudProvider,
  agents: RegistryAgent[],
  tag: string = DEFAULT_TAG,
  logger?: ProvisionerLogger,
): Promise<ReconciliationResult> {
  const log = logger ?? consoleLogger;

  log.info(`Starting reconciliation (provider: ${provider.name}, tag: ${tag})`);

  // Get all provider instances with the hivemi tag
  const instances = await provider.listInstances([tag]);
  const instanceMap = new Map<string, Instance>();
  for (const inst of instances) {
    instanceMap.set(inst.id, inst);
  }

  // Build set of instance IDs referenced by agents
  const agentInstanceIds = new Set<string>();
  for (const agent of agents) {
    if (agent.instanceId) {
      agentInstanceIds.add(agent.instanceId);
    }
  }

  // Orphaned instances: exist in provider but no agent references them
  const orphanedInstances: Instance[] = [];
  const healthy: Instance[] = [];

  for (const instance of instances) {
    if (agentInstanceIds.has(instance.id)) {
      healthy.push(instance);
    } else {
      orphanedInstances.push(instance);
    }
  }

  // Phantom agents: have instanceId but VM doesn't exist
  const phantomAgentIds: string[] = [];
  for (const agent of agents) {
    if (agent.instanceId && !instanceMap.has(agent.instanceId)) {
      // Agent thinks it has a VM, but the VM doesn't exist
      if (agent.status !== "destroyed" && agent.status !== "offline") {
        phantomAgentIds.push(agent.id);
      }
    }
  }

  const result: ReconciliationResult = {
    orphanedInstances,
    phantomAgentIds,
    healthy,
  };

  log.info(
    `Reconciliation complete: ${healthy.length} healthy, ${orphanedInstances.length} orphaned, ${phantomAgentIds.length} phantom`,
  );

  if (orphanedInstances.length > 0) {
    log.warn(
      `Orphaned instances: ${orphanedInstances.map((i) => `${i.id} (${i.name})`).join(", ")}`,
    );
  }
  if (phantomAgentIds.length > 0) {
    log.warn(`Phantom agents: ${phantomAgentIds.join(", ")}`);
  }

  return result;
}

/**
 * Check for IP mismatches between registry agents and provider instances.
 *
 * If an agent's recorded host IP doesn't match the instance's actual public IP,
 * it could indicate DNS issues, stale registry data, or a replaced VM.
 */
export function detectIPMismatches(
  agents: RegistryAgent[],
  instances: Instance[],
): ReconciliationIssue[] {
  const instanceMap = new Map<string, Instance>();
  for (const inst of instances) {
    instanceMap.set(inst.id, inst);
  }

  const issues: ReconciliationIssue[] = [];

  for (const agent of agents) {
    if (!agent.instanceId || !agent.host) continue;

    const instance = instanceMap.get(agent.instanceId);
    if (!instance || !instance.publicIp) continue;

    // Compare agent's host with instance's public IP
    // Skip if agent host is a hostname (not an IP) or localhost
    if (agent.host.startsWith("http://localhost") || agent.host.startsWith("http://127.")) {
      continue;
    }

    // Extract IP from host URL (e.g., "http://1.2.3.4" → "1.2.3.4")
    const hostIp = extractIP(agent.host);
    if (!hostIp) continue;

    if (hostIp !== instance.publicIp) {
      issues.push({
        type: "ip_mismatch",
        severity: "warning",
        message: `Agent "${agent.name}" (${agent.id.slice(0, 8)}) has host IP ${hostIp} but instance ${instance.id} has IP ${instance.publicIp}`,
        instanceId: instance.id,
        instanceName: instance.name,
        agentId: agent.id,
        agentName: agent.name,
      });
    }
  }

  return issues;
}

/**
 * Extract an IPv4 address from a URL or plain IP string.
 */
function extractIP(hostOrUrl: string): string | null {
  // Remove protocol prefix
  let cleaned = hostOrUrl.replace(/^https?:\/\//, "");
  // Remove port and path
  cleaned = cleaned.split(":")[0].split("/")[0];
  // Validate it looks like an IPv4 address
  const parts = cleaned.split(".");
  if (parts.length !== 4) return null;
  const valid = parts.every((p) => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
  return valid ? cleaned : null;
}

/**
 * Generate a full reconciliation report with structured issues and metadata.
 *
 * This is the main entry point for the API — it runs reconciliation,
 * detects IP mismatches, and packages everything into a dashboard-friendly report.
 */
export async function generateReconciliationReport(
  provider: ICloudProvider,
  agents: RegistryAgent[],
  tag: string = DEFAULT_TAG,
  logger?: ProvisionerLogger,
): Promise<ReconciliationReport> {
  const result = await reconcile(provider, agents, tag, logger);

  // Build structured issues
  const issues: ReconciliationIssue[] = [];

  // Orphaned VMs — these cost money
  for (const instance of result.orphanedInstances) {
    issues.push({
      type: "orphaned_vm",
      severity: "error",
      message: `VM "${instance.name}" (${instance.id}) has no matching agent in the registry. It may be costing money.`,
      instanceId: instance.id,
      instanceName: instance.name,
    });
  }

  // Phantom agents — misleading but not costly
  const agentMap = new Map<string, RegistryAgent>();
  for (const agent of agents) {
    agentMap.set(agent.id, agent);
  }

  for (const agentId of result.phantomAgentIds) {
    const agent = agentMap.get(agentId);
    issues.push({
      type: "phantom_agent",
      severity: "warning",
      message: `Agent "${agent?.name || agentId}" has instanceId "${agent?.instanceId}" but no matching VM exists. Should be marked as offline/destroyed.`,
      agentId,
      agentName: agent?.name,
    });
  }

  // IP mismatches — collect healthy instances for comparison
  const ipIssues = detectIPMismatches(agents, result.healthy);
  issues.push(...ipIssues);

  // Determine overall status
  const orphanCount = result.orphanedInstances.length;
  const phantomCount = result.phantomAgentIds.length;
  const ipMismatchCount = ipIssues.length;
  const totalIssues = orphanCount + phantomCount + ipMismatchCount;

  let status: ReconciliationReport["status"] = "clean";
  if (totalIssues > 0) status = "warning";
  if (orphanCount >= 3 || totalIssues >= 5) status = "critical";

  return {
    result,
    issues,
    status,
    timestamp: new Date().toISOString(),
    provider: provider.name,
    stats: {
      totalVMs: result.healthy.length + result.orphanedInstances.length,
      healthy: result.healthy.length,
      orphaned: orphanCount,
      phantom: phantomCount,
      ipMismatches: ipMismatchCount,
    },
  };
}

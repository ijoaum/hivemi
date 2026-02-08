// =============================================================================
// Reconciliation
// Compare provider VMs against registry to detect drift
// =============================================================================

import type {
  ICloudProvider,
  Instance,
  RegistryAgent,
  ReconciliationResult,
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

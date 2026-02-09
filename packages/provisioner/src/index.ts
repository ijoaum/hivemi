// =============================================================================
// @hivemi/provisioner
// Cloud-agnostic VM provisioning for HiveMI agents
// =============================================================================

// Types
export type {
  InstanceSize,
  InstanceStatus,
  InstanceSpec,
  Instance,
  FirewallDirection,
  FirewallProtocol,
  FirewallRule,
  Firewall,
  SSHKey,
  WaitReadyOptions,
  SizeMapping,
  SizeMappings,
  CostEstimate,
  CostReport,
  InstanceCostBreakdown,
  ReconciliationResult,
  ReconciliationReport,
  ReconciliationIssue,
  RegistryAgent,
  ICloudProvider,
  ProviderConfig,
  ProvisionerLogger,
} from "./types.js";

export { consoleLogger } from "./types.js";

// Providers
export { DigitalOceanProvider, RateLimitError, UnsupportedRegionError } from "./providers/digitalocean.js";
export { GCPProvider } from "./providers/gcp.js";

// Managers
export { SSHKeyManager } from "./ssh-key.js";
export { FirewallManager, createDefaultRules } from "./firewall.js";
export { InfraManager } from "./infra-manager.js";
export type { ISecretStore, InfraState, InfraSetupResult } from "./infra-manager.js";

// SSH Key Generation
export { generateSSHKeyPair, isValidSSHPublicKey } from "./ssh-keygen.js";
export type { SSHKeyPair } from "./ssh-keygen.js";

// IP Detection
export { detectControlPlaneIP, detectIPChange, clearIPCache, isValidIPv4 } from "./ip-detect.js";

// Utilities
export { reconcile, detectIPMismatches, generateReconciliationReport } from "./reconciliation.js";
export { estimateCost, estimateInstanceCost, estimateCostFromInstances, generateCostReport } from "./cost.js";

// ---------------------------------------------------------------------------
// Factory — convenience function to create a provider by name
// ---------------------------------------------------------------------------

import type { ICloudProvider, ProviderConfig, ProvisionerLogger } from "./types.js";
import { DigitalOceanProvider } from "./providers/digitalocean.js";
import { GCPProvider } from "./providers/gcp.js";

/**
 * Create a cloud provider instance by name.
 *
 * @param provider - Provider name ("digitalocean" | "gcp")
 * @param config - Provider configuration (token, defaults)
 * @param logger - Optional logger
 */
export function createProvider(
  provider: "digitalocean" | "gcp",
  config: ProviderConfig,
  logger?: ProvisionerLogger,
): ICloudProvider {
  switch (provider) {
    case "digitalocean":
      return new DigitalOceanProvider(config, logger);
    case "gcp":
      return new GCPProvider(config, logger);
    default:
      throw new Error(`Unknown cloud provider: ${provider}`);
  }
}

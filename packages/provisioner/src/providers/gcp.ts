// =============================================================================
// GCP Cloud Provider — Stub
// Placeholder for future Google Cloud Platform implementation
// =============================================================================

import type {
  ICloudProvider,
  InstanceSpec,
  Instance,
  FirewallRule,
  WaitReadyOptions,
  SizeMappings,
  ProviderConfig,
  ProvisionerLogger,
} from "../types.js";
import { consoleLogger } from "../types.js";

/**
 * GCP size mappings (estimated).
 */
const GCP_SIZE_MAPPINGS: SizeMappings = {
  small: { slug: "e2-micro", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 7 },
  medium: { slug: "e2-small", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 13 },
  large: { slug: "e2-medium", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 25 },
};

function notImplemented(): never {
  throw new Error("GCP provider is not implemented yet. Use DigitalOcean.");
}

/**
 * GCP Cloud Provider — stub implementation.
 * All methods throw "not implemented" errors.
 * Size mappings and cost estimation are available.
 */
export class GCPProvider implements ICloudProvider {
  readonly name = "gcp";
  readonly sizeMappings = GCP_SIZE_MAPPINGS;

  private readonly _log: ProvisionerLogger;

  constructor(_config: ProviderConfig, logger?: ProvisionerLogger) {
    this._log = logger ?? consoleLogger;
    this._log.warn("GCP provider is a stub — not yet implemented");
  }

  async createInstance(_spec: InstanceSpec): Promise<Instance> {
    notImplemented();
  }

  async destroyInstance(_id: string): Promise<void> {
    notImplemented();
  }

  async listInstances(_tags?: string[]): Promise<Instance[]> {
    notImplemented();
  }

  async getStatus(_id: string): Promise<Instance> {
    notImplemented();
  }

  async waitReady(_id: string, _options?: WaitReadyOptions): Promise<Instance> {
    notImplemented();
  }

  async ensureSSHKey(_name: string, _publicKey: string): Promise<string> {
    notImplemented();
  }

  async ensureFirewall(_name: string, _rules: FirewallRule[]): Promise<string> {
    notImplemented();
  }

  async addInstanceToFirewall(_firewallId: string, _instanceId: string): Promise<void> {
    notImplemented();
  }

  async removeInstanceFromFirewall(_firewallId: string, _instanceId: string): Promise<void> {
    notImplemented();
  }
}

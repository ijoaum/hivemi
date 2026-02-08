// =============================================================================
// Provisioner Types
// Cloud-agnostic VM management — knows nothing about HiveMI agents
// =============================================================================

/**
 * Abstract instance sizes mapped per provider.
 * Most agents run on "small" — LLM is API, VM just needs Node.js + OpenClaw.
 */
export type InstanceSize = "small" | "medium" | "large";

/**
 * Instance status lifecycle.
 */
export type InstanceStatus = "creating" | "active" | "destroyed" | "error";

/**
 * Specification for creating a new VM.
 */
export interface InstanceSpec {
  /** VM name (e.g. "hivemi-agent-atlas") */
  name: string;
  /** Region — abstract or provider-specific */
  region: string;
  /** Abstract size mapped per provider */
  size: InstanceSize;
  /** OS image (default: Ubuntu 24.04 LTS) */
  image?: string;
  /** SSH key ID registered with the provider */
  sshKeyId: string;
  /** cloud-init script (YAML string) */
  userData?: string;
  /** Tags for filtering (e.g. ["hivemi", "agent"]) */
  tags: string[];
  /** Arbitrary metadata for traceability */
  metadata?: Record<string, string>;
  /** Firewall ID to attach */
  firewallId?: string;
  /** VPC UUID for private networking */
  vpcId?: string;
}

/**
 * A provisioned instance.
 */
export interface Instance {
  /** Provider-specific instance ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Public IPv4 address (null while creating) */
  publicIp: string | null;
  /** Private IPv4 address (null if no VPC) */
  privateIp: string | null;
  /** Current status */
  status: InstanceStatus;
  /** Region the instance is in */
  region: string;
  /** Size tier */
  size: InstanceSize;
  /** Tags applied to the instance */
  tags: string[];
  /** Provider-specific metadata */
  metadata?: Record<string, string>;
  /** When the instance was created */
  createdAt: Date;
}

/**
 * Firewall rule direction.
 */
export type FirewallDirection = "inbound" | "outbound";

/**
 * Protocol for firewall rules.
 */
export type FirewallProtocol = "tcp" | "udp" | "icmp";

/**
 * A single firewall rule.
 */
export interface FirewallRule {
  /** Direction of traffic */
  direction: FirewallDirection;
  /** Protocol */
  protocol: FirewallProtocol;
  /** Port or port range (e.g. "22", "3000-3100", "0" for all) */
  ports: string;
  /** Allowed source/destination CIDRs */
  sources: string[];
}

/**
 * A managed firewall.
 */
export interface Firewall {
  /** Provider-specific firewall ID */
  id: string;
  /** Firewall name */
  name: string;
  /** Applied rules */
  rules: FirewallRule[];
  /** Instance IDs attached to this firewall */
  instanceIds: string[];
}

/**
 * An SSH key registered with the provider.
 */
export interface SSHKey {
  /** Provider-specific key ID */
  id: string;
  /** Key name */
  name: string;
  /** Public key fingerprint */
  fingerprint: string;
}

/**
 * Options for the waitReady poll loop.
 */
export interface WaitReadyOptions {
  /** Timeout in milliseconds (default: 300_000 = 5 min) */
  timeoutMs?: number;
  /** Poll interval in milliseconds (default: 5_000) */
  pollIntervalMs?: number;
}

/**
 * Size mapping entry for a specific provider.
 */
export interface SizeMapping {
  slug: string;
  vcpu: number;
  memoryMb: number;
  /** Estimated monthly cost in USD */
  monthlyCostUsd: number;
}

/**
 * Provider-specific size mappings.
 */
export type SizeMappings = Record<InstanceSize, SizeMapping>;

/**
 * Cost estimate for a set of instances.
 */
export interface CostEstimate {
  provider: string;
  instances: Array<{
    name: string;
    size: InstanceSize;
    monthlyCostUsd: number;
  }>;
  totalMonthlyCostUsd: number;
  summary: string;
}

/**
 * Result of reconciliation between provider VMs and registry.
 */
export interface ReconciliationResult {
  /** VMs that exist in provider but not in registry */
  orphanedInstances: Instance[];
  /** Agent IDs in registry that have no matching VM */
  phantomAgentIds: string[];
  /** VMs that are properly tracked */
  healthy: Instance[];
}

/**
 * Registry agent info needed for reconciliation.
 * Minimal shape — just what the provisioner needs, not the full Agent type.
 */
export interface RegistryAgent {
  id: string;
  name: string;
  instanceId: string | null;
  status: string;
}

/**
 * Cloud provider abstraction.
 * Implementations handle provider-specific API calls.
 */
export interface ICloudProvider {
  /** Provider name (e.g. "digitalocean", "gcp") */
  readonly name: string;

  /** Size mappings for this provider */
  readonly sizeMappings: SizeMappings;

  /** Create a new VM instance */
  createInstance(spec: InstanceSpec): Promise<Instance>;

  /** Destroy an instance. Irreversible. */
  destroyInstance(id: string): Promise<void>;

  /** List instances, optionally filtered by tags */
  listInstances(tags?: string[]): Promise<Instance[]>;

  /** Get current status of an instance */
  getStatus(id: string): Promise<Instance>;

  /** Poll until instance has a public IP and SSH is reachable */
  waitReady(id: string, options?: WaitReadyOptions): Promise<Instance>;

  /** Register SSH key if it doesn't exist, return its ID */
  ensureSSHKey(name: string, publicKey: string): Promise<string>;

  /** Create or update a firewall, return its ID */
  ensureFirewall(name: string, rules: FirewallRule[]): Promise<string>;

  /** Add an instance to an existing firewall */
  addInstanceToFirewall(firewallId: string, instanceId: string): Promise<void>;

  /** Remove an instance from a firewall */
  removeInstanceFromFirewall(firewallId: string, instanceId: string): Promise<void>;
}

/**
 * Configuration for creating a cloud provider.
 */
export interface ProviderConfig {
  /** API token */
  token: string;
  /** Default region if not specified in InstanceSpec */
  defaultRegion?: string;
  /** Default image if not specified in InstanceSpec */
  defaultImage?: string;
}

/**
 * Logger interface the provisioner uses.
 * Consumers can plug in their own logger.
 */
export interface ProvisionerLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Default console logger.
 */
export const consoleLogger: ProvisionerLogger = {
  debug: (msg, meta) => console.debug(`[provisioner] ${msg}`, meta ?? ""),
  info: (msg, meta) => console.info(`[provisioner] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[provisioner] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[provisioner] ${msg}`, meta ?? ""),
};

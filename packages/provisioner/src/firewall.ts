// =============================================================================
// Firewall Management
// High-level helper for creating and managing the HiveMI agent firewall.
//
// Supports:
//   - Automatic firewall creation/update during provisioning
//   - SSH restricted to control plane + authorized IPs
//   - Daemon port restricted to control plane only
//   - Free VPC communication (10.x.x.x)
//   - Instance lifecycle (add on provision, remove on destroy)
//   - IP change detection and rule updates
//   - Configurable authorized IPs
// =============================================================================

import type {
  ICloudProvider,
  FirewallRule,
  ProvisionerLogger,
} from "./types.js";
import { consoleLogger } from "./types.js";
import type { FirewallConfig } from "./config.js";
import {
  DEFAULT_FIREWALL_CONFIG,
  generateFirewallRules,
  buildFirewallConfig,
  normalizeCidr,
} from "./config.js";

const DEFAULT_FIREWALL_NAME = "hivemi-agents";
const DAEMON_PORT = "3100";

/**
 * Create the default HiveMI agent firewall rules.
 *
 * - SSH (22) — only from control plane IP + authorized IPs
 * - Daemon port (3100) — only from control plane IP
 * - VPC — all ports open within 10.0.0.0/8 (DigitalOcean VPC)
 * - ICMP inbound — ping from anywhere (monitoring)
 * - All outbound — needed for LLM APIs, package managers, etc.
 *
 * @param controlPlaneIp - Public IP of the control plane server
 * @param authorizedIps - Additional IPs that can SSH into agents
 */
export function createDefaultRules(
  controlPlaneIp: string,
  authorizedIps: string[] = [],
): FirewallRule[] {
  const config = buildFirewallConfig(controlPlaneIp, {
    authorizedIps,
  });
  return generateFirewallRules(config);
}

/**
 * Firewall Manager.
 * Handles creating the "hivemi-agents" firewall and attaching instances.
 * Supports IP change detection, authorized IPs, and VPC rules.
 */
export class FirewallManager {
  private readonly provider: ICloudProvider;
  private readonly log: ProvisionerLogger;
  private firewallId: string | null = null;
  private lastKnownIp: string | null = null;

  /** Current firewall configuration (null until ensureFirewall is called) */
  private config: FirewallConfig | null = null;

  /** Set of instance IDs currently tracked in the firewall */
  private readonly trackedInstances = new Set<string>();

  constructor(provider: ICloudProvider, logger?: ProvisionerLogger) {
    this.provider = provider;
    this.log = logger ?? consoleLogger;
  }

  /**
   * Ensure the agent firewall exists with the correct rules.
   * Returns the firewall ID.
   *
   * @param controlPlaneIp - Public IP of the control plane
   * @param name - Firewall name (default: "hivemi-agents")
   * @param options - Additional firewall configuration
   */
  async ensureFirewall(
    controlPlaneIp: string,
    name: string = DEFAULT_FIREWALL_NAME,
    options?: {
      authorizedIps?: string[];
      vpcCidr?: string | null;
      daemonPort?: number;
      additionalPorts?: string[];
    },
  ): Promise<string> {
    // Build full config
    this.config = buildFirewallConfig(controlPlaneIp, {
      name,
      authorizedIps: options?.authorizedIps ?? [],
      vpcCidr: options?.vpcCidr !== undefined ? options.vpcCidr : DEFAULT_FIREWALL_CONFIG.vpcCidr,
      daemonPort: options?.daemonPort ?? DEFAULT_FIREWALL_CONFIG.daemonPort,
      additionalPorts: options?.additionalPorts ?? [],
    });

    // If firewall is cached and IP hasn't changed, return cached ID
    if (this.firewallId && this.lastKnownIp === controlPlaneIp) {
      return this.firewallId;
    }

    const rules = generateFirewallRules(this.config);
    this.firewallId = await this.provider.ensureFirewall(name, rules);
    this.lastKnownIp = controlPlaneIp;

    this.log.info(`Firewall "${name}" ready: ${this.firewallId}`);
    this.logRuleSummary(rules);

    return this.firewallId;
  }

  /**
   * Update firewall rules with a new control plane IP.
   * Preserves authorized IPs and VPC config.
   *
   * @param newIp - The new control plane IP
   * @param name - Firewall name (default: "hivemi-agents")
   * @returns true if rules were updated, false if no change needed
   */
  async updateControlPlaneIP(
    newIp: string,
    name: string = DEFAULT_FIREWALL_NAME,
  ): Promise<boolean> {
    if (!this.firewallId) {
      throw new Error("Firewall not initialized — call ensureFirewall first");
    }

    if (this.lastKnownIp === newIp) {
      this.log.debug(`Control plane IP unchanged (${newIp}), no firewall update needed`);
      return false;
    }

    this.log.info(`Updating firewall rules: ${this.lastKnownIp} → ${newIp}`);

    // Rebuild config with new IP, preserving other settings
    if (this.config) {
      this.config.controlPlaneIp = newIp;
    } else {
      this.config = buildFirewallConfig(newIp, { name });
    }

    const rules = generateFirewallRules(this.config);
    await this.provider.ensureFirewall(name, rules);
    this.lastKnownIp = newIp;

    this.log.info(`Firewall rules updated for new IP: ${newIp}`);
    this.logRuleSummary(rules);

    return true;
  }

  /**
   * Update the list of authorized IPs that can SSH into agents.
   * Rebuilds and applies firewall rules.
   *
   * @param authorizedIps - New list of authorized IPs
   * @returns true if rules were updated
   */
  async updateAuthorizedIps(authorizedIps: string[]): Promise<boolean> {
    if (!this.firewallId || !this.config) {
      throw new Error("Firewall not initialized — call ensureFirewall first");
    }

    const oldIps = this.config.authorizedIps;
    this.config.authorizedIps = authorizedIps;

    // Check if anything actually changed
    const oldSet = new Set(oldIps.map(normalizeCidr));
    const newSet = new Set(authorizedIps.map(normalizeCidr));
    if (oldSet.size === newSet.size && [...oldSet].every((ip) => newSet.has(ip))) {
      this.log.debug("Authorized IPs unchanged, no firewall update needed");
      return false;
    }

    this.log.info(
      `Updating authorized IPs: [${oldIps.join(", ")}] → [${authorizedIps.join(", ")}]`,
    );

    const rules = generateFirewallRules(this.config);
    await this.provider.ensureFirewall(this.config.name, rules);

    this.log.info(`Firewall rules updated with ${authorizedIps.length} authorized IPs`);
    return true;
  }

  /**
   * Get the last known control plane IP used for firewall rules.
   */
  getLastKnownIP(): string | null {
    return this.lastKnownIp;
  }

  /**
   * Get the current firewall configuration (null if not initialized).
   */
  getConfig(): Readonly<FirewallConfig> | null {
    return this.config ? { ...this.config } : null;
  }

  /**
   * Add an instance to the agent firewall.
   * Must call ensureFirewall first.
   */
  async addInstance(instanceId: string): Promise<void> {
    if (!this.firewallId) {
      throw new Error("Firewall not initialized — call ensureFirewall first");
    }
    await this.provider.addInstanceToFirewall(this.firewallId, instanceId);
    this.trackedInstances.add(instanceId);
    this.log.info(`Instance ${instanceId} added to firewall ${this.firewallId}`);
  }

  /**
   * Remove an instance from the agent firewall.
   * Cleans up tracking state. Safe to call for unknown instances.
   */
  async removeInstance(instanceId: string): Promise<void> {
    if (!this.firewallId) {
      throw new Error("Firewall not initialized — call ensureFirewall first");
    }
    await this.provider.removeInstanceFromFirewall(this.firewallId, instanceId);
    this.trackedInstances.delete(instanceId);
    this.log.info(`Instance ${instanceId} removed from firewall ${this.firewallId}`);
  }

  /**
   * Get the set of instance IDs currently tracked in the firewall.
   */
  getTrackedInstances(): ReadonlySet<string> {
    return this.trackedInstances;
  }

  /**
   * Get the current firewall ID (null if not initialized).
   */
  getFirewallId(): string | null {
    return this.firewallId;
  }

  /**
   * Set firewall ID directly (e.g. loaded from settings).
   */
  setFirewallId(id: string): void {
    this.firewallId = id;
  }

  /**
   * Log a human-readable summary of the current rules.
   */
  private logRuleSummary(rules: FirewallRule[]): void {
    const inbound = rules.filter((r) => r.direction === "inbound");
    const sshRule = inbound.find((r) => r.ports === "22");
    const daemonRule = inbound.find((r) => r.ports === String(this.config?.daemonPort ?? DAEMON_PORT));
    const vpcRules = inbound.filter((r) =>
      r.sources.some((s) => s.startsWith("10.") || s.startsWith("172.") || s.startsWith("192.168.")),
    );

    this.log.info(
      `Firewall rules: SSH from ${sshRule?.sources.length ?? 0} sources, ` +
      `Daemon from ${daemonRule?.sources.length ?? 0} sources, ` +
      `VPC rules: ${vpcRules.length}, ` +
      `Total: ${rules.length} rules`,
    );
  }
}

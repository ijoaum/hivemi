// =============================================================================
// Firewall Management
// High-level helper for creating and managing the HiveMI agent firewall
// =============================================================================

import type {
  ICloudProvider,
  FirewallRule,
  ProvisionerLogger,
} from "./types.js";
import { consoleLogger } from "./types.js";

const DEFAULT_FIREWALL_NAME = "hivemi-agents";
const DAEMON_PORT = "3100";

/**
 * Create the default HiveMI agent firewall rules.
 *
 * - SSH (22) — only from control plane IP
 * - Daemon port (3100) — only from control plane IP
 * - All outbound — needed for LLM APIs, package managers, etc.
 *
 * @param controlPlaneIp - Public IP of the control plane server
 */
export function createDefaultRules(controlPlaneIp: string): FirewallRule[] {
  const cpCidr = controlPlaneIp.includes("/")
    ? controlPlaneIp
    : `${controlPlaneIp}/32`;

  return [
    {
      direction: "inbound",
      protocol: "tcp",
      ports: "22",
      sources: [cpCidr],
    },
    {
      direction: "inbound",
      protocol: "tcp",
      ports: DAEMON_PORT,
      sources: [cpCidr],
    },
    {
      direction: "outbound",
      protocol: "tcp",
      ports: "0",
      sources: ["0.0.0.0/0", "::/0"],
    },
    {
      direction: "outbound",
      protocol: "udp",
      ports: "0",
      sources: ["0.0.0.0/0", "::/0"],
    },
    {
      direction: "outbound",
      protocol: "icmp",
      ports: "0",
      sources: ["0.0.0.0/0", "::/0"],
    },
  ];
}

/**
 * Firewall Manager.
 * Handles creating the "hivemi-agents" firewall and attaching instances.
 */
export class FirewallManager {
  private readonly provider: ICloudProvider;
  private readonly log: ProvisionerLogger;
  private firewallId: string | null = null;

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
   */
  async ensureFirewall(
    controlPlaneIp: string,
    name: string = DEFAULT_FIREWALL_NAME,
  ): Promise<string> {
    if (this.firewallId) {
      return this.firewallId;
    }

    const rules = createDefaultRules(controlPlaneIp);
    this.firewallId = await this.provider.ensureFirewall(name, rules);
    this.log.info(`Firewall "${name}" ready: ${this.firewallId}`);
    return this.firewallId;
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
  }

  /**
   * Remove an instance from the agent firewall.
   */
  async removeInstance(instanceId: string): Promise<void> {
    if (!this.firewallId) {
      throw new Error("Firewall not initialized — call ensureFirewall first");
    }
    await this.provider.removeInstanceFromFirewall(this.firewallId, instanceId);
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
}

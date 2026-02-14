// =============================================================================
// Firewall Configuration
// Configurable rules for HiveMI agent firewall management
// =============================================================================

import type { FirewallRule } from "./types.js";

/**
 * Configuration for the HiveMI agent firewall.
 */
export interface FirewallConfig {
  /** Firewall name (default: "hivemi-agents") */
  name: string;

  /** Public IP of the control plane server */
  controlPlaneIp: string;

  /**
   * Additional authorized IPs that can access agent SSH (port 22).
   * Useful for developer machines, CI/CD, or monitoring systems.
   * Accepts IPs with or without CIDR notation (e.g. "1.2.3.4" or "10.0.0.0/24").
   */
  authorizedIps: string[];

  /**
   * VPC CIDR for internal communication (e.g. "10.132.0.0/16").
   * All ports are open within the VPC to allow inter-agent and
   * control-plane ↔ agent communication on the private network.
   * Set to null to disable VPC rules.
   */
  vpcCidr: string | null;

  /**
   * Port the agent daemon listens on (default: 3100).
   */
  daemonPort: number;

  /**
   * Additional ports to allow from control plane IP only.
   * Useful for custom services on agent VMs.
   */
  additionalPorts: string[];

  /**
   * Whether to allow ICMP (ping) from anywhere.
   * Useful for monitoring. Default: true.
   */
  allowIcmp: boolean;
}

/**
 * Default firewall configuration.
 */
export const DEFAULT_FIREWALL_CONFIG: Omit<FirewallConfig, "controlPlaneIp"> = {
  name: "hivemi-agents",
  authorizedIps: [],
  vpcCidr: "10.0.0.0/8",  // DigitalOcean VPC default range
  daemonPort: 3100,
  additionalPorts: [],
  allowIcmp: true,
};

/**
 * Normalize an IP address to CIDR notation.
 * If the IP doesn't include a mask, appends /32 (single host).
 */
export function normalizeCidr(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.includes("/")) return trimmed;
  return `${trimmed}/32`;
}

/**
 * Validate that a string looks like a valid IPv4 or IPv4 CIDR.
 */
export function isValidCidr(cidr: string): boolean {
  const trimmed = cidr.trim();
  const [ip, mask] = trimmed.split("/");
  if (!ip) return false;

  // Validate IP part
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const validIp = parts.every((p) => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
  if (!validIp) return false;

  // Validate mask if present
  if (mask !== undefined) {
    const maskNum = parseInt(mask, 10);
    if (isNaN(maskNum) || maskNum < 0 || maskNum > 32 || String(maskNum) !== mask) {
      return false;
    }
  }

  return true;
}

/**
 * Build a complete FirewallConfig from partial user input + defaults.
 */
export function buildFirewallConfig(
  controlPlaneIp: string,
  overrides?: Partial<Omit<FirewallConfig, "controlPlaneIp">>,
): FirewallConfig {
  return {
    ...DEFAULT_FIREWALL_CONFIG,
    ...overrides,
    controlPlaneIp,
  };
}

/**
 * Generate firewall rules from a FirewallConfig.
 *
 * Rules created:
 * 1. SSH (22) — from control plane IP + authorized IPs only
 * 2. Daemon port — from control plane IP only (not public!)
 * 3. VPC — all ports open within VPC CIDR (private network)
 * 4. Additional ports — from control plane IP only
 * 5. ICMP — from anywhere (if enabled)
 * 6. All outbound — needed for LLM APIs, package managers, etc.
 *
 * Security model:
 * - SSH: restricted to control plane + explicitly authorized IPs
 * - Daemon: restricted to control plane ONLY (even authorized IPs can't reach it)
 * - VPC: free communication within the private network
 * - Everything else: blocked on public interface
 */
export function generateFirewallRules(config: FirewallConfig): FirewallRule[] {
  const rules: FirewallRule[] = [];

  const cpCidr = normalizeCidr(config.controlPlaneIp);

  // All sources that can SSH: control plane + authorized IPs
  const sshSources = [
    cpCidr,
    ...config.authorizedIps.map(normalizeCidr),
  ];

  // Deduplicate
  const uniqueSshSources = [...new Set(sshSources)];

  // 1. Inbound: SSH only from control plane + authorized IPs
  rules.push({
    direction: "inbound",
    protocol: "tcp",
    ports: "22",
    sources: uniqueSshSources,
  });

  // 2. Inbound: Daemon port only from control plane (NOT from authorized IPs)
  rules.push({
    direction: "inbound",
    protocol: "tcp",
    ports: String(config.daemonPort),
    sources: [cpCidr],
  });

  // 3. Inbound: VPC — all TCP/UDP ports from private network
  if (config.vpcCidr) {
    rules.push({
      direction: "inbound",
      protocol: "tcp",
      ports: "0",
      sources: [config.vpcCidr],
    });
    rules.push({
      direction: "inbound",
      protocol: "udp",
      ports: "0",
      sources: [config.vpcCidr],
    });
  }

  // 4. Inbound: Additional ports from control plane only
  for (const port of config.additionalPorts) {
    rules.push({
      direction: "inbound",
      protocol: "tcp",
      ports: port,
      sources: [cpCidr],
    });
  }

  // 5. Inbound: ICMP from anywhere (monitoring)
  if (config.allowIcmp) {
    rules.push({
      direction: "inbound",
      protocol: "icmp",
      ports: "0",
      sources: ["0.0.0.0/0", "::/0"],
    });
  }

  // 6. Outbound: all traffic (APIs, package managers, DNS, etc.)
  rules.push({
    direction: "outbound",
    protocol: "tcp",
    ports: "0",
    sources: ["0.0.0.0/0", "::/0"],
  });
  rules.push({
    direction: "outbound",
    protocol: "udp",
    ports: "0",
    sources: ["0.0.0.0/0", "::/0"],
  });
  rules.push({
    direction: "outbound",
    protocol: "icmp",
    ports: "0",
    sources: ["0.0.0.0/0", "::/0"],
  });

  return rules;
}

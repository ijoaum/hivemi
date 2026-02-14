// =============================================================================
// Networking Utilities — Private IP Detection (Issue #82)
//
// Detects the agent's private VPC IP address for use in registration,
// heartbeat, and P2P communication. Agents in the same VPC should
// communicate via private IPs (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
// for lower latency, no egress costs, and improved security.
//
// Detection strategy:
// 1. Enumerate all network interfaces via `os.networkInterfaces()`
// 2. Skip loopback (internal) and IPv6 addresses
// 3. Match against RFC1918 private ranges:
//    - 10.0.0.0/8      (Class A — DigitalOcean VPC, AWS VPC)
//    - 172.16.0.0/12   (Class B — Docker default, some cloud VPCs)
//    - 192.168.0.0/16  (Class C — home networks, some cloud VPCs)
// 4. Prefer 10.x.x.x range (most common in cloud VPCs)
// 5. Return null if no private IP found (VM not in a VPC)
//
// Fallback behavior:
// - If no private IP is detected, the daemon uses "0.0.0.0" as host
// - The registry stores null for privateIp
// - P2P communication falls back to the public host address
// - A warning is logged so operators can investigate
// =============================================================================

import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

/**
 * RFC1918 private IP ranges.
 * Each entry is a [prefix, description] tuple for matching.
 */
const RFC1918_RANGES = [
  { prefix: "10.", description: "Class A (10.0.0.0/8)" },
  { prefix: "172.16.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.17.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.18.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.19.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.20.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.21.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.22.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.23.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.24.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.25.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.26.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.27.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.28.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.29.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.30.", description: "Class B (172.16.0.0/12)" },
  { prefix: "172.31.", description: "Class B (172.16.0.0/12)" },
  { prefix: "192.168.", description: "Class C (192.168.0.0/16)" },
] as const;

/**
 * Check if an IPv4 address is in a RFC1918 private range.
 */
export function isPrivateIp(address: string): boolean {
  return RFC1918_RANGES.some((range) => address.startsWith(range.prefix));
}

/**
 * Get all private IPv4 addresses from network interfaces.
 * Returns an array of { address, interfaceName, range } objects,
 * sorted with 10.x.x.x addresses first (cloud VPC preference).
 */
export function getAllPrivateIps(): Array<{
  address: string;
  interfaceName: string;
  range: string;
}> {
  const ifaces = networkInterfaces();
  const results: Array<{ address: string; interfaceName: string; range: string }> = [];

  for (const [ifName, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const match = RFC1918_RANGES.find((r) => addr.address.startsWith(r.prefix));
      if (match) {
        results.push({
          address: addr.address,
          interfaceName: ifName,
          range: match.description,
        });
      }
    }
  }

  // Sort: 10.x.x.x first (cloud VPCs), then 172.x, then 192.168.x
  results.sort((a, b) => {
    const order = (addr: string) => {
      if (addr.startsWith("10.")) return 0;
      if (addr.startsWith("172.")) return 1;
      return 2;
    };
    return order(a.address) - order(b.address);
  });

  return results;
}

/**
 * Detect the primary private VPC IP address.
 *
 * Looks for a 10.x.x.x, 172.16-31.x.x, or 192.168.x.x IPv4 address
 * on a non-loopback interface. Returns null if none found.
 *
 * Prefers 10.x.x.x addresses (most common in cloud VPCs like
 * DigitalOcean, AWS, GCP) over other private ranges.
 *
 * @returns The private IP address string, or null if not in a VPC
 */
export function detectPrivateIp(): string | null {
  const allPrivate = getAllPrivateIps();
  return allPrivate.length > 0 ? allPrivate[0].address : null;
}

/**
 * Get the public IP address (non-private, non-loopback IPv4).
 * Returns null if only private/loopback addresses exist.
 */
export function detectPublicIp(): string | null {
  const ifaces = networkInterfaces();
  for (const [, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (!isPrivateIp(addr.address)) {
        return addr.address;
      }
    }
  }
  return null;
}

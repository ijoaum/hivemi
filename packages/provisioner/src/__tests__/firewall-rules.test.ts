// =============================================================================
// Tests for Firewall: Public IP Rules (Issue #81)
// Tests for config.ts, firewall.ts, and infra-manager.ts firewall features
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ICloudProvider,
  SizeMappings,
  ProvisionerLogger,
  FirewallRule,
} from "../types.js";
import { FirewallManager, createDefaultRules } from "../firewall.js";
import {
  generateFirewallRules,
  buildFirewallConfig,
  normalizeCidr,
  isValidCidr,
  DEFAULT_FIREWALL_CONFIG,
} from "../config.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockSizeMappings: SizeMappings = {
  small: { slug: "s-1vcpu-1gb", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 6 },
  medium: { slug: "s-2vcpu-2gb", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 12 },
  large: { slug: "s-2vcpu-4gb", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 24 },
};

function createMockProvider(overrides: Partial<ICloudProvider> = {}): ICloudProvider {
  return {
    name: "mock",
    sizeMappings: mockSizeMappings,
    createInstance: vi.fn().mockResolvedValue({
      id: "inst-123", name: "test-vm", publicIp: "1.2.3.4",
      privateIp: "10.0.0.1", status: "active", region: "nyc1",
      size: "small", tags: ["hivemi"], createdAt: new Date(),
    }),
    destroyInstance: vi.fn().mockResolvedValue(undefined),
    listInstances: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue({
      id: "inst-123", name: "test-vm", publicIp: "1.2.3.4",
      privateIp: "10.0.0.1", status: "active", region: "nyc1",
      size: "small", tags: ["hivemi"], createdAt: new Date(),
    }),
    waitReady: vi.fn().mockResolvedValue({
      id: "inst-123", name: "test-vm", publicIp: "1.2.3.4",
      privateIp: "10.0.0.1", status: "active", region: "nyc1",
      size: "small", tags: ["hivemi"], createdAt: new Date(),
    }),
    ensureSSHKey: vi.fn().mockResolvedValue("key-42"),
    ensureFirewall: vi.fn().mockResolvedValue("fw-99"),
    addInstanceToFirewall: vi.fn().mockResolvedValue(undefined),
    removeInstanceFromFirewall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const silentLogger: ProvisionerLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// =============================================================================
// Config Utilities
// =============================================================================

describe("normalizeCidr", () => {
  it("should append /32 to bare IP", () => {
    expect(normalizeCidr("1.2.3.4")).toBe("1.2.3.4/32");
  });

  it("should preserve existing CIDR notation", () => {
    expect(normalizeCidr("10.0.0.0/8")).toBe("10.0.0.0/8");
  });

  it("should trim whitespace", () => {
    expect(normalizeCidr("  1.2.3.4  ")).toBe("1.2.3.4/32");
  });

  it("should handle /0 CIDR", () => {
    expect(normalizeCidr("0.0.0.0/0")).toBe("0.0.0.0/0");
  });
});

describe("isValidCidr", () => {
  it("should accept valid IPs", () => {
    expect(isValidCidr("1.2.3.4")).toBe(true);
    expect(isValidCidr("255.255.255.255")).toBe(true);
    expect(isValidCidr("0.0.0.0")).toBe(true);
  });

  it("should accept valid CIDRs", () => {
    expect(isValidCidr("10.0.0.0/8")).toBe(true);
    expect(isValidCidr("192.168.1.0/24")).toBe(true);
    expect(isValidCidr("1.2.3.4/32")).toBe(true);
    expect(isValidCidr("0.0.0.0/0")).toBe(true);
  });

  it("should reject invalid IPs", () => {
    expect(isValidCidr("")).toBe(false);
    expect(isValidCidr("abc")).toBe(false);
    expect(isValidCidr("1.2.3")).toBe(false);
    expect(isValidCidr("1.2.3.4.5")).toBe(false);
    expect(isValidCidr("256.0.0.1")).toBe(false);
    expect(isValidCidr("1.2.3.-1")).toBe(false);
  });

  it("should reject invalid masks", () => {
    expect(isValidCidr("1.2.3.4/33")).toBe(false);
    expect(isValidCidr("1.2.3.4/-1")).toBe(false);
    expect(isValidCidr("1.2.3.4/abc")).toBe(false);
  });

  it("should trim whitespace", () => {
    expect(isValidCidr("  10.0.0.0/8  ")).toBe(true);
  });
});

describe("buildFirewallConfig", () => {
  it("should create config with defaults", () => {
    const config = buildFirewallConfig("165.245.132.133");
    expect(config.controlPlaneIp).toBe("165.245.132.133");
    expect(config.name).toBe("hivemi-agents");
    expect(config.authorizedIps).toEqual([]);
    expect(config.vpcCidr).toBe("10.0.0.0/8");
    expect(config.daemonPort).toBe(3100);
    expect(config.additionalPorts).toEqual([]);
    expect(config.allowIcmp).toBe(true);
  });

  it("should allow overriding all fields", () => {
    const config = buildFirewallConfig("1.2.3.4", {
      name: "custom-fw",
      authorizedIps: ["5.6.7.8"],
      vpcCidr: "172.16.0.0/12",
      daemonPort: 4000,
      additionalPorts: ["8080"],
      allowIcmp: false,
    });
    expect(config.name).toBe("custom-fw");
    expect(config.authorizedIps).toEqual(["5.6.7.8"]);
    expect(config.vpcCidr).toBe("172.16.0.0/12");
    expect(config.daemonPort).toBe(4000);
    expect(config.additionalPorts).toEqual(["8080"]);
    expect(config.allowIcmp).toBe(false);
  });

  it("should allow disabling VPC", () => {
    const config = buildFirewallConfig("1.2.3.4", { vpcCidr: null });
    expect(config.vpcCidr).toBeNull();
  });
});

describe("DEFAULT_FIREWALL_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_FIREWALL_CONFIG.name).toBe("hivemi-agents");
    expect(DEFAULT_FIREWALL_CONFIG.daemonPort).toBe(3100);
    expect(DEFAULT_FIREWALL_CONFIG.vpcCidr).toBe("10.0.0.0/8");
    expect(DEFAULT_FIREWALL_CONFIG.allowIcmp).toBe(true);
    expect(DEFAULT_FIREWALL_CONFIG.authorizedIps).toEqual([]);
    expect(DEFAULT_FIREWALL_CONFIG.additionalPorts).toEqual([]);
  });
});

// =============================================================================
// Firewall Rule Generation
// =============================================================================

describe("generateFirewallRules", () => {
  it("should create SSH rule restricted to control plane", () => {
    const config = buildFirewallConfig("165.245.132.133");
    const rules = generateFirewallRules(config);

    const sshRule = rules.find((r) => r.ports === "22" && r.direction === "inbound");
    expect(sshRule).toBeDefined();
    expect(sshRule!.protocol).toBe("tcp");
    expect(sshRule!.sources).toEqual(["165.245.132.133/32"]);
  });

  it("should create daemon rule restricted to control plane only", () => {
    const config = buildFirewallConfig("165.245.132.133");
    const rules = generateFirewallRules(config);

    const daemonRule = rules.find((r) => r.ports === "3100" && r.direction === "inbound");
    expect(daemonRule).toBeDefined();
    expect(daemonRule!.protocol).toBe("tcp");
    expect(daemonRule!.sources).toEqual(["165.245.132.133/32"]);
  });

  it("should add authorized IPs to SSH but NOT to daemon", () => {
    const config = buildFirewallConfig("165.245.132.133", {
      authorizedIps: ["200.1.2.3", "201.4.5.6"],
    });
    const rules = generateFirewallRules(config);

    const sshRule = rules.find((r) => r.ports === "22" && r.direction === "inbound");
    expect(sshRule!.sources).toEqual([
      "165.245.132.133/32",
      "200.1.2.3/32",
      "201.4.5.6/32",
    ]);

    // Daemon should NOT have authorized IPs
    const daemonRule = rules.find((r) => r.ports === "3100" && r.direction === "inbound");
    expect(daemonRule!.sources).toEqual(["165.245.132.133/32"]);
  });

  it("should deduplicate authorized IPs", () => {
    const config = buildFirewallConfig("165.245.132.133", {
      authorizedIps: ["165.245.132.133", "200.1.2.3", "200.1.2.3"],
    });
    const rules = generateFirewallRules(config);

    const sshRule = rules.find((r) => r.ports === "22" && r.direction === "inbound");
    // Control plane is in authorizedIps too, should be deduped
    expect(sshRule!.sources).toEqual([
      "165.245.132.133/32",
      "200.1.2.3/32",
    ]);
  });

  it("should create VPC rules allowing all ports", () => {
    const config = buildFirewallConfig("1.2.3.4", { vpcCidr: "10.132.0.0/16" });
    const rules = generateFirewallRules(config);

    const vpcTcp = rules.find(
      (r) => r.direction === "inbound" && r.protocol === "tcp" && r.sources.includes("10.132.0.0/16"),
    );
    const vpcUdp = rules.find(
      (r) => r.direction === "inbound" && r.protocol === "udp" && r.sources.includes("10.132.0.0/16"),
    );

    expect(vpcTcp).toBeDefined();
    expect(vpcTcp!.ports).toBe("0"); // all ports
    expect(vpcUdp).toBeDefined();
    expect(vpcUdp!.ports).toBe("0"); // all ports
  });

  it("should not create VPC rules when vpcCidr is null", () => {
    const config = buildFirewallConfig("1.2.3.4", { vpcCidr: null });
    const rules = generateFirewallRules(config);

    const vpcRules = rules.filter((r) =>
      r.direction === "inbound" && r.sources.some((s) => s.startsWith("10.")),
    );
    expect(vpcRules).toHaveLength(0);
  });

  it("should create ICMP rules when enabled", () => {
    const config = buildFirewallConfig("1.2.3.4", { allowIcmp: true });
    const rules = generateFirewallRules(config);

    const icmpRule = rules.find((r) => r.direction === "inbound" && r.protocol === "icmp");
    expect(icmpRule).toBeDefined();
    expect(icmpRule!.sources).toEqual(["0.0.0.0/0", "::/0"]);
  });

  it("should NOT create inbound ICMP when disabled", () => {
    const config = buildFirewallConfig("1.2.3.4", { allowIcmp: false });
    const rules = generateFirewallRules(config);

    const inboundIcmp = rules.find((r) => r.direction === "inbound" && r.protocol === "icmp");
    expect(inboundIcmp).toBeUndefined();
  });

  it("should create additional port rules from control plane only", () => {
    const config = buildFirewallConfig("1.2.3.4", {
      additionalPorts: ["8080", "9090"],
    });
    const rules = generateFirewallRules(config);

    const port8080 = rules.find((r) => r.ports === "8080" && r.direction === "inbound");
    const port9090 = rules.find((r) => r.ports === "9090" && r.direction === "inbound");

    expect(port8080).toBeDefined();
    expect(port8080!.sources).toEqual(["1.2.3.4/32"]);
    expect(port9090).toBeDefined();
    expect(port9090!.sources).toEqual(["1.2.3.4/32"]);
  });

  it("should use custom daemon port", () => {
    const config = buildFirewallConfig("1.2.3.4", { daemonPort: 4200 });
    const rules = generateFirewallRules(config);

    const daemonRule = rules.find((r) => r.ports === "4200" && r.direction === "inbound");
    expect(daemonRule).toBeDefined();
    expect(daemonRule!.sources).toEqual(["1.2.3.4/32"]);

    // No default 3100 rule
    const oldDaemon = rules.find((r) => r.ports === "3100" && r.direction === "inbound");
    expect(oldDaemon).toBeUndefined();
  });

  it("should always allow all outbound traffic", () => {
    const config = buildFirewallConfig("1.2.3.4");
    const rules = generateFirewallRules(config);

    const outbound = rules.filter((r) => r.direction === "outbound");
    expect(outbound).toHaveLength(3); // tcp, udp, icmp

    const outTcp = outbound.find((r) => r.protocol === "tcp");
    expect(outTcp!.ports).toBe("0");
    expect(outTcp!.sources).toEqual(["0.0.0.0/0", "::/0"]);
  });

  it("should handle CIDR in control plane IP", () => {
    const config = buildFirewallConfig("10.0.0.0/24");
    const rules = generateFirewallRules(config);

    const sshRule = rules.find((r) => r.ports === "22" && r.direction === "inbound");
    expect(sshRule!.sources).toEqual(["10.0.0.0/24"]);
  });

  it("should block all public ports except explicitly allowed", () => {
    const config = buildFirewallConfig("1.2.3.4", { vpcCidr: null, allowIcmp: false });
    const rules = generateFirewallRules(config);

    const inbound = rules.filter((r) => r.direction === "inbound");

    // Only SSH (22) and daemon (3100) should be allowed inbound
    expect(inbound).toHaveLength(2);
    expect(inbound.map((r) => r.ports).sort()).toEqual(["22", "3100"]);

    // All inbound rules should be restricted to control plane
    for (const rule of inbound) {
      expect(rule.sources.every((s) => s.startsWith("1.2.3.4"))).toBe(true);
    }
  });

  it("should produce complete rule set for production config", () => {
    const config = buildFirewallConfig("165.245.132.133", {
      authorizedIps: ["200.232.136.247"],
      vpcCidr: "10.132.0.0/16",
    });
    const rules = generateFirewallRules(config);

    // Should have: SSH, Daemon, VPC TCP, VPC UDP, ICMP, Out TCP, Out UDP, Out ICMP
    expect(rules.length).toBeGreaterThanOrEqual(8);

    const inbound = rules.filter((r) => r.direction === "inbound");
    const outbound = rules.filter((r) => r.direction === "outbound");

    expect(inbound.length).toBe(5); // SSH, daemon, VPC TCP, VPC UDP, ICMP
    expect(outbound.length).toBe(3); // TCP, UDP, ICMP
  });
});

// =============================================================================
// createDefaultRules (backwards compatibility)
// =============================================================================

describe("createDefaultRules", () => {
  it("should create rules with control plane IP", () => {
    const rules = createDefaultRules("165.245.132.133");

    const inbound = rules.filter((r) => r.direction === "inbound");
    const outbound = rules.filter((r) => r.direction === "outbound");

    // SSH, daemon, VPC TCP, VPC UDP, ICMP
    expect(inbound.length).toBeGreaterThanOrEqual(3);
    expect(inbound[0]).toMatchObject({ protocol: "tcp", ports: "22", sources: ["165.245.132.133/32"] });
    expect(outbound).toHaveLength(3); // tcp, udp, icmp
  });

  it("should accept authorized IPs", () => {
    const rules = createDefaultRules("165.245.132.133", ["200.1.2.3"]);
    const sshRule = rules.find((r) => r.ports === "22");
    expect(sshRule!.sources).toContain("200.1.2.3/32");
  });

  it("should include VPC rules by default", () => {
    const rules = createDefaultRules("1.2.3.4");
    const vpcRules = rules.filter((r) =>
      r.direction === "inbound" && r.sources.some((s) => s.startsWith("10.")),
    );
    expect(vpcRules.length).toBeGreaterThanOrEqual(2); // TCP + UDP
  });

  it("should handle CIDR input", () => {
    const rules = createDefaultRules("10.0.0.0/24");
    const sshRule = rules.find((r) => r.ports === "22");
    expect(sshRule?.sources).toEqual(["10.0.0.0/24"]);
  });
});

// =============================================================================
// Firewall Manager — Enhanced
// =============================================================================

describe("FirewallManager", () => {
  let provider: ICloudProvider;
  let manager: FirewallManager;

  beforeEach(() => {
    provider = createMockProvider();
    manager = new FirewallManager(provider, silentLogger);
  });

  describe("ensureFirewall", () => {
    it("should create firewall with default name", async () => {
      const id = await manager.ensureFirewall("165.245.132.133");
      expect(id).toBe("fw-99");
      expect(provider.ensureFirewall).toHaveBeenCalledWith(
        "hivemi-agents",
        expect.any(Array),
      );
    });

    it("should pass rules that include VPC and SSH", async () => {
      await manager.ensureFirewall("165.245.132.133");

      const rulesArg = (provider.ensureFirewall as ReturnType<typeof vi.fn>).mock.calls[0][1] as FirewallRule[];
      const sshRule = rulesArg.find((r) => r.ports === "22");
      const vpcRule = rulesArg.find(
        (r) => r.direction === "inbound" && r.sources.some((s) => s.startsWith("10.")),
      );

      expect(sshRule).toBeDefined();
      expect(vpcRule).toBeDefined();
    });

    it("should pass authorized IPs in rules", async () => {
      await manager.ensureFirewall("1.2.3.4", "hivemi-agents", {
        authorizedIps: ["5.6.7.8"],
      });

      const rulesArg = (provider.ensureFirewall as ReturnType<typeof vi.fn>).mock.calls[0][1] as FirewallRule[];
      const sshRule = rulesArg.find((r) => r.ports === "22");
      expect(sshRule!.sources).toContain("5.6.7.8/32");
    });

    it("should cache firewall ID for same IP", async () => {
      await manager.ensureFirewall("165.245.132.133");
      await manager.ensureFirewall("165.245.132.133");
      expect(provider.ensureFirewall).toHaveBeenCalledTimes(1);
    });

    it("should re-create if IP changes", async () => {
      await manager.ensureFirewall("1.2.3.4");
      await manager.ensureFirewall("5.6.7.8");
      expect(provider.ensureFirewall).toHaveBeenCalledTimes(2);
    });

    it("should allow custom VPC CIDR", async () => {
      await manager.ensureFirewall("1.2.3.4", "hivemi-agents", {
        vpcCidr: "172.16.0.0/12",
      });

      const rulesArg = (provider.ensureFirewall as ReturnType<typeof vi.fn>).mock.calls[0][1] as FirewallRule[];
      const vpcRule = rulesArg.find(
        (r) => r.direction === "inbound" && r.sources.includes("172.16.0.0/12"),
      );
      expect(vpcRule).toBeDefined();
    });

    it("should allow disabling VPC rules", async () => {
      await manager.ensureFirewall("1.2.3.4", "hivemi-agents", {
        vpcCidr: null,
      });

      const rulesArg = (provider.ensureFirewall as ReturnType<typeof vi.fn>).mock.calls[0][1] as FirewallRule[];
      const vpcRules = rulesArg.filter(
        (r) => r.direction === "inbound" && r.sources.some((s) =>
          s.startsWith("10.") || s.startsWith("172.") || s.startsWith("192.168.")),
      );
      expect(vpcRules).toHaveLength(0);
    });
  });

  describe("addInstance", () => {
    it("should add instance to firewall", async () => {
      await manager.ensureFirewall("165.245.132.133");
      await manager.addInstance("inst-456");
      expect(provider.addInstanceToFirewall).toHaveBeenCalledWith("fw-99", "inst-456");
    });

    it("should track added instances", async () => {
      await manager.ensureFirewall("165.245.132.133");
      await manager.addInstance("inst-1");
      await manager.addInstance("inst-2");

      const tracked = manager.getTrackedInstances();
      expect(tracked.has("inst-1")).toBe(true);
      expect(tracked.has("inst-2")).toBe(true);
      expect(tracked.size).toBe(2);
    });

    it("should throw if adding instance before ensuring firewall", async () => {
      await expect(manager.addInstance("inst-456")).rejects.toThrow("Firewall not initialized");
    });
  });

  describe("removeInstance", () => {
    it("should remove instance from firewall", async () => {
      await manager.ensureFirewall("165.245.132.133");
      await manager.addInstance("inst-456");
      await manager.removeInstance("inst-456");

      expect(provider.removeInstanceFromFirewall).toHaveBeenCalledWith("fw-99", "inst-456");
    });

    it("should stop tracking removed instances", async () => {
      await manager.ensureFirewall("165.245.132.133");
      await manager.addInstance("inst-1");
      await manager.removeInstance("inst-1");

      expect(manager.getTrackedInstances().has("inst-1")).toBe(false);
    });

    it("should throw if removing before firewall initialized", async () => {
      await expect(manager.removeInstance("inst-456")).rejects.toThrow("Firewall not initialized");
    });
  });

  describe("updateControlPlaneIP", () => {
    it("should update rules when IP changes", async () => {
      await manager.ensureFirewall("1.2.3.4");
      const updated = await manager.updateControlPlaneIP("5.6.7.8");

      expect(updated).toBe(true);
      expect(provider.ensureFirewall).toHaveBeenCalledTimes(2);

      // Verify new rules use new IP
      const secondCall = (provider.ensureFirewall as ReturnType<typeof vi.fn>).mock.calls[1];
      const rules = secondCall[1] as FirewallRule[];
      const sshRule = rules.find((r) => r.ports === "22");
      expect(sshRule!.sources).toContain("5.6.7.8/32");
    });

    it("should return false when IP unchanged", async () => {
      await manager.ensureFirewall("1.2.3.4");
      const updated = await manager.updateControlPlaneIP("1.2.3.4");
      expect(updated).toBe(false);
    });

    it("should preserve authorized IPs on IP update", async () => {
      await manager.ensureFirewall("1.2.3.4", "hivemi-agents", {
        authorizedIps: ["9.9.9.9"],
      });
      await manager.updateControlPlaneIP("5.6.7.8");

      const secondCall = (provider.ensureFirewall as ReturnType<typeof vi.fn>).mock.calls[1];
      const rules = secondCall[1] as FirewallRule[];
      const sshRule = rules.find((r) => r.ports === "22");
      expect(sshRule!.sources).toContain("5.6.7.8/32");
      expect(sshRule!.sources).toContain("9.9.9.9/32");
    });

    it("should throw if firewall not initialized", async () => {
      await expect(manager.updateControlPlaneIP("5.6.7.8")).rejects.toThrow("Firewall not initialized");
    });
  });

  describe("updateAuthorizedIps", () => {
    it("should update rules with new authorized IPs", async () => {
      await manager.ensureFirewall("1.2.3.4");
      const updated = await manager.updateAuthorizedIps(["10.20.30.40"]);

      expect(updated).toBe(true);
      expect(provider.ensureFirewall).toHaveBeenCalledTimes(2);
    });

    it("should return false when IPs unchanged", async () => {
      await manager.ensureFirewall("1.2.3.4", "hivemi-agents", {
        authorizedIps: ["5.6.7.8"],
      });
      const updated = await manager.updateAuthorizedIps(["5.6.7.8"]);
      expect(updated).toBe(false);
    });

    it("should apply new IPs to SSH rule only", async () => {
      await manager.ensureFirewall("1.2.3.4");
      await manager.updateAuthorizedIps(["99.99.99.99"]);

      const lastCall = (provider.ensureFirewall as ReturnType<typeof vi.fn>).mock.calls[1];
      const rules = lastCall[1] as FirewallRule[];

      const sshRule = rules.find((r) => r.ports === "22");
      expect(sshRule!.sources).toContain("99.99.99.99/32");
      expect(sshRule!.sources).toContain("1.2.3.4/32");

      // Daemon should still only have control plane
      const daemonRule = rules.find((r) => r.ports === "3100");
      expect(daemonRule!.sources).toEqual(["1.2.3.4/32"]);
    });

    it("should throw if firewall not initialized", async () => {
      await expect(manager.updateAuthorizedIps(["1.1.1.1"])).rejects.toThrow("Firewall not initialized");
    });
  });

  describe("getConfig", () => {
    it("should return null before initialization", () => {
      expect(manager.getConfig()).toBeNull();
    });

    it("should return config after initialization", async () => {
      await manager.ensureFirewall("1.2.3.4", "hivemi-agents", {
        authorizedIps: ["5.6.7.8"],
        vpcCidr: "10.0.0.0/8",
      });

      const config = manager.getConfig();
      expect(config).toBeDefined();
      expect(config!.controlPlaneIp).toBe("1.2.3.4");
      expect(config!.authorizedIps).toEqual(["5.6.7.8"]);
      expect(config!.vpcCidr).toBe("10.0.0.0/8");
    });

    it("should return a copy (not a reference)", async () => {
      await manager.ensureFirewall("1.2.3.4");
      const config1 = manager.getConfig();
      const config2 = manager.getConfig();
      expect(config1).not.toBe(config2);
    });
  });

  describe("setFirewallId", () => {
    it("should allow setting firewall ID directly", () => {
      manager.setFirewallId("fw-manual");
      expect(manager.getFirewallId()).toBe("fw-manual");
    });
  });
});

// =============================================================================
// Security Verification
// =============================================================================

describe("Security: Public IP Firewall Rules", () => {
  it("should NEVER expose daemon port to 0.0.0.0/0", () => {
    // Even with the most permissive config
    const config = buildFirewallConfig("1.2.3.4", {
      authorizedIps: ["5.5.5.5", "6.6.6.6", "7.7.7.7"],
      vpcCidr: "10.0.0.0/8",
      allowIcmp: true,
      additionalPorts: ["8080", "9090"],
    });
    const rules = generateFirewallRules(config);

    const daemonRule = rules.find((r) => r.ports === "3100" && r.direction === "inbound");
    expect(daemonRule).toBeDefined();
    expect(daemonRule!.sources).not.toContain("0.0.0.0/0");
    expect(daemonRule!.sources).not.toContain("::/0");
    // Only control plane should access daemon
    expect(daemonRule!.sources).toEqual(["1.2.3.4/32"]);
  });

  it("should not allow authorized IPs to access daemon port", () => {
    const config = buildFirewallConfig("1.2.3.4", {
      authorizedIps: ["attacker.ip.here/32"],
    });
    const rules = generateFirewallRules(config);

    const daemonRule = rules.find((r) => r.ports === "3100" && r.direction === "inbound");
    expect(daemonRule!.sources).toHaveLength(1);
    expect(daemonRule!.sources[0]).toBe("1.2.3.4/32");
  });

  it("should ensure SSH is never wide open", () => {
    const config = buildFirewallConfig("1.2.3.4");
    const rules = generateFirewallRules(config);

    const sshRule = rules.find((r) => r.ports === "22" && r.direction === "inbound");
    expect(sshRule!.sources).not.toContain("0.0.0.0/0");
    expect(sshRule!.sources).not.toContain("::/0");
  });

  it("should ensure VPC access is limited to private CIDR", () => {
    const config = buildFirewallConfig("1.2.3.4", { vpcCidr: "10.132.0.0/16" });
    const rules = generateFirewallRules(config);

    const vpcRules = rules.filter(
      (r) => r.direction === "inbound" && r.sources.includes("10.132.0.0/16"),
    );

    for (const rule of vpcRules) {
      // VPC rules should only reference the VPC CIDR
      expect(rule.sources).toEqual(["10.132.0.0/16"]);
      expect(rule.sources).not.toContain("0.0.0.0/0");
    }
  });

  it("should not allow additional ports from 0.0.0.0/0", () => {
    const config = buildFirewallConfig("1.2.3.4", {
      additionalPorts: ["8080"],
    });
    const rules = generateFirewallRules(config);

    const port8080 = rules.find((r) => r.ports === "8080" && r.direction === "inbound");
    expect(port8080!.sources).toEqual(["1.2.3.4/32"]);
    expect(port8080!.sources).not.toContain("0.0.0.0/0");
  });
});

// =============================================================================
// Instance Lifecycle (provision → destroy)
// =============================================================================

describe("Instance Lifecycle with Firewall", () => {
  let provider: ICloudProvider;
  let manager: FirewallManager;

  beforeEach(() => {
    provider = createMockProvider();
    manager = new FirewallManager(provider, silentLogger);
  });

  it("should add instance on provision and remove on destroy", async () => {
    await manager.ensureFirewall("1.2.3.4");

    // Simulate provision
    await manager.addInstance("inst-new");
    expect(provider.addInstanceToFirewall).toHaveBeenCalledWith("fw-99", "inst-new");
    expect(manager.getTrackedInstances().has("inst-new")).toBe(true);

    // Simulate destroy
    await manager.removeInstance("inst-new");
    expect(provider.removeInstanceFromFirewall).toHaveBeenCalledWith("fw-99", "inst-new");
    expect(manager.getTrackedInstances().has("inst-new")).toBe(false);
  });

  it("should track multiple instances", async () => {
    await manager.ensureFirewall("1.2.3.4");

    await manager.addInstance("inst-1");
    await manager.addInstance("inst-2");
    await manager.addInstance("inst-3");

    expect(manager.getTrackedInstances().size).toBe(3);

    await manager.removeInstance("inst-2");

    const tracked = manager.getTrackedInstances();
    expect(tracked.size).toBe(2);
    expect(tracked.has("inst-1")).toBe(true);
    expect(tracked.has("inst-2")).toBe(false);
    expect(tracked.has("inst-3")).toBe(true);
  });

  it("should handle removing unknown instance gracefully", async () => {
    await manager.ensureFirewall("1.2.3.4");
    // This should not throw — the provider might throw but that's provider-level
    await manager.removeInstance("inst-unknown");
    expect(provider.removeInstanceFromFirewall).toHaveBeenCalledWith("fw-99", "inst-unknown");
  });
});

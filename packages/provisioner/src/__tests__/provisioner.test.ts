// =============================================================================
// Tests for @hivemi/provisioner
// Unit tests using mocked provider
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ICloudProvider,
  Instance,
  SizeMappings,
  ProvisionerLogger,
} from "../types.js";
import { SSHKeyManager } from "../ssh-key.js";
import { FirewallManager, createDefaultRules } from "../firewall.js";
import { reconcile } from "../reconciliation.js";
import { estimateCost, estimateInstanceCost, estimateCostFromInstances } from "../cost.js";
import { createProvider } from "../index.js";

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function createMockInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "inst-123",
    name: "test-vm",
    publicIp: "1.2.3.4",
    privateIp: "10.0.0.1",
    status: "active",
    region: "nyc1",
    size: "small",
    tags: ["hivemi"],
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

const mockSizeMappings: SizeMappings = {
  small: { slug: "s-1vcpu-1gb", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 6 },
  medium: { slug: "s-2vcpu-2gb", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 12 },
  large: { slug: "s-2vcpu-4gb", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 24 },
};

function createMockProvider(overrides: Partial<ICloudProvider> = {}): ICloudProvider {
  return {
    name: "mock",
    sizeMappings: mockSizeMappings,
    createInstance: vi.fn().mockResolvedValue(createMockInstance()),
    destroyInstance: vi.fn().mockResolvedValue(undefined),
    listInstances: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue(createMockInstance()),
    waitReady: vi.fn().mockResolvedValue(createMockInstance()),
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
// SSH Key Manager
// =============================================================================

describe("SSHKeyManager", () => {
  let provider: ICloudProvider;
  let manager: SSHKeyManager;

  beforeEach(() => {
    provider = createMockProvider();
    manager = new SSHKeyManager(provider, silentLogger);
  });

  it("should call provider.ensureSSHKey on first call", async () => {
    const id = await manager.ensureDeployKey("ssh-ed25519 AAAA...");
    expect(id).toBe("key-42");
    expect(provider.ensureSSHKey).toHaveBeenCalledWith("hivemi-deploy", "ssh-ed25519 AAAA...");
  });

  it("should cache key ID on subsequent calls", async () => {
    await manager.ensureDeployKey("ssh-ed25519 AAAA...");
    await manager.ensureDeployKey("ssh-ed25519 AAAA...");
    expect(provider.ensureSSHKey).toHaveBeenCalledTimes(1);
  });

  it("should allow custom key name", async () => {
    await manager.ensureDeployKey("ssh-ed25519 AAAA...", "custom-key");
    expect(provider.ensureSSHKey).toHaveBeenCalledWith("custom-key", "ssh-ed25519 AAAA...");
  });

  it("should clear cache", async () => {
    await manager.ensureDeployKey("ssh-ed25519 AAAA...");
    manager.clearCache();
    await manager.ensureDeployKey("ssh-ed25519 AAAA...");
    expect(provider.ensureSSHKey).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// Firewall Manager
// =============================================================================

describe("FirewallManager", () => {
  let provider: ICloudProvider;
  let manager: FirewallManager;

  beforeEach(() => {
    provider = createMockProvider();
    manager = new FirewallManager(provider, silentLogger);
  });

  it("should create firewall with default name", async () => {
    const id = await manager.ensureFirewall("165.245.132.133");
    expect(id).toBe("fw-99");
    expect(provider.ensureFirewall).toHaveBeenCalledWith(
      "hivemi-agents",
      expect.any(Array),
    );
  });

  it("should cache firewall ID", async () => {
    await manager.ensureFirewall("165.245.132.133");
    await manager.ensureFirewall("165.245.132.133");
    expect(provider.ensureFirewall).toHaveBeenCalledTimes(1);
  });

  it("should add instance to firewall", async () => {
    await manager.ensureFirewall("165.245.132.133");
    await manager.addInstance("inst-456");
    expect(provider.addInstanceToFirewall).toHaveBeenCalledWith("fw-99", "inst-456");
  });

  it("should throw if adding instance before ensuring firewall", async () => {
    await expect(manager.addInstance("inst-456")).rejects.toThrow("Firewall not initialized");
  });

  it("should remove instance from firewall", async () => {
    await manager.ensureFirewall("165.245.132.133");
    await manager.removeInstance("inst-456");
    expect(provider.removeInstanceFromFirewall).toHaveBeenCalledWith("fw-99", "inst-456");
  });

  it("should allow setting firewall ID directly", () => {
    manager.setFirewallId("fw-manual");
    expect(manager.getFirewallId()).toBe("fw-manual");
  });
});

describe("createDefaultRules", () => {
  it("should create rules with control plane IP", () => {
    const rules = createDefaultRules("165.245.132.133");

    const inbound = rules.filter((r) => r.direction === "inbound");
    const outbound = rules.filter((r) => r.direction === "outbound");

    expect(inbound).toHaveLength(2);
    expect(inbound[0]).toMatchObject({ protocol: "tcp", ports: "22", sources: ["165.245.132.133/32"] });
    expect(inbound[1]).toMatchObject({ protocol: "tcp", ports: "3100", sources: ["165.245.132.133/32"] });

    expect(outbound).toHaveLength(3); // tcp, udp, icmp
    expect(outbound.every((r) => r.sources.includes("0.0.0.0/0"))).toBe(true);
  });

  it("should handle CIDR input", () => {
    const rules = createDefaultRules("10.0.0.0/24");
    const sshRule = rules.find((r) => r.ports === "22");
    expect(sshRule?.sources).toEqual(["10.0.0.0/24"]);
  });
});

// =============================================================================
// Reconciliation
// =============================================================================

describe("reconcile", () => {
  it("should identify healthy instances", async () => {
    const inst = createMockInstance({ id: "inst-1", name: "agent-vm" });
    const provider = createMockProvider({
      listInstances: vi.fn().mockResolvedValue([inst]),
    });
    const agents = [{ id: "agent-1", name: "Atlas", instanceId: "inst-1", status: "idle" }];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);
    expect(result.healthy).toHaveLength(1);
    expect(result.orphanedInstances).toHaveLength(0);
    expect(result.phantomAgentIds).toHaveLength(0);
  });

  it("should detect orphaned instances", async () => {
    const inst = createMockInstance({ id: "inst-orphan", name: "orphan-vm" });
    const provider = createMockProvider({
      listInstances: vi.fn().mockResolvedValue([inst]),
    });
    const agents = [{ id: "agent-1", name: "Atlas", instanceId: "inst-other", status: "idle" }];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);
    expect(result.orphanedInstances).toHaveLength(1);
    expect(result.orphanedInstances[0]!.id).toBe("inst-orphan");
  });

  it("should detect phantom agents", async () => {
    const provider = createMockProvider({
      listInstances: vi.fn().mockResolvedValue([]),
    });
    const agents = [
      { id: "agent-phantom", name: "Ghost", instanceId: "inst-gone", status: "idle" },
    ];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);
    expect(result.phantomAgentIds).toEqual(["agent-phantom"]);
  });

  it("should not flag destroyed agents as phantom", async () => {
    const provider = createMockProvider({
      listInstances: vi.fn().mockResolvedValue([]),
    });
    const agents = [
      { id: "agent-dead", name: "Dead", instanceId: "inst-gone", status: "destroyed" },
    ];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);
    expect(result.phantomAgentIds).toHaveLength(0);
  });
});

// =============================================================================
// Cost Estimation
// =============================================================================

describe("estimateCost", () => {
  let provider: ICloudProvider;

  beforeEach(() => {
    provider = createMockProvider();
  });

  it("should estimate cost for single instance", () => {
    const cost = estimateInstanceCost(provider, "small");
    expect(cost).toBe(6);
  });

  it("should estimate total cost for multiple instances", () => {
    const result = estimateCost(provider, [
      { name: "agent-1", size: "small" },
      { name: "agent-2", size: "small" },
      { name: "agent-3", size: "medium" },
    ]);

    expect(result.totalMonthlyCostUsd).toBe(24); // 6 + 6 + 12
    expect(result.instances).toHaveLength(3);
    expect(result.summary).toContain("3 agentes");
    expect(result.summary).toContain("$24/mês");
  });

  it("should estimate from live instances", () => {
    const instances = [
      createMockInstance({ name: "vm-1", size: "large" }),
      createMockInstance({ name: "vm-2", size: "small" }),
    ];

    const result = estimateCostFromInstances(provider, instances);
    expect(result.totalMonthlyCostUsd).toBe(30); // 24 + 6
  });
});

// =============================================================================
// Factory
// =============================================================================

describe("createProvider", () => {
  it("should create DigitalOcean provider", () => {
    const provider = createProvider("digitalocean", { token: "test-token" }, silentLogger);
    expect(provider.name).toBe("digitalocean");
  });

  it("should create GCP stub provider", () => {
    const provider = createProvider("gcp", { token: "test-token" }, silentLogger);
    expect(provider.name).toBe("gcp");
  });

  it("should throw for unknown provider", () => {
    expect(() => createProvider("aws" as "digitalocean", { token: "t" })).toThrow("Unknown cloud provider");
  });

  it("DigitalOcean should throw without token", () => {
    expect(() => createProvider("digitalocean", { token: "" })).toThrow("token is required");
  });
});

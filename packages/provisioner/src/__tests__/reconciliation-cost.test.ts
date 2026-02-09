// =============================================================================
// Tests for Reconciliation and Cost Estimation (Issue #63)
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import type {
  ICloudProvider,
  Instance,
  RegistryAgent,
  SizeMappings,
  ProvisionerLogger,
} from "../types.js";
import {
  reconcile,
  detectIPMismatches,
  generateReconciliationReport,
} from "../reconciliation.js";
import {
  estimateInstanceCost,
  estimateCost,
  estimateCostFromInstances,
  generateCostReport,
} from "../cost.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSizeMappings: SizeMappings = {
  small: { slug: "s-1vcpu-1gb", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 6 },
  medium: { slug: "s-2vcpu-2gb", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 12 },
  large: { slug: "s-2vcpu-4gb", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 24 },
};

const silentLogger: ProvisionerLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createMockProvider(
  instances: Instance[] = [],
  overrides: Partial<ICloudProvider> = {},
): ICloudProvider {
  return {
    name: "mock",
    sizeMappings: mockSizeMappings,
    createInstance: vi.fn(),
    destroyInstance: vi.fn(),
    listInstances: vi.fn().mockResolvedValue(instances),
    getStatus: vi.fn(),
    waitReady: vi.fn(),
    ensureSSHKey: vi.fn(),
    ensureFirewall: vi.fn(),
    addInstanceToFirewall: vi.fn(),
    removeInstanceFromFirewall: vi.fn(),
    ...overrides,
  };
}

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "inst-1",
    name: "hivemi-agent-atlas",
    publicIp: "1.2.3.4",
    privateIp: "10.0.0.1",
    status: "active",
    region: "nyc1",
    size: "small",
    tags: ["hivemi"],
    createdAt: new Date("2026-02-01"),
    ...overrides,
  };
}

function makeAgent(overrides: Partial<RegistryAgent> = {}): RegistryAgent {
  return {
    id: "agent-aaa",
    name: "atlas",
    instanceId: "inst-1",
    status: "idle",
    ...overrides,
  };
}

// =============================================================================
// Reconciliation — Base
// =============================================================================

describe("reconcile", () => {
  it("detects orphaned instances (VM exists, no agent)", async () => {
    const orphan = makeInstance({ id: "orphan-1", name: "orphan-vm" });
    const provider = createMockProvider([orphan]);
    const agents: RegistryAgent[] = []; // no agents

    const result = await reconcile(provider, agents, "hivemi", silentLogger);

    expect(result.orphanedInstances).toHaveLength(1);
    expect(result.orphanedInstances[0].id).toBe("orphan-1");
    expect(result.healthy).toHaveLength(0);
    expect(result.phantomAgentIds).toHaveLength(0);
  });

  it("detects phantom agents (agent exists, no VM)", async () => {
    const provider = createMockProvider([]); // no instances
    const agents = [makeAgent({ id: "phantom-a", instanceId: "gone-instance", status: "idle" })];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);

    expect(result.phantomAgentIds).toHaveLength(1);
    expect(result.phantomAgentIds[0]).toBe("phantom-a");
    expect(result.orphanedInstances).toHaveLength(0);
    expect(result.healthy).toHaveLength(0);
  });

  it("marks healthy when both exist", async () => {
    const inst = makeInstance({ id: "inst-1" });
    const provider = createMockProvider([inst]);
    const agents = [makeAgent({ instanceId: "inst-1" })];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);

    expect(result.healthy).toHaveLength(1);
    expect(result.healthy[0].id).toBe("inst-1");
    expect(result.orphanedInstances).toHaveLength(0);
    expect(result.phantomAgentIds).toHaveLength(0);
  });

  it("ignores destroyed/offline agents when detecting phantoms", async () => {
    const provider = createMockProvider([]);
    const agents = [
      makeAgent({ id: "a1", instanceId: "gone-1", status: "destroyed" }),
      makeAgent({ id: "a2", instanceId: "gone-2", status: "offline" }),
    ];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);

    expect(result.phantomAgentIds).toHaveLength(0);
  });

  it("handles agents without instanceId", async () => {
    const provider = createMockProvider([]);
    const agents = [makeAgent({ instanceId: null })];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);

    expect(result.phantomAgentIds).toHaveLength(0);
    expect(result.healthy).toHaveLength(0);
    expect(result.orphanedInstances).toHaveLength(0);
  });

  it("handles mixed scenario", async () => {
    const healthy = makeInstance({ id: "inst-ok", name: "healthy-vm" });
    const orphan = makeInstance({ id: "inst-orphan", name: "orphan-vm" });
    const provider = createMockProvider([healthy, orphan]);
    const agents = [
      makeAgent({ id: "agent-ok", instanceId: "inst-ok" }),
      makeAgent({ id: "agent-phantom", instanceId: "inst-gone", status: "working" }),
    ];

    const result = await reconcile(provider, agents, "hivemi", silentLogger);

    expect(result.healthy).toHaveLength(1);
    expect(result.orphanedInstances).toHaveLength(1);
    expect(result.phantomAgentIds).toHaveLength(1);
  });

  it("passes tag to provider.listInstances", async () => {
    const provider = createMockProvider([]);
    await reconcile(provider, [], "custom-tag", silentLogger);

    expect(provider.listInstances).toHaveBeenCalledWith(["custom-tag"]);
  });

  it("uses default tag 'hivemi'", async () => {
    const provider = createMockProvider([]);
    await reconcile(provider, [], undefined, silentLogger);

    expect(provider.listInstances).toHaveBeenCalledWith(["hivemi"]);
  });
});

// =============================================================================
// IP Mismatch Detection
// =============================================================================

describe("detectIPMismatches", () => {
  it("detects when agent host IP differs from instance public IP", () => {
    const agents = [makeAgent({ host: "http://5.6.7.8", instanceId: "inst-1" })];
    const instances = [makeInstance({ id: "inst-1", publicIp: "1.2.3.4" })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("ip_mismatch");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("5.6.7.8");
    expect(issues[0].message).toContain("1.2.3.4");
  });

  it("returns no issues when IPs match", () => {
    const agents = [makeAgent({ host: "http://1.2.3.4", instanceId: "inst-1" })];
    const instances = [makeInstance({ id: "inst-1", publicIp: "1.2.3.4" })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(0);
  });

  it("skips localhost agents", () => {
    const agents = [makeAgent({ host: "http://localhost:3001", instanceId: "inst-1" })];
    const instances = [makeInstance({ id: "inst-1", publicIp: "1.2.3.4" })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(0);
  });

  it("skips 127.x agents", () => {
    const agents = [makeAgent({ host: "http://127.0.0.1:3001", instanceId: "inst-1" })];
    const instances = [makeInstance({ id: "inst-1", publicIp: "1.2.3.4" })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(0);
  });

  it("skips agents without host", () => {
    const agents = [makeAgent({ host: undefined, instanceId: "inst-1" })];
    const instances = [makeInstance({ id: "inst-1" })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(0);
  });

  it("skips agents without instanceId", () => {
    const agents = [makeAgent({ host: "http://1.2.3.4", instanceId: null })];
    const instances = [makeInstance({ id: "inst-1" })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(0);
  });

  it("skips instances without publicIp", () => {
    const agents = [makeAgent({ host: "http://1.2.3.4", instanceId: "inst-1" })];
    const instances = [makeInstance({ id: "inst-1", publicIp: null })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(0);
  });

  it("skips non-IP hostnames", () => {
    const agents = [makeAgent({ host: "http://my-agent.example.com", instanceId: "inst-1" })];
    const instances = [makeInstance({ id: "inst-1", publicIp: "1.2.3.4" })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(0);
  });

  it("handles host with port", () => {
    const agents = [makeAgent({ host: "http://5.6.7.8:3001", instanceId: "inst-1" })];
    const instances = [makeInstance({ id: "inst-1", publicIp: "1.2.3.4" })];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("5.6.7.8");
  });

  it("detects multiple mismatches", () => {
    const agents = [
      makeAgent({ id: "a1", name: "agent-1", host: "http://9.9.9.9", instanceId: "inst-1" }),
      makeAgent({ id: "a2", name: "agent-2", host: "http://8.8.8.8", instanceId: "inst-2" }),
    ];
    const instances = [
      makeInstance({ id: "inst-1", publicIp: "1.1.1.1" }),
      makeInstance({ id: "inst-2", publicIp: "2.2.2.2" }),
    ];

    const issues = detectIPMismatches(agents, instances);

    expect(issues).toHaveLength(2);
  });
});

// =============================================================================
// Reconciliation Report
// =============================================================================

describe("generateReconciliationReport", () => {
  it("generates clean report when no issues", async () => {
    const inst = makeInstance({ id: "inst-1" });
    const provider = createMockProvider([inst]);
    const agents = [makeAgent({ instanceId: "inst-1" })];

    const report = await generateReconciliationReport(provider, agents, "hivemi", silentLogger);

    expect(report.status).toBe("clean");
    expect(report.issues).toHaveLength(0);
    expect(report.stats.healthy).toBe(1);
    expect(report.stats.orphaned).toBe(0);
    expect(report.stats.phantom).toBe(0);
    expect(report.stats.totalVMs).toBe(1);
    expect(report.provider).toBe("mock");
    expect(report.timestamp).toBeTruthy();
  });

  it("generates warning report with orphaned VMs", async () => {
    const orphan = makeInstance({ id: "orphan-1", name: "orphan-vm" });
    const provider = createMockProvider([orphan]);

    const report = await generateReconciliationReport(provider, [], "hivemi", silentLogger);

    expect(report.status).toBe("warning");
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].type).toBe("orphaned_vm");
    expect(report.issues[0].severity).toBe("error");
    expect(report.issues[0].instanceId).toBe("orphan-1");
    expect(report.issues[0].instanceName).toBe("orphan-vm");
    expect(report.stats.orphaned).toBe(1);
  });

  it("generates warning report with phantom agents", async () => {
    const provider = createMockProvider([]);
    const agents = [makeAgent({ id: "phantom-a", name: "phantom", instanceId: "gone", status: "idle" })];

    const report = await generateReconciliationReport(provider, agents, "hivemi", silentLogger);

    expect(report.status).toBe("warning");
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].type).toBe("phantom_agent");
    expect(report.issues[0].severity).toBe("warning");
    expect(report.issues[0].agentId).toBe("phantom-a");
    expect(report.issues[0].agentName).toBe("phantom");
    expect(report.stats.phantom).toBe(1);
  });

  it("includes IP mismatches in report", async () => {
    const inst = makeInstance({ id: "inst-1", publicIp: "1.2.3.4" });
    const provider = createMockProvider([inst]);
    const agents = [makeAgent({ instanceId: "inst-1", host: "http://5.6.7.8" })];

    const report = await generateReconciliationReport(provider, agents, "hivemi", silentLogger);

    expect(report.stats.ipMismatches).toBe(1);
    const ipIssue = report.issues.find((i) => i.type === "ip_mismatch");
    expect(ipIssue).toBeTruthy();
  });

  it("sets critical status when 3+ orphaned VMs", async () => {
    const orphans = [
      makeInstance({ id: "o1", name: "orphan-1" }),
      makeInstance({ id: "o2", name: "orphan-2" }),
      makeInstance({ id: "o3", name: "orphan-3" }),
    ];
    const provider = createMockProvider(orphans);

    const report = await generateReconciliationReport(provider, [], "hivemi", silentLogger);

    expect(report.status).toBe("critical");
    expect(report.stats.orphaned).toBe(3);
  });

  it("sets critical status when 5+ total issues", async () => {
    // 2 orphans + 3 phantoms = 5 issues → critical
    const orphans = [
      makeInstance({ id: "o1", name: "orphan-1" }),
      makeInstance({ id: "o2", name: "orphan-2" }),
    ];
    const provider = createMockProvider(orphans);
    const agents = [
      makeAgent({ id: "p1", name: "phantom-1", instanceId: "gone-1", status: "idle" }),
      makeAgent({ id: "p2", name: "phantom-2", instanceId: "gone-2", status: "working" }),
      makeAgent({ id: "p3", name: "phantom-3", instanceId: "gone-3", status: "error" }),
    ];

    const report = await generateReconciliationReport(provider, agents, "hivemi", silentLogger);

    expect(report.status).toBe("critical");
    expect(report.issues.length).toBe(5);
  });

  it("generates empty clean report with no VMs and no agents", async () => {
    const provider = createMockProvider([]);

    const report = await generateReconciliationReport(provider, [], "hivemi", silentLogger);

    expect(report.status).toBe("clean");
    expect(report.issues).toHaveLength(0);
    expect(report.stats.totalVMs).toBe(0);
    expect(report.stats.healthy).toBe(0);
  });
});

// =============================================================================
// Cost Estimation — Basic
// =============================================================================

describe("estimateInstanceCost", () => {
  it("returns monthly cost for small instance", () => {
    const provider = createMockProvider();
    expect(estimateInstanceCost(provider, "small")).toBe(6);
  });

  it("returns monthly cost for medium instance", () => {
    const provider = createMockProvider();
    expect(estimateInstanceCost(provider, "medium")).toBe(12);
  });

  it("returns monthly cost for large instance", () => {
    const provider = createMockProvider();
    expect(estimateInstanceCost(provider, "large")).toBe(24);
  });
});

describe("estimateCost", () => {
  it("calculates total for multiple instances", () => {
    const provider = createMockProvider();
    const result = estimateCost(provider, [
      { name: "agent-1", size: "small" },
      { name: "agent-2", size: "medium" },
      { name: "agent-3", size: "large" },
    ]);

    expect(result.totalMonthlyCostUsd).toBe(42); // 6 + 12 + 24
    expect(result.instances).toHaveLength(3);
    expect(result.provider).toBe("mock");
    expect(result.summary).toContain("3 agentes");
    expect(result.summary).toContain("$42/mês");
  });

  it("returns zero for empty instances", () => {
    const provider = createMockProvider();
    const result = estimateCost(provider, []);

    expect(result.totalMonthlyCostUsd).toBe(0);
    expect(result.instances).toHaveLength(0);
  });

  it("groups sizes in summary", () => {
    const provider = createMockProvider();
    const result = estimateCost(provider, [
      { name: "a1", size: "small" },
      { name: "a2", size: "small" },
      { name: "a3", size: "large" },
    ]);

    expect(result.summary).toContain("2 small");
    expect(result.summary).toContain("1 large");
  });
});

describe("estimateCostFromInstances", () => {
  it("calculates cost from live instances", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ name: "vm-1", size: "small" }),
      makeInstance({ name: "vm-2", size: "medium" }),
    ];

    const result = estimateCostFromInstances(provider, instances);

    expect(result.totalMonthlyCostUsd).toBe(18); // 6 + 12
    expect(result.instances).toHaveLength(2);
  });
});

// =============================================================================
// Cost Report — Enhanced
// =============================================================================

describe("generateCostReport", () => {
  // Use a fixed date in the middle of a 28-day month for predictable math
  const feb15 = new Date("2026-02-15T12:00:00Z"); // Feb has 28 days

  it("calculates monthly cost", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ name: "vm-1", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ name: "vm-2", size: "medium", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    expect(report.monthly).toBe(18); // 6 + 12
    expect(report.provider).toBe("mock");
    expect(report.breakdown).toHaveLength(2);
  });

  it("calculates accumulated cost for full-month VMs", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ name: "vm-1", size: "small", createdAt: new Date("2026-01-01") }), // started before this month
    ];

    const report = generateCostReport(provider, instances, feb15);

    // Running since before the month → ~14.5 days (Feb 1 00:00 to Feb 15 12:00)
    // accumulated = 14.5 * (6/28) ≈ 3.11
    expect(report.accumulated).toBeCloseTo(3.11, 1);
  });

  it("calculates accumulated cost for mid-month VMs", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ name: "vm-1", size: "small", createdAt: new Date("2026-02-10") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    // Running since Feb 10 00:00 to Feb 15 12:00 → 5.5 days of 28
    // accumulated = 5.5 * (6/28) ≈ 1.18
    expect(report.accumulated).toBeCloseTo(1.18, 1);
    expect(report.breakdown[0].daysRunning).toBeCloseTo(5.5, 0);
  });

  it("calculates projected cost", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ name: "vm-1", size: "small", createdAt: new Date("2026-01-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    // Projected = accumulated / (currentDay / totalDays)
    // accumulated ≈ 3.21, fraction = 15/28 ≈ 0.536
    // projected ≈ 3.21 / 0.536 ≈ 5.99 ≈ 6 (monthly cost)
    expect(report.projected).toBeCloseTo(6, 0);
  });

  it("returns zero for no instances", () => {
    const provider = createMockProvider();
    const report = generateCostReport(provider, [], feb15);

    expect(report.monthly).toBe(0);
    expect(report.projected).toBe(0);
    expect(report.accumulated).toBe(0);
    expect(report.breakdown).toHaveLength(0);
  });

  it("includes generatedAt timestamp", () => {
    const provider = createMockProvider();
    const report = generateCostReport(provider, [], feb15);

    expect(report.generatedAt).toBe(feb15.toISOString());
  });

  it("handles VM created today", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ name: "new-vm", size: "large", createdAt: feb15 }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    expect(report.monthly).toBe(24);
    // Accumulated should be ~0 since created at the exact same time
    expect(report.accumulated).toBeCloseTo(0, 0);
    expect(report.breakdown[0].daysRunning).toBeCloseTo(0, 0);
  });

  it("caps days running to elapsed month days", () => {
    const provider = createMockProvider();
    // VM created before this month started
    const instances = [
      makeInstance({ name: "old-vm", size: "small", createdAt: new Date("2025-06-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    // Should show ~14.5 days running (Feb 1 00:00 to Feb 15 12:00), not 250+ days
    expect(report.breakdown[0].daysRunning).toBeCloseTo(14.5, 0);
  });

  it("handles multiple instances with different sizes", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ name: "small-1", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ name: "medium-1", size: "medium", createdAt: new Date("2026-02-01") }),
      makeInstance({ name: "large-1", size: "large", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    expect(report.monthly).toBe(42); // 6 + 12 + 24
    expect(report.breakdown).toHaveLength(3);

    const smallBreakdown = report.breakdown.find((b) => b.name === "small-1");
    expect(smallBreakdown?.monthlyCostUsd).toBe(6);

    const largeBreakdown = report.breakdown.find((b) => b.name === "large-1");
    expect(largeBreakdown?.monthlyCostUsd).toBe(24);
  });

  it("projected equals monthly when VMs run full month", () => {
    const provider = createMockProvider();
    // VM running since Jan (before month start) on day 28 (last day of Feb)
    const lastDay = new Date("2026-02-28T23:59:59Z");
    const instances = [
      makeInstance({ name: "vm-1", size: "small", createdAt: new Date("2026-01-01") }),
    ];

    const report = generateCostReport(provider, instances, lastDay);

    // On last day: accumulated ≈ monthly, projected ≈ monthly
    expect(report.projected).toBeCloseTo(6, 0);
    expect(report.accumulated).toBeCloseTo(6, 0);
  });

  it("uses string createdAt dates (ISO format)", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({
        name: "vm-1",
        size: "small",
        createdAt: "2026-02-01T00:00:00Z" as unknown as Date,
      }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    // Should handle string dates by converting
    expect(report.breakdown[0].daysRunning).toBeGreaterThan(0);
    expect(report.monthly).toBe(6);
  });
});

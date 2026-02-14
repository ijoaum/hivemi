// =============================================================================
// Tests for Cost Estimation — Issue #84
// Covers: pricing tables, cost report generation, caching, agent mappings,
//         provider support, endpoint shapes
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import type {
  ICloudProvider,
  Instance,
  SizeMappings,
  CostReport,
} from "../types.js";
import {
  estimateInstanceCost,
  generateCostReport,
  getCachedCostReport,
  setCostCache,
  invalidateCostCache,
  getCostCacheInfo,
} from "../cost.js";
import type { AgentInstanceMapping } from "../cost.js";
import {
  DIGITALOCEAN_PRICING,
  GCP_PRICING,
  PROVIDER_PRICING,
  getPricingForProvider,
  getMonthlyCost,
  listProviders,
} from "../pricing/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSizeMappings: SizeMappings = {
  small: { slug: "s-1vcpu-1gb", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 6 },
  medium: { slug: "s-2vcpu-2gb", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 12 },
  large: { slug: "s-2vcpu-4gb", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 24 },
};

function createMockProvider(
  instances: Instance[] = [],
  overrides: Partial<ICloudProvider> = {},
): ICloudProvider {
  return {
    name: "mock",
    sizeMappings: mockSizeMappings,
    createInstance: async () => ({} as Instance),
    destroyInstance: async () => {},
    listInstances: async () => instances,
    getStatus: async () => ({} as Instance),
    waitReady: async () => ({} as Instance),
    ensureSSHKey: async () => "",
    ensureFirewall: async () => "",
    addInstanceToFirewall: async () => {},
    removeInstanceFromFirewall: async () => {},
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

const feb15 = new Date("2026-02-15T12:00:00Z");

// =============================================================================
// Pricing Tables
// =============================================================================

describe("Pricing Tables", () => {
  it("DIGITALOCEAN_PRICING has all sizes", () => {
    expect(DIGITALOCEAN_PRICING.small).toBeDefined();
    expect(DIGITALOCEAN_PRICING.medium).toBeDefined();
    expect(DIGITALOCEAN_PRICING.large).toBeDefined();
  });

  it("GCP_PRICING has all sizes", () => {
    expect(GCP_PRICING.small).toBeDefined();
    expect(GCP_PRICING.medium).toBeDefined();
    expect(GCP_PRICING.large).toBeDefined();
  });

  it("DIGITALOCEAN_PRICING matches known values", () => {
    expect(DIGITALOCEAN_PRICING.small.monthlyCostUsd).toBe(6);
    expect(DIGITALOCEAN_PRICING.medium.monthlyCostUsd).toBe(12);
    expect(DIGITALOCEAN_PRICING.large.monthlyCostUsd).toBe(24);
  });

  it("GCP_PRICING matches known values", () => {
    expect(GCP_PRICING.small.monthlyCostUsd).toBe(7);
    expect(GCP_PRICING.medium.monthlyCostUsd).toBe(13);
    expect(GCP_PRICING.large.monthlyCostUsd).toBe(25);
  });

  it("PROVIDER_PRICING includes both providers", () => {
    expect(PROVIDER_PRICING.digitalocean).toBe(DIGITALOCEAN_PRICING);
    expect(PROVIDER_PRICING.gcp).toBe(GCP_PRICING);
  });

  it("getPricingForProvider returns correct pricing", () => {
    expect(getPricingForProvider("digitalocean")).toBe(DIGITALOCEAN_PRICING);
    expect(getPricingForProvider("gcp")).toBe(GCP_PRICING);
  });

  it("getPricingForProvider is case-insensitive", () => {
    expect(getPricingForProvider("DigitalOcean")).toBe(DIGITALOCEAN_PRICING);
    expect(getPricingForProvider("GCP")).toBe(GCP_PRICING);
  });

  it("getPricingForProvider throws for unknown provider", () => {
    expect(() => getPricingForProvider("aws")).toThrow("Unknown provider: aws");
  });

  it("getMonthlyCost returns correct value", () => {
    expect(getMonthlyCost("digitalocean", "small")).toBe(6);
    expect(getMonthlyCost("gcp", "large")).toBe(25);
  });

  it("listProviders returns all providers", () => {
    const providers = listProviders();
    expect(providers).toContain("digitalocean");
    expect(providers).toContain("gcp");
    expect(providers.length).toBe(2);
  });
});

// =============================================================================
// Cost Report — Agent Mappings
// =============================================================================

describe("generateCostReport with agent mappings", () => {
  it("enriches breakdown with agent info", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "inst-1", name: "vm-atlas", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "inst-2", name: "vm-zeus", size: "medium", createdAt: new Date("2026-02-01") }),
    ];

    const mappings: AgentInstanceMapping[] = [
      { agentId: "agent-1", agentName: "atlas", instanceId: "inst-1" },
      { agentId: "agent-2", agentName: "zeus", instanceId: "inst-2" },
    ];

    const report = generateCostReport(provider, instances, feb15, mappings);

    expect(report.breakdown[0].agentId).toBe("agent-1");
    expect(report.breakdown[0].agentName).toBe("atlas");
    expect(report.breakdown[1].agentId).toBe("agent-2");
    expect(report.breakdown[1].agentName).toBe("zeus");
  });

  it("handles instances without agent mapping", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "inst-1", name: "vm-orphan", size: "small", createdAt: new Date("2026-02-01") }),
    ];

    const mappings: AgentInstanceMapping[] = []; // no mappings

    const report = generateCostReport(provider, instances, feb15, mappings);

    expect(report.breakdown[0].agentId).toBeUndefined();
    expect(report.breakdown[0].agentName).toBeUndefined();
    expect(report.breakdown[0].name).toBe("vm-orphan");
  });

  it("handles partial mappings (some instances have agents, some don't)", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "inst-1", name: "vm-1", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "inst-2", name: "vm-2", size: "medium", createdAt: new Date("2026-02-01") }),
    ];

    const mappings: AgentInstanceMapping[] = [
      { agentId: "agent-1", agentName: "atlas", instanceId: "inst-1" },
      // inst-2 has no mapping
    ];

    const report = generateCostReport(provider, instances, feb15, mappings);

    expect(report.breakdown[0].agentId).toBe("agent-1");
    expect(report.breakdown[1].agentId).toBeUndefined();
  });

  it("works without agent mappings parameter", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "inst-1", size: "small", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    expect(report.breakdown[0].agentId).toBeUndefined();
    expect(report.monthly).toBe(6);
  });

  it("does not break with undefined mappings", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "inst-1", size: "small", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15, undefined);

    expect(report.breakdown).toHaveLength(1);
    expect(report.monthly).toBe(6);
  });
});

// =============================================================================
// Cost Report — Multi-provider Support
// =============================================================================

describe("Multi-provider cost calculation", () => {
  it("calculates DO costs correctly", () => {
    const doProvider: ICloudProvider = {
      ...createMockProvider(),
      name: "digitalocean",
      sizeMappings: DIGITALOCEAN_PRICING,
    };

    const instances = [
      makeInstance({ id: "i1", name: "do-small", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "i2", name: "do-large", size: "large", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(doProvider, instances, feb15);

    expect(report.monthly).toBe(30); // 6 + 24
    expect(report.provider).toBe("digitalocean");
  });

  it("calculates GCP costs correctly", () => {
    const gcpProvider: ICloudProvider = {
      ...createMockProvider(),
      name: "gcp",
      sizeMappings: GCP_PRICING,
    };

    const instances = [
      makeInstance({ id: "i1", name: "gcp-small", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "i2", name: "gcp-large", size: "large", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(gcpProvider, instances, feb15);

    expect(report.monthly).toBe(32); // 7 + 25
    expect(report.provider).toBe("gcp");
  });

  it("GCP is more expensive than DO for same sizes", () => {
    const doProvider: ICloudProvider = {
      ...createMockProvider(),
      name: "digitalocean",
      sizeMappings: DIGITALOCEAN_PRICING,
    };
    const gcpProvider: ICloudProvider = {
      ...createMockProvider(),
      name: "gcp",
      sizeMappings: GCP_PRICING,
    };

    const instances = [
      makeInstance({ id: "i1", size: "medium", createdAt: new Date("2026-02-01") }),
    ];

    const doReport = generateCostReport(doProvider, instances, feb15);
    const gcpReport = generateCostReport(gcpProvider, instances, feb15);

    expect(gcpReport.monthly).toBeGreaterThan(doReport.monthly);
  });
});

// =============================================================================
// Cost Report — Instance Sizes
// =============================================================================

describe("Instance size cost support", () => {
  const provider = createMockProvider();

  it("calculates small instance cost", () => {
    expect(estimateInstanceCost(provider, "small")).toBe(6);
  });

  it("calculates medium instance cost", () => {
    expect(estimateInstanceCost(provider, "medium")).toBe(12);
  });

  it("calculates large instance cost", () => {
    expect(estimateInstanceCost(provider, "large")).toBe(24);
  });

  it("report includes all sizes correctly", () => {
    const instances = [
      makeInstance({ id: "i1", name: "s", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "i2", name: "m", size: "medium", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "i3", name: "l", size: "large", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    expect(report.monthly).toBe(42);
    expect(report.breakdown.find(b => b.size === "small")?.monthlyCostUsd).toBe(6);
    expect(report.breakdown.find(b => b.size === "medium")?.monthlyCostUsd).toBe(12);
    expect(report.breakdown.find(b => b.size === "large")?.monthlyCostUsd).toBe(24);
  });
});

// =============================================================================
// Cost Cache
// =============================================================================

describe("Cost cache", () => {
  beforeEach(() => {
    invalidateCostCache();
  });

  it("returns null when empty", () => {
    expect(getCachedCostReport()).toBeNull();
  });

  it("stores and retrieves report", () => {
    const report: CostReport = {
      monthly: 42,
      projected: 42,
      accumulated: 21,
      breakdown: [],
      provider: "mock",
      generatedAt: new Date().toISOString(),
    };

    setCostCache(report);
    expect(getCachedCostReport()).toEqual(report);
  });

  it("invalidates cache", () => {
    const report: CostReport = {
      monthly: 42,
      projected: 42,
      accumulated: 21,
      breakdown: [],
      provider: "mock",
      generatedAt: new Date().toISOString(),
    };

    setCostCache(report);
    expect(getCachedCostReport()).not.toBeNull();

    invalidateCostCache();
    expect(getCachedCostReport()).toBeNull();
  });

  it("expires after TTL", async () => {
    const report: CostReport = {
      monthly: 10,
      projected: 10,
      accumulated: 5,
      breakdown: [],
      provider: "mock",
      generatedAt: new Date().toISOString(),
    };

    // Set with 1ms TTL and wait for it to expire
    setCostCache(report, 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(getCachedCostReport()).toBeNull();
  });

  it("getCostCacheInfo returns cached state", () => {
    expect(getCostCacheInfo().cached).toBe(false);

    const report: CostReport = {
      monthly: 10,
      projected: 10,
      accumulated: 5,
      breakdown: [],
      provider: "mock",
      generatedAt: new Date().toISOString(),
    };

    setCostCache(report, 60_000);

    const info = getCostCacheInfo();
    expect(info.cached).toBe(true);
    expect(info.cachedAt).toBeGreaterThan(0);
    expect(info.expiresAt).toBeGreaterThan(info.cachedAt!);
  });

  it("getCostCacheInfo returns not-cached after invalidation", () => {
    const report: CostReport = {
      monthly: 10,
      projected: 10,
      accumulated: 5,
      breakdown: [],
      provider: "mock",
      generatedAt: new Date().toISOString(),
    };

    setCostCache(report);
    invalidateCostCache();

    expect(getCostCacheInfo().cached).toBe(false);
  });

  it("getCostCacheInfo detects expired cache", async () => {
    const report: CostReport = {
      monthly: 10,
      projected: 10,
      accumulated: 5,
      breakdown: [],
      provider: "mock",
      generatedAt: new Date().toISOString(),
    };

    setCostCache(report, 1); // 1ms TTL
    await new Promise((r) => setTimeout(r, 5));
    expect(getCostCacheInfo().cached).toBe(false);
  });
});

// =============================================================================
// Cost Report — Projections
// =============================================================================

describe("Cost projections", () => {
  it("projected equals monthly for full-month VMs at end of month", () => {
    const provider = createMockProvider();
    const lastDay = new Date("2026-02-28T23:59:59Z");
    const instances = [
      makeInstance({ size: "small", createdAt: new Date("2026-01-01") }),
    ];

    const report = generateCostReport(provider, instances, lastDay);

    expect(report.projected).toBeCloseTo(6, 0);
    expect(report.accumulated).toBeCloseTo(6, 0);
  });

  it("projected is higher than accumulated mid-month", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ size: "medium", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    expect(report.projected).toBeGreaterThanOrEqual(report.accumulated);
  });

  it("projected uses daily fraction for estimation", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ size: "small", createdAt: new Date("2026-01-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    // 15/28 of month elapsed, so projected should be close to monthly
    expect(report.projected).toBeCloseTo(6, 0);
  });

  it("projected defaults to monthly when daily fraction is 0", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ size: "small", createdAt: new Date("2026-02-01") }),
    ];

    // Day 0 edge case — use month start at midnight
    const monthStart = new Date("2026-02-01T00:00:00Z");
    const report = generateCostReport(provider, instances, monthStart);

    // 1/28 fraction, accumulated should be tiny
    expect(report.monthly).toBe(6);
  });

  it("handles zero instances gracefully", () => {
    const provider = createMockProvider();
    const report = generateCostReport(provider, [], feb15);

    expect(report.monthly).toBe(0);
    expect(report.projected).toBe(0);
    expect(report.accumulated).toBe(0);
  });
});

// =============================================================================
// Cost Report — Accumulated per Instance
// =============================================================================

describe("Accumulated cost per instance", () => {
  it("calculates accumulated for VM running all month", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ size: "small", createdAt: new Date("2026-01-15") }), // started before this month
    ];

    const report = generateCostReport(provider, instances, feb15);

    // 14.5 days out of 28 → accumulated = 14.5 * (6/28) ≈ 3.11
    expect(report.breakdown[0].accumulatedCostUsd).toBeCloseTo(3.11, 0);
    expect(report.breakdown[0].daysRunning).toBeCloseTo(14.5, 0);
  });

  it("calculates accumulated for VM created mid-month", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ size: "medium", createdAt: new Date("2026-02-10T00:00:00Z") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    // 5.5 days running → accumulated = 5.5 * (12/28) ≈ 2.36
    expect(report.breakdown[0].accumulatedCostUsd).toBeCloseTo(2.36, 0);
    expect(report.breakdown[0].daysRunning).toBeCloseTo(5.5, 0);
  });

  it("accumulated is 0 for VM created right now", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ size: "large", createdAt: feb15 }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    expect(report.breakdown[0].accumulatedCostUsd).toBe(0);
    expect(report.breakdown[0].daysRunning).toBe(0);
  });
});

// =============================================================================
// Endpoint Response Shape
// =============================================================================

describe("CostReport response shape", () => {
  it("has all required fields", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "i1", name: "vm-1", size: "small", createdAt: new Date("2026-02-01") }),
    ];
    const mappings: AgentInstanceMapping[] = [
      { agentId: "a1", agentName: "atlas", instanceId: "i1" },
    ];

    const report = generateCostReport(provider, instances, feb15, mappings);

    // Top-level fields
    expect(report).toHaveProperty("monthly");
    expect(report).toHaveProperty("projected");
    expect(report).toHaveProperty("accumulated");
    expect(report).toHaveProperty("breakdown");
    expect(report).toHaveProperty("provider");
    expect(report).toHaveProperty("generatedAt");
    expect(typeof report.monthly).toBe("number");
    expect(typeof report.projected).toBe("number");
    expect(typeof report.accumulated).toBe("number");
    expect(Array.isArray(report.breakdown)).toBe(true);
    expect(typeof report.provider).toBe("string");
    expect(typeof report.generatedAt).toBe("string");
  });

  it("breakdown items have all fields including agent info", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "i1", name: "vm-1", size: "small", createdAt: new Date("2026-02-01") }),
    ];
    const mappings: AgentInstanceMapping[] = [
      { agentId: "a1", agentName: "atlas", instanceId: "i1" },
    ];

    const report = generateCostReport(provider, instances, feb15, mappings);
    const item = report.breakdown[0];

    expect(item).toHaveProperty("name");
    expect(item).toHaveProperty("size");
    expect(item).toHaveProperty("monthlyCostUsd");
    expect(item).toHaveProperty("daysRunning");
    expect(item).toHaveProperty("accumulatedCostUsd");
    expect(item).toHaveProperty("agentId");
    expect(item).toHaveProperty("agentName");
  });

  it("generatedAt is valid ISO string", () => {
    const provider = createMockProvider();
    const report = generateCostReport(provider, [], feb15);

    expect(() => new Date(report.generatedAt)).not.toThrow();
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
  });

  it("total equals sum of breakdown monthly costs", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "i1", name: "s", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "i2", name: "m", size: "medium", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "i3", name: "l", size: "large", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    const sumMonthly = report.breakdown.reduce((s, b) => s + b.monthlyCostUsd, 0);
    expect(report.monthly).toBe(sumMonthly);
  });

  it("total accumulated equals sum of breakdown accumulated costs", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ id: "i1", name: "s", size: "small", createdAt: new Date("2026-02-01") }),
      makeInstance({ id: "i2", name: "m", size: "medium", createdAt: new Date("2026-02-05") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    const sumAccumulated = report.breakdown.reduce((s, b) => s + b.accumulatedCostUsd, 0);
    expect(report.accumulated).toBeCloseTo(sumAccumulated, 2);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge cases", () => {
  it("handles string createdAt dates (ISO format)", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({
        name: "vm-1",
        size: "small",
        createdAt: "2026-02-01T00:00:00Z" as unknown as Date,
      }),
    ];

    const report = generateCostReport(provider, instances, feb15);
    expect(report.breakdown[0].daysRunning).toBeGreaterThan(0);
  });

  it("handles VM created in future (edge case)", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ size: "small", createdAt: new Date("2026-03-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    // Future VM shouldn't have accumulated cost
    expect(report.breakdown[0].accumulatedCostUsd).toBe(0);
    expect(report.breakdown[0].daysRunning).toBe(0);
  });

  it("handles many instances", () => {
    const provider = createMockProvider();
    const instances = Array.from({ length: 100 }, (_, i) =>
      makeInstance({
        id: `inst-${i}`,
        name: `vm-${i}`,
        size: "small",
        createdAt: new Date("2026-02-01"),
      }),
    );

    const report = generateCostReport(provider, instances, feb15);

    expect(report.monthly).toBe(600); // 100 * 6
    expect(report.breakdown).toHaveLength(100);
  });

  it("single instance total matches breakdown", () => {
    const provider = createMockProvider();
    const instances = [
      makeInstance({ size: "large", createdAt: new Date("2026-02-01") }),
    ];

    const report = generateCostReport(provider, instances, feb15);

    expect(report.monthly).toBe(report.breakdown[0].monthlyCostUsd);
    expect(report.accumulated).toBe(report.breakdown[0].accumulatedCostUsd);
  });
});

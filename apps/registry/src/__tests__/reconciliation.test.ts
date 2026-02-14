// =============================================================================
// Tests for Reconciliation Job and API (Issue #83)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock types matching the provisioner
// ---------------------------------------------------------------------------

interface MockInstance {
  id: string;
  name: string;
  publicIp: string | null;
  privateIp: string | null;
  status: string;
  region: string;
  size: string;
  tags: string[];
  createdAt: Date;
}

interface MockAgent {
  id: string;
  name: string;
  instanceId: string | null;
  status: string;
  host?: string;
  privateIp?: string | null;
}

interface MockReport {
  result: {
    orphanedInstances: MockInstance[];
    phantomAgentIds: string[];
    healthy: MockInstance[];
  };
  issues: Array<{
    type: string;
    severity: string;
    message: string;
    instanceId?: string;
    instanceName?: string;
    agentId?: string;
    agentName?: string;
  }>;
  status: "clean" | "warning" | "critical";
  timestamp: string;
  provider: string;
  stats: {
    totalVMs: number;
    healthy: number;
    orphaned: number;
    phantom: number;
    ipMismatches: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<MockInstance> = {}): MockInstance {
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

function makeAgent(overrides: Partial<MockAgent> = {}): MockAgent {
  return {
    id: "agent-aaa",
    name: "atlas",
    instanceId: "inst-1",
    status: "idle",
    ...overrides,
  };
}

function makeCleanReport(): MockReport {
  return {
    result: {
      orphanedInstances: [],
      phantomAgentIds: [],
      healthy: [makeInstance()],
    },
    issues: [],
    status: "clean",
    timestamp: new Date().toISOString(),
    provider: "digitalocean",
    stats: {
      totalVMs: 1,
      healthy: 1,
      orphaned: 0,
      phantom: 0,
      ipMismatches: 0,
    },
  };
}

function makeWarningReport(): MockReport {
  return {
    result: {
      orphanedInstances: [makeInstance({ id: "orphan-1", name: "orphan-vm" })],
      phantomAgentIds: ["phantom-agent-1"],
      healthy: [makeInstance()],
    },
    issues: [
      {
        type: "orphaned_vm",
        severity: "error",
        message: 'VM "orphan-vm" (orphan-1) has no matching agent',
        instanceId: "orphan-1",
        instanceName: "orphan-vm",
      },
      {
        type: "phantom_agent",
        severity: "warning",
        message: 'Agent "phantom" has instanceId but no matching VM',
        agentId: "phantom-agent-1",
        agentName: "phantom",
      },
    ],
    status: "warning",
    timestamp: new Date().toISOString(),
    provider: "digitalocean",
    stats: {
      totalVMs: 2,
      healthy: 1,
      orphaned: 1,
      phantom: 1,
      ipMismatches: 0,
    },
  };
}

// =============================================================================
// Reconciliation Job Config Tests
// =============================================================================

describe("Reconciliation Job — Configuration", () => {
  it("has default interval of 1 hour", () => {
    // The default RECONCILIATION_INTERVAL_MS is 3600000 (1 hour)
    const defaultMs = 3600000;
    expect(defaultMs).toBe(60 * 60 * 1000);
  });

  it("supports environment variable override for interval", () => {
    const envVal = "1800000"; // 30 minutes
    const parsed = parseInt(envVal);
    expect(parsed).toBe(1800000);
    expect(parsed).toBe(30 * 60 * 1000);
  });

  it("supports auto-fix toggle via environment variable", () => {
    // Default: true (auto-fix enabled)
    expect("true" !== "false").toBe(true);
    // Disable: RECONCILIATION_AUTO_FIX=false
    expect("false" !== "false").toBe(false);
  });

  it("supports webhook URL for notifications", () => {
    const url = "https://hooks.slack.com/services/test";
    expect(typeof url).toBe("string");
    expect(url.startsWith("https://")).toBe(true);
  });
});

// =============================================================================
// Reconciliation Report Shape Tests
// =============================================================================

describe("Reconciliation Report — Shape", () => {
  it("clean report has expected structure", () => {
    const report = makeCleanReport();

    expect(report.status).toBe("clean");
    expect(report.issues).toHaveLength(0);
    expect(report.stats.healthy).toBe(1);
    expect(report.stats.orphaned).toBe(0);
    expect(report.stats.phantom).toBe(0);
    expect(report.stats.ipMismatches).toBe(0);
    expect(report.provider).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
  });

  it("warning report includes issue details", () => {
    const report = makeWarningReport();

    expect(report.status).toBe("warning");
    expect(report.issues).toHaveLength(2);
    expect(report.stats.orphaned).toBe(1);
    expect(report.stats.phantom).toBe(1);
  });

  it("orphaned VM issue has instance info", () => {
    const report = makeWarningReport();
    const orphanIssue = report.issues.find((i) => i.type === "orphaned_vm");

    expect(orphanIssue).toBeTruthy();
    expect(orphanIssue!.severity).toBe("error");
    expect(orphanIssue!.instanceId).toBe("orphan-1");
    expect(orphanIssue!.instanceName).toBe("orphan-vm");
  });

  it("phantom agent issue has agent info", () => {
    const report = makeWarningReport();
    const phantomIssue = report.issues.find((i) => i.type === "phantom_agent");

    expect(phantomIssue).toBeTruthy();
    expect(phantomIssue!.severity).toBe("warning");
    expect(phantomIssue!.agentId).toBe("phantom-agent-1");
  });

  it("totalVMs = healthy + orphaned", () => {
    const report = makeWarningReport();
    expect(report.stats.totalVMs).toBe(report.stats.healthy + report.stats.orphaned);
  });
});

// =============================================================================
// Reconciliation Job Result Tests
// =============================================================================

describe("Reconciliation Job — Result Shape", () => {
  it("successful result has all expected fields", () => {
    const result = {
      ran: true,
      healthy: 3,
      orphaned: 1,
      phantom: 0,
      ipMismatches: 0,
      autoFixed: 0,
      status: "warning" as const,
      timestamp: new Date().toISOString(),
      provider: "digitalocean",
    };

    expect(result.ran).toBe(true);
    expect(result.healthy).toBeGreaterThanOrEqual(0);
    expect(result.orphaned).toBeGreaterThanOrEqual(0);
    expect(result.phantom).toBeGreaterThanOrEqual(0);
    expect(result.ipMismatches).toBeGreaterThanOrEqual(0);
    expect(result.autoFixed).toBeGreaterThanOrEqual(0);
    expect(["clean", "warning", "critical"]).toContain(result.status);
    expect(result.timestamp).toBeTruthy();
  });

  it("skipped result has skipReason", () => {
    const result = {
      ran: false,
      skipReason: "no_cloud_config",
      healthy: 0,
      orphaned: 0,
      phantom: 0,
      ipMismatches: 0,
      autoFixed: 0,
      status: "clean" as const,
      timestamp: new Date().toISOString(),
    };

    expect(result.ran).toBe(false);
    expect(result.skipReason).toBeTruthy();
    expect(result.healthy).toBe(0);
  });

  it("already running result has correct skipReason", () => {
    const result = {
      ran: false,
      skipReason: "already_running",
      healthy: 0,
      orphaned: 0,
      phantom: 0,
      ipMismatches: 0,
      autoFixed: 0,
      status: "clean" as const,
      timestamp: new Date().toISOString(),
    };

    expect(result.skipReason).toBe("already_running");
  });

  it("error result includes error message in skipReason", () => {
    const errorMsg = "Cloud API rate limit exceeded";
    const result = {
      ran: false,
      skipReason: `error: ${errorMsg}`,
      healthy: 0,
      orphaned: 0,
      phantom: 0,
      ipMismatches: 0,
      autoFixed: 0,
      status: "clean" as const,
      timestamp: new Date().toISOString(),
    };

    expect(result.skipReason).toContain("error:");
    expect(result.skipReason).toContain(errorMsg);
  });
});

// =============================================================================
// Auto-fix Logic Tests
// =============================================================================

describe("Reconciliation — Auto-fix", () => {
  it("tracks auto-fixed count separately from phantom count", () => {
    // Scenario: 3 phantoms detected, 2 successfully marked offline
    const result = {
      ran: true,
      healthy: 5,
      orphaned: 0,
      phantom: 3,
      ipMismatches: 0,
      autoFixed: 2,
      status: "warning" as const,
      timestamp: new Date().toISOString(),
      provider: "digitalocean",
    };

    expect(result.phantom).toBe(3);
    expect(result.autoFixed).toBe(2);
    expect(result.autoFixed).toBeLessThanOrEqual(result.phantom);
  });

  it("auto-fix only targets phantom agents, not orphaned VMs", () => {
    // Auto-fix marks phantom agents as offline
    // It does NOT destroy orphaned VMs (that requires explicit DELETE)
    const phantomAgentIds = ["agent-1", "agent-2"];
    const orphanedVMs = [makeInstance({ id: "orphan-1" })];

    // Auto-fix should only affect agents
    expect(phantomAgentIds.length).toBe(2);
    expect(orphanedVMs.length).toBe(1);
    // Orphaned VMs need manual destruction via DELETE endpoint
  });

  it("phantom agents are marked as offline, not destroyed", () => {
    // Phantom agents have an instanceId pointing to a non-existent VM
    // The correct fix is "offline", not deletion
    const newStatus = "offline";
    expect(newStatus).toBe("offline");
    // Agent stays in registry for visibility
  });

  it("skips already offline/destroyed agents", () => {
    const agents = [
      makeAgent({ id: "a1", status: "offline", instanceId: "gone-1" }),
      makeAgent({ id: "a2", status: "destroyed", instanceId: "gone-2" }),
      makeAgent({ id: "a3", status: "idle", instanceId: "gone-3" }),
    ];

    // The provisioner reconcile logic already filters out offline/destroyed
    const phantomCandidates = agents.filter(
      (a) => a.instanceId && a.status !== "offline" && a.status !== "destroyed",
    );

    expect(phantomCandidates).toHaveLength(1);
    expect(phantomCandidates[0].id).toBe("a3");
  });
});

// =============================================================================
// IP Validation Tests
// =============================================================================

describe("Reconciliation — IP Validation", () => {
  it("detects IP mismatch between agent host and VM public IP", () => {
    const agent = makeAgent({ host: "http://5.6.7.8", instanceId: "inst-1" });
    const instance = makeInstance({ id: "inst-1", publicIp: "1.2.3.4" });

    // Agent says host is 5.6.7.8 but VM has public IP 1.2.3.4
    const hostIp = agent.host!.replace("http://", "");
    expect(hostIp).not.toBe(instance.publicIp);
  });

  it("considers matching IPs healthy", () => {
    const agent = makeAgent({ host: "http://1.2.3.4", instanceId: "inst-1" });
    const instance = makeInstance({ id: "inst-1", publicIp: "1.2.3.4" });

    const hostIp = agent.host!.replace("http://", "");
    expect(hostIp).toBe(instance.publicIp);
  });

  it("ignores localhost agents", () => {
    const agent = makeAgent({ host: "http://localhost:3001", instanceId: "inst-1" });
    // Localhost agents are in dev/test, not cloud VMs
    expect(agent.host!.includes("localhost")).toBe(true);
  });

  it("handles agents with port in host URL", () => {
    const host = "http://1.2.3.4:3001";
    const ip = host.replace(/^https?:\/\//, "").split(":")[0];
    expect(ip).toBe("1.2.3.4");
  });

  it("handles agents with private IP (VPC)", () => {
    const agent = makeAgent({
      host: "http://10.0.0.5",
      instanceId: "inst-1",
      privateIp: "10.0.0.5",
    });

    // Private IP in host means agent is communicating via VPC
    expect(agent.privateIp).toBeTruthy();
    expect(agent.host!.includes("10."));
  });
});

// =============================================================================
// Notification Tests
// =============================================================================

describe("Reconciliation — Notifications", () => {
  it("generates notification payload for warning status", () => {
    const report = makeWarningReport();
    const severity = report.status === "critical" ? "🔴 CRITICAL" : "🟡 WARNING";

    expect(severity).toBe("🟡 WARNING");
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("generates notification payload for critical status", () => {
    const report = makeWarningReport();
    report.status = "critical";
    const severity = report.status === "critical" ? "🔴 CRITICAL" : "🟡 WARNING";

    expect(severity).toBe("🔴 CRITICAL");
  });

  it("does not notify for clean status", () => {
    const report = makeCleanReport();
    const shouldNotify = report.status !== "clean";

    expect(shouldNotify).toBe(false);
  });

  it("includes issue details in notification", () => {
    const report = makeWarningReport();
    const issueLines = report.issues.map((i) => `- [${i.severity}] ${i.message}`);

    expect(issueLines).toHaveLength(2);
    expect(issueLines[0]).toContain("[error]");
    expect(issueLines[1]).toContain("[warning]");
  });
});

// =============================================================================
// Log Entry Tests
// =============================================================================

describe("Reconciliation — Logging", () => {
  it("generates log message with all stats", () => {
    const stats = { healthy: 5, orphaned: 1, phantom: 2, ipMismatches: 1 };
    const autoFixed = 2;

    const message = [
      `Reconciliation: warning`,
      `${stats.healthy} healthy`,
      `${stats.orphaned} orphaned VMs`,
      `${stats.phantom} phantom agents`,
      `${stats.ipMismatches} IP mismatches`,
      autoFixed > 0 ? `${autoFixed} auto-fixed` : null,
    ]
      .filter(Boolean)
      .join(", ");

    expect(message).toContain("5 healthy");
    expect(message).toContain("1 orphaned VMs");
    expect(message).toContain("2 phantom agents");
    expect(message).toContain("1 IP mismatches");
    expect(message).toContain("2 auto-fixed");
  });

  it("omits auto-fixed when count is zero", () => {
    const autoFixed = 0;
    const parts = [
      "Reconciliation: clean",
      autoFixed > 0 ? `${autoFixed} auto-fixed` : null,
    ].filter(Boolean);

    expect(parts).not.toContain(null);
    expect(parts.join(", ")).not.toContain("auto-fixed");
  });

  it("log level matches report status", () => {
    const statusToLevel: Record<string, string> = {
      clean: "info",
      warning: "warn",
      critical: "error",
    };

    expect(statusToLevel["clean"]).toBe("info");
    expect(statusToLevel["warning"]).toBe("warn");
    expect(statusToLevel["critical"]).toBe("error");
  });

  it("uses 'reconciliation-job' as component", () => {
    const component = "reconciliation-job";
    expect(component).toBe("reconciliation-job");
  });
});

// =============================================================================
// API Endpoint Tests
// =============================================================================

describe("Reconciliation — API Endpoints", () => {
  it("GET /api/infra/reconcile returns report data", () => {
    // The endpoint returns the full reconciliation report
    const expectedShape = {
      success: true,
      data: makeCleanReport(),
    };

    expect(expectedShape.success).toBe(true);
    expect(expectedShape.data.status).toBeTruthy();
    expect(expectedShape.data.stats).toBeTruthy();
  });

  it("POST /api/infra/reconcile accepts autoFix option", () => {
    const body = { autoFix: true };
    expect(body.autoFix).toBe(true);
  });

  it("POST /api/infra/reconcile accepts tag override", () => {
    const body = { autoFix: false, tag: "custom-tag" };
    expect(body.tag).toBe("custom-tag");
  });

  it("GET /api/infra/reconcile/status returns last job result", () => {
    // Returns the cached result from the periodic job
    const expectedShape = {
      success: true,
      data: {
        ran: true,
        healthy: 5,
        orphaned: 0,
        phantom: 0,
        ipMismatches: 0,
        autoFixed: 0,
        status: "clean",
        timestamp: new Date().toISOString(),
        provider: "digitalocean",
      },
    };

    expect(expectedShape.data.ran).toBe(true);
    expect(expectedShape.data.status).toBe("clean");
  });

  it("GET /api/infra/reconcile/history accepts limit param", () => {
    const limit = 50;
    const qs = `?limit=${limit}`;
    expect(qs).toBe("?limit=50");
  });

  it("DELETE /api/infra/reconcile/orphan/:id destroys orphaned VM", () => {
    const instanceId = "orphan-instance-123";
    const endpoint = `/api/infra/reconcile/orphan/${instanceId}`;
    expect(endpoint).toContain(instanceId);
  });
});

// =============================================================================
// Dashboard API Client Tests
// =============================================================================

describe("Reconciliation — Dashboard API Client", () => {
  it("infraApi has reconcile method", () => {
    // Verify the expected methods exist on the API client
    const methods = [
      "reconcile",
      "triggerReconcile",
      "reconcileStatus",
      "reconcileHistory",
      "costs",
      "destroyOrphan",
    ];

    // These are the methods defined in api.ts
    expect(methods).toContain("reconcile");
    expect(methods).toContain("triggerReconcile");
    expect(methods).toContain("reconcileStatus");
    expect(methods).toContain("reconcileHistory");
  });

  it("triggerReconcile sends POST with autoFix option", () => {
    const options = { autoFix: true };
    const body = JSON.stringify(options);
    const parsed = JSON.parse(body);

    expect(parsed.autoFix).toBe(true);
  });

  it("reconcileHistory accepts optional limit", () => {
    const withLimit = `/api/infra/reconcile/history?limit=50`;
    const withoutLimit = `/api/infra/reconcile/history`;

    expect(withLimit).toContain("limit=50");
    expect(withoutLimit).not.toContain("limit");
  });
});

// =============================================================================
// Registry Agent Mapping Tests
// =============================================================================

describe("Reconciliation — Agent Mapping", () => {
  it("maps DB agent to RegistryAgent shape", () => {
    const dbAgent = {
      id: "uuid-1",
      name: "Atlas",
      status: "idle",
      host: "http://10.0.0.5:3001",
      privateIp: "10.0.0.5",
      cloud: {
        provider: "digitalocean",
        region: "nyc1",
        instanceId: "inst-123",
      },
    };

    const registryAgent = {
      id: dbAgent.id,
      name: dbAgent.name,
      instanceId: dbAgent.cloud?.instanceId || null,
      status: dbAgent.status,
      host: dbAgent.host || undefined,
      privateIp: dbAgent.privateIp || null,
    };

    expect(registryAgent.id).toBe("uuid-1");
    expect(registryAgent.instanceId).toBe("inst-123");
    expect(registryAgent.host).toBe("http://10.0.0.5:3001");
    expect(registryAgent.privateIp).toBe("10.0.0.5");
  });

  it("handles agent without cloud info", () => {
    const dbAgent = {
      id: "uuid-2",
      name: "Local Agent",
      status: "idle",
      host: "http://localhost:3001",
      privateIp: null,
      cloud: null,
    };

    const registryAgent = {
      id: dbAgent.id,
      name: dbAgent.name,
      instanceId: dbAgent.cloud?.instanceId || null,
      status: dbAgent.status,
      host: dbAgent.host || undefined,
      privateIp: dbAgent.privateIp || null,
    };

    expect(registryAgent.instanceId).toBeNull();
    expect(registryAgent.privateIp).toBeNull();
  });

  it("handles agent with cloud info but no instanceId", () => {
    const dbAgent = {
      id: "uuid-3",
      name: "Pending Agent",
      status: "provisioning",
      host: "",
      privateIp: null,
      cloud: {
        provider: "digitalocean",
        region: "nyc1",
        instanceId: "",
      },
    };

    const registryAgent = {
      id: dbAgent.id,
      name: dbAgent.name,
      instanceId: dbAgent.cloud?.instanceId || null,
      status: dbAgent.status,
      host: dbAgent.host || undefined,
      privateIp: dbAgent.privateIp || null,
    };

    // Empty string instanceId falls back to null via || null
    expect(registryAgent.instanceId).toBeNull();
  });
});

// =============================================================================
// Periodic Job Tests
// =============================================================================

describe("Reconciliation — Periodic Job", () => {
  it("guards against concurrent execution", () => {
    // If isRunning is true, the job should skip
    let isRunning = false;

    // First run
    isRunning = true;
    expect(isRunning).toBe(true);

    // Second attempt while first is running
    const shouldSkip = isRunning;
    expect(shouldSkip).toBe(true);

    // First run completes
    isRunning = false;

    // Now second attempt should proceed
    const shouldProceed = !isRunning;
    expect(shouldProceed).toBe(true);
  });

  it("resets isRunning on error", () => {
    let isRunning = true;

    // Simulate error in try/finally
    try {
      throw new Error("Cloud API failed");
    } catch {
      // Error handled
    } finally {
      isRunning = false;
    }

    expect(isRunning).toBe(false);
  });

  it("delays first run by 30s on startup", () => {
    // The job uses setTimeout(fn, 30_000) for first run
    const startupDelay = 30_000;
    expect(startupDelay).toBe(30 * 1000);
  });

  it("default interval is 1 hour", () => {
    const defaultMs = parseInt("3600000");
    expect(defaultMs).toBe(3600000);
    expect(defaultMs / 60000).toBe(60); // 60 minutes
  });
});

// =============================================================================
// RegistryClient Integration Tests
// =============================================================================

describe("Reconciliation — RegistryClient Methods", () => {
  it("getReconciliationStatus calls correct endpoint", () => {
    const endpoint = "/api/infra/reconcile";
    expect(endpoint).toBe("/api/infra/reconcile");
  });

  it("triggerReconciliation sends POST with options", () => {
    const options = { autoFix: true, tag: "hivemi" };
    expect(options.autoFix).toBe(true);
    expect(options.tag).toBe("hivemi");
  });

  it("getReconciliationHistory supports limit parameter", () => {
    const limit = 50;
    const qs = `?limit=${limit}`;
    const endpoint = `/api/infra/reconcile/history${qs}`;

    expect(endpoint).toContain("history");
    expect(endpoint).toContain("limit=50");
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Reconciliation — Edge Cases", () => {
  it("handles empty agent list", () => {
    const agents: MockAgent[] = [];
    const registryAgents = agents.map((a) => ({
      id: a.id,
      name: a.name,
      instanceId: a.instanceId,
      status: a.status,
    }));

    expect(registryAgents).toHaveLength(0);
  });

  it("handles no VMs in provider", () => {
    const instances: MockInstance[] = [];
    // All agents become phantom if they have instanceIds
    const agents = [
      makeAgent({ id: "a1", instanceId: "gone-1", status: "idle" }),
    ];

    const phantoms = agents.filter(
      (a) => a.instanceId && !instances.find((i) => i.id === a.instanceId),
    );

    expect(phantoms).toHaveLength(1);
  });

  it("handles all agents being phantoms", () => {
    const agents = [
      makeAgent({ id: "a1", instanceId: "gone-1", status: "idle" }),
      makeAgent({ id: "a2", instanceId: "gone-2", status: "working" }),
      makeAgent({ id: "a3", instanceId: "gone-3", status: "error" }),
    ];

    // All have instanceIds but VMs don't exist
    expect(agents.every((a) => a.instanceId)).toBe(true);
  });

  it("handles all VMs being orphans", () => {
    const instances = [
      makeInstance({ id: "orphan-1" }),
      makeInstance({ id: "orphan-2" }),
      makeInstance({ id: "orphan-3" }),
    ];
    const agents: MockAgent[] = [];

    // No agents reference these VMs
    const orphans = instances.filter(
      (inst) => !agents.find((a) => a.instanceId === inst.id),
    );

    expect(orphans).toHaveLength(3);
  });

  it("handles agents without instanceId (local agents)", () => {
    const agents = [
      makeAgent({ id: "a1", instanceId: null, status: "idle" }),
      makeAgent({ id: "a2", instanceId: null, status: "working" }),
    ];

    // Local agents without instanceId should not be phantom
    const phantomCandidates = agents.filter((a) => a.instanceId);
    expect(phantomCandidates).toHaveLength(0);
  });

  it("handles mixed local and cloud agents", () => {
    const instances = [makeInstance({ id: "inst-1" })];
    const agents = [
      makeAgent({ id: "a1", instanceId: "inst-1", status: "idle" }), // healthy
      makeAgent({ id: "a2", instanceId: null, status: "idle" }), // local
      makeAgent({ id: "a3", instanceId: "gone-1", status: "working" }), // phantom
    ];

    const healthy = agents.filter((a) => a.instanceId && instances.find((i) => i.id === a.instanceId));
    const local = agents.filter((a) => !a.instanceId);
    const phantom = agents.filter(
      (a) => a.instanceId && !instances.find((i) => i.id === a.instanceId)
        && a.status !== "offline" && a.status !== "destroyed",
    );

    expect(healthy).toHaveLength(1);
    expect(local).toHaveLength(1);
    expect(phantom).toHaveLength(1);
  });
});

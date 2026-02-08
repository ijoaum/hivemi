// =============================================================================
// Telemetry Route Tests
// Tests for POST/GET /api/agents/:id/telemetry and cleanup endpoint
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

const mockAgent = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  name: "test-agent",
  status: "idle",
};

const mockTelemetryRecord = {
  id: "11111111-2222-3333-4444-555555555555",
  agentId: mockAgent.id,
  timestamp: new Date(),
  infra: {
    cpu: 45,
    memUsed: 524288000,
    memTotal: 1073741824,
    diskUsed: 5368709120,
    diskTotal: 26843545600,
    loadAvg: 0.75,
  },
  llm: {
    requests: 12,
    promptTokens: 15000,
    completionTokens: 3200,
    errors: 0,
    avgLatencyMs: 1200,
  },
  tasks: {
    completed: 2,
    failed: 0,
    active: 1,
  },
  daemon: {
    uptime: 86400,
    version: "0.1.0",
    openclawStatus: "running",
  },
};

// Track DB operations for assertions
let dbOps: { method: string; table: string; data?: any }[] = [];

// Configurable mock responses
let agentExists = true;
let insertResult = [mockTelemetryRecord];
let selectResults: any[] = [mockTelemetryRecord];
let cleanupDeletedIds: string[] = [];
let hourlyDuplicateIds: string[] = [];
let dailyDuplicateIds: string[] = [];
let throwOnInsert = false;

// Chain builder for mocking Drizzle's fluent API
function createChain(result: any) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    set: () => chain,
    values: () => chain,
    returning: () => Promise.resolve(result),
    then: (resolve: any) => resolve(result),
  };
  return chain;
}

vi.mock("../db/index.js", () => {
  const agents = {
    id: "agents.id",
    lastHeartbeat: "agents.lastHeartbeat",
    updatedAt: "agents.updatedAt",
  };

  const agentTelemetry = {
    id: "agentTelemetry.id",
    agentId: "agentTelemetry.agentId",
    timestamp: "agentTelemetry.timestamp",
  };

  return {
    agents,
    agentTelemetry,
    db: {
      select: (fields?: any) => {
        const table = { _table: "" };
        return {
          from: (t: any) => {
            const isAgentQuery = t === agents;
            const result = isAgentQuery
              ? (agentExists ? [{ id: mockAgent.id }] : [])
              : selectResults;

            dbOps.push({ method: "select", table: isAgentQuery ? "agents" : "agentTelemetry" });

            return {
              where: () => ({
                orderBy: () => ({
                  limit: () => Promise.resolve(result),
                  then: (resolve: any) => resolve(result),
                }),
                then: (resolve: any) => resolve(result),
              }),
              orderBy: () => ({
                limit: () => Promise.resolve(result),
                then: (resolve: any) => resolve(result),
              }),
              then: (resolve: any) => resolve(result),
            };
          },
        };
      },
      insert: (t: any) => {
        dbOps.push({ method: "insert", table: "agentTelemetry" });
        if (throwOnInsert) {
          return {
            values: () => ({
              returning: () => Promise.reject(new Error("DB error")),
            }),
          };
        }
        return {
          values: (data: any) => ({
            returning: () => {
              dbOps.push({ method: "insert-values", table: "agentTelemetry", data });
              return Promise.resolve(insertResult);
            },
          }),
        };
      },
      update: (t: any) => {
        const isAgentUpdate = t === agents;
        dbOps.push({ method: "update", table: isAgentUpdate ? "agents" : "agentTelemetry" });
        return {
          set: (data: any) => ({
            where: () => ({
              returning: () => Promise.resolve([{ id: mockAgent.id, ...data }]),
              then: (resolve: any) => resolve([{ id: mockAgent.id, ...data }]),
            }),
          }),
        };
      },
      delete: (t: any) => {
        dbOps.push({ method: "delete", table: "agentTelemetry" });
        return {
          where: () => ({
            returning: () => Promise.resolve(cleanupDeletedIds.map((id) => ({ id }))),
          }),
        };
      },
      execute: (query: any) => {
        dbOps.push({ method: "execute", table: "raw" });
        // Determine which query this is based on call order
        // First execute = daily duplicates, second = hourly duplicates
        const executeCalls = dbOps.filter((op) => op.method === "execute");
        if (executeCalls.length === 1) {
          return Promise.resolve(dailyDuplicateIds.map((id) => ({ id_to_delete: id })));
        }
        return Promise.resolve(hourlyDuplicateIds.map((id) => ({ id_to_delete: id })));
      },
    },
  };
});

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Import after mocks
import app from "../routes/telemetry.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePayload(overrides: Record<string, any> = {}) {
  return {
    ts: new Date().toISOString(),
    infra: {
      cpu: 45,
      memUsed: 524288000,
      memTotal: 1073741824,
      diskUsed: 5368709120,
      diskTotal: 26843545600,
      loadAvg: 0.75,
    },
    llm: {
      requests: 12,
      promptTokens: 15000,
      completionTokens: 3200,
      errors: 0,
      avgLatencyMs: 1200,
    },
    tasks: {
      completed: 2,
      failed: 0,
      active: 1,
    },
    daemon: {
      uptime: 86400,
      version: "0.1.0",
      openclawStatus: "running",
    },
    ...overrides,
  };
}

async function post(path: string, body: any) {
  const req = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return app.fetch(req);
}

async function get(path: string) {
  const req = new Request(`http://localhost${path}`, { method: "GET" });
  return app.fetch(req);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  dbOps = [];
  agentExists = true;
  insertResult = [mockTelemetryRecord];
  selectResults = [mockTelemetryRecord];
  cleanupDeletedIds = [];
  hourlyDuplicateIds = [];
  dailyDuplicateIds = [];
  throwOnInsert = false;
});

// =============================================================================
// POST /api/agents/:id/telemetry
// =============================================================================

describe("POST /:id/telemetry", () => {
  it("accepts full payload with ts field", async () => {
    const payload = makePayload();
    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
  });

  it("accepts payload without ts (server uses now)", async () => {
    const payload = makePayload();
    delete payload.ts;

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
  });

  it("accepts partial payload (only infra)", async () => {
    const payload = {
      ts: new Date().toISOString(),
      infra: {
        cpu: 30,
        memUsed: 100000,
        memTotal: 200000,
        diskUsed: 0,
        diskTotal: 0,
        loadAvg: 0.5,
      },
    };

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(201);
  });

  it("accepts empty payload (all groups optional)", async () => {
    const payload = {};
    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(201);
  });

  it("accepts loadAvg as array (backward compat)", async () => {
    const payload = makePayload({
      infra: {
        cpu: 20,
        memUsed: 100000,
        memTotal: 200000,
        diskUsed: 0,
        diskTotal: 0,
        loadAvg: [0.5, 0.6, 0.7],
      },
    });

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(201);
  });

  it("returns 404 when agent not found", async () => {
    agentExists = false;

    const res = await post(`/${mockAgent.id}/telemetry`, makePayload());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Agent not found");
  });

  it("returns 400 on invalid payload", async () => {
    const payload = {
      infra: {
        cpu: "not-a-number", // Invalid
        memUsed: 100000,
        memTotal: 200000,
        diskUsed: 0,
        diskTotal: 0,
        loadAvg: 0.5,
      },
    };

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details).toBeDefined();
  });

  it("returns 400 on invalid ts format", async () => {
    const payload = makePayload({ ts: "not-a-date" });

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(400);
  });

  it("updates agent lastHeartbeat on telemetry submission", async () => {
    await post(`/${mockAgent.id}/telemetry`, makePayload());

    // Verify agent update was called
    const agentUpdate = dbOps.find(
      (op) => op.method === "update" && op.table === "agents",
    );
    expect(agentUpdate).toBeDefined();
  });

  it("accepts loadAvg as single number (protocol spec)", async () => {
    const payload = makePayload();
    payload.infra.loadAvg = 0.75;

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(201);
  });
});

// =============================================================================
// GET /api/agents/:id/telemetry
// =============================================================================

describe("GET /:id/telemetry", () => {
  it("returns latest telemetry for an agent", async () => {
    const res = await get(`/${mockAgent.id}/telemetry`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
  });

  it("returns null when no telemetry exists", async () => {
    selectResults = [];

    const res = await get(`/${mockAgent.id}/telemetry`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull(); // result[0] of empty array is undefined → route returns null
  });

  it("returns 404 when agent not found", async () => {
    agentExists = false;

    const res = await get(`/${mockAgent.id}/telemetry`);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Agent not found");
  });

  it("supports limit query param", async () => {
    selectResults = [mockTelemetryRecord, { ...mockTelemetryRecord, id: "other-id" }];

    const res = await get(`/${mockAgent.id}/telemetry?limit=5`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // When limit > 1, returns array
    expect(json.data).toBeDefined();
  });
});

// =============================================================================
// GET /api/agents/:id/telemetry/history
// =============================================================================

describe("GET /:id/telemetry/history", () => {
  it("returns telemetry history with default range (24h)", async () => {
    const res = await get(`/${mockAgent.id}/telemetry/history`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.meta).toBeDefined();
    expect(json.meta.count).toBeDefined();
    expect(json.meta.limit).toBe(100);
  });

  it("supports from/to query params", async () => {
    const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    const res = await get(
      `/${mockAgent.id}/telemetry/history?from=${from}&to=${to}`,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.from).toBeDefined();
    expect(json.meta.to).toBeDefined();
  });

  it("supports limit query param", async () => {
    const res = await get(`/${mockAgent.id}/telemetry/history?limit=50`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.limit).toBe(50);
  });

  it("caps limit at 1000", async () => {
    const res = await get(`/${mockAgent.id}/telemetry/history?limit=5000`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.limit).toBe(1000);
  });

  it("returns 404 when agent not found", async () => {
    agentExists = false;

    const res = await get(`/${mockAgent.id}/telemetry/history`);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Agent not found");
  });

  it("returns 400 on invalid date format", async () => {
    const res = await get(
      `/${mockAgent.id}/telemetry/history?from=not-a-date`,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid date format");
  });
});

// =============================================================================
// POST /api/telemetry/cleanup
// =============================================================================

describe("POST /cleanup", () => {
  it("runs cleanup and reports results", async () => {
    cleanupDeletedIds = ["old-1", "old-2"];

    const res = await post("/cleanup", {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data.deletedExpired).toBeDefined();
    expect(json.data.deletedHourlyAggregated).toBeDefined();
    expect(json.data.deletedDailyAggregated).toBeDefined();
    expect(json.data.totalDeleted).toBeDefined();
  });

  it("handles no records to clean up", async () => {
    cleanupDeletedIds = [];
    hourlyDuplicateIds = [];
    dailyDuplicateIds = [];

    const res = await post("/cleanup", {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.totalDeleted).toBe(0);
  });

  it("performs three-tier retention (daily + hourly + expired)", async () => {
    cleanupDeletedIds = ["expired-1"];
    dailyDuplicateIds = ["daily-dup-1"];
    hourlyDuplicateIds = ["hourly-dup-1"];

    const res = await post("/cleanup", {});
    const json = await res.json();

    expect(res.status).toBe(200);
    // Verify all three stages were executed
    const executeOps = dbOps.filter((op) => op.method === "execute");
    expect(executeOps.length).toBe(2); // daily + hourly aggregation queries
    const deleteOps = dbOps.filter((op) => op.method === "delete");
    expect(deleteOps.length).toBeGreaterThanOrEqual(1); // expired deletion + batch deletes
  });
});

// =============================================================================
// Protocol compliance (Issue #54)
// =============================================================================

describe("Protocol compliance", () => {
  it("accepts the exact payload format from Issue #54 spec", async () => {
    // This is the exact payload from the issue description
    const payload = {
      ts: "2026-02-10T12:00:00.000Z",
      infra: {
        cpu: 45,
        memUsed: 524288000,
        memTotal: 1073741824,
        diskUsed: 5368709120,
        diskTotal: 26843545600,
        loadAvg: 0.75,
      },
      llm: {
        requests: 12,
        promptTokens: 15000,
        completionTokens: 3200,
        errors: 0,
        avgLatencyMs: 1200,
      },
      tasks: {
        completed: 2,
        failed: 0,
        active: 1,
      },
      daemon: {
        uptime: 86400,
        version: "0.1.0",
        openclawStatus: "running",
      },
    };

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(201);
  });

  it("validates cpu percentage range", async () => {
    const payload = makePayload({
      infra: {
        cpu: 150, // Invalid: >100
        memUsed: 100000,
        memTotal: 200000,
        diskUsed: 0,
        diskTotal: 0,
        loadAvg: 0.5,
      },
    });

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(400);
  });

  it("validates non-negative memory values", async () => {
    const payload = makePayload({
      infra: {
        cpu: 10,
        memUsed: -100, // Invalid: negative
        memTotal: 200000,
        diskUsed: 0,
        diskTotal: 0,
        loadAvg: 0.5,
      },
    });

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(400);
  });

  it("validates non-negative LLM counters", async () => {
    const payload = makePayload({
      llm: {
        requests: -1, // Invalid
        promptTokens: 0,
        completionTokens: 0,
        errors: 0,
        avgLatencyMs: 0,
      },
    });

    const res = await post(`/${mockAgent.id}/telemetry`, payload);
    expect(res.status).toBe(400);
  });
});

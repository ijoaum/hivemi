// =============================================================================
// Log Batch Route Tests — Issue #57
// Tests for POST /api/logs (batch) and GET /api/logs (with filters)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// State — must be declared before vi.mock (hoisted)
// ---------------------------------------------------------------------------

// We use a module-level state object that the mock factory can reference
const state = {
  agentExists: true,
  insertedRows: [] as any[],
  selectLogResults: [] as any[],
  throwOnInsert: false,
  dbOps: [] as { method: string; table: string }[],
};

const mockAgent = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  name: "test-agent",
};

// ---------------------------------------------------------------------------
// Mock modules BEFORE importing the route
// ---------------------------------------------------------------------------

vi.mock("../db/index.js", () => {
  // Chainable query mock for GET
  function createChainableMock() {
    const chain: any = {};
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.$dynamic = vi.fn().mockReturnValue(chain);
    chain.then = (resolve: any) => resolve(state.selectLogResults);
    chain.catch = (reject: any) => Promise.resolve(state.selectLogResults).catch(reject);
    return chain;
  }

  const db = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: any) => {
        if (table === "agents") {
          state.dbOps.push({ method: "select", table: "agents" });
          return {
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(() =>
                state.agentExists ? [mockAgent] : [],
              ),
            }),
          };
        }
        state.dbOps.push({ method: "select", table: "logs" });
        return createChainableMock();
      }),
    })),
    insert: vi.fn().mockImplementation(() => {
      state.dbOps.push({ method: "insert", table: "logs" });
      return {
        values: vi.fn().mockImplementation((data: any) => {
          if (state.throwOnInsert) throw new Error("DB insert failed");
          state.insertedRows = Array.isArray(data) ? data : [data];
          return {
            returning: vi.fn().mockImplementation(() =>
              state.insertedRows.map((_: any, i: number) => ({ id: `log-${i}` })),
            ),
          };
        }),
      };
    }),
  };

  return { db, agents: "agents", logs: "logs" };
});

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: any, val: any) => ({ col, val, op: "eq" })),
  desc: vi.fn((col: any) => ({ col, dir: "desc" })),
  and: vi.fn((...conditions: any[]) => ({ conditions, op: "and" })),
  gte: vi.fn((col: any, val: any) => ({ col, val, op: "gte" })),
  lte: vi.fn((col: any, val: any) => ({ col, val, op: "lte" })),
  inArray: vi.fn((col: any, vals: any[]) => ({ col, vals, op: "inArray" })),
  sql: vi.fn(),
}));

// Now import the route
import logRoutes from "../routes/logs.js";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = new Hono();
  app.route("/api/logs", logRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/logs — Batch Log Submission", () => {
  beforeEach(() => {
    state.dbOps = [];
    state.insertedRows = [];
    state.selectLogResults = [];
    state.agentExists = true;
    state.throwOnInsert = false;
    vi.clearAllMocks();
  });

  it("accepts valid batch and returns 201", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          {
            level: "warn",
            message: "Task timeout",
            timestamp: "2026-02-11T12:00:00.000Z",
            metadata: { taskId: "11111111-2222-3333-4444-555555555555", component: "poller" },
          },
          {
            level: "error",
            message: "Connection lost",
            timestamp: "2026-02-11T12:01:00.000Z",
          },
          {
            level: "lifecycle",
            message: "Daemon started",
            timestamp: "2026-02-11T12:02:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.received).toBe(3);
  });

  it("inserts correct row data", async () => {
    const app = createTestApp();
    await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          {
            level: "warn",
            message: "Something bad",
            timestamp: "2026-02-11T12:00:00.000Z",
            metadata: { taskId: "11111111-2222-3333-4444-555555555555", component: "executor" },
          },
        ],
      }),
    });

    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0].level).toBe("warn");
    expect(state.insertedRows[0].message).toBe("Something bad");
    expect(state.insertedRows[0].source).toBe("test-agent");
    expect(state.insertedRows[0].agentId).toBe(mockAgent.id);
    expect(state.insertedRows[0].component).toBe("executor");
  });

  it("returns 404 for unknown agent", async () => {
    state.agentExists = false;
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          { level: "warn", message: "test", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Agent not found");
  });

  it("returns 400 for missing agentId", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: [
          { level: "warn", message: "test", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns 400 for empty entries array", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for debug level (not shippable)", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          { level: "debug", message: "test", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for info level (not shippable)", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          { level: "info", message: "test", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid timestamp", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          { level: "warn", message: "test", timestamp: "not-a-date" },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for empty message", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          { level: "warn", message: "", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 500 on DB insert failure", async () => {
    state.throwOnInsert = true;
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          { level: "warn", message: "test", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      }),
    });

    expect(res.status).toBe(500);
  });

  it("handles metadata without taskId or component", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          {
            level: "lifecycle",
            message: "Daemon starting",
            timestamp: "2026-02-11T12:00:00.000Z",
            metadata: {},
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect(state.insertedRows[0].taskId).toBeNull();
    expect(state.insertedRows[0].component).toBeNull();
  });

  it("handles entries without metadata", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: mockAgent.id,
        entries: [
          {
            level: "error",
            message: "Something broke",
            timestamp: "2026-02-11T12:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect(state.insertedRows[0].metadata).toBeNull();
  });

  it("returns validation details on 400", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "not-uuid",
        entries: [{ level: "warn", message: "test", timestamp: "2026-02-11T12:00:00.000Z" }],
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details).toBeDefined();
    expect(json.details.length).toBeGreaterThan(0);
  });
});

describe("GET /api/logs — Query with Filters", () => {
  beforeEach(() => {
    state.dbOps = [];
    state.selectLogResults = [
      {
        id: "log-1",
        timestamp: new Date("2026-02-11T12:00:00Z"),
        level: "warn",
        source: "test-agent",
        agentId: mockAgent.id,
        taskId: null,
        message: "Warning message",
        metadata: null,
        component: null,
      },
    ];
    vi.clearAllMocks();
  });

  it("returns logs with default limit", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
  });

  it("respects custom limit", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs?limit=50");

    expect(res.status).toBe(200);
  });

  it("caps limit at 1000", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs?limit=9999");

    expect(res.status).toBe(200);
  });

  it("supports agentId filter", async () => {
    const app = createTestApp();
    const res = await app.request(`/api/logs?agentId=${mockAgent.id}`);

    expect(res.status).toBe(200);
  });

  it("supports level filter", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs?level=warn");

    expect(res.status).toBe(200);
  });

  it("supports comma-separated level filter", async () => {
    const app = createTestApp();
    const res = await app.request("/api/logs?level=warn,error");

    expect(res.status).toBe(200);
  });

  it("supports from/to date range", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/api/logs?from=2026-02-11T00:00:00Z&to=2026-02-11T23:59:59Z",
    );

    expect(res.status).toBe(200);
  });
});

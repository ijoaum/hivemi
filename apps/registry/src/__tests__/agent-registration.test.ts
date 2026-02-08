// =============================================================================
// Agent Registration Tests
// Tests the POST /api/agents upsert endpoint (issue #52)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegisterAgentSchema } from "@hivemi/protocol";

// ---- Mock DB & logger (factory must be self-contained) ----
vi.mock("../db/index.js", () => {
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit, returning: vi.fn().mockResolvedValue([]) });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });

  return {
    db: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      insert: vi.fn().mockReturnValue({ values: mockValues }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      _mocks: { mockFrom, mockWhere, mockLimit, mockReturning, mockValues, mockSet },
    },
    agents: { id: "agents.id" },
    roles: { id: "roles.id" },
    teams: { id: "teams.id" },
  };
});

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import AFTER mocking
import app from "../routes/agents.js";
import { db } from "../db/index.js";

// Access mock internals
const mocks = (db as any)._mocks;

// ---- Test Data ----
const validPayload = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "test-agent-alpha",
  roleId: "660e8400-e29b-41d4-a716-446655440001",
  teamId: "770e8400-e29b-41d4-a716-446655440002",
  model: "claude-sonnet-4-5",
  host: "10.0.0.5",
  port: 3100,
  version: "1.0.0",
  openclawVersion: "0.28.0",
  cloud: {
    provider: "digitalocean",
    region: "nyc1",
    instanceId: "12345678",
  },
  capabilities: ["file-read", "file-write", "shell-exec"],
};

const mockAgent = {
  ...validPayload,
  status: "idle",
  lastHeartbeat: new Date(),
  currentTaskId: null,
  privateIp: null,
  deployId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---- Helper ----
function post(body: unknown) {
  return app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- Tests ----
describe("POST /api/agents — Agent Registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain: role found, team found, agent NOT found → create
    let selectCall = 0;
    const mockReturning = vi.fn().mockResolvedValue([mockAgent]);
    
    mocks.mockLimit.mockImplementation(async () => {
      selectCall++;
      if (selectCall === 1) return [{ id: validPayload.roleId }]; // role exists
      if (selectCall === 2) return [{ id: validPayload.teamId }]; // team exists
      if (selectCall === 3) return []; // no existing agent → create
      return [];
    });

    mocks.mockWhere.mockReturnValue({ limit: mocks.mockLimit, returning: mockReturning });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockReturning.mockResolvedValue([mockAgent]);
    mocks.mockValues.mockReturnValue({ returning: mocks.mockReturning });
    
    // Update chain: set → where → returning
    const updateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    mocks.mockSet.mockReturnValue({ where: updateWhere });

    // Re-wire db mocks
    (db.select as any).mockReturnValue({ from: mocks.mockFrom });
    (db.insert as any).mockReturnValue({ values: mocks.mockValues });
    (db.update as any).mockReturnValue({ set: mocks.mockSet });
  });

  // ---- Validation ----

  it("returns 400 for missing required fields", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Validation failed");
    expect(json.details).toBeDefined();
  });

  it("returns 400 for invalid UUID in id", async () => {
    const res = await post({ ...validPayload, id: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid port (> 65535)", async () => {
    const res = await post({ ...validPayload, port: 70000 });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty name", async () => {
    const res = await post({ ...validPayload, name: "" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing model", async () => {
    const { model, ...rest } = validPayload;
    const res = await post(rest);
    expect(res.status).toBe(400);
  });

  // ---- Role/Team Validation ----

  it("returns 400 when roleId does not exist", async () => {
    let selectCall = 0;
    mocks.mockLimit.mockImplementation(async () => {
      selectCall++;
      if (selectCall === 1) return []; // role NOT found
      return [];
    });

    const res = await post(validPayload);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Role not found");
  });

  it("returns 400 when teamId does not exist", async () => {
    let selectCall = 0;
    mocks.mockLimit.mockImplementation(async () => {
      selectCall++;
      if (selectCall === 1) return [{ id: validPayload.roleId }]; // role found
      if (selectCall === 2) return []; // team NOT found
      return [];
    });

    const res = await post(validPayload);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Team not found");
  });

  // ---- Create (201) ----

  it("creates new agent and returns 201", async () => {
    const res = await post(validPayload);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(db.insert).toHaveBeenCalled();
  });

  it("creates agent with minimal payload (no optional fields)", async () => {
    const minimal = {
      id: validPayload.id,
      name: validPayload.name,
      roleId: validPayload.roleId,
      teamId: validPayload.teamId,
      model: validPayload.model,
      host: validPayload.host,
      port: validPayload.port,
    };

    const res = await post(minimal);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  // ---- Update (200) ----

  it("updates existing agent and returns 200 on redeploy", async () => {
    let selectCall = 0;
    mocks.mockLimit.mockImplementation(async () => {
      selectCall++;
      if (selectCall === 1) return [{ id: validPayload.roleId }]; // role exists
      if (selectCall === 2) return [{ id: validPayload.teamId }]; // team exists
      if (selectCall === 3) return [{ id: validPayload.id }]; // agent ALREADY EXISTS
      return [];
    });

    const res = await post(validPayload);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  // ---- Schema Unit Tests ----

  describe("RegisterAgentSchema", () => {
    it("accepts valid full payload", () => {
      const result = RegisterAgentSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("defaults capabilities to empty array", () => {
      const { capabilities, ...withoutCaps } = validPayload;
      const result = RegisterAgentSchema.safeParse(withoutCaps);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.capabilities).toEqual([]);
      }
    });

    it("rejects missing id", () => {
      const { id, ...rest } = validPayload;
      const result = RegisterAgentSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects invalid cloud object (missing fields)", () => {
      const result = RegisterAgentSchema.safeParse({
        ...validPayload,
        cloud: { provider: "do" }, // missing region + instanceId
      });
      expect(result.success).toBe(false);
    });

    it("accepts payload without optional fields", () => {
      const result = RegisterAgentSchema.safeParse({
        id: validPayload.id,
        name: validPayload.name,
        roleId: validPayload.roleId,
        teamId: validPayload.teamId,
        model: validPayload.model,
        host: validPayload.host,
        port: validPayload.port,
      });
      expect(result.success).toBe(true);
    });

    it("rejects name over 100 chars", () => {
      const result = RegisterAgentSchema.safeParse({
        ...validPayload,
        name: "a".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("rejects version over 20 chars", () => {
      const result = RegisterAgentSchema.safeParse({
        ...validPayload,
        version: "x".repeat(21),
      });
      expect(result.success).toBe(false);
    });
  });
});

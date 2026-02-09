// =============================================================================
// Heartbeat & Offline Detection Tests
// Tests for issue #53: Heartbeat protocol and offline detection
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeartbeatPayloadSchema } from "@hivemi/protocol";

// ---- Mock DB & logger ----
const mockReturning = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();

vi.mock("../db/index.js", () => {
  return {
    db: {
      update: vi.fn().mockReturnValue({
        set: (...args: any[]) => {
          mockSet(...args);
          return {
            where: (...wArgs: any[]) => {
              mockWhere(...wArgs);
              return {
                returning: (...rArgs: any[]) => {
                  mockReturning(...rArgs);
                  return mockReturning();
                },
              };
            },
          };
        },
      }),
    },
    agents: { id: "agents.id", lastHeartbeat: "agents.last_heartbeat", status: "agents.status", currentTaskId: "agents.current_task_id", updatedAt: "agents.updated_at" },
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
import app from "../routes/heartbeat.js";

// ---- Test Data ----
const agentId = "550e8400-e29b-41d4-a716-446655440000";

const validPayload = {
  status: "idle" as const,
  currentTaskId: null,
  timestamp: new Date().toISOString(),
};

// ---- Helper ----
function post(id: string, body: unknown) {
  return app.request(`/${id}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// =============================================================================
// HeartbeatPayloadSchema
// =============================================================================

describe("HeartbeatPayloadSchema", () => {
  it("accepts valid idle payload", () => {
    const result = HeartbeatPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts working status with currentTaskId", () => {
    const result = HeartbeatPayloadSchema.safeParse({
      status: "working",
      currentTaskId: "660e8400-e29b-41d4-a716-446655440001",
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts error status", () => {
    const result = HeartbeatPayloadSchema.safeParse({
      status: "error",
      currentTaskId: null,
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = HeartbeatPayloadSchema.safeParse({
      status: "offline",
      currentTaskId: null,
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing status", () => {
    const result = HeartbeatPayloadSchema.safeParse({
      currentTaskId: null,
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const result = HeartbeatPayloadSchema.safeParse({
      status: "idle",
      currentTaskId: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid timestamp format", () => {
    const result = HeartbeatPayloadSchema.safeParse({
      status: "idle",
      currentTaskId: null,
      timestamp: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID for currentTaskId", () => {
    const result = HeartbeatPayloadSchema.safeParse({
      status: "working",
      currentTaskId: "not-a-uuid",
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// POST /api/agents/:id/heartbeat
// =============================================================================

describe("POST /api/agents/:id/heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: agent found, update succeeds
    mockReturning.mockResolvedValue([{ id: agentId }]);
  });

  it("returns 200 with ack:true for valid payload", async () => {
    const res = await post(agentId, validPayload);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ack).toBe(true);
  });

  it("updates agent status, currentTaskId, and lastHeartbeat", async () => {
    await post(agentId, {
      status: "working",
      currentTaskId: "660e8400-e29b-41d4-a716-446655440001",
      timestamp: new Date().toISOString(),
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "working",
        currentTaskId: "660e8400-e29b-41d4-a716-446655440001",
      }),
    );
  });

  it("returns 400 for invalid payload", async () => {
    const res = await post(agentId, { status: "invalid" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Validation failed");
  });

  it("returns 400 for empty body", async () => {
    const res = await post(agentId, {});
    expect(res.status).toBe(400);
  });

  it("returns 404 when agent does not exist", async () => {
    mockReturning.mockResolvedValue([]);

    const res = await post(agentId, validPayload);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Agent not found");
  });

  it("returns 200 for idle status with null currentTaskId", async () => {
    const res = await post(agentId, {
      status: "idle",
      currentTaskId: null,
      timestamp: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ack).toBe(true);
  });

  it("returns 200 for error status", async () => {
    const res = await post(agentId, {
      status: "error",
      currentTaskId: null,
      timestamp: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ack).toBe(true);
  });
});

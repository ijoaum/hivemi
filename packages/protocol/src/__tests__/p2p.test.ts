// =============================================================================
// P2P Protocol Tests (Issue #56)
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  P2PMessageTypeSchema,
  P2PMessageSchema,
  P2PRequestPayloadSchema,
  P2PResponsePayloadSchema,
  P2PDelegatePayloadSchema,
  P2PPingPayloadSchema,
  P2PPongPayloadSchema,
  P2PMessageAckSchema,
  AgentEndpointSchema,
  P2PRetryConfigSchema,
  MessageTypeSchema,
} from "../types.js";

// =============================================================================
// P2PMessageTypeSchema
// =============================================================================

describe("P2PMessageTypeSchema", () => {
  it("accepts valid message types", () => {
    expect(P2PMessageTypeSchema.parse("request")).toBe("request");
    expect(P2PMessageTypeSchema.parse("response")).toBe("response");
    expect(P2PMessageTypeSchema.parse("delegate")).toBe("delegate");
    expect(P2PMessageTypeSchema.parse("ping")).toBe("ping");
    expect(P2PMessageTypeSchema.parse("pong")).toBe("pong");
  });

  it("rejects invalid message types", () => {
    expect(() => P2PMessageTypeSchema.parse("invalid")).toThrow();
    expect(() => P2PMessageTypeSchema.parse("task:assign")).toThrow();
    expect(() => P2PMessageTypeSchema.parse("")).toThrow();
  });

  it("is aliased as MessageTypeSchema for backward compat", () => {
    expect(MessageTypeSchema.parse("request")).toBe("request");
    expect(MessageTypeSchema.parse("ping")).toBe("ping");
  });
});

// =============================================================================
// P2PMessageSchema
// =============================================================================

describe("P2PMessageSchema", () => {
  const validMessage = {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    type: "request",
    from: "11111111-2222-3333-4444-555555555555",
    to: "66666666-7777-8888-9999-000000000000",
    payload: { action: "review", content: "Please review this PR" },
    timestamp: "2026-02-10T12:00:00.000Z",
  };

  it("validates a full message", () => {
    const result = P2PMessageSchema.parse(validMessage);
    expect(result.id).toBe(validMessage.id);
    expect(result.type).toBe("request");
    expect(result.from).toBe(validMessage.from);
    expect(result.to).toBe(validMessage.to);
  });

  it("accepts correlationId", () => {
    const msg = {
      ...validMessage,
      correlationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    };
    const result = P2PMessageSchema.parse(msg);
    expect(result.correlationId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("accepts ttlMs", () => {
    const msg = { ...validMessage, ttlMs: 30000 };
    const result = P2PMessageSchema.parse(msg);
    expect(result.ttlMs).toBe(30000);
  });

  it("rejects invalid UUID for from", () => {
    expect(() =>
      P2PMessageSchema.parse({ ...validMessage, from: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects invalid UUID for to", () => {
    expect(() =>
      P2PMessageSchema.parse({ ...validMessage, to: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects missing type", () => {
    const { type, ...noType } = validMessage;
    expect(() => P2PMessageSchema.parse(noType)).toThrow();
  });

  it("rejects negative ttlMs", () => {
    expect(() =>
      P2PMessageSchema.parse({ ...validMessage, ttlMs: -1 }),
    ).toThrow();
  });

  it("accepts unknown payload shapes", () => {
    const msg = { ...validMessage, payload: { arbitrary: "data", nested: { deep: true } } };
    const result = P2PMessageSchema.parse(msg);
    expect(result.payload).toEqual({ arbitrary: "data", nested: { deep: true } });
  });

  it("accepts null payload", () => {
    const msg = { ...validMessage, payload: null };
    const result = P2PMessageSchema.parse(msg);
    expect(result.payload).toBeNull();
  });
});

// =============================================================================
// P2PRequestPayloadSchema
// =============================================================================

describe("P2PRequestPayloadSchema", () => {
  it("validates full request payload", () => {
    const result = P2PRequestPayloadSchema.parse({
      action: "review-code",
      content: "Please review the changes in PR #42",
      taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      metadata: { prUrl: "https://github.com/org/repo/pull/42" },
    });
    expect(result.action).toBe("review-code");
    expect(result.taskId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("validates minimal request payload", () => {
    const result = P2PRequestPayloadSchema.parse({
      action: "ping-check",
      content: "Are you available?",
    });
    expect(result.action).toBe("ping-check");
    expect(result.taskId).toBeUndefined();
  });

  it("rejects empty action", () => {
    expect(() =>
      P2PRequestPayloadSchema.parse({ action: "", content: "test" }),
    ).toThrow();
  });

  it("rejects action > 100 chars", () => {
    expect(() =>
      P2PRequestPayloadSchema.parse({ action: "a".repeat(101), content: "test" }),
    ).toThrow();
  });

  it("rejects missing content", () => {
    expect(() => P2PRequestPayloadSchema.parse({ action: "test" })).toThrow();
  });
});

// =============================================================================
// P2PResponsePayloadSchema
// =============================================================================

describe("P2PResponsePayloadSchema", () => {
  it("validates success response", () => {
    const result = P2PResponsePayloadSchema.parse({
      success: true,
      content: "Looks good, approved!",
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe("Looks good, approved!");
  });

  it("validates error response", () => {
    const result = P2PResponsePayloadSchema.parse({
      success: false,
      error: "Cannot process — currently busy",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Cannot process — currently busy");
  });

  it("validates minimal response", () => {
    const result = P2PResponsePayloadSchema.parse({ success: true });
    expect(result.success).toBe(true);
    expect(result.content).toBeUndefined();
  });

  it("rejects missing success field", () => {
    expect(() => P2PResponsePayloadSchema.parse({ content: "test" })).toThrow();
  });
});

// =============================================================================
// P2PDelegatePayloadSchema
// =============================================================================

describe("P2PDelegatePayloadSchema", () => {
  it("validates full delegate payload", () => {
    const result = P2PDelegatePayloadSchema.parse({
      action: "write-tests",
      content: "Add unit tests for the auth module",
      priority: "high",
      taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(result.action).toBe("write-tests");
    expect(result.priority).toBe("high");
  });

  it("validates minimal delegate payload", () => {
    const result = P2PDelegatePayloadSchema.parse({
      action: "investigate",
      content: "Check why build is failing",
    });
    expect(result.priority).toBeUndefined();
    expect(result.taskId).toBeUndefined();
  });

  it("rejects empty action", () => {
    expect(() =>
      P2PDelegatePayloadSchema.parse({ action: "", content: "test" }),
    ).toThrow();
  });
});

// =============================================================================
// P2PPingPayloadSchema / P2PPongPayloadSchema
// =============================================================================

describe("P2PPingPayloadSchema", () => {
  it("validates ping with status", () => {
    const result = P2PPingPayloadSchema.parse({ status: "idle" });
    expect(result.status).toBe("idle");
  });

  it("validates empty ping", () => {
    const result = P2PPingPayloadSchema.parse({});
    expect(result.status).toBeUndefined();
  });

  it("rejects invalid status", () => {
    expect(() => P2PPingPayloadSchema.parse({ status: "running" })).toThrow();
  });
});

describe("P2PPongPayloadSchema", () => {
  it("validates full pong", () => {
    const result = P2PPongPayloadSchema.parse({
      status: "working",
      uptimeMs: 3600000,
    });
    expect(result.status).toBe("working");
    expect(result.uptimeMs).toBe(3600000);
  });

  it("validates pong without uptimeMs", () => {
    const result = P2PPongPayloadSchema.parse({ status: "idle" });
    expect(result.uptimeMs).toBeUndefined();
  });

  it("rejects missing status", () => {
    expect(() => P2PPongPayloadSchema.parse({})).toThrow();
  });

  it("rejects negative uptimeMs", () => {
    expect(() =>
      P2PPongPayloadSchema.parse({ status: "idle", uptimeMs: -1 }),
    ).toThrow();
  });
});

// =============================================================================
// P2PMessageAckSchema
// =============================================================================

describe("P2PMessageAckSchema", () => {
  it("validates accepted ack", () => {
    const result = P2PMessageAckSchema.parse({ accepted: true });
    expect(result.accepted).toBe(true);
  });

  it("validates rejected ack with error", () => {
    const result = P2PMessageAckSchema.parse({
      accepted: false,
      error: "Unknown message type",
    });
    expect(result.accepted).toBe(false);
    expect(result.error).toBe("Unknown message type");
  });

  it("validates ack with inline response", () => {
    const result = P2PMessageAckSchema.parse({
      accepted: true,
      response: {
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        type: "pong",
        from: "11111111-2222-3333-4444-555555555555",
        to: "66666666-7777-8888-9999-000000000000",
        payload: { status: "idle" },
        timestamp: "2026-02-10T12:00:00.000Z",
      },
    });
    expect(result.response?.type).toBe("pong");
  });

  it("rejects missing accepted field", () => {
    expect(() => P2PMessageAckSchema.parse({ error: "nope" })).toThrow();
  });
});

// =============================================================================
// AgentEndpointSchema
// =============================================================================

describe("AgentEndpointSchema", () => {
  it("validates full endpoint", () => {
    const result = AgentEndpointSchema.parse({
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "dev-agent-1",
      host: "10.0.0.5",
      port: 3100,
      status: "idle",
      privateIp: "10.0.0.5",
    });
    expect(result.host).toBe("10.0.0.5");
    expect(result.port).toBe(3100);
  });

  it("validates endpoint without privateIp", () => {
    const result = AgentEndpointSchema.parse({
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "dev-agent-1",
      host: "192.168.1.100",
      port: 3100,
      status: "working",
    });
    expect(result.privateIp).toBeUndefined();
  });

  it("accepts null privateIp", () => {
    const result = AgentEndpointSchema.parse({
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "dev-agent-1",
      host: "0.0.0.0",
      port: 3100,
      status: "offline",
      privateIp: null,
    });
    expect(result.privateIp).toBeNull();
  });

  it("accepts all valid status values", () => {
    for (const status of ["idle", "working", "error", "offline", "unreachable", "provisioning", "destroyed"]) {
      expect(
        AgentEndpointSchema.parse({
          id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          name: "test",
          host: "0.0.0.0",
          port: 3100,
          status,
        }).status,
      ).toBe(status);
    }
  });

  it("rejects invalid port", () => {
    expect(() =>
      AgentEndpointSchema.parse({
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        name: "test",
        host: "0.0.0.0",
        port: 0,
        status: "idle",
      }),
    ).toThrow();
  });

  it("rejects port > 65535", () => {
    expect(() =>
      AgentEndpointSchema.parse({
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        name: "test",
        host: "0.0.0.0",
        port: 70000,
        status: "idle",
      }),
    ).toThrow();
  });
});

// =============================================================================
// P2PRetryConfigSchema
// =============================================================================

describe("P2PRetryConfigSchema", () => {
  it("uses defaults when empty", () => {
    const result = P2PRetryConfigSchema.parse({});
    expect(result.maxRetries).toBe(3);
    expect(result.initialDelayMs).toBe(1000);
    expect(result.multiplier).toBe(3);
    expect(result.maxDelayMs).toBe(30000);
  });

  it("validates custom config", () => {
    const result = P2PRetryConfigSchema.parse({
      maxRetries: 5,
      initialDelayMs: 500,
      multiplier: 2,
      maxDelayMs: 10000,
    });
    expect(result.maxRetries).toBe(5);
    expect(result.initialDelayMs).toBe(500);
  });

  it("rejects maxRetries > 10", () => {
    expect(() => P2PRetryConfigSchema.parse({ maxRetries: 11 })).toThrow();
  });

  it("rejects multiplier < 1", () => {
    expect(() => P2PRetryConfigSchema.parse({ multiplier: 0.5 })).toThrow();
  });

  it("rejects initialDelayMs < 100", () => {
    expect(() => P2PRetryConfigSchema.parse({ initialDelayMs: 50 })).toThrow();
  });

  it("issue #56 default backoff: 1s, 3s, 9s", () => {
    const config = P2PRetryConfigSchema.parse({});
    // Verify the backoff sequence: 1000, 3000, 9000
    let delay = config.initialDelayMs;
    expect(delay).toBe(1000);
    delay = Math.min(delay * config.multiplier, config.maxDelayMs);
    expect(delay).toBe(3000);
    delay = Math.min(delay * config.multiplier, config.maxDelayMs);
    expect(delay).toBe(9000);
  });
});

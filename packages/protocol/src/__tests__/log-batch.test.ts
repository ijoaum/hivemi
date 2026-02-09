// =============================================================================
// Log Batch Protocol Tests — Issue #57
// Tests for SubmitLogBatchSchema and LogBatchEntrySchema validation
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  SubmitLogBatchSchema,
  LogBatchEntrySchema,
  ShippableLogLevelSchema,
} from "../types.js";

describe("ShippableLogLevelSchema", () => {
  it("accepts warn", () => {
    expect(ShippableLogLevelSchema.parse("warn")).toBe("warn");
  });

  it("accepts error", () => {
    expect(ShippableLogLevelSchema.parse("error")).toBe("error");
  });

  it("accepts lifecycle", () => {
    expect(ShippableLogLevelSchema.parse("lifecycle")).toBe("lifecycle");
  });

  it("rejects debug", () => {
    expect(() => ShippableLogLevelSchema.parse("debug")).toThrow();
  });

  it("rejects info", () => {
    expect(() => ShippableLogLevelSchema.parse("info")).toThrow();
  });

  it("rejects unknown level", () => {
    expect(() => ShippableLogLevelSchema.parse("critical")).toThrow();
  });
});

describe("LogBatchEntrySchema", () => {
  const validEntry = {
    level: "warn",
    message: "Task xyz failed: timeout",
    timestamp: "2026-02-11T12:00:00.000Z",
    metadata: {
      taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      component: "task-executor",
    },
  };

  it("accepts full entry", () => {
    const result = LogBatchEntrySchema.parse(validEntry);
    expect(result.level).toBe("warn");
    expect(result.message).toBe("Task xyz failed: timeout");
    expect(result.timestamp).toBe("2026-02-11T12:00:00.000Z");
    expect(result.metadata?.taskId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result.metadata?.component).toBe("task-executor");
  });

  it("accepts minimal entry (no metadata)", () => {
    const result = LogBatchEntrySchema.parse({
      level: "error",
      message: "Connection lost",
      timestamp: "2026-02-11T12:00:00.000Z",
    });
    expect(result.level).toBe("error");
    expect(result.metadata).toBeUndefined();
  });

  it("accepts lifecycle level", () => {
    const result = LogBatchEntrySchema.parse({
      level: "lifecycle",
      message: "Task started",
      timestamp: "2026-02-11T12:00:00.000Z",
    });
    expect(result.level).toBe("lifecycle");
  });

  it("rejects empty message", () => {
    expect(() =>
      LogBatchEntrySchema.parse({
        level: "warn",
        message: "",
        timestamp: "2026-02-11T12:00:00.000Z",
      })
    ).toThrow();
  });

  it("rejects missing timestamp", () => {
    expect(() =>
      LogBatchEntrySchema.parse({
        level: "warn",
        message: "something",
      })
    ).toThrow();
  });

  it("rejects invalid timestamp format", () => {
    expect(() =>
      LogBatchEntrySchema.parse({
        level: "warn",
        message: "something",
        timestamp: "not-a-date",
      })
    ).toThrow();
  });

  it("rejects debug level", () => {
    expect(() =>
      LogBatchEntrySchema.parse({
        level: "debug",
        message: "debug msg",
        timestamp: "2026-02-11T12:00:00.000Z",
      })
    ).toThrow();
  });

  it("rejects info level", () => {
    expect(() =>
      LogBatchEntrySchema.parse({
        level: "info",
        message: "info msg",
        timestamp: "2026-02-11T12:00:00.000Z",
      })
    ).toThrow();
  });

  it("accepts extra metadata fields (passthrough)", () => {
    const result = LogBatchEntrySchema.parse({
      level: "error",
      message: "something broke",
      timestamp: "2026-02-11T12:00:00.000Z",
      metadata: {
        taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        component: "poller",
        customField: "extra",
      },
    });
    expect((result.metadata as any).customField).toBe("extra");
  });

  it("rejects invalid taskId UUID", () => {
    expect(() =>
      LogBatchEntrySchema.parse({
        level: "warn",
        message: "test",
        timestamp: "2026-02-11T12:00:00.000Z",
        metadata: { taskId: "not-a-uuid" },
      })
    ).toThrow();
  });

  it("rejects component > 50 chars", () => {
    expect(() =>
      LogBatchEntrySchema.parse({
        level: "warn",
        message: "test",
        timestamp: "2026-02-11T12:00:00.000Z",
        metadata: { component: "a".repeat(51) },
      })
    ).toThrow();
  });

  it("accepts message up to 10000 chars", () => {
    const result = LogBatchEntrySchema.parse({
      level: "error",
      message: "x".repeat(10000),
      timestamp: "2026-02-11T12:00:00.000Z",
    });
    expect(result.message.length).toBe(10000);
  });

  it("rejects message > 10000 chars", () => {
    expect(() =>
      LogBatchEntrySchema.parse({
        level: "error",
        message: "x".repeat(10001),
        timestamp: "2026-02-11T12:00:00.000Z",
      })
    ).toThrow();
  });
});

describe("SubmitLogBatchSchema", () => {
  const validBatch = {
    agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    entries: [
      {
        level: "warn",
        message: "Task xyz failed: timeout",
        timestamp: "2026-02-11T12:00:00.000Z",
        metadata: {
          taskId: "11111111-2222-3333-4444-555555555555",
          component: "task-executor",
        },
      },
    ],
  };

  it("accepts valid batch", () => {
    const result = SubmitLogBatchSchema.parse(validBatch);
    expect(result.agentId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result.entries).toHaveLength(1);
  });

  it("accepts batch with multiple entries", () => {
    const result = SubmitLogBatchSchema.parse({
      agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      entries: [
        { level: "warn", message: "warning 1", timestamp: "2026-02-11T12:00:00.000Z" },
        { level: "error", message: "error 1", timestamp: "2026-02-11T12:01:00.000Z" },
        { level: "lifecycle", message: "task started", timestamp: "2026-02-11T12:02:00.000Z" },
      ],
    });
    expect(result.entries).toHaveLength(3);
  });

  it("rejects empty entries array", () => {
    expect(() =>
      SubmitLogBatchSchema.parse({
        agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        entries: [],
      })
    ).toThrow();
  });

  it("rejects missing agentId", () => {
    expect(() =>
      SubmitLogBatchSchema.parse({
        entries: [
          { level: "warn", message: "test", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      })
    ).toThrow();
  });

  it("rejects invalid agentId", () => {
    expect(() =>
      SubmitLogBatchSchema.parse({
        agentId: "not-a-uuid",
        entries: [
          { level: "warn", message: "test", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      })
    ).toThrow();
  });

  it("rejects > 500 entries", () => {
    const entries = Array.from({ length: 501 }, (_, i) => ({
      level: "warn" as const,
      message: `entry ${i}`,
      timestamp: "2026-02-11T12:00:00.000Z",
    }));
    expect(() =>
      SubmitLogBatchSchema.parse({
        agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        entries,
      })
    ).toThrow();
  });

  it("accepts exactly 500 entries", () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({
      level: "warn" as const,
      message: `entry ${i}`,
      timestamp: "2026-02-11T12:00:00.000Z",
    }));
    const result = SubmitLogBatchSchema.parse({
      agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      entries,
    });
    expect(result.entries).toHaveLength(500);
  });

  it("validates exact Issue #57 payload", () => {
    const issuePayload = {
      agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      entries: [
        {
          level: "warn",
          message: "Task xyz failed: timeout",
          timestamp: "2026-02-11T12:00:00.000Z",
          metadata: {
            taskId: "11111111-2222-3333-4444-555555555555",
            component: "task-executor",
          },
        },
      ],
    };
    const result = SubmitLogBatchSchema.parse(issuePayload);
    expect(result.entries[0].level).toBe("warn");
    expect(result.entries[0].message).toBe("Task xyz failed: timeout");
    expect(result.entries[0].metadata?.taskId).toBe("11111111-2222-3333-4444-555555555555");
    expect(result.entries[0].metadata?.component).toBe("task-executor");
  });

  it("rejects entries with info level (should not be shipped)", () => {
    expect(() =>
      SubmitLogBatchSchema.parse({
        agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        entries: [
          { level: "info", message: "info msg", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      })
    ).toThrow();
  });

  it("rejects entries with debug level (should not be shipped)", () => {
    expect(() =>
      SubmitLogBatchSchema.parse({
        agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        entries: [
          { level: "debug", message: "debug msg", timestamp: "2026-02-11T12:00:00.000Z" },
        ],
      })
    ).toThrow();
  });
});

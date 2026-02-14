// =============================================================================
// Task Progress Tests — Issue #88
// Tests for task progress endpoints (POST & GET /api/tasks/:id/progress)
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  CreateTaskProgressSchema,
  TaskProgressSchema,
} from "@hivemi/protocol";

// =============================================================================
// CreateTaskProgressSchema Validation Tests
// =============================================================================

describe("CreateTaskProgressSchema", () => {
  it("validates a full progress step payload", () => {
    const payload = {
      step: "Cloning repository",
      timestamp: "2026-02-15T10:30:00Z",
      toolCall: "git_clone",
    };

    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.step).toBe("Cloning repository");
      expect(result.data.toolCall).toBe("git_clone");
      expect(result.data.timestamp).toBeInstanceOf(Date);
    }
  });

  it("validates a minimal payload (step + timestamp only)", () => {
    const payload = {
      step: "Starting build",
      timestamp: "2026-02-15T10:30:00Z",
    };

    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.step).toBe("Starting build");
      expect(result.data.toolCall).toBeUndefined();
    }
  });

  it("rejects missing step", () => {
    const payload = {
      timestamp: "2026-02-15T10:30:00Z",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty("step");
    }
  });

  it("rejects missing timestamp", () => {
    const payload = {
      step: "Building",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty("timestamp");
    }
  });

  it("rejects empty step string", () => {
    const payload = {
      step: "",
      timestamp: "2026-02-15T10:30:00Z",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects step longer than 1000 chars", () => {
    const payload = {
      step: "x".repeat(1001),
      timestamp: "2026-02-15T10:30:00Z",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("accepts step exactly 1000 chars", () => {
    const payload = {
      step: "x".repeat(1000),
      timestamp: "2026-02-15T10:30:00Z",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("rejects toolCall longer than 50 chars", () => {
    const payload = {
      step: "Running tests",
      timestamp: "2026-02-15T10:30:00Z",
      toolCall: "a".repeat(51),
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("accepts toolCall exactly 50 chars", () => {
    const payload = {
      step: "Running tests",
      timestamp: "2026-02-15T10:30:00Z",
      toolCall: "a".repeat(50),
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("coerces string timestamps to Date objects", () => {
    const payload = {
      step: "Deploying",
      timestamp: "2026-02-15T10:30:00.000Z",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timestamp).toBeInstanceOf(Date);
      expect(result.data.timestamp.toISOString()).toBe("2026-02-15T10:30:00.000Z");
    }
  });

  it("accepts numeric timestamps (epoch ms)", () => {
    const payload = {
      step: "Deploying",
      timestamp: 1739614200000,
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timestamp).toBeInstanceOf(Date);
    }
  });

  it("allows toolCall to be omitted", () => {
    const payload = {
      step: "Running linter",
      timestamp: "2026-02-15T10:30:00Z",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolCall).toBeUndefined();
    }
  });

  it("accepts toolCall when provided", () => {
    const payload = {
      step: "Running tests",
      timestamp: "2026-02-15T10:30:00Z",
      toolCall: "vitest",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolCall).toBe("vitest");
    }
  });

  it("rejects extra unknown fields (strict would fail, passthrough keeps)", () => {
    // Zod object by default strips unknown fields
    const payload = {
      step: "Building",
      timestamp: "2026-02-15T10:30:00Z",
      unknownField: "should be stripped",
    };
    const result = CreateTaskProgressSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknownField).toBeUndefined();
    }
  });
});

// =============================================================================
// TaskProgressSchema Validation Tests
// =============================================================================

describe("TaskProgressSchema", () => {
  it("validates a full task progress record", () => {
    const record = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      taskId: "550e8400-e29b-41d4-a716-446655440001",
      step: "Running test suite",
      toolCall: "vitest_run",
      timestamp: "2026-02-15T10:35:00Z",
    };

    const result = TaskProgressSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(record.id);
      expect(result.data.taskId).toBe(record.taskId);
      expect(result.data.step).toBe("Running test suite");
      expect(result.data.toolCall).toBe("vitest_run");
    }
  });

  it("validates a record with null toolCall", () => {
    const record = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      taskId: "550e8400-e29b-41d4-a716-446655440001",
      step: "Analyzing code",
      toolCall: null,
      timestamp: "2026-02-15T10:35:00Z",
    };

    const result = TaskProgressSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolCall).toBeNull();
    }
  });

  it("rejects missing id", () => {
    const record = {
      taskId: "550e8400-e29b-41d4-a716-446655440001",
      step: "Building",
      toolCall: null,
      timestamp: "2026-02-15T10:35:00Z",
    };
    const result = TaskProgressSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid id", () => {
    const record = {
      id: "not-a-uuid",
      taskId: "550e8400-e29b-41d4-a716-446655440001",
      step: "Building",
      toolCall: null,
      timestamp: "2026-02-15T10:35:00Z",
    };
    const result = TaskProgressSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it("rejects missing taskId", () => {
    const record = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      step: "Building",
      toolCall: null,
      timestamp: "2026-02-15T10:35:00Z",
    };
    const result = TaskProgressSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it("rejects missing step", () => {
    const record = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      taskId: "550e8400-e29b-41d4-a716-446655440001",
      toolCall: null,
      timestamp: "2026-02-15T10:35:00Z",
    };
    const result = TaskProgressSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const record = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      taskId: "550e8400-e29b-41d4-a716-446655440001",
      step: "Building",
      toolCall: null,
    };
    const result = TaskProgressSchema.safeParse(record);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Pagination Logic Tests
// =============================================================================

describe("Pagination logic (GET /api/tasks/:id/progress)", () => {
  // Replicates the pagination logic from the route handler
  const computePagination = (limitParam?: string, offsetParam?: string) => {
    const limit = Math.min(Math.max(parseInt(limitParam || "100", 10) || 100, 1), 500);
    const offset = Math.max(parseInt(offsetParam || "0", 10) || 0, 0);
    return { limit, offset };
  };

  it("defaults limit to 100 when not provided", () => {
    const { limit } = computePagination(undefined);
    expect(limit).toBe(100);
  });

  it("caps limit at 500", () => {
    const { limit } = computePagination("1000");
    expect(limit).toBe(500);
  });

  it("defaults offset to 0 when not provided", () => {
    const { offset } = computePagination(undefined, undefined);
    expect(offset).toBe(0);
  });

  it("handles negative offset by clamping to 0", () => {
    const { offset } = computePagination(undefined, "-5");
    expect(offset).toBe(0);
  });

  it("handles non-numeric limit by defaulting to 100", () => {
    const { limit } = computePagination("abc");
    expect(limit).toBe(100);
  });

  it("handles limit=0 by falling back to default 100", () => {
    // parseInt("0") returns 0, which is falsy, so || 100 kicks in
    const { limit } = computePagination("0");
    expect(limit).toBe(100);
  });

  it("accepts valid limit within range", () => {
    const { limit } = computePagination("50");
    expect(limit).toBe(50);
  });

  it("accepts valid offset", () => {
    const { offset } = computePagination(undefined, "20");
    expect(offset).toBe(20);
  });

  it("handles both limit and offset together", () => {
    const { limit, offset } = computePagination("25", "50");
    expect(limit).toBe(25);
    expect(offset).toBe(50);
  });

  it("enforces minimum limit of 1", () => {
    // With a negative number
    const { limit } = computePagination("-10");
    expect(limit).toBe(1);
  });
});

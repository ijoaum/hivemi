// =============================================================================
// Offline Detection Tests
// Tests for the offline detection job (issue #53)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- Mock DB & logger ----
const mockReturning = vi.fn();

vi.mock("../db/index.js", () => {
  return {
    db: {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            returning: vi.fn().mockImplementation(() => mockReturning()),
          })),
        })),
      })),
    },
    agents: {
      id: "agents.id",
      name: "agents.name",
      lastHeartbeat: "agents.last_heartbeat",
      status: "agents.status",
      updatedAt: "agents.updated_at",
    },
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
import { detectOfflineAgents, startOfflineDetection, stopOfflineDetection } from "../lib/offline-detection.js";
import { logger } from "../lib/logger.js";

// =============================================================================
// detectOfflineAgents()
// =============================================================================

describe("detectOfflineAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no agents affected
    mockReturning.mockResolvedValue([]);
  });

  it("returns zeros when no agents are stale", async () => {
    const result = await detectOfflineAgents();
    expect(result.markedOffline).toBe(0);
    expect(result.markedUnreachable).toBe(0);
  });

  it("marks agents as unreachable first, then offline", async () => {
    // First call (unreachable check) returns 1 agent
    // Second call (offline check) returns 2 agents
    mockReturning
      .mockResolvedValueOnce([{ id: "agent-1", name: "stale-agent-1" }])
      .mockResolvedValueOnce([
        { id: "agent-2", name: "stale-agent-2" },
        { id: "agent-3", name: "stale-agent-3" },
      ]);

    const result = await detectOfflineAgents();
    expect(result.markedUnreachable).toBe(1);
    expect(result.markedOffline).toBe(2);
  });

  it("logs warning when agents are marked unreachable", async () => {
    mockReturning
      .mockResolvedValueOnce([{ id: "agent-1", name: "lost-agent" }])
      .mockResolvedValueOnce([]);

    await detectOfflineAgents();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining("unreachable"),
    );
  });

  it("logs info when agents are marked offline", async () => {
    mockReturning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "agent-1", name: "quiet-agent" }]);

    await detectOfflineAgents();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining("offline"),
    );
  });

  it("handles DB errors gracefully", async () => {
    mockReturning.mockRejectedValueOnce(new Error("DB connection lost"));

    const result = await detectOfflineAgents();

    // Should not throw, returns zeros
    expect(result.markedOffline).toBe(0);
    expect(result.markedUnreachable).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Offline detection job failed",
    );
  });
});

// =============================================================================
// startOfflineDetection / stopOfflineDetection
// =============================================================================

describe("Offline detection lifecycle", () => {
  afterEach(() => {
    stopOfflineDetection();
  });

  it("starts without error", () => {
    mockReturning.mockResolvedValue([]);
    expect(() => startOfflineDetection()).not.toThrow();
  });

  it("stops without error", () => {
    mockReturning.mockResolvedValue([]);
    startOfflineDetection();
    expect(() => stopOfflineDetection()).not.toThrow();
  });

  it("warns if started twice", () => {
    mockReturning.mockResolvedValue([]);
    startOfflineDetection();
    startOfflineDetection();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("already running"),
    );
  });
});

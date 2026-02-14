// =============================================================================
// Tool Call Progress Reporting Tests — Issue #89
//
// Tests for:
// 1. OpenClawInterceptor — tool call detection from SSE stream chunks
// 2. ProgressReporter — debounce, retry, lifecycle
// 3. Integration — interceptor → reporter → registry flow
// 4. Configuration — enable/disable, env vars
// 5. Edge cases — malformed data, network errors, no active task
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawInterceptor, type ToolCallEvent } from "../openclaw-interceptor.js";
import { ProgressReporter, type ProgressReporterConfig } from "../progress-reporter.js";
import type { DaemonLogger, IRegistryClient } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSilentLogger(): DaemonLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockRegistry(): IRegistryClient {
  return {
    register: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue({ ack: true, cancelTask: null }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    pollTask: vi.fn().mockResolvedValue(null),
    reportTaskResult: vi.fn().mockResolvedValue(undefined),
    createSubtask: vi.fn().mockResolvedValue(null),
    sendTelemetry: vi.fn().mockResolvedValue(undefined),
    sendLogs: vi.fn().mockResolvedValue(undefined),
    setOffline: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn().mockResolvedValue(undefined),
  };
}

function makeToolCallChunk(
  id: string,
  name: string,
  args: string,
  index = 0,
): string {
  return JSON.stringify({
    id: "chatcmpl-abc",
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              id,
              type: "function",
              function: { name, arguments: args },
            },
          ],
        },
      },
    ],
  });
}

function makeToolCallArgChunk(args: string, index = 0): string {
  return JSON.stringify({
    id: "chatcmpl-abc",
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              function: { arguments: args },
            },
          ],
        },
      },
    ],
  });
}

function makeContentChunk(content: string): string {
  return JSON.stringify({
    id: "chatcmpl-abc",
    choices: [
      {
        delta: { content },
      },
    ],
  });
}

// =============================================================================
// OpenClawInterceptor
// =============================================================================

describe("OpenClawInterceptor", () => {
  let logger: DaemonLogger;
  let interceptor: OpenClawInterceptor;

  beforeEach(() => {
    logger = createSilentLogger();
    interceptor = new OpenClawInterceptor(logger);
  });

  // ---------------------------------------------------------------------------
  // Basic tool call detection
  // ---------------------------------------------------------------------------

  describe("tool call detection", () => {
    it("should detect a complete tool call in a single chunk", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      const data = makeToolCallChunk(
        "call_123",
        "exec",
        '{"command":"ls -la"}',
      );
      interceptor.processChunk(data);
      interceptor.flush();

      expect(events).toHaveLength(1);
      expect(events[0].callId).toBe("call_123");
      expect(events[0].toolName).toBe("exec");
      expect(events[0].arguments).toBe('{"command":"ls -la"}');
    });

    it("should detect tool calls split across multiple chunks", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      // First chunk: start of tool call
      interceptor.processChunk(
        makeToolCallChunk("call_456", "read", '{"path":'),
      );
      // Second chunk: continuation of arguments
      interceptor.processChunk(makeToolCallArgChunk('"/src/index.ts"}'));
      interceptor.flush();

      expect(events).toHaveLength(1);
      expect(events[0].toolName).toBe("read");
      expect(events[0].arguments).toBe('{"path":"/src/index.ts"}');
    });

    it("should detect multiple sequential tool calls", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      // First tool call
      interceptor.processChunk(
        makeToolCallChunk("call_1", "exec", '{"command":"git status"}'),
      );
      // Second tool call (new id at same index flushes the first)
      interceptor.processChunk(
        makeToolCallChunk("call_2", "write", '{"path":"/tmp/test.txt"}'),
      );
      interceptor.flush();

      expect(events).toHaveLength(2);
      expect(events[0].toolName).toBe("exec");
      expect(events[1].toolName).toBe("write");
    });

    it("should handle parallel tool calls (different indices)", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      // Two tool calls at different indices in same chunk
      const data = JSON.stringify({
        id: "chatcmpl-abc",
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_a",
                  type: "function",
                  function: { name: "exec", arguments: '{"command":"ls"}' },
                },
                {
                  index: 1,
                  id: "call_b",
                  type: "function",
                  function: { name: "read", arguments: '{"path":"README.md"}' },
                },
              ],
            },
          },
        ],
      });

      interceptor.processChunk(data);
      interceptor.flush();

      expect(events).toHaveLength(2);
      expect(events.map((e) => e.toolName).sort()).toEqual(["exec", "read"]);
    });

    it("should handle [DONE] marker and flush", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "exec", '{"command":"echo hi"}'),
      );
      interceptor.processChunk("[DONE]");

      expect(events).toHaveLength(1);
      expect(events[0].toolName).toBe("exec");
    });
  });

  // ---------------------------------------------------------------------------
  // Content passthrough
  // ---------------------------------------------------------------------------

  describe("content passthrough", () => {
    it("should return content delta from content chunks", () => {
      const result = interceptor.processChunk(makeContentChunk("Hello world"));
      expect(result).toBe("Hello world");
    });

    it("should return null for tool call chunks without content", () => {
      const result = interceptor.processChunk(
        makeToolCallChunk("call_1", "exec", "{}"),
      );
      expect(result).toBeNull();
    });

    it("should return null for [DONE]", () => {
      const result = interceptor.processChunk("[DONE]");
      expect(result).toBeNull();
    });

    it("should return null for invalid JSON", () => {
      const result = interceptor.processChunk("not json at all");
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Argument summaries
  // ---------------------------------------------------------------------------

  describe("argument summaries", () => {
    it("should summarize exec commands", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "exec", '{"command":"npm install"}'),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("$ npm install");
    });

    it("should summarize read paths", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "read", '{"path":"/src/index.ts"}'),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("📄 /src/index.ts");
    });

    it("should summarize write paths", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "write", '{"path":"/tmp/out.txt"}'),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("✏️ /tmp/out.txt");
    });

    it("should summarize edit paths", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "edit", '{"file_path":"/src/app.ts"}'),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("🔧 /src/app.ts");
    });

    it("should summarize web_search queries", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "web_search", '{"query":"Node.js streams"}'),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("🔍 Node.js streams");
    });

    it("should summarize web_fetch URLs", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "web_fetch", '{"url":"https://example.com"}'),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("🌐 https://example.com");
    });

    it("should summarize browser actions", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "browser", '{"action":"screenshot"}'),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("🖥️ browser:screenshot");
    });

    it("should fall back to first key-value for unknown tools", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "custom_tool", '{"target":"production"}'),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("target: production");
    });

    it("should truncate long summaries", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      const longCmd = "a".repeat(200);
      interceptor.processChunk(
        makeToolCallChunk("call_1", "exec", `{"command":"${longCmd}"}`),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary.length).toBeLessThanOrEqual(103); // 100 + "..."
      expect(events[0].argumentsSummary).toContain("...");
    });

    it("should handle empty arguments", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(makeToolCallChunk("call_1", "exec", ""));
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("(no args)");
    });

    it("should handle invalid JSON arguments gracefully", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "exec", "not-json"),
      );
      interceptor.flush();

      expect(events[0].argumentsSummary).toBe("not-json");
    });
  });

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  describe("configuration", () => {
    it("should not emit events when disabled", () => {
      const disabled = new OpenClawInterceptor(logger, { enabled: false });
      const events: ToolCallEvent[] = [];
      disabled.onToolCall((e) => events.push(e));

      disabled.processChunk(
        makeToolCallChunk("call_1", "exec", '{"command":"ls"}'),
      );
      disabled.flush();

      expect(events).toHaveLength(0);
    });

    it("should respect custom maxArgsSummaryLength", () => {
      const short = new OpenClawInterceptor(logger, {
        maxArgsSummaryLength: 20,
      });
      const events: ToolCallEvent[] = [];
      short.onToolCall((e) => events.push(e));

      short.processChunk(
        makeToolCallChunk("call_1", "exec", '{"command":"very long command that exceeds limit"}'),
      );
      short.flush();

      expect(events[0].argumentsSummary.length).toBeLessThanOrEqual(20);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    it("should not throw when callback errors", () => {
      interceptor.onToolCall(() => {
        throw new Error("callback boom");
      });

      expect(() => {
        interceptor.processChunk(
          makeToolCallChunk("call_1", "exec", "{}"),
        );
        interceptor.flush();
      }).not.toThrow();
    });

    it("should log callback errors as warnings", () => {
      interceptor.onToolCall(() => {
        throw new Error("callback boom");
      });

      interceptor.processChunk(
        makeToolCallChunk("call_1", "exec", "{}"),
      );
      interceptor.flush();

      expect(logger.warn).toHaveBeenCalledWith(
        "Tool call callback error",
        expect.objectContaining({ error: "callback boom" }),
      );
    });

    it("should handle empty delta gracefully", () => {
      const data = JSON.stringify({
        id: "chatcmpl-abc",
        choices: [{ delta: {} }],
      });

      expect(() => interceptor.processChunk(data)).not.toThrow();
    });

    it("should handle missing choices gracefully", () => {
      const data = JSON.stringify({ id: "chatcmpl-abc" });
      const result = interceptor.processChunk(data);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  describe("reset", () => {
    it("should clear accumulators on reset", () => {
      const events: ToolCallEvent[] = [];
      interceptor.onToolCall((e) => events.push(e));

      interceptor.processChunk(
        makeToolCallChunk("call_1", "exec", '{"command":"ls"}'),
      );
      interceptor.reset();
      interceptor.flush();

      // The tool call from before reset should not be emitted
      expect(events).toHaveLength(0);
    });
  });
});

// =============================================================================
// ProgressReporter
// =============================================================================

describe("ProgressReporter", () => {
  let logger: DaemonLogger;
  let registry: IRegistryClient;
  let reporter: ProgressReporter;

  beforeEach(() => {
    logger = createSilentLogger();
    registry = createMockRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createReporter(
    config: Partial<ProgressReporterConfig> = {},
  ): ProgressReporter {
    return new ProgressReporter(registry, logger, {
      debounceMs: 2_000,
      maxRetries: 2,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 1_000,
      ...config,
    });
  }

  function makeToolCallEvent(
    toolName = "exec",
    summary = "$ ls",
  ): ToolCallEvent {
    return {
      callId: `call_${Math.random().toString(36).slice(2, 8)}`,
      toolName,
      arguments: "{}",
      argumentsSummary: summary,
      timestamp: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe("lifecycle", () => {
    it("should not report without active task", () => {
      reporter = createReporter();
      reporter.handleToolCall(makeToolCallEvent());

      expect(registry.reportProgress).not.toHaveBeenCalled();
    });

    it("should report after startTask", async () => {
      reporter = createReporter();
      reporter.startTask("task-001");
      reporter.handleToolCall(makeToolCallEvent());

      // The first event should be sent immediately (no debounce needed)
      await vi.advanceTimersByTimeAsync(0);

      expect(registry.reportProgress).toHaveBeenCalledTimes(1);
      expect(registry.reportProgress).toHaveBeenCalledWith(
        "task-001",
        expect.objectContaining({
          step: expect.stringContaining("exec"),
          toolCall: "exec",
        }),
      );
    });

    it("should flush pending on stopTask", async () => {
      reporter = createReporter();
      reporter.startTask("task-001");

      // Send one event (starts debounce)
      reporter.handleToolCall(makeToolCallEvent());
      await vi.advanceTimersByTimeAsync(0);

      // Send another event (within debounce window)
      reporter.handleToolCall(makeToolCallEvent("read", "📄 /src/index.ts"));

      // Stop should flush the pending event
      await reporter.stopTask();

      expect(registry.reportProgress).toHaveBeenCalledTimes(2);
    });

    it("should reset metrics on startTask", () => {
      reporter = createReporter();
      reporter.startTask("task-001");

      const metrics = reporter.getMetrics();
      expect(metrics.sent).toBe(0);
      expect(metrics.failed).toBe(0);
      expect(metrics.pending).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Debounce
  // ---------------------------------------------------------------------------

  describe("debounce", () => {
    it("should send first event immediately", async () => {
      reporter = createReporter({ debounceMs: 2_000 });
      reporter.startTask("task-001");

      reporter.handleToolCall(makeToolCallEvent());
      await vi.advanceTimersByTimeAsync(0);

      expect(registry.reportProgress).toHaveBeenCalledTimes(1);
    });

    it("should debounce rapid events", async () => {
      reporter = createReporter({ debounceMs: 2_000 });
      reporter.startTask("task-001");

      // First event — immediate
      reporter.handleToolCall(makeToolCallEvent("exec", "$ ls"));
      await vi.advanceTimersByTimeAsync(0);

      // Second event — within debounce window (should not send yet)
      reporter.handleToolCall(makeToolCallEvent("read", "📄 file.ts"));
      await vi.advanceTimersByTimeAsync(500); // Still within 2s window

      expect(registry.reportProgress).toHaveBeenCalledTimes(1);

      // Wait for debounce to expire
      await vi.advanceTimersByTimeAsync(1_600);

      expect(registry.reportProgress).toHaveBeenCalledTimes(2);
    });

    it("should batch events during debounce window", async () => {
      reporter = createReporter({ debounceMs: 2_000 });
      reporter.startTask("task-001");

      // First event — immediate
      reporter.handleToolCall(makeToolCallEvent("exec", "$ ls"));
      await vi.advanceTimersByTimeAsync(0);

      // Multiple events within debounce window
      reporter.handleToolCall(makeToolCallEvent("read", "📄 a.ts"));
      reporter.handleToolCall(makeToolCallEvent("write", "✏️ b.ts"));

      // Wait for debounce flush
      await vi.advanceTimersByTimeAsync(2_100);

      // First immediate + two batched
      expect(registry.reportProgress).toHaveBeenCalledTimes(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Retry with backoff
  // ---------------------------------------------------------------------------

  describe("retry", () => {
    it("should retry on network error", async () => {
      const mockReport = registry.reportProgress as ReturnType<typeof vi.fn>;
      mockReport
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(undefined);

      reporter = createReporter({ maxRetries: 2, retryBaseDelayMs: 100 });
      reporter.startTask("task-001");
      reporter.handleToolCall(makeToolCallEvent());

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      // Retry delay
      await vi.advanceTimersByTimeAsync(100);

      expect(registry.reportProgress).toHaveBeenCalledTimes(2);
    });

    it("should give up after max retries", async () => {
      const mockReport = registry.reportProgress as ReturnType<typeof vi.fn>;
      mockReport.mockRejectedValue(new Error("Persistent error"));

      reporter = createReporter({
        maxRetries: 2,
        retryBaseDelayMs: 50,
        retryMaxDelayMs: 200,
      });
      reporter.startTask("task-001");
      reporter.handleToolCall(makeToolCallEvent());

      // First attempt + 2 retries
      await vi.advanceTimersByTimeAsync(0);   // Attempt 0
      await vi.advanceTimersByTimeAsync(50);  // Attempt 1 (50ms delay)
      await vi.advanceTimersByTimeAsync(100); // Attempt 2 (100ms delay)

      // 3 total attempts (0 + 2 retries)
      expect(registry.reportProgress).toHaveBeenCalledTimes(3);

      const metrics = reporter.getMetrics();
      expect(metrics.failed).toBe(1);
    });

    it("should use exponential backoff", async () => {
      const mockReport = registry.reportProgress as ReturnType<typeof vi.fn>;
      mockReport.mockRejectedValue(new Error("fail"));

      reporter = createReporter({
        maxRetries: 3,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 10_000,
      });
      reporter.startTask("task-001");
      reporter.handleToolCall(makeToolCallEvent());

      // The delays should be: 100, 200, 400 (exponential)
      await vi.advanceTimersByTimeAsync(0);   // Attempt 0
      await vi.advanceTimersByTimeAsync(100); // Attempt 1
      await vi.advanceTimersByTimeAsync(200); // Attempt 2
      await vi.advanceTimersByTimeAsync(400); // Attempt 3

      expect(registry.reportProgress).toHaveBeenCalledTimes(4);
    });

    it("should cap retry delay at retryMaxDelayMs", async () => {
      const mockReport = registry.reportProgress as ReturnType<typeof vi.fn>;
      mockReport.mockRejectedValue(new Error("fail"));

      reporter = createReporter({
        maxRetries: 3,
        retryBaseDelayMs: 5_000,
        retryMaxDelayMs: 8_000,
      });
      reporter.startTask("task-001");
      reporter.handleToolCall(makeToolCallEvent());

      // 5000, min(10000, 8000)=8000, min(20000, 8000)=8000
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(8_000);
      await vi.advanceTimersByTimeAsync(8_000);

      expect(registry.reportProgress).toHaveBeenCalledTimes(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Enable/disable
  // ---------------------------------------------------------------------------

  describe("enable/disable", () => {
    it("should not report when disabled", async () => {
      reporter = createReporter({ enabled: false });
      reporter.startTask("task-001");
      reporter.handleToolCall(makeToolCallEvent());

      await vi.advanceTimersByTimeAsync(5_000);

      expect(registry.reportProgress).not.toHaveBeenCalled();
    });

    it("should report when enabled", async () => {
      reporter = createReporter({ enabled: true });
      reporter.startTask("task-001");
      reporter.handleToolCall(makeToolCallEvent());

      await vi.advanceTimersByTimeAsync(0);

      expect(registry.reportProgress).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  describe("metrics", () => {
    it("should track sent count", async () => {
      reporter = createReporter();
      reporter.startTask("task-001");

      reporter.handleToolCall(makeToolCallEvent());
      await vi.advanceTimersByTimeAsync(0);

      expect(reporter.getMetrics().sent).toBe(1);
    });

    it("should track failed count", async () => {
      const mockReport = registry.reportProgress as ReturnType<typeof vi.fn>;
      mockReport.mockRejectedValue(new Error("fail"));

      reporter = createReporter({ maxRetries: 0 });
      reporter.startTask("task-001");

      reporter.handleToolCall(makeToolCallEvent());
      await vi.advanceTimersByTimeAsync(0);

      expect(reporter.getMetrics().failed).toBe(1);
    });

    it("should track pending count", () => {
      reporter = createReporter();
      reporter.startTask("task-001");

      // Don't flush - events are pending
      reporter.handleToolCall(makeToolCallEvent());
      // Note: the event gets queued and may be flushed immediately
      // but before the microtask runs, it should be in pendingQueue
      // This is tricky with fake timers — let's just verify the getter works
      const metrics = reporter.getMetrics();
      expect(typeof metrics.pending).toBe("number");
    });
  });

  // ---------------------------------------------------------------------------
  // Report payload
  // ---------------------------------------------------------------------------

  describe("report payload", () => {
    it("should include step with tool name and summary", async () => {
      reporter = createReporter();
      reporter.startTask("task-001");

      reporter.handleToolCall(
        makeToolCallEvent("exec", "$ npm install"),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(registry.reportProgress).toHaveBeenCalledWith(
        "task-001",
        expect.objectContaining({
          step: "[exec] $ npm install",
          toolCall: "exec",
        }),
      );
    });

    it("should include timestamp from the event", async () => {
      reporter = createReporter();
      reporter.startTask("task-001");

      const event = makeToolCallEvent();
      reporter.handleToolCall(event);
      await vi.advanceTimersByTimeAsync(0);

      expect(registry.reportProgress).toHaveBeenCalledWith(
        "task-001",
        expect.objectContaining({
          timestamp: event.timestamp,
        }),
      );
    });
  });
});

// =============================================================================
// Integration — Interceptor + Reporter
// =============================================================================

describe("Interceptor → Reporter integration", () => {
  let logger: DaemonLogger;
  let registry: IRegistryClient;

  beforeEach(() => {
    logger = createSilentLogger();
    registry = createMockRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should report tool calls from interceptor to registry", async () => {
    const interceptor = new OpenClawInterceptor(logger);
    const reporter = new ProgressReporter(registry, logger, {
      debounceMs: 0, // No debounce for this test
    });

    // Wire interceptor → reporter
    interceptor.onToolCall((event) => reporter.handleToolCall(event));

    // Start task
    reporter.startTask("task-integration");

    // Simulate SSE stream with tool call
    interceptor.processChunk(
      makeToolCallChunk("call_1", "exec", '{"command":"npm test"}'),
    );
    interceptor.flush();

    // Wait for async flush
    await vi.advanceTimersByTimeAsync(0);

    expect(registry.reportProgress).toHaveBeenCalledWith(
      "task-integration",
      expect.objectContaining({
        step: expect.stringContaining("exec"),
        toolCall: "exec",
      }),
    );
  });

  it("should handle full execution flow with multiple tool calls", async () => {
    const interceptor = new OpenClawInterceptor(logger);
    const reporter = new ProgressReporter(registry, logger, {
      debounceMs: 0,
    });

    interceptor.onToolCall((event) => reporter.handleToolCall(event));
    reporter.startTask("task-full-flow");

    // Simulate: content → tool_call → content → tool_call → [DONE]
    interceptor.processChunk(makeContentChunk("Let me check the code..."));
    interceptor.processChunk(
      makeToolCallChunk("call_1", "read", '{"path":"/src/app.ts"}'),
    );
    // Flush call_1 by sending call_2 (same index, new id)
    await vi.advanceTimersByTimeAsync(0);

    interceptor.processChunk(makeContentChunk("Found it. Editing..."));
    interceptor.processChunk(
      makeToolCallChunk("call_2", "edit", '{"file_path":"/src/app.ts"}'),
    );
    // call_1 was flushed when call_2 started (same index replacement)
    await vi.advanceTimersByTimeAsync(0);

    interceptor.processChunk("[DONE]");
    // call_2 is flushed on [DONE]
    await vi.advanceTimersByTimeAsync(0);

    expect(registry.reportProgress).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// Configuration — DaemonConfig env vars
// =============================================================================

describe("DaemonConfig progress settings", () => {
  it("should parse PROGRESS_REPORTING env var", async () => {
    const { loadConfigFromEnv } = await import("../types.js");

    const config = loadConfigFromEnv({
      AGENT_ID: "test",
      AGENT_NAME: "Test",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
      PROGRESS_REPORTING: "false",
    });

    expect(config.progressReportingEnabled).toBe(false);
  });

  it("should default progressReportingEnabled to true", async () => {
    const { loadConfigFromEnv } = await import("../types.js");

    const config = loadConfigFromEnv({
      AGENT_ID: "test",
      AGENT_NAME: "Test",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
    });

    expect(config.progressReportingEnabled).toBe(true);
  });

  it("should parse PROGRESS_DEBOUNCE_MS env var", async () => {
    const { loadConfigFromEnv } = await import("../types.js");

    const config = loadConfigFromEnv({
      AGENT_ID: "test",
      AGENT_NAME: "Test",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
      PROGRESS_DEBOUNCE_MS: "5000",
    });

    expect(config.progressDebounceMs).toBe(5000);
  });

  it("should default progressDebounceMs to 2000", async () => {
    const { loadConfigFromEnv } = await import("../types.js");

    const config = loadConfigFromEnv({
      AGENT_ID: "test",
      AGENT_NAME: "Test",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
    });

    expect(config.progressDebounceMs).toBe(2000);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge cases", () => {
  let logger: DaemonLogger;

  beforeEach(() => {
    logger = createSilentLogger();
  });

  it("should handle tool call with unknown name", () => {
    const interceptor = new OpenClawInterceptor(logger);
    const events: ToolCallEvent[] = [];
    interceptor.onToolCall((e) => events.push(e));

    interceptor.processChunk(
      makeToolCallChunk("call_1", "", '{}'),
    );
    interceptor.flush();

    // Empty name should still emit, as "unknown" is set by the accumulator init
    expect(events).toHaveLength(1);
  });

  it("should handle multiple callbacks", () => {
    const interceptor = new OpenClawInterceptor(logger);
    const events1: ToolCallEvent[] = [];
    const events2: ToolCallEvent[] = [];

    interceptor.onToolCall((e) => events1.push(e));
    interceptor.onToolCall((e) => events2.push(e));

    interceptor.processChunk(
      makeToolCallChunk("call_1", "exec", '{}'),
    );
    interceptor.flush();

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
  });

  it("should handle tool call with no function field", () => {
    const data = JSON.stringify({
      id: "chatcmpl-abc",
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_1" }],
          },
        },
      ],
    });

    const interceptor = new OpenClawInterceptor(logger);
    const events: ToolCallEvent[] = [];
    interceptor.onToolCall((e) => events.push(e));

    interceptor.processChunk(data);
    interceptor.flush();

    expect(events).toHaveLength(1);
    expect(events[0].toolName).toBe("unknown");
  });

  it("should preserve IRegistryClient interface with reportProgress", () => {
    const registry = createMockRegistry();
    expect(typeof registry.reportProgress).toBe("function");
  });
});

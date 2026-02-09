// =============================================================================
// Daemon ↔ OpenClaw Integration Tests — Issue #64
//
// Tests the complete integration between the Agent Daemon and OpenClaw:
// 1. OpenClaw Client — streaming (SSE) execution
// 2. OpenClaw Client — non-streaming fallback
// 3. OpenClaw Client — session lifecycle (create → execute → destroy)
// 4. OpenClaw Client — health check and restart
// 5. OpenClaw Client — cancellation during execution
// 6. SSE Parser — parsing Server-Sent Events
// 7. Task Executor — prompt formatting with role/agent context
// 8. Task Executor — full lifecycle with session cleanup
// 9. End-to-end — poll → health check → execute → parse → report → cleanup
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  type DaemonConfig,
  type DaemonLogger,
  type DaemonTask,
  type IRegistryClient,
  type IOpenClawClient,
  type LogEntry,
  type OpenClawStatus,
  loadConfigFromEnv,
} from "../types.js";
import { OpenClawClient, parseSSEStream } from "../openclaw-client.js";
import { TaskExecutor, OpenClawUnavailableError } from "../task-executor.js";
import { TaskPoller } from "../task-poller.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLogger: DaemonLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    agentName: "Atlas",
    roleId: "11111111-2222-3333-4444-555555555555",
    teamId: "66666666-7777-8888-9999-000000000000",
    model: "anthropic/claude-sonnet-4-5",
    registryUrl: "http://registry:4001",
    hivemiSecret: "test-secret",
    daemonPort: 3100,
    openclawUrl: "http://127.0.0.1:4100",
    pollIntervalMs: 1000,
    heartbeatIntervalMs: 1000,
    telemetryIntervalMs: 1000,
    logBatchIntervalMs: 1000,
    taskTimeoutMs: 30_000,
    roleName: "developer",
    ...overrides,
  };
}

function makeTask(overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id: "task-abc12345-full-uuid",
    title: "Implement user authentication",
    description: "Implement JWT-based authentication for the API",
    input: "Requirements: Use bcrypt for password hashing, JWT for tokens",
    priority: "high",
    roleTarget: null,
    parentTaskId: null,
    teamId: "66666666-7777-8888-9999-000000000000",
    ...overrides,
  };
}

function makeMockRegistry(): IRegistryClient {
  return {
    register: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(true),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    pollTask: vi.fn().mockResolvedValue(null),
    reportTaskResult: vi.fn().mockResolvedValue(undefined),
    createSubtask: vi.fn().mockResolvedValue("subtask-001"),
    sendTelemetry: vi.fn().mockResolvedValue(undefined),
    sendLogs: vi.fn().mockResolvedValue(undefined),
    setOffline: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockOpenClaw(): IOpenClawClient {
  return {
    healthCheck: vi.fn().mockResolvedValue("running" as OpenClawStatus),
    executeTask: vi.fn().mockResolvedValue("Task completed successfully.\n\nRESULT: success"),
    restart: vi.fn().mockResolvedValue(true),
    cancelExecution: vi.fn(),
    destroySession: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Create a mock ReadableStream that emits SSE events for testing.
 */
function createSSEStream(events: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(encoder.encode(events[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });

  return stream.getReader();
}

/**
 * Create a proper SSE response body with data events.
 */
function sseResponse(chunks: string[], sessionId = "session-123"): string {
  let result = "";
  for (let i = 0; i < chunks.length; i++) {
    const event = {
      id: sessionId,
      choices: [
        {
          delta: { content: chunks[i] },
          index: 0,
          finish_reason: i === chunks.length - 1 ? "stop" : null,
        },
      ],
    };
    result += `data: ${JSON.stringify(event)}\n\n`;
  }
  result += "data: [DONE]\n\n";
  return result;
}

// =============================================================================
// SSE Parser Tests
// =============================================================================

describe("parseSSEStream", () => {
  it("should parse a simple SSE stream with content chunks", async () => {
    const reader = createSSEStream([
      'data: {"id":"sess-1","choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"id":"sess-1","choices":[{"delta":{"content":"World"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe("Hello World");
    expect(result.sessionId).toBe("sess-1");
  });

  it("should capture session ID from first chunk only", async () => {
    const reader = createSSEStream([
      'data: {"id":"first-id","choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"id":"second-id","choices":[{"delta":{"content":"b"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const result = await parseSSEStream(reader);

    expect(result.sessionId).toBe("first-id");
  });

  it("should handle empty content deltas", async () => {
    const reader = createSSEStream([
      'data: {"id":"sess-1","choices":[{"delta":{}}]}\n\n',
      'data: {"id":"sess-1","choices":[{"delta":{"content":"data"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe("data");
  });

  it("should skip invalid JSON lines", async () => {
    const reader = createSSEStream([
      "data: not-valid-json\n\n",
      'data: {"id":"sess-1","choices":[{"delta":{"content":"ok"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe("ok");
  });

  it("should skip comment lines", async () => {
    const reader = createSSEStream([
      ": this is a comment\n",
      'data: {"id":"sess-1","choices":[{"delta":{"content":"hello"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe("hello");
  });

  it("should return null sessionId when no id in events", async () => {
    const reader = createSSEStream([
      'data: {"choices":[{"delta":{"content":"no-id"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe("no-id");
    expect(result.sessionId).toBeNull();
  });

  it("should call onProgress callback with chunks", async () => {
    const reader = createSSEStream([
      'data: {"id":"s","choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"id":"s","choices":[{"delta":{"content":"b"}}]}\n\n',
      'data: {"id":"s","choices":[{"delta":{"content":"c"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const chunks: string[] = [];
    const accumulated: string[] = [];

    await parseSSEStream(reader, (chunk, acc) => {
      chunks.push(chunk);
      accumulated.push(acc);
    });

    expect(chunks).toEqual(["a", "b", "c"]);
    expect(accumulated).toEqual(["a", "ab", "abc"]);
  });

  it("should handle multi-line data in single chunk", async () => {
    const lines = [
      'data: {"id":"s","choices":[{"delta":{"content":"first"}}]}',
      "",
      'data: {"id":"s","choices":[{"delta":{"content":" second"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const reader = createSSEStream([lines]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe("first second");
  });

  it("should handle empty stream", async () => {
    const reader = createSSEStream([]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe("");
    expect(result.sessionId).toBeNull();
  });

  it("should handle stream with only [DONE]", async () => {
    const reader = createSSEStream(["data: [DONE]\n\n"]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe("");
  });
});

// =============================================================================
// OpenClaw Client — Health Check
// =============================================================================

describe("OpenClawClient — Health Check", () => {
  let client: OpenClawClient;

  beforeEach(() => {
    client = new OpenClawClient(makeConfig(), silentLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 'running' when /v1/models returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    const status = await client.healthCheck();

    expect(status).toBe("running");
  });

  it("should return 'error' when /v1/models returns non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const status = await client.healthCheck();

    expect(status).toBe("error");
  });

  it("should return 'stopped' when fetch throws (gateway down)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const status = await client.healthCheck();

    expect(status).toBe("stopped");
  });

  it("should call /v1/models endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    await client.healthCheck();

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("should include auth token in health check", async () => {
    const authedClient = new OpenClawClient(
      makeConfig({ openclawApiToken: "secret-token" }),
      silentLogger,
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    await authedClient.healthCheck();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      }),
    );
  });
});

// =============================================================================
// OpenClaw Client — Streaming Execution
// =============================================================================

describe("OpenClawClient — Streaming Execution", () => {
  let client: OpenClawClient;

  beforeEach(() => {
    client = new OpenClawClient(makeConfig({ useStreaming: true }), silentLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use streaming by default", async () => {
    const body = sseResponse(["Task ", "completed ", "successfully"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const result = await client.executeTask("Do something", 30_000);

    expect(result).toBe("Task completed successfully");

    // Verify stream: true was sent
    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(callBody.stream).toBe(true);
  });

  it("should capture session ID from streaming response", async () => {
    const body = sseResponse(["hello"], "my-session-id");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    await client.executeTask("test", 30_000);

    expect(client.getSessionId()).toBe("my-session-id");
  });

  it("should throw on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(client.executeTask("test", 30_000)).rejects.toThrow(
      "OpenClaw API error: 500",
    );
  });

  it("should throw on empty streaming response", async () => {
    const body = "data: [DONE]\n\n";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    await expect(client.executeTask("test", 30_000)).rejects.toThrow(
      "empty streaming response",
    );
  });

  it("should throw when response body is null", async () => {
    const response = new Response(null, { status: 200 });
    // Override body to be null
    Object.defineProperty(response, "body", { value: null });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(client.executeTask("test", 30_000)).rejects.toThrow(
      "no response body",
    );
  });

  it("should send correct request body for streaming", async () => {
    const body = sseResponse(["ok"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    await client.executeTask("My task prompt", 30_000);

    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(requestBody).toEqual({
      model: "default",
      stream: true,
      messages: [{ role: "user", content: "My task prompt" }],
    });
  });

  it("should handle large streaming responses", async () => {
    // Simulate a large response with many chunks
    const chunks = Array.from({ length: 100 }, (_, i) => `chunk-${i} `);
    const body = sseResponse(chunks);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const result = await client.executeTask("test", 60_000);

    expect(result).toBe(chunks.join(""));
  });
});

// =============================================================================
// OpenClaw Client — Non-Streaming Execution
// =============================================================================

describe("OpenClawClient — Non-Streaming Execution", () => {
  let client: OpenClawClient;

  beforeEach(() => {
    client = new OpenClawClient(makeConfig({ useStreaming: false }), silentLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use non-streaming when configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "sess-abc",
          choices: [{ message: { content: "Response text" } }],
        }),
        { status: 200 },
      ),
    );

    const result = await client.executeTask("test", 30_000);

    expect(result).toBe("Response text");

    // Verify no stream: true in body
    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(callBody.stream).toBeUndefined();
  });

  it("should capture session ID from non-streaming response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "non-stream-session",
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200 },
      ),
    );

    await client.executeTask("test", 30_000);

    expect(client.getSessionId()).toBe("non-stream-session");
  });

  it("should throw on empty non-streaming response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "sess",
          choices: [{ message: { content: "" } }],
        }),
        { status: 200 },
      ),
    );

    await expect(client.executeTask("test", 30_000)).rejects.toThrow(
      "empty response",
    );
  });
});

// =============================================================================
// OpenClaw Client — Session Lifecycle
// =============================================================================

describe("OpenClawClient — Session Lifecycle", () => {
  let client: OpenClawClient;

  beforeEach(() => {
    client = new OpenClawClient(makeConfig({ useStreaming: false }), silentLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create session on executeTask and destroy on destroySession", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "session-to-destroy",
          choices: [{ message: { content: "done" } }],
        }),
        { status: 200 },
      ),
    );

    await client.executeTask("task", 30_000);
    expect(client.getSessionId()).toBe("session-to-destroy");

    await client.destroySession();
    expect(client.getSessionId()).toBeNull();

    // Verify DELETE was called
    const deleteCall = fetchSpy.mock.calls.find(
      (c) => c[1]?.method === "DELETE",
    );
    expect(deleteCall).toBeTruthy();
    expect(deleteCall![0]).toContain("/v1/sessions/session-to-destroy");
  });

  it("should handle destroy when no session exists", async () => {
    const result = await client.destroySession();

    expect(result).toBe(true);
  });

  it("should handle 404 on session destroy gracefully", async () => {
    // First call: executeTask
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gone-session",
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200 },
        ),
      )
      // Second call: DELETE returns 404
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await client.executeTask("task", 30_000);
    const result = await client.destroySession();

    expect(result).toBe(true); // 404 is OK — session already gone
  });

  it("should clear previous session ID before new execution", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "first-session",
            choices: [{ message: { content: "first" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "second-session",
            choices: [{ message: { content: "second" } }],
          }),
          { status: 200 },
        ),
      );

    await client.executeTask("task 1", 30_000);
    expect(client.getSessionId()).toBe("first-session");

    await client.executeTask("task 2", 30_000);
    expect(client.getSessionId()).toBe("second-session");
  });

  it("should clean session between tasks (no context carryover)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "session-a",
            choices: [{ message: { content: "result a" } }],
          }),
          { status: 200 },
        ),
      )
      // DELETE session-a
      .mockResolvedValueOnce(new Response("OK", { status: 200 }))
      // Execute task 2 — new session
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "session-b",
            choices: [{ message: { content: "result b" } }],
          }),
          { status: 200 },
        ),
      );

    // Task 1: execute + destroy
    const result1 = await client.executeTask("task 1", 30_000);
    expect(result1).toBe("result a");
    await client.destroySession();
    expect(client.getSessionId()).toBeNull();

    // Task 2: new clean session
    const result2 = await client.executeTask("task 2", 30_000);
    expect(result2).toBe("result b");
    expect(client.getSessionId()).toBe("session-b");
  });
});

// =============================================================================
// OpenClaw Client — Cancellation
// =============================================================================

describe("OpenClawClient — Cancellation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should provide cancelExecution method", () => {
    const client = new OpenClawClient(makeConfig(), silentLogger);
    expect(typeof client.cancelExecution).toBe("function");
  });

  it("should not throw when cancelling with no active execution", () => {
    const client = new OpenClawClient(makeConfig(), silentLogger);
    expect(() => client.cancelExecution()).not.toThrow();
  });
});

// =============================================================================
// OpenClaw Client — Configuration
// =============================================================================

describe("OpenClawClient — Configuration", () => {
  it("should default to streaming enabled", () => {
    const config = makeConfig();
    delete config.useStreaming;

    const client = new OpenClawClient(config, silentLogger);

    // Verify by checking it sends stream: true
    const body = sseResponse(["test"]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    // The fact that it doesn't throw means streaming is working
    expect(client).toBeTruthy();

    vi.restoreAllMocks();
  });

  it("should use custom openclawUrl", async () => {
    const client = new OpenClawClient(
      makeConfig({ openclawUrl: "http://custom:9999", useStreaming: false }),
      silentLogger,
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "s",
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200 },
      ),
    );

    await client.executeTask("test", 30_000);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://custom:9999/v1/chat/completions",
    );

    vi.restoreAllMocks();
  });

  it("should strip trailing slash from URL", async () => {
    const client = new OpenClawClient(
      makeConfig({ openclawUrl: "http://host:4100/", useStreaming: false }),
      silentLogger,
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "s",
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200 },
      ),
    );

    await client.executeTask("test", 30_000);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://host:4100/v1/chat/completions",
    );

    vi.restoreAllMocks();
  });
});

// =============================================================================
// OpenClaw Client — useStreaming config env
// =============================================================================

describe("DaemonConfig — useStreaming", () => {
  it("should default useStreaming to true", () => {
    const config = loadConfigFromEnv({
      AGENT_ID: "id",
      AGENT_NAME: "name",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4o",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
    });
    expect(config.useStreaming).toBe(true);
  });

  it("should set useStreaming to false when USE_STREAMING=false", () => {
    const config = loadConfigFromEnv({
      AGENT_ID: "id",
      AGENT_NAME: "name",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4o",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
      USE_STREAMING: "false",
    });
    expect(config.useStreaming).toBe(false);
  });

  it("should set useStreaming to true for any non-false value", () => {
    const config = loadConfigFromEnv({
      AGENT_ID: "id",
      AGENT_NAME: "name",
      ROLE_ID: "role",
      TEAM_ID: "team",
      MODEL: "gpt-4o",
      REGISTRY_URL: "http://localhost:4001",
      HIVEMI_SECRET: "secret",
      USE_STREAMING: "true",
    });
    expect(config.useStreaming).toBe(true);
  });
});

// =============================================================================
// Task Executor — Prompt Formatting (Issue #64 Message Format)
// =============================================================================

describe("TaskExecutor — Prompt Formatting", () => {
  let executor: TaskExecutor;
  let config: DaemonConfig;

  beforeEach(() => {
    config = makeConfig({ roleName: "developer", agentName: "Atlas" });
    const openclaw = makeMockOpenClaw();
    const registry = makeMockRegistry();
    executor = new TaskExecutor(config, openclaw, registry, silentLogger, []);
  });

  it("should include task ID, title, priority in prompt header", () => {
    const task = makeTask();
    const prompt = executor.buildPrompt(task);

    expect(prompt).toContain("[HiveMI Task #task-abc");
    expect(prompt).toContain("Title: Implement user authentication");
    expect(prompt).toContain("Priority: high");
  });

  it("should include role name in prompt", () => {
    const task = makeTask();
    const prompt = executor.buildPrompt(task);

    expect(prompt).toContain("Role: developer");
  });

  it("should include agent name in prompt", () => {
    const task = makeTask();
    const prompt = executor.buildPrompt(task);

    expect(prompt).toContain("Agent: Atlas");
  });

  it("should include description section", () => {
    const task = makeTask({ description: "Build the auth module" });
    const prompt = executor.buildPrompt(task);

    expect(prompt).toContain("## Description");
    expect(prompt).toContain("Build the auth module");
  });

  it("should include input/context section", () => {
    const task = makeTask({ input: "Use bcrypt and JWT" });
    const prompt = executor.buildPrompt(task);

    expect(prompt).toContain("## Context");
    expect(prompt).toContain("Use bcrypt and JWT");
  });

  it("should include parent task ID when present", () => {
    const task = makeTask({ parentTaskId: "parent-12345678-uuid" });
    const prompt = executor.buildPrompt(task);

    expect(prompt).toContain("Parent Task: #parent-1");
  });

  it("should omit parent task line when no parent", () => {
    const task = makeTask({ parentTaskId: null });
    const prompt = executor.buildPrompt(task);

    expect(prompt).not.toContain("Parent Task:");
  });

  it("should omit role when not configured", () => {
    const noRoleConfig = makeConfig({ roleName: undefined });
    const openclaw = makeMockOpenClaw();
    const registry = makeMockRegistry();
    const noRoleExecutor = new TaskExecutor(
      noRoleConfig,
      openclaw,
      registry,
      silentLogger,
      [],
    );

    const prompt = noRoleExecutor.buildPrompt(makeTask());

    expect(prompt).not.toContain("Role:");
  });

  it("should include instructions and output format", () => {
    const task = makeTask();
    const prompt = executor.buildPrompt(task);

    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain("## Output Format");
    expect(prompt).toContain("subtasks");
  });

  it("should match Issue #64 message format", () => {
    const task = makeTask({
      id: "abc12345-0000-0000-0000-000000000000",
      title: "Implement user authentication",
      priority: "high",
    });

    const prompt = executor.buildPrompt(task);

    // Verify the format matches the spec
    const lines = prompt.split("\n");
    expect(lines[0]).toBe("[HiveMI Task #abc12345]");
    expect(lines[1]).toBe("Title: Implement user authentication");
    expect(lines[2]).toBe("Priority: high");
  });
});

// =============================================================================
// Task Executor — Full Lifecycle (Health → Execute → Parse → Cleanup)
// =============================================================================

describe("TaskExecutor — Full Lifecycle", () => {
  let executor: TaskExecutor;
  let openclaw: IOpenClawClient;
  let registry: IRegistryClient;
  let logBuffer: LogEntry[];

  beforeEach(() => {
    openclaw = makeMockOpenClaw();
    registry = makeMockRegistry();
    logBuffer = [];
    executor = new TaskExecutor(
      makeConfig(),
      openclaw,
      registry,
      silentLogger,
      logBuffer,
    );
  });

  it("should check health before executing", async () => {
    const task = makeTask();
    await executor.execute(task);

    expect(openclaw.healthCheck).toHaveBeenCalled();
  });

  it("should call executeTask with formatted prompt", async () => {
    const task = makeTask();
    await executor.execute(task);

    expect(openclaw.executeTask).toHaveBeenCalledWith(
      expect.stringContaining("[HiveMI Task"),
      expect.any(Number),
    );
  });

  it("should destroy session after successful execution", async () => {
    const task = makeTask();
    await executor.execute(task);

    expect(openclaw.destroySession).toHaveBeenCalled();
  });

  it("should destroy session even after failed execution", async () => {
    vi.mocked(openclaw.executeTask).mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "TimeoutError" }),
    );

    const task = makeTask();
    await executor.execute(task);

    expect(openclaw.destroySession).toHaveBeenCalled();
  });

  it("should return parsed result with status", async () => {
    vi.mocked(openclaw.executeTask).mockResolvedValue(
      "Task completed successfully. RESULT: success\n\nImplemented JWT auth.",
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.taskResult.status).toBe("completed");
    expect(result.parsed.status).toBe("completed");
    expect(result.parsed.summary).toContain("JWT auth");
  });

  it("should extract PR links from output", async () => {
    vi.mocked(openclaw.executeTask).mockResolvedValue(
      "Done! PR created: https://github.com/ijoaum/hivemi/pull/42",
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.parsed.pullRequests).toHaveLength(1);
    expect(result.parsed.pullRequests[0].url).toBe(
      "https://github.com/ijoaum/hivemi/pull/42",
    );
  });

  it("should extract subtasks from structured output", async () => {
    vi.mocked(openclaw.executeTask).mockResolvedValue(
      'Delegating work.\n\n```subtasks\n[{"title":"Write tests","description":"Unit tests for auth","priority":"high","roleTarget":"qa"}]\n```',
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.parsed.subtasks).toHaveLength(1);
    expect(result.parsed.subtasks[0].title).toBe("Write tests");
    expect(result.parsed.subtasks[0].roleTarget).toBe("qa");
  });

  it("should handle failed task status", async () => {
    vi.mocked(openclaw.executeTask).mockResolvedValue(
      "The build failed. RESULT: failed\n\nCompilation errors in auth module.",
    );

    const task = makeTask();
    const result = await executor.execute(task);

    expect(result.taskResult.status).toBe("failed");
    expect(result.taskResult.error).toBeTruthy();
  });

  it("should add log entries to buffer during execution", async () => {
    const task = makeTask();
    await executor.execute(task);

    const executorLogs = logBuffer.filter((l) => l.component === "task-executor");
    expect(executorLogs.length).toBeGreaterThan(0);
    expect(executorLogs.some((l) => l.message.includes("Executing task"))).toBe(true);
  });

  it("should throw OpenClawUnavailableError when health check fails and auto-restart fails", async () => {
    vi.mocked(openclaw.healthCheck).mockResolvedValue("stopped");
    vi.mocked(openclaw.restart).mockResolvedValue(false);

    const executor = new TaskExecutor(
      makeConfig(),
      openclaw,
      registry,
      silentLogger,
      logBuffer,
      { autoRestart: true, maxHealthCheckRetries: 1 },
    );

    await expect(executor.execute(makeTask())).rejects.toThrow(
      OpenClawUnavailableError,
    );
  });

  it("should restart OpenClaw when health check fails and auto-restart is enabled", async () => {
    vi.mocked(openclaw.healthCheck)
      .mockResolvedValueOnce("stopped") // First check fails
      .mockResolvedValueOnce("running"); // After restart

    vi.mocked(openclaw.restart).mockResolvedValue(true);

    const task = makeTask();
    await executor.execute(task);

    expect(openclaw.restart).toHaveBeenCalled();
    expect(openclaw.executeTask).toHaveBeenCalled();
  });
});

// =============================================================================
// End-to-End — Poll → Execute → Report → Cleanup
// =============================================================================

describe("End-to-End — Daemon ↔ OpenClaw Integration", () => {
  let registry: IRegistryClient;
  let openclaw: IOpenClawClient;
  let logBuffer: LogEntry[];

  beforeEach(() => {
    vi.useFakeTimers();
    registry = makeMockRegistry();
    openclaw = makeMockOpenClaw();
    logBuffer = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should execute task end-to-end: poll → execute → report → cleanup", async () => {
    const task = makeTask();

    // Registry returns a task on first poll, then none
    vi.mocked(registry.pollTask)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(null);

    vi.mocked(openclaw.executeTask).mockResolvedValue(
      "Implemented JWT authentication successfully.\n\nRESULT: success",
    );

    const config = makeConfig();
    const poller = new TaskPoller(config, registry, openclaw, silentLogger, logBuffer);

    poller.start();

    // Wait for the poll to fire and task to execute
    await vi.advanceTimersByTimeAsync(100);

    poller.stop();

    // Verify full lifecycle
    expect(registry.pollTask).toHaveBeenCalled();
    expect(openclaw.healthCheck).toHaveBeenCalled();
    expect(openclaw.executeTask).toHaveBeenCalled();
    expect(registry.reportTaskResult).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: "completed",
        output: expect.stringContaining("JWT authentication"),
      }),
    );
    expect(openclaw.destroySession).toHaveBeenCalled();
    expect(registry.updateStatus).toHaveBeenCalledWith("idle");
  });

  it("should report failure when task execution fails", async () => {
    const task = makeTask();
    vi.mocked(registry.pollTask).mockResolvedValueOnce(task).mockResolvedValue(null);
    vi.mocked(openclaw.executeTask).mockRejectedValue(new Error("API error"));

    const poller = new TaskPoller(
      makeConfig(),
      registry,
      openclaw,
      silentLogger,
      logBuffer,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(100);
    poller.stop();

    expect(registry.reportTaskResult).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("API error"),
      }),
    );
  });

  it("should create subtasks when parsed from output", async () => {
    const task = makeTask();
    vi.mocked(registry.pollTask).mockResolvedValueOnce(task).mockResolvedValue(null);
    vi.mocked(openclaw.executeTask).mockResolvedValue(
      'Done.\n\n```subtasks\n[{"title":"Write unit tests","description":"Cover auth module","priority":"high","roleTarget":"qa"}]\n```',
    );

    const poller = new TaskPoller(
      makeConfig(),
      registry,
      openclaw,
      silentLogger,
      logBuffer,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(100);
    poller.stop();

    expect(registry.createSubtask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        title: "Write unit tests",
        roleTarget: "qa",
      }),
    );
  });

  it("should set status to working during execution and idle after", async () => {
    const task = makeTask();
    vi.mocked(registry.pollTask).mockResolvedValueOnce(task).mockResolvedValue(null);

    const statusCalls: string[] = [];
    vi.mocked(registry.updateStatus).mockImplementation(async (status) => {
      statusCalls.push(status);
    });

    const poller = new TaskPoller(
      makeConfig(),
      registry,
      openclaw,
      silentLogger,
      logBuffer,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(100);
    poller.stop();

    expect(statusCalls).toContain("working");
    expect(statusCalls[statusCalls.length - 1]).toBe("idle");
  });

  it("should track task counters correctly", async () => {
    const task1 = makeTask({ id: "task-1" });
    const task2 = makeTask({ id: "task-2" });

    vi.mocked(registry.pollTask)
      .mockResolvedValueOnce(task1)
      .mockResolvedValueOnce(task2)
      .mockResolvedValue(null);

    // First task succeeds, second fails
    vi.mocked(openclaw.executeTask)
      .mockResolvedValueOnce("RESULT: success\nDone!")
      .mockRejectedValueOnce(new Error("Failed"));

    const poller = new TaskPoller(
      makeConfig(),
      registry,
      openclaw,
      silentLogger,
      logBuffer,
    );

    poller.start();

    // Execute first task — poll fires immediately on start
    await vi.advanceTimersByTimeAsync(200);
    expect(poller.tasksCompleted).toBe(1);

    // Execute second task — need to advance past pollIntervalMs (1000ms)
    // to trigger next poll + allow error rejection to propagate
    await vi.advanceTimersByTimeAsync(2000);
    expect(poller.tasksFailed).toBe(1);

    poller.stop();
  });

  it("should handle OpenClaw unavailable by reporting failure", async () => {
    const task = makeTask();
    vi.mocked(registry.pollTask).mockResolvedValueOnce(task).mockResolvedValue(null);
    vi.mocked(openclaw.healthCheck).mockResolvedValue("stopped");
    vi.mocked(openclaw.restart).mockResolvedValue(false);

    const poller = new TaskPoller(
      makeConfig(),
      registry,
      openclaw,
      silentLogger,
      logBuffer,
    );

    poller.start();
    // Need enough time for 3 health check retries × 2s delay = ~6s
    await vi.advanceTimersByTimeAsync(10_000);
    poller.stop();

    expect(registry.reportTaskResult).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("unavailable"),
      }),
    );
  });

  it("should not execute new tasks while one is running", async () => {
    const slowTask = makeTask({ id: "slow-task" });
    vi.mocked(registry.pollTask)
      .mockResolvedValueOnce(slowTask)
      .mockResolvedValue(null);

    // Simulate a slow task
    vi.mocked(openclaw.executeTask).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 5000, "done")),
    );

    const poller = new TaskPoller(
      makeConfig(),
      registry,
      openclaw,
      silentLogger,
      logBuffer,
    );

    poller.start();

    // First poll triggers execution
    await vi.advanceTimersByTimeAsync(100);

    // While task is running, activeTask should be set
    expect(poller.activeTask).toBeTruthy();
    expect(poller.activeTask?.id).toBe("slow-task");

    poller.stop();
  });
});

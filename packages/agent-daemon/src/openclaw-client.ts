// =============================================================================
// OpenClaw Client
// Integrates with the local OpenClaw gateway via Chat Completions API.
// Each task execution creates a clean session (no context carryover).
//
// Uses streaming (SSE) to avoid Node.js fetch timeout on long-running tasks.
// Developer tasks can run up to 30 minutes — non-streaming fetch would hit
// Node's internal HTTP response timeout (~5 min). Streaming keeps the
// connection alive with incremental data chunks.
// =============================================================================

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { DaemonConfig, DaemonLogger, IOpenClawClient, OpenClawStatus } from "./types.js";
import { OpenClawInterceptor, type ToolCallCallback } from "./openclaw-interceptor.js";

const execAsync = promisify(execCb);

// ---------------------------------------------------------------------------
// SSE Parser — extracts content from Server-Sent Events stream
// ---------------------------------------------------------------------------

/**
 * Callback invoked for each content chunk received from the SSE stream.
 * Used for progress tracking (e.g., logging partial output).
 */
export type StreamProgressCallback = (chunk: string, accumulated: string) => void;

/**
 * Parse an SSE (Server-Sent Events) stream from OpenClaw Chat Completions API.
 *
 * Each SSE event looks like:
 *   data: {"id":"...","choices":[{"delta":{"content":"chunk"}}]}
 *
 * The stream ends with:
 *   data: [DONE]
 *
 * Returns the concatenated content and the session ID (from the first chunk).
 */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onProgress?: StreamProgressCallback,
): Promise<{ content: string; sessionId: string | null }> {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let sessionId: string | null = null;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    const lines = buffer.split("\n");
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith(":")) continue;

      // Parse data lines
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);

        // End of stream
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            id?: string;
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
          };

          // Capture session ID from first chunk
          if (parsed.id && !sessionId) {
            sessionId = parsed.id;
          }

          // Extract content delta
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            onProgress?.(delta, content);
          }
        } catch {
          // Invalid JSON — skip this line (could be malformed SSE)
        }
      }
    }
  }

  return { content, sessionId };
}

// ---------------------------------------------------------------------------
// OpenClaw Client
// ---------------------------------------------------------------------------

export class OpenClawClient implements IOpenClawClient {
  private readonly baseUrl: string;
  private readonly apiToken?: string;
  private readonly logger: DaemonLogger;
  private lastSessionId: string | null = null;

  /** Whether to use streaming for task execution (default: true) */
  private readonly useStreaming: boolean;

  /** Active AbortController for the current task (used for cancellation) */
  private activeAbortController: AbortController | null = null;

  /** Tool call interceptor for progress reporting (Issue #89) */
  private readonly interceptor: OpenClawInterceptor;

  constructor(config: DaemonConfig, logger: DaemonLogger) {
    this.baseUrl = (config.openclawUrl || "http://127.0.0.1:4100").replace(/\/$/, "");
    this.apiToken = config.openclawApiToken;
    this.logger = logger;
    // Streaming is the default — avoids Node fetch timeout on long tasks
    this.useStreaming = config.useStreaming !== false;
    // Initialize interceptor (Issue #89)
    this.interceptor = new OpenClawInterceptor(logger, {
      enabled: config.progressReportingEnabled !== false,
    });
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiToken) {
      h["Authorization"] = `Bearer ${this.apiToken}`;
    }
    return h;
  }

  /** Get the current session ID (for testing/debugging) */
  getSessionId(): string | null {
    return this.lastSessionId;
  }

  /**
   * Register a callback to be invoked for each tool call detected during
   * streaming execution (Issue #89). The callback receives a ToolCallEvent.
   */
  onToolCall(callback: ToolCallCallback): void {
    this.interceptor.onToolCall(callback);
  }

  /**
   * Get the interceptor instance (for testing/advanced use).
   */
  getInterceptor(): OpenClawInterceptor {
    return this.interceptor;
  }

  // -------------------------------------------------------------------------
  // Health Check — GET /v1/models
  //
  // Checks if the OpenClaw gateway is running and responsive.
  // Returns "running" if OK, "error" if gateway responds with error,
  // "stopped" if gateway is unreachable.
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<OpenClawStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });

      if (res.ok) return "running";
      this.logger.warn(`OpenClaw health check returned ${res.status}`);
      return "error";
    } catch (_err) {
      return "stopped";
    }
  }

  // -------------------------------------------------------------------------
  // Execute Task — POST /v1/chat/completions
  //
  // Each task = one HTTP request = one clean session.
  // The daemon sends the task as a user message, OpenClaw processes it
  // with the configured model and tools, and returns the result.
  //
  // Uses streaming (SSE) by default to avoid Node.js fetch timeout.
  // Long tasks (e.g., developer = 30 min) would exceed the default
  // ~5 min response timeout of Node's HTTP layer. With streaming,
  // the connection stays alive as OpenClaw sends incremental chunks.
  // -------------------------------------------------------------------------

  async executeTask(prompt: string, timeoutMs: number): Promise<string> {
    this.logger.info("Sending task to OpenClaw Chat Completions API", {
      streaming: this.useStreaming,
      timeoutMs,
    });

    // Clear any previous session ID
    this.lastSessionId = null;

    if (this.useStreaming) {
      return this.executeTaskStreaming(prompt, timeoutMs);
    }

    return this.executeTaskNonStreaming(prompt, timeoutMs);
  }

  // -------------------------------------------------------------------------
  // Streaming execution — SSE-based
  //
  // Sends `stream: true` to Chat Completions API and parses the SSE response.
  // This keeps the HTTP connection alive with incremental data, preventing
  // Node.js from timing out on long-running tasks.
  // -------------------------------------------------------------------------

  private async executeTaskStreaming(prompt: string, timeoutMs: number): Promise<string> {
    const body = {
      model: "default",
      stream: true,
      messages: [
        {
          role: "user" as const,
          content: prompt,
        },
      ],
    };

    // Create an AbortController with timeout
    const controller = new AbortController();
    this.activeAbortController = controller;
    const timeoutId = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

    // Reset interceptor state for new task
    this.interceptor.reset();

    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenClaw API error: ${res.status} ${text}`);
      }

      if (!res.body) {
        throw new Error("OpenClaw returned no response body for streaming request");
      }

      // Parse the SSE stream with interceptor integration (Issue #89)
      const reader = res.body.getReader();
      let lastProgressLog = Date.now();

      const { content, sessionId } = await this.parseSSEStreamWithInterceptor(
        reader,
        (_chunk, accumulated) => {
          // Log progress every 30 seconds
          const now = Date.now();
          if (now - lastProgressLog >= 30_000) {
            this.logger.debug(`Streaming progress: ${accumulated.length} chars received`);
            lastProgressLog = now;
          }
        },
      );

      // Capture session ID for cleanup
      if (sessionId) {
        this.lastSessionId = sessionId;
      }

      if (!content) {
        throw new Error("OpenClaw returned empty streaming response");
      }

      this.logger.info(`Streaming complete: ${content.length} chars received`, {
        sessionId: sessionId?.substring(0, 8),
      });

      return content;
    } finally {
      clearTimeout(timeoutId);
      this.activeAbortController = null;
    }
  }

  // -------------------------------------------------------------------------
  // SSE Stream parsing with interceptor — Issue #89
  //
  // Replaces the standalone parseSSEStream for streaming execution.
  // Routes each SSE data event through the OpenClawInterceptor to detect
  // tool calls, while still accumulating content for the task result.
  // -------------------------------------------------------------------------

  private async parseSSEStreamWithInterceptor(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onProgress?: StreamProgressCallback,
  ): Promise<{ content: string; sessionId: string | null }> {
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let sessionId: string | null = null;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Flush remaining tool calls at stream end
        this.interceptor.flush();
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith(":")) continue;

        // Parse data lines
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);

          // Process through interceptor (handles [DONE], tool calls, and content)
          const contentDelta = this.interceptor.processChunk(data);

          if (contentDelta) {
            content += contentDelta;
            onProgress?.(contentDelta, content);
          }

          // Extract session ID from raw data (interceptor doesn't track this)
          if (!sessionId && data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data) as { id?: string };
              if (parsed.id) {
                sessionId = parsed.id;
              }
            } catch {
              // Skip invalid JSON for session ID extraction
            }
          }
        }
      }
    }

    return { content, sessionId };
  }

  // -------------------------------------------------------------------------
  // Non-streaming execution — single JSON response
  //
  // Simpler but susceptible to Node.js fetch timeout on long tasks.
  // Used as fallback when streaming is disabled.
  // -------------------------------------------------------------------------

  private async executeTaskNonStreaming(prompt: string, timeoutMs: number): Promise<string> {
    const body = {
      model: "default",
      messages: [
        {
          role: "user" as const,
          content: prompt,
        },
      ],
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenClaw API error: ${res.status} ${text}`);
    }

    const json = await res.json() as {
      id?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };

    // Capture session ID for cleanup
    if (json.id) {
      this.lastSessionId = json.id;
    }

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenClaw returned empty response");
    }

    return content;
  }

  // -------------------------------------------------------------------------
  // Cancel — abort the current task execution
  //
  // Used during graceful shutdown to cancel a long-running task.
  // The TaskExecutor handles the AbortError and marks the task as failed.
  // -------------------------------------------------------------------------

  cancelExecution(): void {
    if (this.activeAbortController) {
      this.logger.info("Cancelling active task execution");
      this.activeAbortController.abort(new Error("cancelled"));
      this.activeAbortController = null;
    }
  }

  // -------------------------------------------------------------------------
  // Restart — try `openclaw gateway restart`
  // -------------------------------------------------------------------------

  async restart(): Promise<boolean> {
    this.logger.warn("Attempting to restart OpenClaw gateway");

    try {
      const { stderr } = await execAsync("openclaw gateway restart", {
        timeout: 30_000,
      });

      if (stderr && stderr.includes("error")) {
        this.logger.error("OpenClaw restart stderr", { stderr });
        return false;
      }

      // Wait for gateway to come back up
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      const status = await this.healthCheck();
      if (status === "running") {
        this.logger.info("OpenClaw gateway restarted successfully");
        return true;
      }

      this.logger.error("OpenClaw gateway did not come back after restart");
      return false;
    } catch (err) {
      this.logger.error("Failed to restart OpenClaw", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Destroy Session — clean up after task execution
  //
  // Each task creates a clean session via Chat Completions. After the task
  // completes (success or failure), we destroy the session to free resources
  // and prevent context carryover between tasks.
  // -------------------------------------------------------------------------

  async destroySession(): Promise<boolean> {
    if (!this.lastSessionId) {
      this.logger.debug("No session to destroy");
      return true;
    }

    const sessionId = this.lastSessionId;
    this.lastSessionId = null;

    try {
      const res = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}`, {
        method: "DELETE",
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok || res.status === 404) {
        this.logger.debug("Session destroyed", { sessionId });
        return true;
      }

      this.logger.warn(`Failed to destroy session: ${res.status}`, { sessionId });
      return false;
    } catch (err) {
      this.logger.warn("Session cleanup failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}

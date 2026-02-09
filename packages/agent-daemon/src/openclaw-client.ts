// =============================================================================
// OpenClaw Client
// Integrates with the local OpenClaw gateway via Chat Completions API.
// Each task execution creates a clean session (no context carryover).
// =============================================================================

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { DaemonConfig, DaemonLogger, IOpenClawClient, OpenClawStatus } from "./types.js";

const execAsync = promisify(execCb);

export class OpenClawClient implements IOpenClawClient {
  private readonly baseUrl: string;
  private readonly apiToken?: string;
  private readonly logger: DaemonLogger;
  private lastSessionId: string | null = null;

  constructor(config: DaemonConfig, logger: DaemonLogger) {
    this.baseUrl = (config.openclawUrl || "http://127.0.0.1:4100").replace(/\/$/, "");
    this.apiToken = config.openclawApiToken;
    this.logger = logger;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiToken) {
      h["Authorization"] = `Bearer ${this.apiToken}`;
    }
    return h;
  }

  // -------------------------------------------------------------------------
  // Health Check — GET /health or /v1/models
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
  // -------------------------------------------------------------------------

  async executeTask(prompt: string, timeoutMs: number): Promise<string> {
    this.logger.info("Sending task to OpenClaw Chat Completions API");

    // Clear any previous session ID
    this.lastSessionId = null;

    const body = {
      model: "default",
      messages: [
        {
          role: "user" as const,
          content: prompt,
        },
      ],
      // Let OpenClaw use its configured defaults for max_tokens, temperature, etc.
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

    // Capture session ID for cleanup (Chat Completions returns it as `id`)
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

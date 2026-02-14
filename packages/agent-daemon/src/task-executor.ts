// =============================================================================
// Task Executor
// Orchestrates the full task execution lifecycle:
// 1. Health check — verify OpenClaw is running (restart if needed)
// 2. Build prompt — format task as a message for OpenClaw
// 3. Execute — send to OpenClaw Chat Completions API
// 4. Parse output — extract structured results (text, PRs, subtasks, status)
// 5. Report — send result to registry
//
// This module owns the "how" of task execution. The TaskPoller owns the
// "when" (polling loop, concurrency control).
// =============================================================================

import type {
  DaemonConfig,
  DaemonLogger,
  DaemonTask,
  IOpenClawClient,
  IRegistryClient,
  LogEntry,
  TaskArtifact,
  TaskResult,
} from "./types.js";
import { getEffectiveTimeout } from "./types.js";
import { parseTaskOutput, type ParsedOutput } from "./output-parser.js";
import { ProgressReporter } from "./progress-reporter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskExecutionResult {
  /** Result reported to registry */
  taskResult: TaskResult;
  /** Parsed structured output */
  parsed: ParsedOutput;
  /** Elapsed time in ms */
  elapsedMs: number;
}

export interface TaskExecutorConfig {
  /** Max consecutive OpenClaw failures before marking agent as error */
  maxHealthCheckRetries: number;
  /** Delay between health check retries (ms) */
  healthCheckRetryDelayMs: number;
  /** Whether to attempt OpenClaw restart on failure */
  autoRestart: boolean;
}

const DEFAULT_EXECUTOR_CONFIG: TaskExecutorConfig = {
  maxHealthCheckRetries: 3,
  healthCheckRetryDelayMs: 2_000,
  autoRestart: true,
};

// ---------------------------------------------------------------------------
// Task Executor
// ---------------------------------------------------------------------------

export class TaskExecutor {
  private readonly config: DaemonConfig;
  private readonly executorConfig: TaskExecutorConfig;
  private readonly openclaw: IOpenClawClient;
  private readonly logger: DaemonLogger;
  private readonly logBuffer: LogEntry[];
  private readonly progressReporter: ProgressReporter;

  constructor(
    config: DaemonConfig,
    openclaw: IOpenClawClient,
    registry: IRegistryClient,
    logger: DaemonLogger,
    logBuffer: LogEntry[],
    executorConfig: Partial<TaskExecutorConfig> = {},
  ) {
    this.config = config;
    this.executorConfig = { ...DEFAULT_EXECUTOR_CONFIG, ...executorConfig };
    this.openclaw = openclaw;
    this.logger = logger;
    this.logBuffer = logBuffer;

    // Issue #89: Initialize progress reporter
    this.progressReporter = new ProgressReporter(registry, logger, {
      enabled: config.progressReportingEnabled !== false,
      debounceMs: config.progressDebounceMs ?? 2_000,
    });

    // Wire up tool call interception if the OpenClaw client supports it
    if (typeof (openclaw as any).onToolCall === "function") {
      (openclaw as any).onToolCall((event: any) => {
        this.progressReporter.handleToolCall(event);
      });
    }
  }

  // -------------------------------------------------------------------------
  // Execute — full lifecycle for a single task
  // -------------------------------------------------------------------------

  async execute(task: DaemonTask): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const effectiveTimeout = getEffectiveTimeout(this.config);

    this.logger.info(`Executing task: ${task.title} (timeout: ${effectiveTimeout}ms)`, { taskId: task.id });
    this.addLog("info", `Executing task: ${task.title} (timeout: ${effectiveTimeout}ms, role: ${this.config.roleName || "unknown"})`, task.id, "task-executor");

    // Issue #89: Start progress reporting for this task
    this.progressReporter.startTask(task.id);

    try {
      // 1. Pre-flight health check
      await this.ensureOpenClawHealthy(task.id);

      // 2. Build prompt
      const prompt = this.buildPrompt(task);

      // 3. Execute via OpenClaw with role-based timeout
      this.logger.info("Sending task to OpenClaw", { taskId: task.id });
      const rawOutput = await this.openclaw.executeTask(prompt, effectiveTimeout);

      // 4. Parse output
      const parsed = parseTaskOutput(rawOutput);
      const elapsedMs = Date.now() - startTime;

      this.logger.info(`Task executed in ${elapsedMs}ms — status: ${parsed.status}`, {
        taskId: task.id,
        prCount: parsed.pullRequests.length,
        subtaskCount: parsed.subtasks.length,
      });

      // 5. Build result
      const artifacts: TaskArtifact[] = [...parsed.pullRequests];
      const taskResult: TaskResult = {
        status: parsed.status === "needs-input" ? "failed" : parsed.status,
        output: parsed.summary,
        error: parsed.status === "failed"
          ? this.extractErrorMessage(rawOutput)
          : parsed.status === "needs-input"
            ? "Task requires additional input"
            : null,
        elapsedMs,
        artifacts,
      };

      this.addLog(
        taskResult.status === "completed" ? "info" : "warn",
        `Task ${taskResult.status}: ${task.title} (${elapsedMs}ms)`,
        task.id,
        "task-executor",
      );

      return { taskResult, parsed, elapsedMs };
    } catch (err) {
      const elapsedMs = Date.now() - startTime;

      // Check if this is a timeout error (AbortError from AbortSignal.timeout)
      if (this.isTimeoutError(err)) {
        this.logger.error(`Task execution timed out after ${effectiveTimeout}ms`, { taskId: task.id });
        this.addLog("error", `Task timed out after ${effectiveTimeout}ms (role: ${this.config.roleName || "unknown"})`, task.id, "task-executor");

        const taskResult: TaskResult = {
          status: "failed",
          output: null,
          error: `Execution timeout after ${Math.round(effectiveTimeout / 1000)}s`,
          elapsedMs,
          artifacts: [],
        };

        const parsed: ParsedOutput = {
          summary: "",
          status: "failed",
          pullRequests: [],
          subtasks: [],
          rawOutput: "",
        };

        return { taskResult, parsed, elapsedMs };
      }

      // Re-throw non-timeout errors for TaskPoller to handle
      throw err;
    } finally {
      // 6. Stop progress reporting (flush pending reports)
      try {
        await this.progressReporter.stopTask();
        const metrics = this.progressReporter.getMetrics();
        if (metrics.sent > 0 || metrics.failed > 0) {
          this.logger.debug(`Progress reporting: ${metrics.sent} sent, ${metrics.failed} failed`, { taskId: task.id });
        }
      } catch (progressErr) {
        this.logger.warn("Progress reporter cleanup failed (non-critical)", {
          taskId: task.id,
          error: progressErr instanceof Error ? progressErr.message : String(progressErr),
        });
      }

      // 7. Clean up session after each task (success or failure)
      try {
        await this.openclaw.destroySession();
        this.logger.debug("Session destroyed after task", { taskId: task.id });
      } catch (cleanupErr) {
        this.logger.warn("Session cleanup failed (non-critical)", {
          taskId: task.id,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
    }
  }

  /**
   * Check if an error is a timeout error (from AbortSignal.timeout).
   */
  private isTimeoutError(err: unknown): boolean {
    if (err instanceof Error) {
      // AbortSignal.timeout throws a TimeoutError (DOMException)
      return err.name === "TimeoutError" || err.name === "AbortError";
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Health Check — ensure OpenClaw is running before task execution
  // -------------------------------------------------------------------------

  async ensureOpenClawHealthy(taskId: string): Promise<void> {
    const status = await this.openclaw.healthCheck();

    if (status === "running") {
      return; // All good
    }

    this.logger.warn(`OpenClaw health check: ${status}`, { taskId });
    this.addLog("warn", `OpenClaw not healthy: ${status}`, taskId, "task-executor");

    if (!this.executorConfig.autoRestart) {
      throw new OpenClawUnavailableError(
        `OpenClaw is ${status} and auto-restart is disabled`,
      );
    }

    // Attempt restart with retries
    for (let i = 0; i < this.executorConfig.maxHealthCheckRetries; i++) {
      this.logger.info(
        `Attempting OpenClaw restart (${i + 1}/${this.executorConfig.maxHealthCheckRetries})`,
        { taskId },
      );

      const restarted = await this.openclaw.restart();
      if (restarted) {
        this.logger.info("OpenClaw restarted successfully", { taskId });
        this.addLog("lifecycle", "OpenClaw restarted for task execution", taskId, "task-executor");
        return;
      }

      // Wait before next retry
      if (i < this.executorConfig.maxHealthCheckRetries - 1) {
        await delay(this.executorConfig.healthCheckRetryDelayMs);
      }
    }

    // All retries exhausted
    this.addLog(
      "error",
      `OpenClaw unavailable after ${this.executorConfig.maxHealthCheckRetries} restart attempts`,
      taskId,
      "task-executor",
    );

    throw new OpenClawUnavailableError(
      `OpenClaw unavailable after ${this.executorConfig.maxHealthCheckRetries} restart attempts`,
    );
  }

  // -------------------------------------------------------------------------
  // Build prompt — format task as a message for OpenClaw
  //
  // The daemon translates a HiveMI task into a natural message that
  // OpenClaw processes using the agent's configured model + tools + SOUL.md.
  //
  // Format matches the spec from Issue #64:
  //   [HiveMI Task #abc123]
  //   Title: Implement user authentication
  //   Priority: high
  //   From: PM Agent (Atlas)
  //   ...
  // -------------------------------------------------------------------------

  buildPrompt(task: DaemonTask): string {
    const parts: string[] = [];

    // Header with task metadata (matches Issue #64 message format)
    parts.push(`[HiveMI Task #${task.id.substring(0, 8)}]`);
    parts.push(`Title: ${task.title}`);
    parts.push(`Priority: ${task.priority}`);

    // Include agent role and name for context
    if (this.config.roleName) {
      parts.push(`Role: ${this.config.roleName}`);
    }
    parts.push(`Agent: ${this.config.agentName}`);

    if (task.parentTaskId) {
      parts.push(`Parent Task: #${task.parentTaskId.substring(0, 8)}`);
    }

    parts.push("");

    // Description
    if (task.description) {
      parts.push("## Description");
      parts.push(task.description);
      parts.push("");
    }

    // Input/Context
    if (task.input) {
      parts.push("## Context");
      parts.push(task.input);
      parts.push("");
    }

    // Instructions
    parts.push("## Instructions");
    parts.push("Execute this task completely. When done, clearly report:");
    parts.push("1. What was accomplished (summary)");
    parts.push("2. Any PRs created (include full GitHub URL)");
    parts.push("3. Any subtasks that need to be delegated to other roles");
    parts.push("4. Whether the task succeeded, failed, or needs additional input");
    parts.push("");

    // Output format guidance
    parts.push("## Output Format");
    parts.push("If you need to create subtasks, use this format:");
    parts.push("```subtasks");
    parts.push('[{"title": "Task title", "description": "What to do", "priority": "medium", "roleTarget": "developer"}]');
    parts.push("```");

    return parts.join("\n");
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Extract a concise error message from raw output.
   * Looks for common error patterns in the text.
   */
  private extractErrorMessage(text: string): string {
    // Look for explicit error lines
    const errorLine = text
      .split("\n")
      .find((line) =>
        /\b(?:error|failed|exception|fatal)\b/i.test(line) &&
        line.trim().length > 10,
      );

    if (errorLine) {
      const trimmed = errorLine.trim();
      return trimmed.length > 500 ? trimmed.substring(0, 500) + "..." : trimmed;
    }

    // Fallback: first 200 chars of output
    const trimmed = text.trim();
    return trimmed.length > 200
      ? trimmed.substring(0, 200) + "..."
      : trimmed || "Task failed with no error details";
  }

  private addLog(
    level: "debug" | "info" | "warn" | "error" | "lifecycle",
    message: string,
    taskId: string | null,
    component: string,
  ): void {
    this.logBuffer.push({
      level,
      source: this.config.agentName,
      message,
      agentId: this.config.agentId,
      taskId,
      component,
      metadata: null,
      timestamp: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OpenClawUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

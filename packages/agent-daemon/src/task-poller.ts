// =============================================================================
// Task Poller
// Polls the registry task queue, executes tasks via OpenClaw, reports results.
// =============================================================================

import type {
  DaemonConfig,
  DaemonLogger,
  DaemonTask,
  IOpenClawClient,
  IRegistryClient,
  TaskResult,
} from "./types.js";

export class TaskPoller {
  private readonly config: DaemonConfig;
  private readonly registry: IRegistryClient;
  private readonly openclaw: IOpenClawClient;
  private readonly logger: DaemonLogger;
  private readonly logBuffer: Array<import("./types.js").LogEntry>;

  private timer: ReturnType<typeof setInterval> | null = null;
  private executing = false;
  private _tasksCompleted = 0;
  private _tasksFailed = 0;
  private _activeTask: DaemonTask | null = null;

  constructor(
    config: DaemonConfig,
    registry: IRegistryClient,
    openclaw: IOpenClawClient,
    logger: DaemonLogger,
    logBuffer: Array<import("./types.js").LogEntry>,
  ) {
    this.config = config;
    this.registry = registry;
    this.openclaw = openclaw;
    this.logger = logger;
    this.logBuffer = logBuffer;
  }

  get tasksCompleted(): number {
    return this._tasksCompleted;
  }
  get tasksFailed(): number {
    return this._tasksFailed;
  }
  get activeTask(): DaemonTask | null {
    return this._activeTask;
  }

  // -------------------------------------------------------------------------
  // Start / Stop
  // -------------------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.logger.info(`Task poller starting (interval: ${this.config.pollIntervalMs}ms)`);

    // Poll immediately on start, then on interval
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Task poller stopped");
  }

  // -------------------------------------------------------------------------
  // Poll loop
  // -------------------------------------------------------------------------

  private async poll(): Promise<void> {
    // Don't poll if already executing a task
    if (this.executing) return;

    try {
      const task = await this.registry.pollTask();
      if (!task) return;

      this.logger.info(`Received task: ${task.title}`, { taskId: task.id });
      await this.execute(task);
    } catch (err) {
      this.logger.error("Error polling for tasks", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------

  private async execute(task: DaemonTask): Promise<void> {
    this.executing = true;
    this._activeTask = task;
    const startTime = Date.now();

    try {
      // 1. Update agent status to working
      await this.registry.updateStatus("working");

      // 2. Build prompt from task
      const prompt = this.buildPrompt(task);

      // 3. Execute via OpenClaw
      this.logger.info(`Executing task via OpenClaw`, { taskId: task.id });
      this.addLog("info", `Executing task: ${task.title}`, task.id, "task-poller");

      const output = await this.openclaw.executeTask(prompt, this.config.taskTimeoutMs);

      // 4. Report success
      const elapsedMs = Date.now() - startTime;
      const result: TaskResult = {
        status: "completed",
        output,
        error: null,
        elapsedMs,
        artifacts: [],
      };

      await this.registry.reportTaskResult(task.id, result);
      this._tasksCompleted++;
      this.logger.info(`Task completed in ${elapsedMs}ms`, { taskId: task.id });
      this.addLog("info", `Task completed in ${elapsedMs}ms`, task.id, "task-poller");
    } catch (err) {
      // Report failure
      const elapsedMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      const result: TaskResult = {
        status: "failed",
        output: null,
        error: errorMsg,
        elapsedMs,
        artifacts: [],
      };

      try {
        await this.registry.reportTaskResult(task.id, result);
      } catch (reportErr) {
        this.logger.error("Failed to report task failure", {
          taskId: task.id,
          error: reportErr instanceof Error ? reportErr.message : String(reportErr),
        });
      }

      this._tasksFailed++;
      this.logger.error(`Task failed: ${errorMsg}`, { taskId: task.id });
      this.addLog("error", `Task failed: ${errorMsg}`, task.id, "task-poller");
    } finally {
      this._activeTask = null;
      this.executing = false;

      // 5. Set agent status back to idle
      try {
        await this.registry.updateStatus("idle");
      } catch (_err) {
        this.logger.warn("Failed to set status back to idle");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Build prompt from task
  // -------------------------------------------------------------------------

  private buildPrompt(task: DaemonTask): string {
    const parts: string[] = [];

    parts.push(`# Task: ${task.title}`);
    parts.push("");

    if (task.description) {
      parts.push("## Description");
      parts.push(task.description);
      parts.push("");
    }

    if (task.input) {
      parts.push("## Input");
      parts.push(task.input);
      parts.push("");
    }

    parts.push("## Instructions");
    parts.push("Execute this task completely. Report your results clearly.");
    parts.push("If you encounter errors, describe them in detail.");

    return parts.join("\n");
  }

  // -------------------------------------------------------------------------
  // Log buffer helper
  // -------------------------------------------------------------------------

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

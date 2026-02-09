// =============================================================================
// Task Poller
// Polls the registry task queue, executes tasks via TaskExecutor, reports results.
//
// The poller owns the "when" (polling loop, concurrency control).
// The TaskExecutor owns the "how" (health check, prompt, execution, parsing).
// =============================================================================

import type {
  DaemonConfig,
  DaemonLogger,
  DaemonTask,
  IOpenClawClient,
  IRegistryClient,
  TaskResult,
} from "./types.js";
import { TaskExecutor, OpenClawUnavailableError, type TaskExecutionResult } from "./task-executor.js";

export class TaskPoller {
  private readonly config: DaemonConfig;
  private readonly registry: IRegistryClient;
  private readonly executor: TaskExecutor;
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
    this.logger = logger;
    this.logBuffer = logBuffer;

    // Create the task executor
    this.executor = new TaskExecutor(config, openclaw, registry, logger, logBuffer);
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
      await this.executeTask(task);
    } catch (err) {
      this.logger.error("Error polling for tasks", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Task execution — delegates to TaskExecutor
  // -------------------------------------------------------------------------

  private async executeTask(task: DaemonTask): Promise<void> {
    this.executing = true;
    this._activeTask = task;

    try {
      // 1. Update agent status to working
      await this.registry.updateStatus("working");

      // 2. Execute via TaskExecutor (health check + prompt + execute + parse)
      const result: TaskExecutionResult = await this.executor.execute(task);

      // 3. Report result to registry
      await this.registry.reportTaskResult(task.id, result.taskResult);

      // 4. Create subtasks if any were parsed
      if (result.parsed.subtasks.length > 0) {
        await this.createSubtasks(task, result);
      }

      // 5. Update counters
      if (result.taskResult.status === "completed") {
        this._tasksCompleted++;
      } else {
        this._tasksFailed++;
      }

      this.logger.info(`Task ${result.taskResult.status}: ${task.title}`, {
        taskId: task.id,
        elapsedMs: result.elapsedMs,
      });
    } catch (err) {
      // Handle execution errors
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (err instanceof OpenClawUnavailableError) {
        // OpenClaw is down — return task to queue by reporting failure
        this.logger.error(`OpenClaw unavailable — task returned to queue`, {
          taskId: task.id,
        });
      }

      const result: TaskResult = {
        status: "failed",
        output: null,
        error: errorMsg,
        elapsedMs: 0,
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

      // Set agent status back to idle
      try {
        await this.registry.updateStatus("idle");
      } catch (_err) {
        this.logger.warn("Failed to set status back to idle");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Subtask creation
  // -------------------------------------------------------------------------

  private async createSubtasks(
    parentTask: DaemonTask,
    result: TaskExecutionResult,
  ): Promise<void> {
    for (const subtask of result.parsed.subtasks) {
      try {
        this.logger.info(`Creating subtask: ${subtask.title}`, {
          parentTaskId: parentTask.id,
          roleTarget: subtask.roleTarget,
        });

        // Use the dedicated subtask creation endpoint (POST /api/tasks/:id/subtasks)
        const subtaskId = await this.registry.createSubtask(parentTask.id, {
          title: subtask.title,
          description: subtask.description,
          priority: subtask.priority,
          roleTarget: subtask.roleTarget,
        });

        if (subtaskId) {
          this.addLog(
            "info",
            `Subtask created: ${subtask.title} → ${subtask.roleTarget || "any"} (${subtaskId.substring(0, 8)})`,
            parentTask.id,
            "task-poller",
          );
        } else {
          this.addLog(
            "warn",
            `Subtask creation returned no ID: ${subtask.title}`,
            parentTask.id,
            "task-poller",
          );
        }
      } catch (err) {
        this.logger.warn(`Failed to create subtask: ${subtask.title}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        this.addLog(
          "warn",
          `Failed to create subtask: ${subtask.title} — ${err instanceof Error ? err.message : String(err)}`,
          parentTask.id,
          "task-poller",
        );
      }
    }
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

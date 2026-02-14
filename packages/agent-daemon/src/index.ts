// =============================================================================
// Agent Daemon — Entry Point
//
// Resident process on each agent VM. Responsibilities:
// 1. Register with the HiveMI Registry on startup
// 2. Poll the task queue every 15s and execute via OpenClaw
// 3. Send heartbeat every 30s
// 4. Collect and send telemetry every 60s
// 5. Batch and ship logs every 5 min
// 6. Monitor OpenClaw gateway health
// 7. Graceful shutdown on SIGTERM/SIGINT
// =============================================================================

import { RegistryClient } from "./registry-client.js";
import { OpenClawClient } from "./openclaw-client.js";
import { TaskPoller } from "./task-poller.js";
import { TelemetryCollector } from "./telemetry.js";
import {
  consoleLogger,
  loadConfigFromEnv,
  type DaemonConfig,
  type DaemonLogger,
  type LogEntry,
  type OpenClawStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Daemon class — orchestrates all loops
// ---------------------------------------------------------------------------

export class AgentDaemon {
  private readonly config: DaemonConfig;
  private readonly logger: DaemonLogger;
  private readonly registry: RegistryClient;
  private readonly openclaw: OpenClawClient;
  private readonly taskPoller: TaskPoller;
  private readonly telemetry: TelemetryCollector;

  private readonly logBuffer: LogEntry[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logShipTimer: ReturnType<typeof setInterval> | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Track consecutive OpenClaw failures for restart logic
  private openclawFailures = 0;
  private static readonly MAX_OPENCLAW_FAILURES = 3;

  // Issue #85: Kill timeout constants (SIGTERM → wait → SIGKILL)
  private static readonly CANCEL_KILL_TIMEOUT_MS = 10_000;

  constructor(config: DaemonConfig, logger: DaemonLogger = consoleLogger) {
    this.config = config;
    this.logger = logger;
    this.shutdownTimeoutMs = config.shutdownTimeoutMs ?? 55_000;

    this.registry = new RegistryClient(config, logger);
    this.openclaw = new OpenClawClient(config, logger);

    this.taskPoller = new TaskPoller(
      config,
      this.registry,
      this.openclaw,
      logger,
      this.logBuffer,
    );

    this.telemetry = new TelemetryCollector(
      config,
      this.registry,
      this.openclaw,
      logger,
      () => ({
        completed: this.taskPoller.tasksCompleted,
        failed: this.taskPoller.tasksFailed,
        active: this.taskPoller.activeTask ? 1 : 0,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    this.logger.info("=================================================");
    this.logger.info(`HiveMI Agent Daemon starting`);
    this.logger.info(`Agent: ${this.config.agentName} (${this.config.agentId})`);
    this.logger.info(`Registry: ${this.config.registryUrl}`);
    this.logger.info(`OpenClaw: ${this.config.openclawUrl}`);
    this.logger.info("=================================================");

    this.running = true;

    // 1. Register with registry
    try {
      await this.registry.register();
      this.addLog("lifecycle", "Daemon started and registered");
    } catch (err) {
      this.logger.error("Failed to register with registry", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue anyway — heartbeat will keep trying
      this.addLog("error", `Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Start heartbeat loop
    this.startHeartbeat();

    // 3. Start telemetry loop
    this.telemetry.start();

    // 4. Start log shipping loop
    this.startLogShipping();

    // 5. Start OpenClaw health check loop
    this.startHealthCheck();

    // 6. Start task polling loop
    this.taskPoller.start();

    this.logger.info("All loops started — daemon is operational");
  }

  // -------------------------------------------------------------------------
  // Stop (graceful shutdown)
  //
  // On SIGTERM:
  // - If idle: report offline and exit immediately
  // - If executing a task: wait for it to finish (up to shutdownTimeoutMs)
  // - If timeout: mark task as failed with "agent shutdown" error
  // - Ship remaining logs, report offline, exit
  // -------------------------------------------------------------------------

  /** Whether a shutdown has been initiated */
  get shuttingDown(): boolean {
    return this._shuttingDown;
  }
  private _shuttingDown = false;

  /** Max time to wait for active task during shutdown (default: 55s — leaves 5s for cleanup before systemd SIGKILL at 60s) */
  readonly shutdownTimeoutMs: number;

  async stop(): Promise<void> {
    if (!this.running) return;
    this._shuttingDown = true;
    this.running = false;

    this.logger.info("Graceful shutdown initiated...");

    // 1. Stop polling for new tasks immediately (no new work)
    this.taskPoller.stop();
    this.telemetry.stop();

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.logShipTimer) {
      clearInterval(this.logShipTimer);
      this.logShipTimer = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // 2. Wait for active task to finish (if any)
    const activeTask = this.taskPoller.activeTask;
    if (activeTask) {
      this.logger.info(`Waiting for active task to complete: ${activeTask.title} (timeout: ${this.shutdownTimeoutMs}ms)`, {
        taskId: activeTask.id,
      });
      this.addLog("lifecycle", `Shutdown waiting for task: ${activeTask.title}`, activeTask.id);

      const finished = await this.waitForTaskCompletion(this.shutdownTimeoutMs);

      if (!finished) {
        this.logger.warn(`Shutdown timeout — task did not complete in ${this.shutdownTimeoutMs}ms`, {
          taskId: activeTask.id,
        });
        this.addLog("error", `Shutdown timeout — task aborted: ${activeTask.title}`, activeTask.id);

        // Mark the task as failed in the registry
        try {
          await this.registry.reportTaskResult(activeTask.id, {
            status: "failed",
            output: null,
            error: "Agent shutdown — task aborted due to SIGTERM timeout",
            elapsedMs: 0,
            artifacts: [],
          });
        } catch (err) {
          this.logger.error("Failed to mark timed-out task as failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        this.logger.info("Active task completed before shutdown timeout");
      }
    } else {
      this.logger.info("No active task — shutting down immediately");
    }

    // 3. Ship remaining logs
    this.addLog("lifecycle", "Daemon shutting down");
    await this.shipLogs();

    // 4. Set agent offline in registry
    try {
      await this.registry.setOffline();
    } catch (err) {
      this.logger.error("Failed to set offline status", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.logger.info("Daemon stopped");
  }

  /**
   * Wait for the task poller's active task to complete.
   * Returns true if the task finished, false if the timeout expired.
   */
  private waitForTaskCompletion(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (!this.taskPoller.activeTask) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }
      }, 500); // Check every 500ms
    });
  }

  // -------------------------------------------------------------------------
  // Heartbeat loop — sends status + currentTaskId every interval
  // Handles 404 by re-registering with the registry
  // Issue #85: Handles cancelTask signal by killing the OpenClaw process
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.logger.info(`Heartbeat starting (interval: ${this.config.heartbeatIntervalMs}ms)`);

    const beat = async () => {
      try {
        // Determine current status from task poller
        const activeTask = this.taskPoller.activeTask;
        const status: "idle" | "working" | "error" = activeTask ? "working" : "idle";
        const currentTaskId = activeTask?.id ?? null;

        const result = await this.registry.heartbeat(status, currentTaskId);

        if (!result.ack) {
          // 404 — agent was removed from registry, re-register
          this.logger.warn("Heartbeat returned 404 — attempting re-registration");
          this.addLog("lifecycle", "Agent removed from registry, re-registering");
          try {
            await this.registry.register();
            this.logger.info("Re-registration successful");
            this.addLog("lifecycle", "Re-registration successful");
          } catch (regErr) {
            this.logger.error("Re-registration failed", {
              error: regErr instanceof Error ? regErr.message : String(regErr),
            });
            this.addLog("error", `Re-registration failed: ${regErr instanceof Error ? regErr.message : String(regErr)}`);
          }
        } else {
          this.logger.debug("Heartbeat sent");

          // Issue #85: Check for task cancellation signal
          if (result.cancelTask && activeTask && result.cancelTask === activeTask.id) {
            this.logger.warn(`Received cancelTask signal for task: ${activeTask.title}`, {
              taskId: result.cancelTask,
            });
            this.addLog("lifecycle", `Task cancellation received: ${activeTask.title}`, result.cancelTask);

            // Cancel the task — kill the OpenClaw process
            await this.handleTaskCancellation(result.cancelTask, activeTask.title);
          }
        }
      } catch (err) {
        this.logger.warn("Heartbeat failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    // Send first heartbeat immediately
    void beat();
    this.heartbeatTimer = setInterval(() => void beat(), this.config.heartbeatIntervalMs);
  }

  // -------------------------------------------------------------------------
  // Task Cancellation — Issue #85
  //
  // When the heartbeat response includes cancelTask, we:
  // 1. Cancel the OpenClaw execution (abort HTTP request)
  // 2. Wait briefly for the task executor to notice the abort
  // 3. Report the task as cancelled to the registry
  // 4. Log the cancellation
  //
  // The OpenClaw client's cancelExecution() aborts the active AbortController,
  // which causes the streaming/non-streaming fetch to throw an AbortError.
  // The TaskExecutor catches this and the TaskPoller marks it as failed.
  // We then override the status to "cancelled" via the registry.
  // -------------------------------------------------------------------------

  private async handleTaskCancellation(taskId: string, taskTitle: string): Promise<void> {
    this.logger.info(`Cancelling task: ${taskTitle}`, { taskId });

    try {
      // Step 1: Kill the OpenClaw process (abort the HTTP request)
      this.openclaw.cancelExecution();
      this.logger.info("OpenClaw execution cancelled (SIGTERM equivalent — HTTP abort)", { taskId });

      // Step 2: Wait for the task poller to notice the cancellation
      // The AbortError propagates through the TaskExecutor → TaskPoller → finally block
      const waitStart = Date.now();
      const cancelled = await this.waitForTaskCancellation(AgentDaemon.CANCEL_KILL_TIMEOUT_MS);

      if (cancelled) {
        this.logger.info(`Task cancellation confirmed in ${Date.now() - waitStart}ms`, { taskId });
      } else {
        this.logger.warn(`Task cancellation timeout after ${AgentDaemon.CANCEL_KILL_TIMEOUT_MS}ms — task may still be running`, { taskId });
        this.addLog("warn", `Cancellation timeout for task: ${taskTitle}`, taskId);
      }

      // Step 3: Report the task as cancelled to the registry
      // Use reportTaskResult with status "failed" and a cancellation error
      // The registry or caller can then finalize it as "cancelled"
      try {
        await this.registry.reportTaskResult(taskId, {
          status: "failed",
          output: null,
          error: "Task cancelled via heartbeat signal",
          elapsedMs: 0,
          artifacts: [],
        });
        this.logger.info("Task cancellation reported to registry", { taskId });
      } catch (reportErr) {
        this.logger.error("Failed to report task cancellation to registry", {
          taskId,
          error: reportErr instanceof Error ? reportErr.message : String(reportErr),
        });
      }

      // Step 4: Mark the task as cancelled (final status)
      try {
        await this.registry.updateTaskCancelled(taskId);
        this.logger.info("Task marked as cancelled in registry", { taskId });
      } catch (cancelErr) {
        // updateTaskCancelled may not exist yet — non-critical
        this.logger.debug("Could not mark task as cancelled (endpoint may not exist)", {
          taskId,
          error: cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
        });
      }

      this.addLog("lifecycle", `Task cancelled successfully: ${taskTitle}`, taskId);
    } catch (err) {
      this.logger.error("Error during task cancellation", {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.addLog("error", `Task cancellation error: ${err instanceof Error ? err.message : String(err)}`, taskId);
    }
  }

  /**
   * Wait for the task poller's active task to be cleared after cancellation.
   * Returns true if the task was cleared, false if timeout expired.
   */
  private waitForTaskCancellation(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (!this.taskPoller.activeTask) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }
      }, 200); // Check every 200ms
    });
  }

  // -------------------------------------------------------------------------
  // Log shipping loop
  // -------------------------------------------------------------------------

  private startLogShipping(): void {
    this.logger.info(`Log shipping starting (interval: ${this.config.logBatchIntervalMs}ms)`);

    this.logShipTimer = setInterval(() => void this.shipLogs(), this.config.logBatchIntervalMs);
  }

  private async shipLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    // Drain buffer
    const entries = this.logBuffer.splice(0, this.logBuffer.length);
    this.logger.debug(`Shipping ${entries.length} log entries`);

    try {
      await this.registry.sendLogs(entries);
    } catch (err) {
      this.logger.warn("Failed to ship logs", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Put them back (front of buffer) for retry
      this.logBuffer.unshift(...entries);
      // Cap buffer to avoid memory leak
      if (this.logBuffer.length > 1000) {
        this.logBuffer.splice(0, this.logBuffer.length - 500);
      }
    }
  }

  // -------------------------------------------------------------------------
  // OpenClaw health check loop
  // -------------------------------------------------------------------------

  private startHealthCheck(): void {
    const checkIntervalMs = this.config.telemetryIntervalMs; // Same as telemetry

    this.logger.info(`OpenClaw health check starting (interval: ${checkIntervalMs}ms)`);

    const check = async () => {
      let status: OpenClawStatus;
      try {
        status = await this.openclaw.healthCheck();
      } catch {
        status = "error";
      }

      if (status === "running") {
        this.openclawFailures = 0;
        return;
      }

      this.openclawFailures++;
      this.logger.warn(`OpenClaw not healthy: ${status} (failure ${this.openclawFailures}/${AgentDaemon.MAX_OPENCLAW_FAILURES})`);

      if (this.openclawFailures >= AgentDaemon.MAX_OPENCLAW_FAILURES) {
        this.logger.error("OpenClaw max failures reached — attempting restart");
        this.addLog("error", `OpenClaw unresponsive after ${this.openclawFailures} checks, restarting`);

        const restarted = await this.openclaw.restart();
        if (restarted) {
          this.openclawFailures = 0;
          this.addLog("lifecycle", "OpenClaw restarted successfully");
        } else {
          // Report error status to registry
          await this.registry.updateStatus("error");
          this.addLog("error", "OpenClaw restart failed — agent in error state");
        }
      }
    };

    // Check immediately
    void check();
    this.healthCheckTimer = setInterval(() => void check(), checkIntervalMs);
  }

  // -------------------------------------------------------------------------
  // Log buffer helper
  // -------------------------------------------------------------------------

  private addLog(level: LogEntry["level"], message: string, taskId?: string): void {
    this.logBuffer.push({
      level,
      source: this.config.agentName,
      message,
      agentId: this.config.agentId,
      taskId: taskId ?? null,
      component: "daemon",
      metadata: null,
      timestamp: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Main — runs when executed as `node dist/index.js`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfigFromEnv(process.env as Record<string, string | undefined>);
  const daemon = new AgentDaemon(config);

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    consoleLogger.info(`Received ${signal} — shutting down`);
    await daemon.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Uncaught error handlers
  process.on("uncaughtException", (err) => {
    consoleLogger.error("Uncaught exception", { error: err.message, stack: err.stack });
    void daemon.stop().then(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    consoleLogger.error("Unhandled rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });

  await daemon.start();
}

// Only run main() if this is the entry point (not imported as a module)
// Node.js ESM doesn't have require.main, so we check if there's no parent
const isEntryPoint = process.argv[1]?.endsWith("index.js") ?? false;
if (isEntryPoint) {
  main().catch((err) => {
    consoleLogger.error("Fatal error", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}

// Re-export everything for library usage
export { RegistryClient } from "./registry-client.js";
export { OpenClawClient } from "./openclaw-client.js";
export { parseSSEStream } from "./openclaw-client.js";
export type { StreamProgressCallback } from "./openclaw-client.js";
export { TaskPoller } from "./task-poller.js";
export { TaskExecutor, OpenClawUnavailableError } from "./task-executor.js";
export type { TaskExecutionResult, TaskExecutorConfig } from "./task-executor.js";
export { TelemetryCollector } from "./telemetry.js";
export { P2PClient, P2PError } from "./p2p-client.js";
export { P2PHandler } from "./p2p-handler.js";
export type {
  P2PMessage,
  P2PMessageAck,
  P2PMessageType,
  AgentEndpoint,
  P2PRetryConfig,
  P2PSendOptions,
  P2PErrorCode,
} from "./p2p-client.js";
export type { P2PMessageCallback, P2PHandlerConfig } from "./p2p-handler.js";
export { detectPrivateIp, detectPublicIp, isPrivateIp, getAllPrivateIps } from "./networking.js";
export * from "./types.js";

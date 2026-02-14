// =============================================================================
// Progress Reporter — Issue #89
//
// Reports tool call events as task progress steps to the Registry.
// Features:
// - Debounce: minimum interval between progress reports (default: 2s)
// - Retry with exponential backoff on network errors
// - Enable/disable via config
// - Non-blocking: errors don't affect task execution
// - Batch pending events during debounce window
// =============================================================================

import type { DaemonLogger, IRegistryClient } from "./types.js";
import type { ToolCallEvent } from "./openclaw-interceptor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressReporterConfig {
  /** Whether progress reporting is enabled (default: true) */
  enabled: boolean;
  /** Minimum interval between progress reports in ms (default: 2000) */
  debounceMs: number;
  /** Maximum retry attempts for failed reports (default: 3) */
  maxRetries: number;
  /** Initial retry delay in ms — doubles each attempt (default: 1000) */
  retryBaseDelayMs: number;
  /** Maximum retry delay in ms (default: 10000) */
  retryMaxDelayMs: number;
}

const DEFAULT_PROGRESS_CONFIG: ProgressReporterConfig = {
  enabled: true,
  debounceMs: 2_000,
  maxRetries: 3,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 10_000,
};

interface PendingReport {
  taskId: string;
  event: ToolCallEvent;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Progress Reporter
// ---------------------------------------------------------------------------

export class ProgressReporter {
  private readonly config: ProgressReporterConfig;
  private readonly registry: IRegistryClient;
  private readonly logger: DaemonLogger;

  /** Currently active task ID (set by startTask/stopTask) */
  private activeTaskId: string | null = null;

  /** Pending reports waiting for debounce window */
  private pendingQueue: PendingReport[] = [];

  /** Timer for debounce flush */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Last time a progress report was sent */
  private lastReportTime = 0;

  /** Whether we're currently flushing (prevents re-entry) */
  private flushing = false;

  /** Count of reports sent for current task (for metrics) */
  private reportsSent = 0;

  /** Count of reports failed for current task (for metrics) */
  private reportsFailed = 0;

  constructor(
    registry: IRegistryClient,
    logger: DaemonLogger,
    config: Partial<ProgressReporterConfig> = {},
  ) {
    this.config = { ...DEFAULT_PROGRESS_CONFIG, ...config };
    this.registry = registry;
    this.logger = logger;
  }

  /**
   * Mark the start of a task — all subsequent tool call events will be
   * reported against this task ID.
   */
  startTask(taskId: string): void {
    this.activeTaskId = taskId;
    this.reportsSent = 0;
    this.reportsFailed = 0;
    this.lastReportTime = 0;
    this.pendingQueue = [];
    this.logger.debug("Progress reporter started for task", { taskId });
  }

  /**
   * Mark the end of a task — flush any pending reports and reset.
   */
  async stopTask(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Flush remaining pending reports
    if (this.pendingQueue.length > 0) {
      await this.flushPending();
    }

    if (this.activeTaskId) {
      this.logger.debug("Progress reporter stopped", {
        taskId: this.activeTaskId,
        sent: this.reportsSent,
        failed: this.reportsFailed,
      });
    }

    this.activeTaskId = null;
    this.pendingQueue = [];
  }

  /**
   * Handle a tool call event — queue it for reporting with debounce.
   * This is the callback to register with OpenClawInterceptor.onToolCall().
   */
  handleToolCall(event: ToolCallEvent): void {
    if (!this.config.enabled) return;
    if (!this.activeTaskId) return;

    const report: PendingReport = {
      taskId: this.activeTaskId,
      event,
      retryCount: 0,
    };

    this.pendingQueue.push(report);

    // Check if we can send immediately (outside debounce window)
    const now = Date.now();
    const elapsed = now - this.lastReportTime;

    if (elapsed >= this.config.debounceMs) {
      // Send immediately
      void this.flushPending();
    } else if (!this.debounceTimer) {
      // Schedule flush after remaining debounce window
      const remaining = this.config.debounceMs - elapsed;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.flushPending();
      }, remaining);
    }
    // If timer is already set, the pending report will be included in the next flush
  }

  /**
   * Flush all pending reports to the registry.
   */
  private async flushPending(): Promise<void> {
    if (this.flushing) return;
    if (this.pendingQueue.length === 0) return;

    this.flushing = true;

    try {
      // Drain the queue
      const reports = this.pendingQueue.splice(0, this.pendingQueue.length);

      for (const report of reports) {
        await this.sendReport(report);
      }

      this.lastReportTime = Date.now();
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Send a single progress report to the registry with retry.
   */
  private async sendReport(report: PendingReport): Promise<void> {
    const { taskId, event } = report;

    const step = `[${event.toolName}] ${event.argumentsSummary}`;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.registry.reportProgress(taskId, {
          step,
          timestamp: event.timestamp,
          toolCall: event.toolName,
        });

        this.reportsSent++;
        this.logger.debug("Progress reported", {
          taskId,
          tool: event.toolName,
          attempt,
        });
        return;
      } catch (err) {
        const isLastAttempt = attempt === this.config.maxRetries;

        if (isLastAttempt) {
          this.reportsFailed++;
          this.logger.warn("Progress report failed after retries", {
            taskId,
            tool: event.toolName,
            attempts: attempt + 1,
            error: err instanceof Error ? err.message : String(err),
          });
          // Don't throw — progress reporting is non-critical
          return;
        }

        // Exponential backoff
        const delay = Math.min(
          this.config.retryBaseDelayMs * Math.pow(2, attempt),
          this.config.retryMaxDelayMs,
        );

        this.logger.debug("Progress report retry", {
          taskId,
          tool: event.toolName,
          attempt: attempt + 1,
          retryInMs: delay,
        });

        await sleep(delay);
      }
    }
  }

  /**
   * Get reporting metrics for the current task.
   */
  getMetrics(): { sent: number; failed: number; pending: number } {
    return {
      sent: this.reportsSent,
      failed: this.reportsFailed,
      pending: this.pendingQueue.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

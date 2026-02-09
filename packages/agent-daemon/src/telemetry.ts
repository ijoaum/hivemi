// =============================================================================
// Telemetry Collector
// Gathers OS metrics using native Node.js modules (os.cpus, os.freemem, etc.)
// and daemon runtime stats. Sent to registry at configurable intervals.
// =============================================================================

import os from "node:os";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type {
  DaemonConfig,
  DaemonLogger,
  IOpenClawClient,
  IRegistryClient,
  OpenClawStatus,
  TelemetrySnapshot,
} from "./types.js";

const execAsync = promisify(execCb);

const DAEMON_VERSION = "0.1.0";

export class TelemetryCollector {
  private readonly config: DaemonConfig;
  private readonly registry: IRegistryClient;
  private readonly openclaw: IOpenClawClient;
  private readonly logger: DaemonLogger;
  private readonly startedAt: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private _lastOpenClawStatus: OpenClawStatus = "stopped";

  // LLM counters (incremented externally by task poller)
  private _llmRequests = 0;
  private _llmPromptTokens = 0;
  private _llmCompletionTokens = 0;
  private _llmErrors = 0;
  private _llmTotalLatencyMs = 0;

  // Task stats getter (injected)
  private getTaskStats: () => { completed: number; failed: number; active: number };

  constructor(
    config: DaemonConfig,
    registry: IRegistryClient,
    openclaw: IOpenClawClient,
    logger: DaemonLogger,
    getTaskStats: () => { completed: number; failed: number; active: number },
  ) {
    this.config = config;
    this.registry = registry;
    this.openclaw = openclaw;
    this.logger = logger;
    this.startedAt = Date.now();
    this.getTaskStats = getTaskStats;
  }

  get lastOpenClawStatus(): OpenClawStatus {
    return this._lastOpenClawStatus;
  }

  // -------------------------------------------------------------------------
  // LLM counter helpers (called by task execution)
  // -------------------------------------------------------------------------

  recordLlmRequest(latencyMs: number, promptTokens: number, completionTokens: number): void {
    this._llmRequests++;
    this._llmPromptTokens += promptTokens;
    this._llmCompletionTokens += completionTokens;
    this._llmTotalLatencyMs += latencyMs;
  }

  recordLlmError(): void {
    this._llmErrors++;
  }

  // -------------------------------------------------------------------------
  // Start / Stop
  // -------------------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.logger.info(`Telemetry collector starting (interval: ${this.config.telemetryIntervalMs}ms)`);
    this.timer = setInterval(() => void this.collect(), this.config.telemetryIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Telemetry collector stopped");
  }

  // -------------------------------------------------------------------------
  // Collect and send
  // -------------------------------------------------------------------------

  async collect(): Promise<TelemetrySnapshot> {
    const snapshot = await this.buildSnapshot();

    try {
      await this.registry.sendTelemetry(snapshot);
      this.logger.debug("Telemetry sent");
    } catch (err) {
      this.logger.warn("Failed to send telemetry", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return snapshot;
  }

  // -------------------------------------------------------------------------
  // Build snapshot
  // -------------------------------------------------------------------------

  async buildSnapshot(): Promise<TelemetrySnapshot> {
    const [infra, openclawStatus] = await Promise.all([
      this.collectInfra(),
      this.openclaw.healthCheck(),
    ]);

    this._lastOpenClawStatus = openclawStatus;

    const tasks = this.getTaskStats();
    const uptime = Math.floor((Date.now() - this.startedAt) / 1000);

    const avgLatencyMs =
      this._llmRequests > 0
        ? Math.round(this._llmTotalLatencyMs / this._llmRequests)
        : 0;

    return {
      ts: new Date().toISOString(),
      infra,
      llm: {
        requests: this._llmRequests,
        promptTokens: this._llmPromptTokens,
        completionTokens: this._llmCompletionTokens,
        errors: this._llmErrors,
        avgLatencyMs,
      },
      tasks,
      daemon: {
        uptime,
        version: DAEMON_VERSION,
        openclawStatus,
      },
    };
  }

  // -------------------------------------------------------------------------
  // OS metrics
  // -------------------------------------------------------------------------

  private async collectInfra(): Promise<TelemetrySnapshot["infra"]> {
    const cpus = os.cpus();
    const cpu = this.calculateCpuUsage(cpus);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const loadAvg = os.loadavg();

    let diskUsed = 0;
    let diskTotal = 0;

    try {
      const { stdout } = await execAsync("df -B1 / | tail -1", { timeout: 5_000 });
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        diskTotal = parseInt(parts[1], 10) || 0;
        diskUsed = parseInt(parts[2], 10) || 0;
      }
    } catch {
      // Disk stats unavailable — not critical
    }

    return {
      cpu: Math.round(cpu * 100) / 100,
      memUsed: totalMem - freeMem,
      memTotal: totalMem,
      diskUsed,
      diskTotal,
      // Protocol spec (Issue #54): single number = 1-minute load average
      loadAvg: Math.round(loadAvg[0] * 100) / 100,
    };
  }

  /**
   * Calculate approximate CPU usage from os.cpus() snapshot.
   * Returns a percentage 0-100.
   */
  private calculateCpuUsage(cpus: os.CpuInfo[]): number {
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      const { user, nice, sys, idle, irq } = cpu.times;
      totalTick += user + nice + sys + idle + irq;
      totalIdle += idle;
    }

    if (totalTick === 0) return 0;
    return ((totalTick - totalIdle) / totalTick) * 100;
  }
}

// =============================================================================
// Agent Daemon Types
// Resident process on agent VMs — polls tasks, executes via OpenClaw, reports.
// =============================================================================

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export interface DaemonLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger: DaemonLogger = {
  debug: (msg, meta) => console.debug(`[daemon] ${msg}`, meta ?? ""),
  info: (msg, meta) => console.info(`[daemon] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[daemon] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[daemon] ${msg}`, meta ?? ""),
};

// ---------------------------------------------------------------------------
// Daemon Config (from .env)
// ---------------------------------------------------------------------------

export interface DaemonConfig {
  /** Agent UUID in registry */
  agentId: string;
  /** Human-readable name */
  agentName: string;
  /** Role UUID */
  roleId: string;
  /** Team UUID */
  teamId: string;
  /** LLM model identifier */
  model: string;
  /** Registry base URL (e.g. http://10.0.0.1:4001) */
  registryUrl: string;
  /** Shared secret for daemon ↔ registry auth */
  hivemiSecret: string;
  /** Port the daemon can expose (not currently used for HTTP) */
  daemonPort: number;
  /** OpenClaw Chat Completions API token */
  openclawApiToken?: string;
  /** OpenClaw gateway URL (default: http://127.0.0.1:4100) */
  openclawUrl?: string;

  // ---------------------------------------------------------------------------
  // Intervals (ms) — overridable from env
  // ---------------------------------------------------------------------------

  /** Task poll interval in ms (default: 15_000) */
  pollIntervalMs: number;
  /** Heartbeat interval in ms (default: 30_000) */
  heartbeatIntervalMs: number;
  /** Telemetry interval in ms (default: 60_000) */
  telemetryIntervalMs: number;
  /** Log batch interval in ms (default: 300_000 = 5 min) */
  logBatchIntervalMs: number;
  /** Task execution timeout in ms (default: 600_000 = 10 min) */
  taskTimeoutMs: number;
}

/** Parse DaemonConfig from process.env */
export function loadConfigFromEnv(env: Record<string, string | undefined>): DaemonConfig {
  const required = (key: string): string => {
    const val = env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  const optionalInt = (key: string, defaultVal: number): number => {
    const val = env[key];
    if (!val) return defaultVal;
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) throw new Error(`Invalid integer for ${key}: ${val}`);
    return parsed;
  };

  return {
    agentId: required("AGENT_ID"),
    agentName: required("AGENT_NAME"),
    roleId: required("ROLE_ID"),
    teamId: required("TEAM_ID"),
    model: required("MODEL"),
    registryUrl: required("REGISTRY_URL"),
    hivemiSecret: required("HIVEMI_SECRET"),
    daemonPort: optionalInt("DAEMON_PORT", 3100),
    openclawApiToken: env["OPENCLAW_API_TOKEN"],
    openclawUrl: env["OPENCLAW_URL"] || "http://127.0.0.1:4100",
    pollIntervalMs: optionalInt("POLL_INTERVAL_MS", 15_000),
    heartbeatIntervalMs: optionalInt("HEARTBEAT_INTERVAL_MS", 30_000),
    telemetryIntervalMs: optionalInt("TELEMETRY_INTERVAL_MS", 60_000),
    logBatchIntervalMs: optionalInt("LOG_BATCH_INTERVAL_MS", 300_000),
    taskTimeoutMs: optionalInt("TASK_TIMEOUT_MS", 600_000),
  };
}

// ---------------------------------------------------------------------------
// Task types (what the daemon works with)
// ---------------------------------------------------------------------------

export interface DaemonTask {
  id: string;
  title: string;
  description: string | null;
  input: string | null;
  priority: "high" | "medium" | "low";
  roleTarget: string | null;
  parentTaskId: string | null;
  teamId: string;
}

export interface TaskResult {
  status: "completed" | "failed";
  output: string | null;
  error: string | null;
  elapsedMs: number;
  artifacts: TaskArtifact[];
}

export interface TaskArtifact {
  type: string;
  url: string;
  description: string;
}

// ---------------------------------------------------------------------------
// OpenClaw status
// ---------------------------------------------------------------------------

export type OpenClawStatus = "running" | "stopped" | "error";

// ---------------------------------------------------------------------------
// Telemetry snapshot
// ---------------------------------------------------------------------------

export interface TelemetrySnapshot {
  infra: {
    cpu: number;
    memUsed: number;
    memTotal: number;
    diskUsed: number;
    diskTotal: number;
    loadAvg: number[];
  };
  llm: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    errors: number;
    avgLatencyMs: number;
  };
  tasks: {
    completed: number;
    failed: number;
    active: number;
  };
  daemon: {
    uptime: number;
    version: string;
    openclawStatus: string;
  };
}

// ---------------------------------------------------------------------------
// Registry HTTP client interface
// ---------------------------------------------------------------------------

export interface IRegistryClient {
  /** POST /api/agents — register or upsert this agent */
  register(): Promise<void>;

  /** POST /api/agents/:id/heartbeat — keep-alive */
  heartbeat(): Promise<void>;

  /** PUT /api/agents/:id — update agent status */
  updateStatus(status: string): Promise<void>;

  /** GET /api/tasks/next?role=<roleId> — poll for next task */
  pollTask(): Promise<DaemonTask | null>;

  /** PUT /api/tasks/:id — update task with result */
  reportTaskResult(taskId: string, result: TaskResult): Promise<void>;

  /** POST /api/agents/:id/telemetry — send telemetry data */
  sendTelemetry(snapshot: TelemetrySnapshot): Promise<void>;

  /** POST /api/logs (batch) */
  sendLogs(entries: LogEntry[]): Promise<void>;

  /** PUT /api/agents/:id with status=offline — graceful shutdown */
  setOffline(): Promise<void>;
}

// ---------------------------------------------------------------------------
// OpenClaw client interface
// ---------------------------------------------------------------------------

export interface IOpenClawClient {
  /** Check if OpenClaw gateway is running */
  healthCheck(): Promise<OpenClawStatus>;

  /**
   * Execute a task via Chat Completions API.
   * Creates a new session, sends the prompt, and returns the response.
   */
  executeTask(prompt: string, timeoutMs: number): Promise<string>;

  /** Attempt to restart the OpenClaw gateway */
  restart(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Log buffer entry
// ---------------------------------------------------------------------------

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error" | "lifecycle";
  source: string;
  message: string;
  agentId: string;
  taskId: string | null;
  component: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

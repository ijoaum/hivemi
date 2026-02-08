// =============================================================================
// Bootstrapper Types
// VM configuration and agent deployment — turns a provisioned VM into a
// functional HiveMI agent with OpenClaw, secrets, and the Agent Daemon.
// =============================================================================

// ---------------------------------------------------------------------------
// Logger (same interface as provisioner for consistency)
// ---------------------------------------------------------------------------

export interface BootstrapperLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger: BootstrapperLogger = {
  debug: (msg, meta) => console.debug(`[bootstrapper] ${msg}`, meta ?? ""),
  info: (msg, meta) => console.info(`[bootstrapper] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[bootstrapper] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[bootstrapper] ${msg}`, meta ?? ""),
};

// ---------------------------------------------------------------------------
// Bootstrap Phases
// ---------------------------------------------------------------------------

export type BootstrapPhaseName =
  | "cloud-init"
  | "ssh-connect"
  | "inject-secrets"
  | "configure-openclaw"
  | "copy-role-config"
  | "install-daemon"
  | "wait-registration";

export type BootstrapPhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface BootstrapPhase {
  name: BootstrapPhaseName;
  status: BootstrapPhaseStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Bootstrap Config — what the caller provides
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** UUID of the agent in the registry */
  agentId: string;
  /** Human-readable agent name (e.g. "hivemi-agent-atlas") */
  agentName: string;
  /** UUID of the role this agent will perform */
  roleId: string;
  /** UUID of the team this agent belongs to */
  teamId: string;
  /** LLM model identifier (e.g. "anthropic/claude-sonnet-4-5") */
  model: string;
  /** Port the Agent Daemon will listen on */
  daemonPort: number;
}

export interface RoleConfig {
  /** SOUL.md — personality and instructions */
  soulMd: string;
  /** AGENTS.md — behavioral rules */
  agentsMd: string;
  /** TOOLS.md — enabled tools */
  toolsMd: string;
  /** config.json — operational parameters (JSON string) */
  configJson: string;
}

export interface BootstrapConfig {
  /** VM public IP or hostname */
  host: string;
  /** SSH port (default: 22) */
  sshPort?: number;
  /** SSH private key (PEM string) for connecting as root or openclaw */
  sshPrivateKey: string;
  /** SSH user (default: "root") */
  sshUser?: string;
  /** Agent configuration */
  agent: AgentConfig;
  /** Role files to copy */
  role: RoleConfig;
  /** Secret mappings to inject */
  secrets: SecretMapping[];
  /** Secret provider to use */
  secretProvider: ISecretProvider;
  /** Registry URL the daemon will report to */
  registryUrl: string;
  /** HIVEMI_SECRET for daemon ↔ registry auth */
  hivemiSecret: string;
  /** OpenClaw Chat Completions API token for this agent */
  openclawApiToken?: string;
}

// ---------------------------------------------------------------------------
// Bootstrap Result
// ---------------------------------------------------------------------------

export type BootstrapStatus = "success" | "failed";

export interface BootstrapResult {
  status: BootstrapStatus;
  phases: BootstrapPhase[];
  /** Total duration in milliseconds */
  durationMs: number;
  /** Error message if status is "failed" */
  error?: string;
  /** Phase that failed, if any */
  failedPhase?: BootstrapPhaseName;
}

// ---------------------------------------------------------------------------
// Secret Provider
// ---------------------------------------------------------------------------

/**
 * A mapping from a secret reference to where it should be placed on the VM.
 */
export interface SecretMapping {
  /** Reference to the secret (e.g. "op://Vault/Item/field" or env key) */
  ref: string;
  /** Target env var name in the daemon's .env file */
  envVar: string;
}

/**
 * Abstraction over secret storage backends.
 * Resolves secret references to their actual values.
 */
export interface ISecretProvider {
  /** Provider name (e.g. "1password", "envfile") */
  readonly name: string;

  /**
   * Resolve a single secret reference to its value.
   * @throws if the secret cannot be resolved
   */
  getSecret(ref: string): Promise<string>;

  /**
   * Resolve multiple secret mappings.
   * Returns a map of envVar → secretValue.
   * @throws if any secret cannot be resolved (includes which ref failed)
   */
  resolveAll(mappings: SecretMapping[]): Promise<Map<string, string>>;
}

// ---------------------------------------------------------------------------
// SSH Client Interface
// ---------------------------------------------------------------------------

/**
 * Result of executing a command over SSH.
 */
export interface SSHExecResult {
  /** Exit code (0 = success) */
  exitCode: number;
  /** Combined stdout */
  stdout: string;
  /** Combined stderr */
  stderr: string;
}

/**
 * Abstraction over SSH connections.
 * Allows mocking in tests without real SSH.
 */
export interface ISSHClient {
  /**
   * Connect to the remote host.
   * @throws on connection failure
   */
  connect(): Promise<void>;

  /**
   * Execute a command on the remote host.
   */
  exec(command: string): Promise<SSHExecResult>;

  /**
   * Upload a string as a file on the remote host.
   */
  writeFile(remotePath: string, content: string, mode?: string): Promise<void>;

  /**
   * Check if a file exists on the remote host.
   */
  fileExists(remotePath: string): Promise<boolean>;

  /**
   * Disconnect from the remote host.
   */
  disconnect(): Promise<void>;

  /** Whether currently connected */
  readonly connected: boolean;
}

// ---------------------------------------------------------------------------
// SSH Client Config
// ---------------------------------------------------------------------------

export interface SSHClientConfig {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  /** Connection timeout in ms (default: 30_000) */
  connectTimeoutMs?: number;
  /** Command execution timeout in ms (default: 300_000) */
  execTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Timeouts & Retry Config
// ---------------------------------------------------------------------------

export interface BootstrapTimeouts {
  /** Cloud-init completion timeout (default: 600_000 = 10 min) */
  cloudInitMs?: number;
  /** SSH connection timeout (default: 300_000 = 5 min) */
  sshConnectMs?: number;
  /** SSH connection retries (default: 3) */
  sshConnectRetries?: number;
  /** OpenClaw install retries (default: 1) */
  openclawInstallRetries?: number;
  /** Registration poll timeout (default: 120_000 = 2 min) */
  registrationMs?: number;
  /** Registration poll interval (default: 5_000 = 5s) */
  registrationPollMs?: number;
}

export const DEFAULT_TIMEOUTS: Required<BootstrapTimeouts> = {
  cloudInitMs: 600_000,
  sshConnectMs: 300_000,
  sshConnectRetries: 3,
  openclawInstallRetries: 1,
  registrationMs: 120_000,
  registrationPollMs: 5_000,
};

// ---------------------------------------------------------------------------
// Cloud-init template context
// ---------------------------------------------------------------------------

export interface CloudInitContext {
  /** Whether to configure swap (recommended for VMs ≤ 2GB) */
  enableSwap: boolean;
  /** Swap size in MB (default: 2048) */
  swapSizeMb?: number;
}

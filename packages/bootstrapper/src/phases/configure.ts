// =============================================================================
// Phase 2: SSH Configuration
// Connects to VM and configures OpenClaw, role files, secrets, and daemon.
// Includes post-install verification (systemctl status + initial logs).
// =============================================================================

import type {
  ISSHClient,
  BootstrapConfig,
  BootstrapperLogger,
  ISecretProvider,
  SecretMapping,
  SecretInjectionResult,
  AgentConfig,
  RoleConfig,
} from "../types.js";
import { parseSecretTarget, maskSecret, isRequired } from "../secrets/utils.js";
import {
  generateOpenClawConfig,
  buildSystemPrompt,
  validateOpenClawConfig,
  logConfigSummary,
} from "../openclaw-config.js";
import type { OpenClawConfigOptions } from "../openclaw-config.js";
import {
  buildModelConfig,
  resolveAuthProfiles,
  validateAuthProfiles,
  authProfilesToEnv,
  logModelAuthSummary,
  generateFallbackConfig,
} from "../model-config.js";
import type { AuthProfile, ModelConfigOptions, LLMProviderName, LLMProviderConfig } from "../model-config.js";

const OPENCLAW_HOME = "/home/openclaw";
const OPENCLAW_WORKSPACE = `${OPENCLAW_HOME}/.openclaw/workspace`;
const DAEMON_DIR = `${OPENCLAW_HOME}/.hivemi/daemon`;

// ---------------------------------------------------------------------------
// Sub-phase: Inject Secrets
// ---------------------------------------------------------------------------

/**
 * Resolve secrets via the provider and inject them into the VM via SSH.
 *
 * This handles two target types:
 * - `env:VAR_NAME` → collected for the daemon's .env file (written later by installDaemon)
 * - `file:/path/to/file` → written directly to the VM with mode 600
 *
 * Security:
 * - Secrets are resolved locally on the control plane (never stored on disk)
 * - Values are transmitted to the VM via SSH (encrypted)
 * - File secrets are written with permission 600
 * - Secret values are never logged — only masked references
 *
 * @returns SecretInjectionResult with env secrets, file paths, and skipped refs
 */
export async function injectSecrets(
  ssh: ISSHClient,
  secretProvider: ISecretProvider,
  mappings: SecretMapping[],
  logger?: BootstrapperLogger,
): Promise<SecretInjectionResult> {
  const result: SecretInjectionResult = {
    envSecrets: new Map(),
    fileSecrets: [],
    skipped: [],
  };

  if (mappings.length === 0) {
    logger?.info("No secrets to inject");
    return result;
  }

  logger?.info(`Injecting ${mappings.length} secret(s) via ${secretProvider.name}`);

  for (const mapping of mappings) {
    const target = parseSecretTarget(mapping);
    const required = isRequired(mapping);

    let value: string;
    try {
      value = await secretProvider.getSecret(mapping.ref);
    } catch (err) {
      if (required) {
        throw new Error(
          `Required secret "${mapping.ref}" could not be resolved: ${(err as Error).message}`,
        );
      }
      logger?.warn(`Optional secret "${mapping.ref}" not found — skipping`);
      result.skipped.push(mapping.ref);
      continue;
    }

    if (target.kind === "env") {
      // Env secrets are collected and written to .env by installDaemon
      result.envSecrets.set(target.value, value);
      logger?.info(`Secret resolved: ${mapping.ref} → env:${target.value} [${maskSecret(value)}]`);
    } else if (target.kind === "file") {
      // File secrets are written directly to the VM via SSH
      await writeSecretFile(ssh, target.value, value, logger);
      result.fileSecrets.push(target.value);
      logger?.info(`Secret written: ${mapping.ref} → file:${target.value}`);
    }
  }

  const total = result.envSecrets.size + result.fileSecrets.length;
  logger?.info(
    `Injected ${total} secret(s) (${result.envSecrets.size} env, ${result.fileSecrets.length} file` +
    `${result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : ""})`,
  );

  return result;
}

/**
 * Write a secret value to a file on the VM via SSH.
 * - Creates parent directory if needed
 * - Sets file permissions to 600 (owner read/write only)
 * - Uses base64 encoding to avoid shell escaping issues
 */
async function writeSecretFile(
  ssh: ISSHClient,
  remotePath: string,
  value: string,
  logger?: BootstrapperLogger,
): Promise<void> {
  // writeFile with mode 600 handles mkdir + base64 encoding + chmod
  await ssh.writeFile(remotePath, value, "600");
  logger?.debug(`Secret file written: ${remotePath} (mode 600)`);
}

// ---------------------------------------------------------------------------
// Sub-phase: Configure OpenClaw
// ---------------------------------------------------------------------------

/**
 * Configuration options for the OpenClaw setup phase.
 */
export interface ConfigureOpenClawOptions {
  /** Role name for tool resolution (e.g. "developer", "qa", "pm") */
  roleName?: string;
  /** Explicit tool list (overrides role-based defaults) */
  tools?: string[];
  /** Additional behavioral instructions */
  instructions?: string;
  /** Security configuration overrides */
  security?: Partial<import("../openclaw-config.js").SecurityConfig>;
  /** Fallback models in priority order */
  fallbackModels?: string[];
  /** Provider overrides for secret refs, base URLs, etc. */
  providerOverrides?: Partial<Record<LLMProviderName, Partial<LLMProviderConfig>>>;
  /** Whether to validate API keys via live API calls (default: false) */
  validateKeysLive?: boolean;
  /** Resolved auth profiles (if pre-resolved externally) */
  authProfiles?: AuthProfile[];
}

/**
 * Configure OpenClaw on the VM:
 * - Resolve model configuration and auth profiles
 * - Generate system prompt with role, tools, and instructions
 * - Generate openclaw.json with chatCompletions, sandbox off, security config
 * - Include fallback models if configured
 * - Inject auth profile env vars for LLM providers
 * - Validate the generated config
 * - Write SOUL.md (system prompt) and config.yaml to the VM
 * - Log configuration summary
 *
 * The agent runs headless — Chat Completions API only, no messaging channels.
 *
 * @returns Resolved auth profiles (env vars for the daemon .env file)
 */
export async function configureOpenClaw(
  ssh: ISSHClient,
  agent: AgentConfig,
  soulMd: string,
  apiToken?: string,
  logger?: BootstrapperLogger,
  options?: ConfigureOpenClawOptions,
): Promise<{ authEnvVars: Map<string, string> }> {
  logger?.info("Configuring OpenClaw gateway");

  // Ensure directories exist
  await ssh.exec(`mkdir -p ${OPENCLAW_WORKSPACE}`);
  await ssh.exec(`mkdir -p ${OPENCLAW_HOME}/.openclaw`);

  // -------------------------------------------------------------------------
  // Model & Auth configuration
  // -------------------------------------------------------------------------
  let authEnvVars = new Map<string, string>();

  if (options?.authProfiles && options.authProfiles.length > 0) {
    // Auth profiles provided externally (e.g. pre-resolved by deploy orchestrator)
    authEnvVars = authProfilesToEnv(options.authProfiles);
    logger?.info(`Using ${options.authProfiles.length} pre-resolved auth profile(s)`);

    // Validate live if requested
    if (options.validateKeysLive) {
      const validation = await validateAuthProfiles(options.authProfiles, logger);
      if (!validation.valid) {
        const failures = validation.providers
          .filter((p) => !p.valid)
          .map((p) => `${p.provider}: ${p.error}`)
          .join("; ");
        throw new Error(`API key validation failed: ${failures}`);
      }
      logger?.info("All API keys validated ✓");
    }
  }

  // Build configuration options
  const configOptions: OpenClawConfigOptions = {
    agent,
    apiToken,
    systemPrompt: soulMd,
    roleName: options?.roleName,
    tools: options?.tools,
    instructions: options?.instructions,
    security: options?.security,
    fallbackModels: options?.fallbackModels,
  };

  // 1. Build system prompt with role, tools, and instructions
  const systemPrompt = buildSystemPrompt(configOptions);
  logger?.info(`System prompt built: ${systemPrompt.length} chars`);

  // Write SOUL.md (the system prompt the agent will use)
  await ssh.writeFile(`${OPENCLAW_WORKSPACE}/SOUL.md`, systemPrompt);
  logger?.debug("Wrote SOUL.md with role and tools context");

  // 2. Generate OpenClaw gateway config
  const openclawConfig = generateOpenClawConfig(configOptions);

  // 3. Validate the generated config
  const validation = validateOpenClawConfig(openclawConfig);

  if (validation.warnings.length > 0) {
    for (const warning of validation.warnings) {
      logger?.warn(`Config warning: ${warning}`);
    }
  }

  if (!validation.valid) {
    const errorMsg = `OpenClaw config validation failed: ${validation.errors.join("; ")}`;
    logger?.error(errorMsg);
    throw new Error(errorMsg);
  }

  logger?.info("OpenClaw config validated ✓");

  // 4. Write config to VM
  const configPath = `${OPENCLAW_HOME}/.openclaw/config.yaml`;
  const configJson = JSON.stringify(openclawConfig, null, 2);
  // Mode 600: config contains API token — readable only by openclaw user
  await ssh.writeFile(configPath, configJson, "600");
  logger?.debug(`Wrote config to ${configPath} (${configJson.length} bytes)`);

  // 5. Verify config was written correctly
  const verifyResult = await ssh.exec(`cat ${configPath} | wc -c`);
  if (verifyResult.exitCode !== 0) {
    throw new Error(`Failed to verify config file: ${verifyResult.stderr}`);
  }

  const writtenBytes = parseInt(verifyResult.stdout.trim(), 10);
  if (writtenBytes < 50) {
    throw new Error(
      `Config file verification failed: expected ~${configJson.length} bytes, ` +
      `got ${writtenBytes}. File may be corrupted.`,
    );
  }
  logger?.info(`Config file verified: ${writtenBytes} bytes on disk`);

  // 6. Log summary (without secrets)
  if (logger) {
    logConfigSummary(openclawConfig, systemPrompt.length, logger);
  }

  logger?.info("OpenClaw configured (chatCompletions, sandbox off, security applied) ✓");

  return { authEnvVars };
}

// ---------------------------------------------------------------------------
// Sub-phase: Copy Role Config
// ---------------------------------------------------------------------------

/**
 * Copy role configuration files to the OpenClaw workspace.
 */
export async function copyRoleConfig(
  ssh: ISSHClient,
  role: RoleConfig,
  logger?: BootstrapperLogger,
): Promise<void> {
  logger?.info("Copying role configuration files");

  await ssh.exec(`mkdir -p ${OPENCLAW_WORKSPACE}`);

  // SOUL.md is already written by configureOpenClaw, but we overwrite
  // with the full role version if provided
  if (role.soulMd) {
    await ssh.writeFile(`${OPENCLAW_WORKSPACE}/SOUL.md`, role.soulMd);
    logger?.debug("Wrote SOUL.md (role)");
  }

  if (role.agentsMd) {
    await ssh.writeFile(`${OPENCLAW_WORKSPACE}/AGENTS.md`, role.agentsMd);
    logger?.debug("Wrote AGENTS.md");
  }

  if (role.toolsMd) {
    await ssh.writeFile(`${OPENCLAW_WORKSPACE}/TOOLS.md`, role.toolsMd);
    logger?.debug("Wrote TOOLS.md");
  }

  if (role.configJson) {
    await ssh.writeFile(`${OPENCLAW_WORKSPACE}/config.json`, role.configJson);
    logger?.debug("Wrote config.json");
  }

  if (role.toolsJson) {
    await ssh.writeFile(`${OPENCLAW_WORKSPACE}/tools.json`, role.toolsJson);
    logger?.debug("Wrote tools.json");
  }

  logger?.info("Role configuration files copied");
}

// ---------------------------------------------------------------------------
// Sub-phase: Install Agent Daemon
// ---------------------------------------------------------------------------

/**
 * Install the Agent Daemon as a systemd service.
 *
 * Steps:
 * 1. Create daemon directory
 * 2. Write .env file with all config
 * 3. Write systemd unit file
 * 4. Enable and start the service
 */
export async function installDaemon(
  ssh: ISSHClient,
  config: BootstrapConfig,
  resolvedSecrets: Map<string, string>,
  logger?: BootstrapperLogger,
): Promise<void> {
  logger?.info("Installing Agent Daemon");

  const { agent, registryUrl, hivemiSecret } = config;

  // 1. Create daemon directory
  await ssh.exec(`mkdir -p ${DAEMON_DIR}`);

  // 2. Build .env content
  const envLines: string[] = [
    `# HiveMI Agent Daemon — generated by bootstrapper`,
    `AGENT_ID=${agent.agentId}`,
    `AGENT_NAME=${agent.agentName}`,
    `ROLE_ID=${agent.roleId}`,
    `TEAM_ID=${agent.teamId}`,
    `MODEL=${agent.model}`,
    `REGISTRY_URL=${registryUrl}`,
    `HIVEMI_SECRET=${hivemiSecret}`,
    `DAEMON_PORT=${agent.daemonPort}`,
  ];

  // Add resolved secrets
  for (const [envVar, value] of resolvedSecrets) {
    envLines.push(`${envVar}=${value}`);
  }

  // Add OpenClaw API token if provided
  if (config.openclawApiToken) {
    envLines.push(`OPENCLAW_API_TOKEN=${config.openclawApiToken}`);
  }

  const envContent = envLines.join("\n") + "\n";
  await ssh.writeFile(`${DAEMON_DIR}/.env`, envContent, "600");
  logger?.debug("Wrote daemon .env");

  // 3. Write systemd unit file
  const unitContent = `[Unit]
Description=HiveMI Agent Daemon (${agent.agentName})
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=openclaw
Group=openclaw
WorkingDirectory=${DAEMON_DIR}
EnvironmentFile=${DAEMON_DIR}/.env
ExecStart=/home/linuxbrew/.linuxbrew/bin/node ${DAEMON_DIR}/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hivemi-daemon

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${OPENCLAW_HOME}

[Install]
WantedBy=multi-user.target
`;

  await ssh.writeFile("/etc/systemd/system/hivemi-daemon.service", unitContent);
  logger?.debug("Wrote systemd unit file");

  // 4. Reload, enable, and start
  const reloadResult = await ssh.exec("systemctl daemon-reload");
  if (reloadResult.exitCode !== 0) {
    throw new Error(`systemctl daemon-reload failed: ${reloadResult.stderr}`);
  }

  const enableResult = await ssh.exec("systemctl enable hivemi-daemon");
  if (enableResult.exitCode !== 0) {
    throw new Error(`systemctl enable failed: ${enableResult.stderr}`);
  }

  const startResult = await ssh.exec("systemctl start hivemi-daemon");
  if (startResult.exitCode !== 0) {
    throw new Error(`systemctl start failed: ${startResult.stderr}`);
  }

  logger?.info("Agent Daemon installed and started as systemd service");
}

// ---------------------------------------------------------------------------
// Sub-phase: Verify Installation
// ---------------------------------------------------------------------------

/**
 * Result of the post-install verification.
 */
export interface VerifyResult {
  /** Whether the daemon service is running */
  running: boolean;
  /** systemctl status output */
  statusOutput: string;
  /** Initial journal logs (last 20 lines) */
  logs: string;
}

/**
 * Verify the Agent Daemon is running after installation.
 *
 * Checks:
 * 1. `systemctl is-active hivemi-daemon` = "active"
 * 2. `journalctl -u hivemi-daemon --no-pager -n 20` for initial logs
 *
 * @throws if the daemon is not running
 */
export async function verifyInstallation(
  ssh: ISSHClient,
  logger?: BootstrapperLogger,
): Promise<VerifyResult> {
  logger?.info("Verifying daemon installation");

  // 1. Check service is active
  const isActiveResult = await ssh.exec("systemctl is-active hivemi-daemon");
  const isActive = isActiveResult.stdout.trim() === "active";

  // 2. Get detailed status
  const statusResult = await ssh.exec("systemctl status hivemi-daemon --no-pager 2>&1 || true");

  // 3. Get initial logs
  const logsResult = await ssh.exec(
    "journalctl -u hivemi-daemon --no-pager -n 20 2>/dev/null || echo 'No logs available yet'",
  );

  const result: VerifyResult = {
    running: isActive,
    statusOutput: statusResult.stdout,
    logs: logsResult.stdout,
  };

  if (!isActive) {
    logger?.error(`Daemon is not running (status: ${isActiveResult.stdout.trim()})`);
    logger?.error(`Status output:\n${statusResult.stdout}`);
    logger?.error(`Logs:\n${logsResult.stdout}`);
    throw new Error(
      `Agent Daemon is not running after installation. ` +
      `Status: ${isActiveResult.stdout.trim()}. ` +
      `Check journalctl -u hivemi-daemon for details.`,
    );
  }

  logger?.info("Daemon is running ✓");
  logger?.debug(`Status:\n${statusResult.stdout.slice(0, 500)}`);
  logger?.debug(`Logs:\n${logsResult.stdout.slice(0, 500)}`);

  return result;
}

// ---------------------------------------------------------------------------
// Full configure phase (orchestrates sub-phases)
// ---------------------------------------------------------------------------

/**
 * Execute the full SSH configuration phase:
 * 1. Inject secrets
 * 2. Configure OpenClaw
 * 3. Copy role config
 * 4. Install daemon
 * 5. Verify installation
 *
 * Each sub-phase is reported separately for granular error tracking.
 */
export interface ConfigureCallbacks {
  onPhaseStart?: (phase: string) => void;
  onPhaseComplete?: (phase: string) => void;
  onPhaseError?: (phase: string, error: Error) => void;
}

export async function configure(
  ssh: ISSHClient,
  config: BootstrapConfig,
  logger?: BootstrapperLogger,
  callbacks?: ConfigureCallbacks,
): Promise<void> {
  // 1. Inject secrets
  callbacks?.onPhaseStart?.("inject-secrets");
  let injectionResult: SecretInjectionResult;
  try {
    injectionResult = await injectSecrets(
      ssh,
      config.secretProvider,
      config.secrets,
      logger,
    );
    callbacks?.onPhaseComplete?.("inject-secrets");
  } catch (err) {
    callbacks?.onPhaseError?.("inject-secrets", err as Error);
    throw err;
  }

  // 2. Configure OpenClaw
  callbacks?.onPhaseStart?.("configure-openclaw");
  let authEnvVars = new Map<string, string>();
  try {
    const result = await configureOpenClaw(
      ssh,
      config.agent,
      config.role.soulMd,
      config.openclawApiToken,
      logger,
    );
    authEnvVars = result.authEnvVars;
    callbacks?.onPhaseComplete?.("configure-openclaw");
  } catch (err) {
    callbacks?.onPhaseError?.("configure-openclaw", err as Error);
    throw err;
  }

  // 3. Copy role config
  callbacks?.onPhaseStart?.("copy-role-config");
  try {
    await copyRoleConfig(ssh, config.role, logger);
    callbacks?.onPhaseComplete?.("copy-role-config");
  } catch (err) {
    callbacks?.onPhaseError?.("copy-role-config", err as Error);
    throw err;
  }

  // 4. Install daemon
  callbacks?.onPhaseStart?.("install-daemon");
  try {
    // Merge injected secrets with auth profile env vars
    const mergedSecrets = new Map([
      ...injectionResult.envSecrets,
      ...authEnvVars,
    ]);
    await installDaemon(ssh, config, mergedSecrets, logger);
    callbacks?.onPhaseComplete?.("install-daemon");
  } catch (err) {
    callbacks?.onPhaseError?.("install-daemon", err as Error);
    throw err;
  }

  // 5. Verify installation
  callbacks?.onPhaseStart?.("verify-install");
  try {
    await verifyInstallation(ssh, logger);
    callbacks?.onPhaseComplete?.("verify-install");
  } catch (err) {
    callbacks?.onPhaseError?.("verify-install", err as Error);
    throw err;
  }
}

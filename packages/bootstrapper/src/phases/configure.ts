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
  AgentConfig,
  RoleConfig,
} from "../types.js";

const OPENCLAW_HOME = "/home/openclaw";
const OPENCLAW_WORKSPACE = `${OPENCLAW_HOME}/.openclaw/workspace`;
const DAEMON_DIR = `${OPENCLAW_HOME}/.hivemi/daemon`;

// ---------------------------------------------------------------------------
// Sub-phase: Inject Secrets
// ---------------------------------------------------------------------------

/**
 * Resolve secrets via the provider and write them to the daemon's .env.
 * This is called before daemon installation so the .env is ready.
 *
 * @returns Resolved secret map (envVar → value)
 */
export async function injectSecrets(
  secretProvider: ISecretProvider,
  mappings: SecretMapping[],
  logger?: BootstrapperLogger,
): Promise<Map<string, string>> {
  if (mappings.length === 0) {
    logger?.info("No secrets to inject");
    return new Map();
  }

  logger?.info(`Resolving ${mappings.length} secret(s) via ${secretProvider.name}`);

  const resolved = await secretProvider.resolveAll(mappings);

  logger?.info(`Resolved ${resolved.size} secret(s)`);
  return resolved;
}

// ---------------------------------------------------------------------------
// Sub-phase: Configure OpenClaw
// ---------------------------------------------------------------------------

/**
 * Configure OpenClaw on the VM:
 * - Set default model
 * - Enable Chat Completions API endpoint (headless, no WhatsApp/Telegram)
 * - Set API token for authentication
 * - Write SOUL.md as the system prompt
 */
export async function configureOpenClaw(
  ssh: ISSHClient,
  agent: AgentConfig,
  soulMd: string,
  apiToken?: string,
  logger?: BootstrapperLogger,
): Promise<void> {
  logger?.info("Configuring OpenClaw");

  // Ensure workspace exists
  await ssh.exec(`mkdir -p ${OPENCLAW_WORKSPACE}`);

  // Write SOUL.md
  await ssh.writeFile(`${OPENCLAW_WORKSPACE}/SOUL.md`, soulMd);
  logger?.debug("Wrote SOUL.md");

  // Generate OpenClaw config
  // The agent runs headless — Chat Completions API only, no messaging channels
  const openclawConfig = {
    llm: {
      model: agent.model,
    },
    gateway: {
      http: {
        endpoints: {
          chatCompletions: {
            enabled: true,
            ...(apiToken ? { auth: { token: apiToken } } : {}),
          },
        },
      },
    },
    sandbox: "off",
  };

  const configPath = `${OPENCLAW_HOME}/.openclaw/config.yaml`;
  // Write as YAML-ish JSON (OpenClaw accepts JSON config)
  // Mode 600: config contains API token — readable only by openclaw user
  await ssh.writeFile(configPath, JSON.stringify(openclawConfig, null, 2), "600");
  logger?.info("OpenClaw configured (model, Chat Completions API, sandbox off)");
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
  let resolvedSecrets: Map<string, string>;
  try {
    resolvedSecrets = await injectSecrets(
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
  try {
    await configureOpenClaw(
      ssh,
      config.agent,
      config.role.soulMd,
      config.openclawApiToken,
      logger,
    );
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
    await installDaemon(ssh, config, resolvedSecrets, logger);
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

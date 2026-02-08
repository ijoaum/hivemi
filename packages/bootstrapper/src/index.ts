// =============================================================================
// @hivemi/bootstrapper
// Transforms a provisioned VM into a functional HiveMI agent.
//
// Three phases:
//   1. Cloud-init — generic OS setup (runs as user-data on VM creation)
//   2. SSH Configuration — secrets, OpenClaw, role files, daemon install
//   3. Registration — poll Registry until daemon checks in
// =============================================================================

// Types
export type {
  BootstrapperLogger,
  BootstrapPhaseName,
  BootstrapPhaseStatus,
  BootstrapPhase,
  AgentConfig,
  RoleConfig,
  BootstrapConfig,
  BootstrapStatus,
  BootstrapResult,
  SecretMapping,
  ISecretProvider,
  SSHExecResult,
  ISSHClient,
  SSHClientConfig,
  BootstrapTimeouts,
  CloudInitContext,
} from "./types.js";

export { consoleLogger, DEFAULT_TIMEOUTS } from "./types.js";

// SSH Client
export { SSHClient } from "./ssh-client.js";

// Secret Providers
export { OnePasswordProvider } from "./secrets/onepassword.js";
export { EnvFileProvider } from "./secrets/envfile.js";

// Phases (individual, for advanced usage)
export { generateCloudInit, waitCloudInit } from "./phases/cloud-init.js";
export {
  injectSecrets,
  configureOpenClaw,
  copyRoleConfig,
  installDaemon,
  configure,
} from "./phases/configure.js";
export { waitRegistration } from "./phases/wait-registration.js";

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

import type {
  BootstrapConfig,
  BootstrapResult,
  BootstrapPhase,
  BootstrapPhaseName,
  BootstrapTimeouts,
  BootstrapperLogger,
} from "./types.js";
import { consoleLogger as defaultLogger, DEFAULT_TIMEOUTS } from "./types.js";
import { SSHClient } from "./ssh-client.js";
import { waitCloudInit } from "./phases/cloud-init.js";
import { configure } from "./phases/configure.js";
import { waitRegistration } from "./phases/wait-registration.js";

// ---------------------------------------------------------------------------
// Phase tracking helpers
// ---------------------------------------------------------------------------

function createPhases(): BootstrapPhase[] {
  const names: BootstrapPhaseName[] = [
    "cloud-init",
    "ssh-connect",
    "inject-secrets",
    "configure-openclaw",
    "copy-role-config",
    "install-daemon",
    "wait-registration",
  ];

  return names.map((name) => ({
    name,
    status: "pending",
    startedAt: null,
    completedAt: null,
    error: null,
  }));
}

function startPhase(phases: BootstrapPhase[], name: BootstrapPhaseName): void {
  const phase = phases.find((p) => p.name === name);
  if (phase) {
    phase.status = "running";
    phase.startedAt = new Date().toISOString();
  }
}

function completePhase(phases: BootstrapPhase[], name: BootstrapPhaseName): void {
  const phase = phases.find((p) => p.name === name);
  if (phase) {
    phase.status = "completed";
    phase.completedAt = new Date().toISOString();
  }
}

function failPhase(phases: BootstrapPhase[], name: BootstrapPhaseName, error: string): void {
  const phase = phases.find((p) => p.name === name);
  if (phase) {
    phase.status = "failed";
    phase.completedAt = new Date().toISOString();
    phase.error = error;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap orchestrator
// ---------------------------------------------------------------------------

/**
 * Bootstrap options beyond the config.
 */
export interface BootstrapOptions {
  /** Timeout overrides */
  timeouts?: BootstrapTimeouts;
  /** Logger */
  logger?: BootstrapperLogger;
  /** Skip cloud-init wait (e.g. if using a pre-baked image) */
  skipCloudInit?: boolean;
  /** Callback for phase updates (for reporting to deploy status) */
  onPhaseUpdate?: (phases: BootstrapPhase[]) => void;
}

/**
 * Run the full bootstrap sequence.
 *
 * This is the main entry point for the bootstrapper. It:
 * 1. Connects via SSH and waits for cloud-init
 * 2. Injects secrets, configures OpenClaw, copies role files
 * 3. Installs the Agent Daemon as a systemd service
 * 4. Waits for the daemon to register with the Registry
 *
 * Each phase is tracked individually, so callers can report granular progress
 * to the deploy status.
 *
 * @param config - Full bootstrap configuration
 * @param options - Optional timeouts, logger, and callbacks
 * @returns BootstrapResult with per-phase status
 */
export async function bootstrap(
  config: BootstrapConfig,
  options?: BootstrapOptions,
): Promise<BootstrapResult> {
  const log = options?.logger ?? defaultLogger;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options?.timeouts };
  const phases = createPhases();
  const startTime = Date.now();

  const emitPhases = () => options?.onPhaseUpdate?.([...phases]);

  let ssh: SSHClient | null = null;

  try {
    // -----------------------------------------------------------------------
    // Phase 1: Cloud-init wait
    // -----------------------------------------------------------------------
    if (options?.skipCloudInit) {
      const phase = phases.find((p) => p.name === "cloud-init");
      if (phase) phase.status = "skipped";
      log.info("Skipping cloud-init wait (skipCloudInit=true)");
      emitPhases();
    } else {
      startPhase(phases, "cloud-init");
      emitPhases();

      // Connect temporarily to check cloud-init
      ssh = new SSHClient(
        {
          host: config.host,
          port: config.sshPort ?? 22,
          username: config.sshUser ?? "root",
          privateKey: config.sshPrivateKey,
        },
        log,
      );

      // SSH might not be ready immediately — retry
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= timeouts.sshConnectRetries; attempt++) {
        try {
          await ssh.connect();
          lastError = null;
          break;
        } catch (err) {
          lastError = err as Error;
          log.warn(`SSH connect attempt ${attempt}/${timeouts.sshConnectRetries} failed: ${lastError.message}`);
          if (attempt < timeouts.sshConnectRetries) {
            await new Promise((r) => setTimeout(r, 15_000));
          }
        }
      }
      if (lastError) {
        throw new Error(`SSH connection failed after ${timeouts.sshConnectRetries} attempts: ${lastError.message}`);
      }

      await waitCloudInit(ssh, timeouts.cloudInitMs, 15_000, log);
      completePhase(phases, "cloud-init");
      emitPhases();

      // Disconnect — we'll reconnect as the right user for configuration
      await ssh.disconnect();
      ssh = null;
    }

    // -----------------------------------------------------------------------
    // Phase 2: SSH Connect (as openclaw user for configuration)
    // -----------------------------------------------------------------------
    startPhase(phases, "ssh-connect");
    emitPhases();

    ssh = new SSHClient(
      {
        host: config.host,
        port: config.sshPort ?? 22,
        // After cloud-init, connect as the openclaw user for setup.
        // Some operations (systemd) will use sudo.
        username: config.sshUser ?? "root",
        privateKey: config.sshPrivateKey,
      },
      log,
    );

    let sshLastError: Error | null = null;
    for (let attempt = 1; attempt <= timeouts.sshConnectRetries; attempt++) {
      try {
        await ssh.connect();
        sshLastError = null;
        break;
      } catch (err) {
        sshLastError = err as Error;
        log.warn(`SSH connect attempt ${attempt}/${timeouts.sshConnectRetries} failed: ${sshLastError.message}`);
        if (attempt < timeouts.sshConnectRetries) {
          await new Promise((r) => setTimeout(r, 10_000));
        }
      }
    }

    if (sshLastError) {
      failPhase(phases, "ssh-connect", sshLastError.message);
      emitPhases();
      throw sshLastError;
    }

    completePhase(phases, "ssh-connect");
    emitPhases();

    // -----------------------------------------------------------------------
    // Phase 2b-2e: Configure (secrets, openclaw, role, daemon)
    // -----------------------------------------------------------------------
    await configure(ssh, config, log, {
      onPhaseStart: (phase) => {
        startPhase(phases, phase as BootstrapPhaseName);
        emitPhases();
      },
      onPhaseComplete: (phase) => {
        completePhase(phases, phase as BootstrapPhaseName);
        emitPhases();
      },
      onPhaseError: (phase, error) => {
        failPhase(phases, phase as BootstrapPhaseName, error.message);
        emitPhases();
      },
    });

    // -----------------------------------------------------------------------
    // Phase 3: Wait for Registration
    // -----------------------------------------------------------------------
    startPhase(phases, "wait-registration");
    emitPhases();

    await waitRegistration(
      {
        agentId: config.agent.agentId,
        registryUrl: config.registryUrl,
        timeoutMs: timeouts.registrationMs,
        pollIntervalMs: timeouts.registrationPollMs,
        ssh,
      },
      log,
    );

    completePhase(phases, "wait-registration");
    emitPhases();

    // -----------------------------------------------------------------------
    // Success!
    // -----------------------------------------------------------------------
    log.info(`Bootstrap completed successfully for ${config.agent.agentName}`);

    return {
      status: "success",
      phases,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const error = err as Error;
    log.error(`Bootstrap failed: ${error.message}`);

    // Find the failed phase (if any sub-phase didn't mark it)
    const failedPhase = phases.find((p) => p.status === "failed");
    const runningPhase = phases.find((p) => p.status === "running");

    if (runningPhase && !failedPhase) {
      failPhase(phases, runningPhase.name, error.message);
    }

    return {
      status: "failed",
      phases,
      durationMs: Date.now() - startTime,
      error: error.message,
      failedPhase: (failedPhase ?? runningPhase)?.name,
    };
  } finally {
    if (ssh?.connected) {
      try {
        await ssh.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
  }
}

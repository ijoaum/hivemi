// =============================================================================
// Phase 3: Wait for Registration
// Polls the Registry until the Agent Daemon registers itself.
// =============================================================================

import type { BootstrapperLogger, ISSHClient } from "../types.js";

/**
 * Options for the registration poll loop.
 */
export interface WaitRegistrationOptions {
  /** Agent UUID to check for */
  agentId: string;
  /** Registry base URL (e.g. "http://localhost:4001") */
  registryUrl: string;
  /** Timeout in milliseconds (default: 120_000 = 2 min) */
  timeoutMs?: number;
  /** Poll interval in milliseconds (default: 5_000) */
  pollIntervalMs?: number;
  /** Optional SSH client for fetching journalctl on failure */
  ssh?: ISSHClient;
}

/**
 * Poll the Registry's `GET /api/agents/:id` endpoint until the agent
 * appears and is no longer in "provisioning" status.
 *
 * The Agent Daemon calls `POST /api/agents/:id/heartbeat` when it starts,
 * which transitions the agent to "idle". We wait for that.
 *
 * @throws if the agent doesn't register within the timeout
 */
export async function waitRegistration(
  options: WaitRegistrationOptions,
  logger?: BootstrapperLogger,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollIntervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  logger?.info(
    `Waiting for agent ${options.agentId} to register (timeout: ${Math.round(timeoutMs / 1000)}s)`,
  );

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${options.registryUrl}/api/agents/${options.agentId}`);

      if (res.ok) {
        const body = (await res.json()) as {
          success: boolean;
          data?: { status: string; lastHeartbeat: string | null };
        };

        if (body.success && body.data) {
          const { status, lastHeartbeat } = body.data;

          // Agent has registered and sent at least one heartbeat
          if (status !== "provisioning" && lastHeartbeat) {
            logger?.info(`Agent ${options.agentId} registered (status: ${status})`);
            return;
          }

          logger?.debug(`Agent status: ${status}, heartbeat: ${lastHeartbeat ?? "none"}`);
        }
      }
    } catch (err) {
      // Registry might not be reachable yet — just retry
      logger?.debug(`Registry check failed: ${(err as Error).message}`);
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  // Timeout — try to get daemon logs for diagnostics
  let diagnostics = "";
  if (options.ssh?.connected) {
    try {
      const result = await options.ssh.exec(
        "journalctl -u hivemi-daemon --no-pager -n 50 2>/dev/null || echo 'No logs available'",
      );
      diagnostics = `\n\nDaemon logs:\n${result.stdout}`;
    } catch {
      // ignore — best effort
    }
  }

  throw new Error(
    `Agent ${options.agentId} did not register within ${Math.round(timeoutMs / 1000)}s. ` +
    `The daemon may have failed to start — check journalctl on the VM.${diagnostics}`,
  );
}

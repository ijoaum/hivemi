// =============================================================================
// Phase 1: Cloud-Init
// Generates the cloud-init user-data YAML and waits for it to complete.
// =============================================================================

import type {
  ISSHClient,
  BootstrapperLogger,
  CloudInitContext,
} from "../types.js";

// ---------------------------------------------------------------------------
// Swap section template
// ---------------------------------------------------------------------------

function swapSection(sizeMb: number): string {
  return `swap:
  filename: /swapfile
  size: ${sizeMb * 1024 * 1024}
  maxsize: ${sizeMb * 1024 * 1024}`;
}

// ---------------------------------------------------------------------------
// Generate cloud-init YAML
// ---------------------------------------------------------------------------

/**
 * Generate the cloud-init user-data YAML string.
 *
 * This is called by the orchestrator BEFORE creating the VM — the YAML is
 * passed as `userData` to the provisioner's `createInstance`.
 */
export function generateCloudInit(
  sshPublicKey: string,
  context: CloudInitContext = { enableSwap: true, swapSizeMb: 2048 },
): string {
  const swap = context.enableSwap
    ? swapSection(context.swapSizeMb ?? 2048)
    : "# swap disabled";

  return `#cloud-config
# =============================================================================
# HiveMI Cloud-Init — Generic VM setup
# =============================================================================

users:
  - name: openclaw
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    groups: [sudo]
    lock_passwd: true
    ssh_authorized_keys:
      - ${sshPublicKey}

package_update: true
package_upgrade: true
packages:
  - curl
  - jq
  - git
  - htop
  - unzip

${swap}

runcmd:
  - |
    su - openclaw -c 'curl -fsSL https://openclaw.ai/install.sh | bash -s -- --non-interactive' || true
  - |
    echo 'export PATH="$HOME/.local/bin:/home/linuxbrew/.linuxbrew/bin:$PATH"' >> /home/openclaw/.bashrc
  - touch /tmp/hivemi-cloud-init-done
  - chown openclaw:openclaw /tmp/hivemi-cloud-init-done

final_message: "HiveMI cloud-init complete after $UPTIME seconds"
`;
}

// ---------------------------------------------------------------------------
// Wait for cloud-init to complete
// ---------------------------------------------------------------------------

/**
 * Poll the VM over SSH until `/tmp/hivemi-cloud-init-done` exists.
 *
 * @param ssh - Connected SSH client
 * @param timeoutMs - Maximum time to wait (default: 600_000 = 10 min)
 * @param pollIntervalMs - Poll interval (default: 15_000 = 15s)
 * @param logger - Logger
 * @throws if the flag file doesn't appear within the timeout
 */
export async function waitCloudInit(
  ssh: ISSHClient,
  timeoutMs: number = 600_000,
  pollIntervalMs: number = 15_000,
  logger?: BootstrapperLogger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  logger?.info(`Waiting for cloud-init to complete (timeout: ${Math.round(timeoutMs / 1000)}s)`);

  while (Date.now() < deadline) {
    const exists = await ssh.fileExists("/tmp/hivemi-cloud-init-done");
    if (exists) {
      logger?.info("Cloud-init completed");
      return;
    }

    logger?.debug("Cloud-init still running...");
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(
    `Cloud-init did not complete within ${Math.round(timeoutMs / 1000)}s. ` +
    `Check /var/log/cloud-init-output.log on the VM.`,
  );
}

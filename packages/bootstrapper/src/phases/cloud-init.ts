// =============================================================================
// Phase 1: Cloud-Init
// Generates the cloud-init user-data YAML and waits for it to complete.
//
// The cloud-init template is the entry point for agent VMs. It:
//   1. Creates the openclaw user with SSH access
//   2. Sets the VM hostname
//   3. Installs base packages
//   4. Optionally configures swap
//   5. Downloads and executes hivemi-agent-bootstrap.sh from a GitHub Release
//   6. The bootstrap script handles everything else (OpenClaw, daemon, etc.)
//   7. Writes /tmp/hivemi-cloud-init-done when finished
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
// Bootstrap script download + execution section
// ---------------------------------------------------------------------------

/**
 * Generate the runcmd section for downloading and executing the bootstrap
 * script from a GitHub Release.
 *
 * When releaseUrl and ghToken are provided, the script is downloaded from
 * the private repo release. Otherwise, falls back to a basic OpenClaw install
 * for backward compatibility.
 */
function bootstrapRunCmd(context: CloudInitContext): string {
  const { releaseUrl, ghToken, hostname } = context;

  const lines: string[] = [];

  // Set hostname if provided
  if (hostname) {
    lines.push(`  - hostnamectl set-hostname "${hostname}"`);
  }

  if (releaseUrl && ghToken) {
    // Download bootstrap script from GitHub Release (private repo)
    lines.push(`  - |`);
    lines.push(`    export RELEASE_URL="${releaseUrl}"`);
    lines.push(`    export GH_TOKEN="${ghToken}"`);
    lines.push(`    SCRIPT_URL="${releaseUrl}/hivemi-agent-bootstrap.sh"`);
    lines.push(`    echo "Downloading bootstrap script from $SCRIPT_URL"`);
    lines.push(`    curl -fsSL \\`);
    lines.push(`      -H "Authorization: token $GH_TOKEN" \\`);
    lines.push(`      -H "Accept: application/octet-stream" \\`);
    lines.push(`      -o /tmp/hivemi-agent-bootstrap.sh \\`);
    lines.push(`      "$SCRIPT_URL"`);
    lines.push(`    chmod +x /tmp/hivemi-agent-bootstrap.sh`);
    lines.push(`    echo "Running bootstrap script..."`);
    lines.push(`    /tmp/hivemi-agent-bootstrap.sh "$RELEASE_URL" "$GH_TOKEN" 2>&1 | tee /var/log/hivemi-bootstrap.log`);
  } else if (releaseUrl) {
    // Public repo — no auth header needed
    lines.push(`  - |`);
    lines.push(`    export RELEASE_URL="${releaseUrl}"`);
    lines.push(`    SCRIPT_URL="${releaseUrl}/hivemi-agent-bootstrap.sh"`);
    lines.push(`    echo "Downloading bootstrap script from $SCRIPT_URL"`);
    lines.push(`    curl -fsSL \\`);
    lines.push(`      -H "Accept: application/octet-stream" \\`);
    lines.push(`      -o /tmp/hivemi-agent-bootstrap.sh \\`);
    lines.push(`      "$SCRIPT_URL"`);
    lines.push(`    chmod +x /tmp/hivemi-agent-bootstrap.sh`);
    lines.push(`    echo "Running bootstrap script..."`);
    lines.push(`    /tmp/hivemi-agent-bootstrap.sh "$RELEASE_URL" 2>&1 | tee /var/log/hivemi-bootstrap.log`);
  } else {
    // Legacy fallback: direct OpenClaw install (no bootstrap script)
    lines.push(`  - |`);
    lines.push(`    su - openclaw -c 'curl -fsSL https://openclaw.ai/install.sh | bash -s -- --non-interactive' || true`);
    lines.push(`  - |`);
    lines.push(`    echo 'export PATH="$HOME/.local/bin:/home/linuxbrew/.linuxbrew/bin:$PATH"' >> /home/openclaw/.bashrc`);
  }

  // Completion flag — always written last
  lines.push(`  - touch /tmp/hivemi-cloud-init-done`);
  lines.push(`  - chown openclaw:openclaw /tmp/hivemi-cloud-init-done`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generate cloud-init YAML
// ---------------------------------------------------------------------------

/**
 * Generate the cloud-init user-data YAML string.
 *
 * This is called by the orchestrator BEFORE creating the VM — the YAML is
 * passed as `userData` to the provisioner's `createInstance`.
 *
 * Template variables (interpolated by the Provisioner before sending):
 *  - sshPublicKey — SSH public key for Bootstrapper access
 *  - context.hostname — VM hostname (agent name)
 *  - context.releaseUrl — GitHub Release URL for the bootstrap script
 *  - context.ghToken — GitHub token for private repo access
 */
export function generateCloudInit(
  sshPublicKey: string,
  context: CloudInitContext = { enableSwap: true, swapSizeMb: 2048 },
): string {
  const swap = context.enableSwap
    ? swapSection(context.swapSizeMb ?? 2048)
    : "# swap disabled";

  const hostname = context.hostname ?? "hivemi-agent";

  return `#cloud-config
# =============================================================================
# HiveMI Cloud-Init — Agent VM Bootstrap
# Generated by @hivemi/bootstrapper
# =============================================================================

# --- Hostname ----------------------------------------------------------------
hostname: ${hostname}
manage_etc_hosts: true

# --- User Setup --------------------------------------------------------------
users:
  - name: openclaw
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    groups: [sudo]
    lock_passwd: true
    ssh_authorized_keys:
      - ${sshPublicKey}

# --- Packages ----------------------------------------------------------------
package_update: true
package_upgrade: true
packages:
  - curl
  - jq
  - git
  - htop
  - unzip

# --- Swap --------------------------------------------------------------------
${swap}

# --- Bootstrap ---------------------------------------------------------------
runcmd:
${bootstrapRunCmd(context)}

final_message: "HiveMI cloud-init complete for ${hostname} after $UPTIME seconds"
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

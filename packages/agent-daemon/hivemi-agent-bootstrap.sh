#!/usr/bin/env bash
# =============================================================================
# hivemi-agent-bootstrap.sh
#
# Self-contained bootstrap script for HiveMI agent VMs.
# Called by cloud-init on first boot — does everything from user creation
# to daemon setup.
#
# Usage (called by cloud-init):
#   curl -fsSL <release-url>/hivemi-agent-bootstrap.sh | bash
#
# Environment variables (set by cloud-init user_data):
#   HIVEMI_RELEASE_URL — URL base of the GitHub Release (required)
#   HIVEMI_GH_TOKEN    — GitHub token for private repo access (optional)
#
# What this script does (in order):
#   1. Create user "openclaw" with sudo and home /home/openclaw
#   2. Configure 2GB swap (for VMs with 1GB RAM)
#   3. apt update && apt upgrade -y
#   4. Install base packages: jq, curl, git, build-essential
#   5. Install OpenClaw: curl -fsSL https://openclaw.ai/install.sh | bash
#   6. Verify OpenClaw installation
#   7. Download hivemi-daemon.tar.gz from GitHub Release
#   8. Extract to /home/openclaw/.hivemi/daemon/
#   9. Install deps (npm install --production)
#   9.5. Configure OpenClaw (agents, tools, gateway, plugins)
#  10. Copy systemd unit file
#  11. systemctl daemon-reload && systemctl enable hivemi-agent
#  12. Does NOT start the service (Bootstrapper does that after injecting config)
#  13. Write completion flag /tmp/hivemi-cloud-init-done
#
# Idempotent — safe to re-run.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HIVEMI_RELEASE_URL="${HIVEMI_RELEASE_URL:-}"
HIVEMI_GH_TOKEN="${HIVEMI_GH_TOKEN:-}"

OPENCLAW_USER="openclaw"
OPENCLAW_HOME="/home/${OPENCLAW_USER}"
DAEMON_DIR="${OPENCLAW_HOME}/.hivemi/daemon"
SWAP_FILE="/swapfile"
SWAP_SIZE_MB=2048
COMPLETION_FLAG="/tmp/hivemi-cloud-init-done"
LOG_FILE="/var/log/hivemi-bootstrap.log"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_FILE"
}

warn() {
  log "WARN: $*"
}

error() {
  log "ERROR: $*"
  exit 1
}

# ---------------------------------------------------------------------------
# Download helper (supports private repo auth)
# ---------------------------------------------------------------------------

download() {
  local url="$1"
  local output="$2"
  if [ -n "$HIVEMI_GH_TOKEN" ]; then
    curl -fsSL \
      -H "Authorization: token $HIVEMI_GH_TOKEN" \
      -H "Accept: application/octet-stream" \
      -o "$output" \
      "$url"
  else
    curl -fsSL \
      -H "Accept: application/octet-stream" \
      -o "$output" \
      "$url"
  fi
}

# ---------------------------------------------------------------------------
# Step 1: Create user "openclaw"
# ---------------------------------------------------------------------------

setup_user() {
  log "Step 1: Setting up user '${OPENCLAW_USER}'"

  if id "$OPENCLAW_USER" &>/dev/null; then
    log "User '${OPENCLAW_USER}' already exists — skipping"
  else
    useradd \
      --create-home \
      --home-dir "$OPENCLAW_HOME" \
      --shell /bin/bash \
      "$OPENCLAW_USER"
    log "User '${OPENCLAW_USER}' created"
  fi

  # Ensure sudo access (idempotent — overwrites if exists)
  echo "${OPENCLAW_USER} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/${OPENCLAW_USER}"
  chmod 440 "/etc/sudoers.d/${OPENCLAW_USER}"
  log "Sudo access configured for '${OPENCLAW_USER}'"
}

# ---------------------------------------------------------------------------
# Step 2: Configure swap (2GB)
# ---------------------------------------------------------------------------

setup_swap() {
  log "Step 2: Configuring ${SWAP_SIZE_MB}MB swap"

  if swapon --show | grep -q "$SWAP_FILE"; then
    log "Swap already active at ${SWAP_FILE} — skipping"
    return
  fi

  if [ -f "$SWAP_FILE" ]; then
    log "Swap file exists but not active — activating"
  else
    log "Creating ${SWAP_SIZE_MB}MB swap file"
    dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=progress 2>&1 | tail -1
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE"
  fi

  swapon "$SWAP_FILE"
  log "Swap activated: $(swapon --show)"

  # Ensure swap persists across reboots
  if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
    log "Swap entry added to /etc/fstab"
  fi
}

# ---------------------------------------------------------------------------
# Step 3 & 4: System packages
# ---------------------------------------------------------------------------

install_packages() {
  log "Step 3: Updating system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y

  log "Step 4: Installing base packages"
  apt-get install -y jq curl git build-essential
  log "Base packages installed"
}

# ---------------------------------------------------------------------------
# Step 5 & 6: Install and verify OpenClaw
# ---------------------------------------------------------------------------

install_openclaw() {
  log "Step 5: Installing OpenClaw"

  # Run as the openclaw user — the installer sets up in their home
  sudo -u "$OPENCLAW_USER" bash -c \
    'curl -fsSL https://openclaw.ai/install.sh | bash -s -- --non-interactive' \
    || warn "OpenClaw install exited with non-zero status"

  # Ensure PATH includes linuxbrew (OpenClaw installs via Homebrew)
  local openclaw_path="${OPENCLAW_HOME}/.local/bin:/home/linuxbrew/.linuxbrew/bin"

  log "Step 6: Verifying OpenClaw installation"
  local version
  version=$(sudo -u "$OPENCLAW_USER" bash -c "export PATH=\"${openclaw_path}:\$PATH\" && openclaw --version" 2>&1) || true

  if [ -n "$version" ]; then
    log "OpenClaw installed: ${version}"
  else
    warn "OpenClaw --version returned empty — install may have failed"
  fi

  # Add PATH to bashrc so it persists for the user
  local bashrc="${OPENCLAW_HOME}/.bashrc"
  if ! grep -q "linuxbrew" "$bashrc" 2>/dev/null; then
    echo "export PATH=\"${openclaw_path}:\$PATH\"" >> "$bashrc"
    chown "$OPENCLAW_USER:$OPENCLAW_USER" "$bashrc"
    log "PATH updated in ${bashrc}"
  fi
}

# ---------------------------------------------------------------------------
# Step 7-9: Download, extract, and install daemon
# ---------------------------------------------------------------------------

install_daemon() {
  if [ -z "$HIVEMI_RELEASE_URL" ]; then
    warn "HIVEMI_RELEASE_URL not set — skipping daemon install"
    return
  fi

  local tarball_url="${HIVEMI_RELEASE_URL}/hivemi-daemon.tar.gz"
  local tarball_tmp="/tmp/hivemi-daemon.tar.gz"

  log "Step 7: Downloading daemon tarball from ${tarball_url}"
  download "$tarball_url" "$tarball_tmp"

  log "Step 8: Extracting to ${DAEMON_DIR}"
  mkdir -p "$DAEMON_DIR"
  tar -xzf "$tarball_tmp" -C "$DAEMON_DIR"
  rm -f "$tarball_tmp"

  log "Step 9: Installing production dependencies"
  cd "$DAEMON_DIR"

  # Wait for Node.js to be available (OpenClaw install may still be running)
  local max_wait=300
  local waited=0
  local node_path="${OPENCLAW_HOME}/.local/bin:/home/linuxbrew/.linuxbrew/bin"

  while ! sudo -u "$OPENCLAW_USER" bash -c "export PATH=\"${node_path}:\$PATH\" && command -v node" &>/dev/null; do
    if [ "$waited" -ge "$max_wait" ]; then
      error "Node.js not available after ${max_wait}s — OpenClaw install may have failed"
    fi
    log "Waiting for Node.js... (${waited}s)"
    sleep 10
    waited=$((waited + 10))
  done

  local node_version
  node_version=$(sudo -u "$OPENCLAW_USER" bash -c "export PATH=\"${node_path}:\$PATH\" && node --version")
  log "Node.js found: ${node_version}"

  # Install production deps as openclaw user
  sudo -u "$OPENCLAW_USER" bash -c \
    "export PATH=\"${node_path}:\$PATH\" && cd \"${DAEMON_DIR}\" && npm install --omit=dev --no-audit --no-fund" \
    2>&1 | tail -5

  # Set ownership
  chown -R "$OPENCLAW_USER:$OPENCLAW_USER" "$DAEMON_DIR"
  log "Daemon installed at ${DAEMON_DIR}"
}

# ---------------------------------------------------------------------------
# Step 9.5: Configure OpenClaw
# ---------------------------------------------------------------------------

configure_openclaw() {
  log "Step 9.5: Configuring OpenClaw"

  local config_dir="${OPENCLAW_HOME}/.openclaw"
  local config_file="${config_dir}/openclaw.json"

  # Create config directory if needed
  mkdir -p "$config_dir"

  # Generate config JSON
  # Tokens and channel-specific settings come from environment variables
  # set by the Bootstrapper when it injects config
  # Model config (primary, aliases, heartbeat model) is NOT set here —
  # it depends on which auth provider is configured at deploy time.
  # The Bootstrapper injects model settings along with auth tokens.
  cat > "$config_file" << 'OPENCLAW_CONFIG'
{
  "agents": {
    "defaults": {
      "workspace": "/home/openclaw/.openclaw/workspace",
      "contextPruning": {
        "mode": "cache-ttl",
        "ttl": "1h"
      },
      "compaction": {
        "mode": "safeguard"
      },
      "elevatedDefault": "full",
      "maxConcurrent": 4,
      "subagents": {
        "maxConcurrent": 8
      },
      "sandbox": {
        "mode": "off"
      }
    }
  },
  "tools": {
    "elevated": {
      "enabled": true,
      "allowFrom": {
        "webchat": ["*"],
        "whatsapp": ["*"]
      }
    }
  },
  "messages": {
    "ackReactionScope": "group-mentions"
  },
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true
  },
  "hooks": {
    "enabled": true
  },
  "discovery": {
    "mdns": {
      "mode": "off"
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token"
    },
    "trustedProxies": [
      "127.0.0.1",
      "::1"
    ],
    "tailscale": {
      "mode": "off",
      "resetOnExit": false
    },
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  },
  "plugins": {
    "entries": {
      "whatsapp": {
        "enabled": true
      },
      "telegram": {
        "enabled": true
      },
      "clawrouter": {
        "enabled": true
      },
      "discord": {
        "enabled": true
      }
    }
  }
}
OPENCLAW_CONFIG

  chown "$OPENCLAW_USER:$OPENCLAW_USER" "$config_file"
  chmod 600 "$config_file"
  log "OpenClaw config written to ${config_file}"
  log "Note: Auth tokens and channel configs will be injected by the Bootstrapper"
}

# ---------------------------------------------------------------------------
# Step 10-11: Systemd service setup
# ---------------------------------------------------------------------------

setup_systemd() {
  local service_file="${DAEMON_DIR}/systemd/hivemi-agent.service"

  if [ ! -f "$service_file" ]; then
    warn "Systemd unit file not found at ${service_file} — skipping service setup"
    return
  fi

  log "Step 10: Copying systemd unit file"
  cp "$service_file" /etc/systemd/system/hivemi-agent.service

  log "Step 11: Reloading systemd and enabling service"
  systemctl daemon-reload
  systemctl enable hivemi-agent.service
  log "hivemi-agent service enabled (not started — Bootstrapper will start after config injection)"
}

# ---------------------------------------------------------------------------
# Step 13: Write completion flag
# ---------------------------------------------------------------------------

write_completion_flag() {
  log "Step 13: Writing completion flag"
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$COMPLETION_FLAG"
  chown "$OPENCLAW_USER:$OPENCLAW_USER" "$COMPLETION_FLAG"
  log "Completion flag written to ${COMPLETION_FLAG}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  log "========================================="
  log "=== HiveMI Agent Bootstrap ==="
  log "========================================="
  log "Release URL: ${HIVEMI_RELEASE_URL:-<not set>}"
  log "Auth token: ${HIVEMI_GH_TOKEN:+<set>}${HIVEMI_GH_TOKEN:-<not set>}"
  log "Running as: $(whoami)"
  log "Hostname: $(hostname)"
  log "Ubuntu: $(lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2)"
  log ""

  local start_time
  start_time=$(date +%s)

  setup_user
  setup_swap
  install_packages
  install_openclaw
  configure_openclaw
  install_daemon
  setup_systemd
  write_completion_flag

  local end_time elapsed
  end_time=$(date +%s)
  elapsed=$((end_time - start_time))
  log ""
  log "========================================="
  log "=== Bootstrap complete in ${elapsed}s ==="
  log "========================================="
}

main "$@"

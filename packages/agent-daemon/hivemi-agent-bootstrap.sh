#!/usr/bin/env bash
# =============================================================================
# hivemi-agent-bootstrap.sh
#
# Bootstrap script for HiveMI agent VMs. Called by cloud-init after the base
# system is ready. Downloads the daemon tarball from a GitHub Release, installs
# Node.js dependencies, sets up the systemd service, and starts the daemon.
#
# Usage:
#   ./hivemi-agent-bootstrap.sh <RELEASE_URL> [GH_TOKEN]
#
# Arguments:
#   RELEASE_URL  — GitHub Release API URL for downloading assets
#   GH_TOKEN     — GitHub token for private repo access (optional for public)
#
# Environment:
#   The daemon expects a .env file at /home/openclaw/.hivemi/daemon/.env
#   (injected by the bootstrapper via SSH after cloud-init completes)
# =============================================================================

set -euo pipefail

RELEASE_URL="${1:-$RELEASE_URL}"
GH_TOKEN="${2:-${GH_TOKEN:-}}"

DAEMON_DIR="/home/openclaw/.hivemi/daemon"
LOG_FILE="/var/log/hivemi-bootstrap.log"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_FILE"
}

error() {
  log "ERROR: $*"
  exit 1
}

# ---------------------------------------------------------------------------
# Auth header for private repo
# ---------------------------------------------------------------------------

auth_header() {
  if [ -n "$GH_TOKEN" ]; then
    echo "-H 'Authorization: token $GH_TOKEN'"
  fi
}

download() {
  local url="$1"
  local output="$2"
  if [ -n "$GH_TOKEN" ]; then
    curl -fsSL \
      -H "Authorization: token $GH_TOKEN" \
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
# Main
# ---------------------------------------------------------------------------

log "=== HiveMI Agent Bootstrap ==="
log "Release URL: $RELEASE_URL"
log "Running as: $(whoami)"

# 1. Create daemon directory
log "Creating daemon directory: $DAEMON_DIR"
mkdir -p "$DAEMON_DIR"

# 2. Download daemon tarball
TARBALL_URL="${RELEASE_URL}/hivemi-daemon.tar.gz"
log "Downloading daemon tarball from $TARBALL_URL"
download "$TARBALL_URL" "/tmp/hivemi-daemon.tar.gz"

# 3. Extract tarball into daemon directory
log "Extracting tarball to $DAEMON_DIR"
tar -xzf /tmp/hivemi-daemon.tar.gz -C "$DAEMON_DIR"
rm -f /tmp/hivemi-daemon.tar.gz

# 4. Install production dependencies (Node.js should be available via OpenClaw)
log "Installing Node.js production dependencies"
cd "$DAEMON_DIR"

# Wait for OpenClaw install to make node/npm available (cloud-init runs in parallel)
MAX_WAIT=300
WAITED=0
while ! command -v node &>/dev/null; do
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    error "Node.js not available after ${MAX_WAIT}s — OpenClaw install may have failed"
  fi
  log "Waiting for Node.js... (${WAITED}s)"
  sleep 10
  WAITED=$((WAITED + 10))
  # Re-source PATH in case it was updated
  export PATH="/home/openclaw/.local/bin:/home/linuxbrew/.linuxbrew/bin:$PATH"
done

log "Node.js found: $(node --version)"

# Install deps using npm (available via Node.js, no need for pnpm in production)
if command -v npm &>/dev/null; then
  npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
else
  log "WARN: npm not found, skipping dependency install (daemon may fail if it has runtime deps)"
fi

# 5. Set ownership
log "Setting ownership to openclaw:openclaw"
chown -R openclaw:openclaw "$DAEMON_DIR"

# 6. Install systemd service
log "Installing systemd service"
sudo cp "$DAEMON_DIR/systemd/hivemi-agent.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hivemi-agent.service

# 7. Start the daemon (only if .env exists — it may be injected later by bootstrapper)
if [ -f "$DAEMON_DIR/.env" ]; then
  log "Starting hivemi-agent service"
  sudo systemctl start hivemi-agent.service
  log "Service status: $(sudo systemctl is-active hivemi-agent.service)"
else
  log "WARN: .env not found — daemon will start after bootstrapper injects configuration"
fi

log "=== Bootstrap complete ==="

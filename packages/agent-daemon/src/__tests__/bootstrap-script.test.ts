// =============================================================================
// Bootstrap Script Tests
//
// Validates the hivemi-agent-bootstrap.sh script meets all Issue #66 criteria:
// - Correct step ordering
// - Idempotency checks
// - Environment variable usage
// - Security practices
// - Completion flag
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, "../../hivemi-agent-bootstrap.sh");

function loadScript(): string {
  return readFileSync(SCRIPT_PATH, "utf-8");
}

describe("hivemi-agent-bootstrap.sh", () => {
  // -------------------------------------------------------------------------
  // Structure & basics
  // -------------------------------------------------------------------------

  describe("script structure", () => {
    it("starts with bash shebang", () => {
      const script = loadScript();
      expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
    });

    it("uses strict mode (set -euo pipefail)", () => {
      const script = loadScript();
      expect(script).toContain("set -euo pipefail");
    });

    it("is executable", () => {
      const { statSync } = require("node:fs");
      const stat = statSync(SCRIPT_PATH);
      // Check owner execute bit
      expect(stat.mode & 0o100).toBeTruthy();
    });

    it("defines a main function", () => {
      const script = loadScript();
      expect(script).toMatch(/^main\(\)/m);
    });

    it("calls main at the end", () => {
      const script = loadScript();
      const lines = script.trim().split("\n");
      const lastLine = lines[lines.length - 1].trim();
      expect(lastLine).toBe('main "$@"');
    });
  });

  // -------------------------------------------------------------------------
  // Environment variables (not positional args)
  // -------------------------------------------------------------------------

  describe("environment variables", () => {
    it("reads HIVEMI_RELEASE_URL from env", () => {
      const script = loadScript();
      expect(script).toContain('HIVEMI_RELEASE_URL="${HIVEMI_RELEASE_URL:-}"');
    });

    it("reads HIVEMI_GH_TOKEN from env", () => {
      const script = loadScript();
      expect(script).toContain('HIVEMI_GH_TOKEN="${HIVEMI_GH_TOKEN:-}"');
    });

    it("does not use positional args for release URL", () => {
      const script = loadScript();
      // Should NOT have $1 for release URL
      expect(script).not.toMatch(/RELEASE_URL="\$\{1/);
      expect(script).not.toMatch(/HIVEMI_RELEASE_URL="\$\{1/);
    });
  });

  // -------------------------------------------------------------------------
  // Step 1: User creation
  // -------------------------------------------------------------------------

  describe("step 1: user creation", () => {
    it("creates openclaw user", () => {
      const script = loadScript();
      expect(script).toContain("useradd");
      expect(script).toContain("openclaw");
    });

    it("creates user with home directory /home/openclaw", () => {
      const script = loadScript();
      expect(script).toContain("--create-home");
      expect(script).toContain("/home/openclaw");
    });

    it("checks if user already exists (idempotent)", () => {
      const script = loadScript();
      expect(script).toMatch(/id\s+/);
      expect(script).toContain("OPENCLAW_USER");
      expect(script).toContain("already exists");
    });

    it("configures sudo access", () => {
      const script = loadScript();
      expect(script).toContain("NOPASSWD:ALL");
      expect(script).toContain("/etc/sudoers.d/");
    });
  });

  // -------------------------------------------------------------------------
  // Step 2: Swap
  // -------------------------------------------------------------------------

  describe("step 2: swap configuration", () => {
    it("creates a 2GB swap file", () => {
      const script = loadScript();
      expect(script).toContain("SWAP_SIZE_MB=2048");
      expect(script).toContain("dd if=/dev/zero");
      expect(script).toContain("mkswap");
    });

    it("checks if swap already exists (idempotent)", () => {
      const script = loadScript();
      expect(script).toContain("swapon --show");
      expect(script).toContain("already active");
    });

    it("activates swap", () => {
      const script = loadScript();
      expect(script).toContain("swapon");
    });

    it("persists swap in /etc/fstab", () => {
      const script = loadScript();
      expect(script).toContain("/etc/fstab");
      expect(script).toContain("swap sw");
    });

    it("checks fstab before adding entry (idempotent)", () => {
      const script = loadScript();
      expect(script).toMatch(/grep.*fstab/);
    });
  });

  // -------------------------------------------------------------------------
  // Step 3 & 4: System packages
  // -------------------------------------------------------------------------

  describe("steps 3-4: system packages", () => {
    it("runs apt update", () => {
      const script = loadScript();
      expect(script).toMatch(/apt-get update/);
    });

    it("runs apt upgrade", () => {
      const script = loadScript();
      expect(script).toMatch(/apt-get upgrade/);
    });

    it("installs required packages", () => {
      const script = loadScript();
      const requiredPackages = ["jq", "curl", "git", "build-essential"];
      for (const pkg of requiredPackages) {
        expect(script).toContain(pkg);
      }
    });

    it("uses DEBIAN_FRONTEND=noninteractive", () => {
      const script = loadScript();
      expect(script).toContain("DEBIAN_FRONTEND=noninteractive");
    });
  });

  // -------------------------------------------------------------------------
  // Step 5 & 6: OpenClaw installation
  // -------------------------------------------------------------------------

  describe("steps 5-6: OpenClaw installation", () => {
    it("installs OpenClaw via official script", () => {
      const script = loadScript();
      expect(script).toContain("https://openclaw.ai/install.sh");
    });

    it("runs install as openclaw user (not root)", () => {
      const script = loadScript();
      expect(script).toMatch(/sudo -u.*openclaw.*install\.sh/s);
    });

    it("uses --non-interactive flag", () => {
      const script = loadScript();
      expect(script).toContain("--non-interactive");
    });

    it("verifies installation with openclaw --version", () => {
      const script = loadScript();
      expect(script).toContain("openclaw --version");
    });

    it("sets up PATH for linuxbrew", () => {
      const script = loadScript();
      expect(script).toContain("linuxbrew");
      expect(script).toContain(".bashrc");
    });
  });

  // -------------------------------------------------------------------------
  // Steps 7-9: Daemon installation
  // -------------------------------------------------------------------------

  describe("steps 7-9: daemon installation", () => {
    it("downloads hivemi-daemon.tar.gz from release URL", () => {
      const script = loadScript();
      expect(script).toContain("hivemi-daemon.tar.gz");
      expect(script).toContain("HIVEMI_RELEASE_URL");
    });

    it("extracts to /home/openclaw/.hivemi/daemon/", () => {
      const script = loadScript();
      expect(script).toContain('DAEMON_DIR="${OPENCLAW_HOME}/.hivemi/daemon"');
      expect(script).toContain("tar -xzf");
    });

    it("installs production dependencies with npm", () => {
      const script = loadScript();
      expect(script).toContain("npm install --omit=dev");
    });

    it("cleans up downloaded tarball", () => {
      const script = loadScript();
      expect(script).toContain('rm -f "$tarball_tmp"');
    });

    it("sets ownership to openclaw", () => {
      const script = loadScript();
      expect(script).toMatch(/chown -R.*OPENCLAW_USER.*DAEMON_DIR/);
    });

    it("waits for Node.js with timeout", () => {
      const script = loadScript();
      expect(script).toContain("max_wait=300");
      expect(script).toContain("Waiting for Node.js");
    });

    it("skips daemon install if HIVEMI_RELEASE_URL not set", () => {
      const script = loadScript();
      expect(script).toContain("HIVEMI_RELEASE_URL not set");
      expect(script).toContain("skipping daemon install");
    });

    it("supports private repo download with auth header", () => {
      const script = loadScript();
      expect(script).toContain("Authorization: token");
      expect(script).toContain("HIVEMI_GH_TOKEN");
    });
  });

  // -------------------------------------------------------------------------
  // Steps 10-11: Systemd setup
  // -------------------------------------------------------------------------

  describe("steps 10-11: systemd service", () => {
    it("copies unit file to /etc/systemd/system/", () => {
      const script = loadScript();
      expect(script).toContain("cp");
      expect(script).toContain("/etc/systemd/system/hivemi-agent.service");
    });

    it("runs systemctl daemon-reload", () => {
      const script = loadScript();
      expect(script).toContain("systemctl daemon-reload");
    });

    it("enables the service", () => {
      const script = loadScript();
      expect(script).toContain("systemctl enable hivemi-agent");
    });

    it("does NOT start the service", () => {
      const script = loadScript();
      // Should not have systemctl start anywhere
      expect(script).not.toMatch(/systemctl start hivemi-agent/);
    });
  });

  // -------------------------------------------------------------------------
  // Step 13: Completion flag
  // -------------------------------------------------------------------------

  describe("step 13: completion flag", () => {
    it("writes /tmp/hivemi-cloud-init-done", () => {
      const script = loadScript();
      expect(script).toContain("/tmp/hivemi-cloud-init-done");
    });

    it("includes timestamp in the flag", () => {
      const script = loadScript();
      // The flag should contain a timestamp
      expect(script).toMatch(/echo.*date.*>.*COMPLETION_FLAG/s);
    });

    it("sets ownership to openclaw", () => {
      const script = loadScript();
      expect(script).toMatch(/chown.*OPENCLAW_USER.*COMPLETION_FLAG/);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  describe("idempotency", () => {
    it("checks user existence before creating", () => {
      const script = loadScript();
      // Should use `id` to check if user exists
      expect(script).toMatch(/if\s+id\s+/);
    });

    it("checks swap status before creating", () => {
      const script = loadScript();
      expect(script).toMatch(/swapon --show/);
    });

    it("overwrites daemon tarball if already installed", () => {
      const script = loadScript();
      // mkdir -p is idempotent, tar extracts over existing files
      expect(script).toContain("mkdir -p");
    });

    it("checks fstab before adding swap entry", () => {
      const script = loadScript();
      expect(script).toMatch(/grep.*SWAP_FILE.*fstab/s);
    });
  });

  // -------------------------------------------------------------------------
  // Step ordering
  // -------------------------------------------------------------------------

  describe("step ordering", () => {
    it("calls steps in the correct order", () => {
      const script = loadScript();
      const mainBody = script.substring(script.indexOf("main()"));

      const steps = [
        "setup_user",
        "setup_swap",
        "install_packages",
        "install_openclaw",
        "install_daemon",
        "setup_systemd",
        "write_completion_flag",
      ];

      let lastIndex = 0;
      for (const step of steps) {
        const idx = mainBody.indexOf(step);
        expect(idx).toBeGreaterThan(lastIndex);
        lastIndex = idx;
      }
    });

    it("writes completion flag last", () => {
      const script = loadScript();
      const mainBody = script.substring(script.indexOf("main()"));
      const flagIdx = mainBody.indexOf("write_completion_flag");
      const timeCalcIdx = mainBody.indexOf("end_time");
      // Flag should be written before time calculation
      expect(flagIdx).toBeLessThan(timeCalcIdx);
    });
  });

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe("security", () => {
    it("does not log the auth token value", () => {
      const script = loadScript();
      // Should log that token is set/not-set, not the actual value
      expect(script).toContain("${HIVEMI_GH_TOKEN:+<set>}");
      expect(script).toContain("${HIVEMI_GH_TOKEN:-<not set>}");
    });

    it("sets swap file permissions to 600", () => {
      const script = loadScript();
      expect(script).toContain("chmod 600");
      expect(script).toContain("SWAP_FILE");
    });

    it("sets sudoers file permissions to 440", () => {
      const script = loadScript();
      expect(script).toContain("chmod 440");
    });
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  describe("logging", () => {
    it("logs to /var/log/hivemi-bootstrap.log", () => {
      const script = loadScript();
      expect(script).toContain("/var/log/hivemi-bootstrap.log");
    });

    it("logs timestamps in UTC ISO format", () => {
      const script = loadScript();
      expect(script).toContain("date -u '+%Y-%m-%dT%H:%M:%SZ'");
    });

    it("logs total elapsed time", () => {
      const script = loadScript();
      expect(script).toContain("elapsed");
      expect(script).toContain("Bootstrap complete in");
    });
  });
});

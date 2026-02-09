// =============================================================================
// Bootstrapper Tests
// Unit tests using mock SSH client and secret providers
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCloudInit, waitCloudInit } from "../phases/cloud-init.js";
import {
  injectSecrets,
  configureOpenClaw,
  copyRoleConfig,
  installDaemon,
} from "../phases/configure.js";
import { waitRegistration } from "../phases/wait-registration.js";
import { EnvFileProvider } from "../secrets/envfile.js";
import type {
  ISSHClient,
  SSHExecResult,
  BootstrapConfig,
  BootstrapperLogger,
} from "../types.js";

// ---------------------------------------------------------------------------
// Mock SSH Client
// ---------------------------------------------------------------------------

function createMockSSH(overrides?: Partial<ISSHClient>): ISSHClient {
  const files = new Map<string, string>();

  return {
    connected: true,
    connect: vi.fn(async () => {}),
    exec: vi.fn(async (_cmd: string): Promise<SSHExecResult> => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    })),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    fileExists: vi.fn(async (_path: string) => false),
    disconnect: vi.fn(async () => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Quiet logger for tests
// ---------------------------------------------------------------------------

const silentLogger: BootstrapperLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ---------------------------------------------------------------------------
// Tests: Cloud-Init Generation
// ---------------------------------------------------------------------------

describe("generateCloudInit", () => {
  // --- Basic structure ---

  it("generates valid cloud-init YAML with #cloud-config header", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: true,
      swapSizeMb: 1024,
    });

    expect(yaml).toContain("#cloud-config");
    expect(yaml).toContain("ssh-ed25519 AAAA...");
    expect(yaml).toContain("openclaw");
    expect(yaml).toContain("hivemi-cloud-init-done");
  });

  it("includes SSH public key for bootstrapper access", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA+test+key user@host");
    expect(yaml).toContain("ssh-ed25519 AAAA+test+key user@host");
    expect(yaml).toContain("ssh_authorized_keys:");
  });

  it("creates openclaw user with sudo and locked password", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...");
    expect(yaml).toContain("name: openclaw");
    expect(yaml).toContain("sudo: ALL=(ALL) NOPASSWD:ALL");
    expect(yaml).toContain("lock_passwd: true");
  });

  it("includes required packages", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...");
    expect(yaml).toContain("curl");
    expect(yaml).toContain("jq");
    expect(yaml).toContain("git");
    expect(yaml).toContain("htop");
    expect(yaml).toContain("unzip");
  });

  // --- Swap ---

  it("generates swap section with correct size", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: true,
      swapSizeMb: 1024,
    });
    expect(yaml).toContain("swap");
    expect(yaml).toContain("filename: /swapfile");
    expect(yaml).toContain(String(1024 * 1024 * 1024)); // 1GB in bytes
  });

  it("generates cloud-init without swap when disabled", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
    });
    expect(yaml).toContain("# swap disabled");
    expect(yaml).not.toContain("filename: /swapfile");
  });

  it("defaults to 2048MB swap when swapSizeMb not specified", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: true,
    });
    expect(yaml).toContain(String(2048 * 1024 * 1024)); // 2GB in bytes
  });

  // --- Hostname ---

  it("sets hostname when provided", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
      hostname: "hivemi-agent-atlas",
    });
    expect(yaml).toContain("hostname: hivemi-agent-atlas");
    expect(yaml).toContain("manage_etc_hosts: true");
    expect(yaml).toContain('hostnamectl set-hostname "hivemi-agent-atlas"');
  });

  it("uses default hostname when not specified", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
    });
    expect(yaml).toContain("hostname: hivemi-agent");
  });

  it("includes hostname in final_message", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
      hostname: "my-agent",
    });
    expect(yaml).toContain("cloud-init complete for my-agent");
  });

  // --- Bootstrap script (releaseUrl + ghToken) ---

  it("downloads and executes bootstrap script with releaseUrl + ghToken", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
      hostname: "hivemi-agent-atlas",
      releaseUrl: "https://github.com/ijoaum/hivemi/releases/download/v0.1.0",
      ghToken: "ghp_test123",
    });

    // Should download the script with auth
    expect(yaml).toContain("Authorization: token $GH_TOKEN");
    expect(yaml).toContain("hivemi-agent-bootstrap.sh");
    expect(yaml).toContain("/tmp/hivemi-agent-bootstrap.sh");
    expect(yaml).toContain("chmod +x");

    // Should pass RELEASE_URL and GH_TOKEN to the script
    expect(yaml).toContain('RELEASE_URL="https://github.com/ijoaum/hivemi/releases/download/v0.1.0"');
    expect(yaml).toContain('GH_TOKEN="ghp_test123"');
    expect(yaml).toContain('/tmp/hivemi-agent-bootstrap.sh "$RELEASE_URL" "$GH_TOKEN"');

    // Should log to hivemi-bootstrap.log
    expect(yaml).toContain("/var/log/hivemi-bootstrap.log");

    // Should NOT include legacy OpenClaw install
    expect(yaml).not.toContain("openclaw.ai/install.sh");
  });

  it("downloads bootstrap script without auth for public repos", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
      releaseUrl: "https://github.com/ijoaum/hivemi/releases/download/v0.1.0",
      // No ghToken
    });

    // Should download without Authorization header
    expect(yaml).not.toContain("Authorization: token");
    expect(yaml).toContain("hivemi-agent-bootstrap.sh");
    expect(yaml).toContain('/tmp/hivemi-agent-bootstrap.sh "$RELEASE_URL"');

    // Should NOT include legacy OpenClaw install
    expect(yaml).not.toContain("openclaw.ai/install.sh");
  });

  // --- Legacy fallback ---

  it("falls back to direct OpenClaw install when no releaseUrl", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
    });

    expect(yaml).toContain("openclaw.ai/install.sh");
    expect(yaml).toContain("--non-interactive");
    expect(yaml).not.toContain("hivemi-agent-bootstrap.sh");
  });

  // --- Completion flag ---

  it("always writes completion flag at the end", () => {
    // With bootstrap script
    const yaml1 = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
      releaseUrl: "https://example.com/release/v1",
      ghToken: "ghp_test",
    });
    expect(yaml1).toContain("touch /tmp/hivemi-cloud-init-done");
    expect(yaml1).toContain("chown openclaw:openclaw /tmp/hivemi-cloud-init-done");

    // Without bootstrap script (legacy)
    const yaml2 = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
    });
    expect(yaml2).toContain("touch /tmp/hivemi-cloud-init-done");
    expect(yaml2).toContain("chown openclaw:openclaw /tmp/hivemi-cloud-init-done");
  });

  // --- Full template integration ---

  it("generates complete template with all variables", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA+fulltest", {
      enableSwap: true,
      swapSizeMb: 512,
      hostname: "hivemi-agent-zeus",
      releaseUrl: "https://github.com/ijoaum/hivemi/releases/download/v0.2.0",
      ghToken: "ghp_fulltest456",
    });

    // Structure
    expect(yaml).toMatch(/^#cloud-config/);
    expect(yaml).toContain("hostname: hivemi-agent-zeus");
    expect(yaml).toContain("ssh-ed25519 AAAA+fulltest");

    // Packages
    expect(yaml).toContain("package_update: true");
    expect(yaml).toContain("package_upgrade: true");

    // Swap
    expect(yaml).toContain("filename: /swapfile");
    expect(yaml).toContain(String(512 * 1024 * 1024));

    // Bootstrap
    expect(yaml).toContain("hivemi-agent-bootstrap.sh");
    expect(yaml).toContain('GH_TOKEN="ghp_fulltest456"');

    // Completion
    expect(yaml).toContain("hivemi-cloud-init-done");
    expect(yaml).toContain("cloud-init complete for hivemi-agent-zeus");
  });
});

// ---------------------------------------------------------------------------
// Tests: Wait Cloud-Init
// ---------------------------------------------------------------------------

describe("waitCloudInit", () => {
  it("returns immediately if flag file exists", async () => {
    const ssh = createMockSSH({
      fileExists: vi.fn(async () => true),
    });

    await waitCloudInit(ssh, 5000, 100, silentLogger);

    expect(ssh.fileExists).toHaveBeenCalledWith("/tmp/hivemi-cloud-init-done");
  });

  it("polls until flag file appears", async () => {
    let callCount = 0;
    const ssh = createMockSSH({
      fileExists: vi.fn(async () => {
        callCount++;
        return callCount >= 3;
      }),
    });

    await waitCloudInit(ssh, 5000, 50, silentLogger);

    expect(callCount).toBe(3);
  });

  it("throws on timeout", async () => {
    const ssh = createMockSSH({
      fileExists: vi.fn(async () => false),
    });

    await expect(
      waitCloudInit(ssh, 200, 50, silentLogger),
    ).rejects.toThrow("did not complete");
  });
});

// ---------------------------------------------------------------------------
// Tests: Secret Injection
// ---------------------------------------------------------------------------

describe("injectSecrets", () => {
  it("resolves all env secrets via provider", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([
        ["ANTHROPIC_KEY", "sk-ant-123"],
        ["OPENAI_KEY", "sk-oai-456"],
      ]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [
        { ref: "ANTHROPIC_KEY", target: "env:ANTHROPIC_API_KEY" },
        { ref: "OPENAI_KEY", target: "env:OPENAI_API_KEY" },
      ],
      silentLogger,
    );

    expect(result.envSecrets.get("ANTHROPIC_API_KEY")).toBe("sk-ant-123");
    expect(result.envSecrets.get("OPENAI_API_KEY")).toBe("sk-oai-456");
    expect(result.fileSecrets).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("returns empty result when no mappings", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(new Map());
    const result = await injectSecrets(ssh, provider, [], silentLogger);
    expect(result.envSecrets.size).toBe(0);
    expect(result.fileSecrets).toHaveLength(0);
  });

  it("throws when a required secret is missing", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(new Map());

    await expect(
      injectSecrets(
        ssh,
        provider,
        [{ ref: "MISSING_KEY", target: "env:MISSING" }],
        silentLogger,
      ),
    ).rejects.toThrow("MISSING_KEY");
  });

  it("skips optional secrets that are not found", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([["FOUND_KEY", "found-value"]]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [
        { ref: "FOUND_KEY", target: "env:FOUND_VAR" },
        { ref: "OPTIONAL_KEY", target: "env:OPTIONAL_VAR", required: false },
      ],
      silentLogger,
    );

    expect(result.envSecrets.get("FOUND_VAR")).toBe("found-value");
    expect(result.envSecrets.has("OPTIONAL_VAR")).toBe(false);
    expect(result.skipped).toContain("OPTIONAL_KEY");
  });

  it("writes file secrets to VM via SSH with mode 600", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([["TOKEN_REF", "secret-token-value"]]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [{ ref: "TOKEN_REF", target: "file:/home/openclaw/.openclaw/secrets/token" }],
      silentLogger,
    );

    expect(result.fileSecrets).toContain("/home/openclaw/.openclaw/secrets/token");
    expect(result.envSecrets.size).toBe(0);

    // Verify SSH writeFile was called with correct path, value, and mode
    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.openclaw/secrets/token",
      "secret-token-value",
      "600",
    );
  });

  it("handles mix of env and file targets", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([
        ["API_KEY", "sk-123"],
        ["CERT_DATA", "-----BEGIN CERT-----"],
      ]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [
        { ref: "API_KEY", target: "env:OPENAI_API_KEY" },
        { ref: "CERT_DATA", target: "file:/home/openclaw/.certs/ca.pem" },
      ],
      silentLogger,
    );

    expect(result.envSecrets.get("OPENAI_API_KEY")).toBe("sk-123");
    expect(result.fileSecrets).toContain("/home/openclaw/.certs/ca.pem");
  });

  it("supports legacy envVar field for backward compat", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([["OLD_KEY", "old-value"]]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [{ ref: "OLD_KEY", target: "env:LEGACY_VAR", envVar: "LEGACY_VAR" }],
      silentLogger,
    );

    expect(result.envSecrets.get("LEGACY_VAR")).toBe("old-value");
  });
});

// ---------------------------------------------------------------------------
// Tests: Configure OpenClaw
// ---------------------------------------------------------------------------

describe("configureOpenClaw", () => {
  it("writes SOUL.md and config", async () => {
    const ssh = createMockSSH();
    const agent = {
      agentId: "test-uuid",
      agentName: "test-agent",
      roleId: "role-uuid",
      teamId: "team-uuid",
      model: "anthropic/claude-sonnet-4-5",
      daemonPort: 4002,
    };

    await configureOpenClaw(ssh, agent, "# Test Soul", "test-token", silentLogger);

    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.openclaw/workspace/SOUL.md",
      "# Test Soul",
    );

    // Check config was written with model and chat completions
    const configCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0].includes("config.yaml"),
    );
    expect(configCall).toBeDefined();
    const config = JSON.parse(configCall[1]);
    expect(config.llm.model).toBe("anthropic/claude-sonnet-4-5");
    expect(config.gateway.http.endpoints.chatCompletions.enabled).toBe(true);
    expect(config.gateway.http.endpoints.chatCompletions.auth.token).toBe("test-token");
    expect(config.sandbox).toBe("off");

    // Config file should have mode 600 (contains API token)
    expect(configCall[2]).toBe("600");
  });
});

// ---------------------------------------------------------------------------
// Tests: Copy Role Config
// ---------------------------------------------------------------------------

describe("copyRoleConfig", () => {
  it("writes all role files", async () => {
    const ssh = createMockSSH();
    const role = {
      soulMd: "# Soul",
      agentsMd: "# Agents",
      toolsMd: "# Tools",
      configJson: '{"key": "value"}',
    };

    await copyRoleConfig(ssh, role, silentLogger);

    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.openclaw/workspace/SOUL.md",
      "# Soul",
    );
    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.openclaw/workspace/AGENTS.md",
      "# Agents",
    );
    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.openclaw/workspace/TOOLS.md",
      "# Tools",
    );
    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.openclaw/workspace/config.json",
      '{"key": "value"}',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Install Daemon
// ---------------------------------------------------------------------------

describe("installDaemon", () => {
  it("writes .env and systemd unit, enables and starts service", async () => {
    const ssh = createMockSSH();
    const config: BootstrapConfig = {
      host: "1.2.3.4",
      sshPrivateKey: "key",
      agent: {
        agentId: "agent-uuid",
        agentName: "test-agent",
        roleId: "role-uuid",
        teamId: "team-uuid",
        model: "anthropic/claude-sonnet-4-5",
        daemonPort: 4002,
      },
      role: {
        soulMd: "",
        agentsMd: "",
        toolsMd: "",
        configJson: "",
      },
      secrets: [],
      secretProvider: new EnvFileProvider(new Map()),
      registryUrl: "http://registry:4001",
      hivemiSecret: "secret-123",
      openclawApiToken: "api-token",
    };

    const resolvedSecrets = new Map([["ANTHROPIC_API_KEY", "sk-ant-123"]]);

    await installDaemon(ssh, config, resolvedSecrets, silentLogger);

    // Check .env was written
    const envCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0].includes(".env"),
    );
    expect(envCall).toBeDefined();
    const envContent = envCall[1] as string;
    expect(envContent).toContain("AGENT_ID=agent-uuid");
    expect(envContent).toContain("REGISTRY_URL=http://registry:4001");
    expect(envContent).toContain("HIVEMI_SECRET=secret-123");
    expect(envContent).toContain("DAEMON_PORT=4002");
    expect(envContent).toContain("ANTHROPIC_API_KEY=sk-ant-123");
    expect(envContent).toContain("OPENCLAW_API_TOKEN=api-token");

    // Check .env has mode 600
    expect(envCall[2]).toBe("600");

    // Check systemd unit was written
    const unitCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0].includes("hivemi-daemon.service"),
    );
    expect(unitCall).toBeDefined();
    expect(unitCall[1]).toContain("test-agent");
    expect(unitCall[1]).toContain("ExecStart=");

    // Check systemd commands were called
    expect(ssh.exec).toHaveBeenCalledWith("systemctl daemon-reload");
    expect(ssh.exec).toHaveBeenCalledWith("systemctl enable hivemi-daemon");
    expect(ssh.exec).toHaveBeenCalledWith("systemctl start hivemi-daemon");
  });
});

// ---------------------------------------------------------------------------
// Tests: Wait Registration
// ---------------------------------------------------------------------------

describe("waitRegistration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves when agent is registered and has heartbeat", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { status: "idle", lastHeartbeat: new Date().toISOString() },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await waitRegistration(
      {
        agentId: "agent-uuid",
        registryUrl: "http://localhost:4001",
        timeoutMs: 5000,
        pollIntervalMs: 50,
      },
      silentLogger,
    );

    expect(fetchSpy).toHaveBeenCalled();
  });

  it("keeps polling while agent is provisioning", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { status: "provisioning", lastHeartbeat: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: { status: "idle", lastHeartbeat: new Date().toISOString() },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await waitRegistration(
      {
        agentId: "agent-uuid",
        registryUrl: "http://localhost:4001",
        timeoutMs: 5000,
        pollIntervalMs: 50,
      },
      silentLogger,
    );

    expect(callCount).toBe(3);
  });

  it("throws on timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { status: "provisioning", lastHeartbeat: null },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      waitRegistration(
        {
          agentId: "agent-uuid",
          registryUrl: "http://localhost:4001",
          timeoutMs: 200,
          pollIntervalMs: 50,
        },
        silentLogger,
      ),
    ).rejects.toThrow("did not register");
  });

  it("handles fetch errors gracefully and retries", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("Connection refused");
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: { status: "idle", lastHeartbeat: new Date().toISOString() },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await waitRegistration(
      {
        agentId: "agent-uuid",
        registryUrl: "http://localhost:4001",
        timeoutMs: 5000,
        pollIntervalMs: 50,
      },
      silentLogger,
    );

    expect(callCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: EnvFileProvider
// ---------------------------------------------------------------------------

describe("EnvFileProvider", () => {
  it("resolves known secrets", async () => {
    const provider = new EnvFileProvider(
      new Map([["MY_KEY", "my-value"]]),
    );

    expect(await provider.getSecret("MY_KEY")).toBe("my-value");
  });

  it("throws for unknown secrets", async () => {
    const provider = new EnvFileProvider(new Map());

    await expect(provider.getSecret("UNKNOWN")).rejects.toThrow("not found");
  });

  it("resolveAll returns env var map", async () => {
    const provider = new EnvFileProvider(
      new Map([
        ["ref1", "val1"],
        ["ref2", "val2"],
      ]),
    );

    const result = await provider.resolveAll([
      { ref: "ref1", target: "env:ENV1" },
      { ref: "ref2", target: "env:ENV2" },
    ]);

    expect(result.get("ENV1")).toBe("val1");
    expect(result.get("ENV2")).toBe("val2");
  });
});

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
  it("generates valid cloud-init YAML with swap enabled", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: true,
      swapSizeMb: 1024,
    });

    expect(yaml).toContain("#cloud-config");
    expect(yaml).toContain("ssh-ed25519 AAAA...");
    expect(yaml).toContain("openclaw");
    expect(yaml).toContain("hivemi-cloud-init-done");
    expect(yaml).toContain("swap");
    expect(yaml).toContain(String(1024 * 1024 * 1024));
  });

  it("generates cloud-init without swap when disabled", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...", {
      enableSwap: false,
    });

    expect(yaml).toContain("# swap disabled");
    expect(yaml).not.toContain("filename: /swapfile");
  });

  it("includes required packages", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...");

    expect(yaml).toContain("curl");
    expect(yaml).toContain("jq");
    expect(yaml).toContain("git");
  });

  it("includes OpenClaw install command", () => {
    const yaml = generateCloudInit("ssh-ed25519 AAAA...");

    expect(yaml).toContain("openclaw.ai/install.sh");
    expect(yaml).toContain("--non-interactive");
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
  it("resolves all secrets via provider", async () => {
    const provider = new EnvFileProvider(
      new Map([
        ["ANTHROPIC_KEY", "sk-ant-123"],
        ["OPENAI_KEY", "sk-oai-456"],
      ]),
    );

    const result = await injectSecrets(
      provider,
      [
        { ref: "ANTHROPIC_KEY", envVar: "ANTHROPIC_API_KEY" },
        { ref: "OPENAI_KEY", envVar: "OPENAI_API_KEY" },
      ],
      silentLogger,
    );

    expect(result.get("ANTHROPIC_API_KEY")).toBe("sk-ant-123");
    expect(result.get("OPENAI_API_KEY")).toBe("sk-oai-456");
  });

  it("returns empty map when no mappings", async () => {
    const provider = new EnvFileProvider(new Map());
    const result = await injectSecrets(provider, [], silentLogger);
    expect(result.size).toBe(0);
  });

  it("throws when a secret is missing", async () => {
    const provider = new EnvFileProvider(new Map());

    await expect(
      injectSecrets(
        provider,
        [{ ref: "MISSING_KEY", envVar: "MISSING" }],
        silentLogger,
      ),
    ).rejects.toThrow("MISSING_KEY");
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
      { ref: "ref1", envVar: "ENV1" },
      { ref: "ref2", envVar: "ENV2" },
    ]);

    expect(result.get("ENV1")).toBe("val1");
    expect(result.get("ENV2")).toBe("val2");
  });
});

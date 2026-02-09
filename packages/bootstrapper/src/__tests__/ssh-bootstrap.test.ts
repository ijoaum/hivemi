// =============================================================================
// SSH Bootstrap Phase 2 Tests
// Tests for role loading/merging, verification, and configure orchestration.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  configureOpenClaw,
  copyRoleConfig,
  installDaemon,
  verifyInstallation,
  configure,
} from "../phases/configure.js";
import { loadRoleConfig, deepMerge } from "../role-loader.js";
import type {
  ISSHClient,
  SSHExecResult,
  BootstrapConfig,
  BootstrapperLogger,
  RoleConfig,
} from "../types.js";
import { EnvFileProvider } from "../secrets/envfile.js";

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
// Silent logger
// ---------------------------------------------------------------------------

const silentLogger: BootstrapperLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ---------------------------------------------------------------------------
// Tests: deepMerge utility
// ---------------------------------------------------------------------------

describe("deepMerge", () => {
  it("merges flat objects", () => {
    const base = { a: 1, b: 2 };
    const override = { b: 3, c: 4 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("deep merges nested objects", () => {
    const base = { a: { x: 1, y: 2 }, b: 3 };
    const override = { a: { y: 5, z: 6 } };
    expect(deepMerge(base, override)).toEqual({ a: { x: 1, y: 5, z: 6 }, b: 3 });
  });

  it("replaces arrays entirely (no concatenation)", () => {
    const base = { tools: ["read", "write"] };
    const override = { tools: ["exec"] };
    expect(deepMerge(base, override)).toEqual({ tools: ["exec"] });
  });

  it("handles null values in override", () => {
    const base = { a: { x: 1 }, b: 2 };
    const override = { a: null };
    expect(deepMerge(base, override)).toEqual({ a: null, b: 2 });
  });

  it("does not mutate base or override", () => {
    const base = { a: 1 };
    const override = { b: 2 };
    const result = deepMerge(base, override);
    expect(base).toEqual({ a: 1 });
    expect(override).toEqual({ b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("handles empty objects", () => {
    expect(deepMerge({}, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
    expect(deepMerge({}, {})).toEqual({});
  });

  it("handles deeply nested merge (3+ levels)", () => {
    const base = { a: { b: { c: 1, d: 2 }, e: 3 } };
    const override = { a: { b: { c: 10, f: 20 } } };
    expect(deepMerge(base, override)).toEqual({
      a: { b: { c: 10, d: 2, f: 20 }, e: 3 },
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: loadRoleConfig
// ---------------------------------------------------------------------------

describe("loadRoleConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hivemi-test-agents-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads role-specific SOUL.md over _base", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });
    await writeFile(join(tmpDir, "_base", "SOUL.md"), "Base soul");
    await writeFile(join(tmpDir, "dev", "SOUL.md"), "Dev soul");

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.soulMd).toBe("Dev soul");
  });

  it("falls back to _base SOUL.md when role has none", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });
    await writeFile(join(tmpDir, "_base", "SOUL.md"), "Base soul");

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.soulMd).toBe("Base soul");
  });

  it("returns empty string when neither _base nor role has SOUL.md", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.soulMd).toBe("");
  });

  it("uses _base AGENTS.md when role has none", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });
    await writeFile(join(tmpDir, "_base", "AGENTS.md"), "Base agents");

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.agentsMd).toBe("Base agents");
  });

  it("role AGENTS.md overrides _base entirely", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });
    await writeFile(join(tmpDir, "_base", "AGENTS.md"), "Base agents");
    await writeFile(join(tmpDir, "dev", "AGENTS.md"), "Dev agents");

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.agentsMd).toBe("Dev agents");
  });

  it("uses _base TOOLS.md when role has none", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });
    await writeFile(join(tmpDir, "_base", "TOOLS.md"), "Base tools");

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.toolsMd).toBe("Base tools");
  });

  it("deep-merges config.json (_base + role)", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const baseConfig = {
      heartbeatInterval: 30000,
      telemetryInterval: 60000,
      logLevel: "info",
      maxRetries: 3,
    };
    const roleConfig = {
      model: "openai/gpt-4o",
      maxRetries: 5,
      temperature: 0.3,
    };

    await writeFile(join(tmpDir, "_base", "config.json"), JSON.stringify(baseConfig));
    await writeFile(join(tmpDir, "dev", "config.json"), JSON.stringify(roleConfig));

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    const merged = JSON.parse(config.configJson);

    expect(merged.heartbeatInterval).toBe(30000); // from _base
    expect(merged.telemetryInterval).toBe(60000); // from _base
    expect(merged.logLevel).toBe("info");          // from _base
    expect(merged.maxRetries).toBe(5);             // overridden by role
    expect(merged.model).toBe("openai/gpt-4o");   // from role
    expect(merged.temperature).toBe(0.3);          // from role
  });

  it("uses only _base config.json when role has none", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const baseConfig = { heartbeatInterval: 30000 };
    await writeFile(join(tmpDir, "_base", "config.json"), JSON.stringify(baseConfig));

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    const parsed = JSON.parse(config.configJson);
    expect(parsed.heartbeatInterval).toBe(30000);
  });

  it("uses only role config.json when _base has none", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const roleConfig = { model: "openai/gpt-4o" };
    await writeFile(join(tmpDir, "dev", "config.json"), JSON.stringify(roleConfig));

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    const parsed = JSON.parse(config.configJson);
    expect(parsed.model).toBe("openai/gpt-4o");
  });

  it("returns empty config.json when neither _base nor role has it", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(JSON.parse(config.configJson)).toEqual({});
  });

  it("role tools.json overrides _base entirely", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const baseTools = JSON.stringify({ tools: [{ name: "base-tool" }] });
    const roleTools = JSON.stringify({ tools: [{ name: "dev-tool" }] });

    await writeFile(join(tmpDir, "_base", "tools.json"), baseTools);
    await writeFile(join(tmpDir, "dev", "tools.json"), roleTools);

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.toolsJson).toBe(roleTools);
  });

  it("falls back to _base tools.json when role has none", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const baseTools = JSON.stringify({ tools: [{ name: "base-tool" }] });
    await writeFile(join(tmpDir, "_base", "tools.json"), baseTools);

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.toolsJson).toBe(baseTools);
  });

  it("returns undefined toolsJson when neither has tools.json", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    expect(config.toolsJson).toBeUndefined();
  });

  it("handles invalid JSON in _base config.json gracefully", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    await writeFile(join(tmpDir, "_base", "config.json"), "not valid json");
    const roleConfig = { model: "openai/gpt-4o" };
    await writeFile(join(tmpDir, "dev", "config.json"), JSON.stringify(roleConfig));

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    const parsed = JSON.parse(config.configJson);
    // Should still have role config, _base was skipped due to parse error
    expect(parsed.model).toBe("openai/gpt-4o");
  });

  it("handles invalid JSON in role config.json gracefully", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "dev"), { recursive: true });

    const baseConfig = { heartbeatInterval: 30000 };
    await writeFile(join(tmpDir, "_base", "config.json"), JSON.stringify(baseConfig));
    await writeFile(join(tmpDir, "dev", "config.json"), "invalid");

    const config = await loadRoleConfig(tmpDir, "dev", silentLogger);
    const parsed = JSON.parse(config.configJson);
    // Should have base config only, role was skipped
    expect(parsed.heartbeatInterval).toBe(30000);
  });

  it("loads complete role config with all files present", async () => {
    await mkdir(join(tmpDir, "_base"), { recursive: true });
    await mkdir(join(tmpDir, "pm"), { recursive: true });

    // _base files
    await writeFile(join(tmpDir, "_base", "AGENTS.md"), "# Base Agents");
    await writeFile(join(tmpDir, "_base", "TOOLS.md"), "# Base Tools");
    await writeFile(join(tmpDir, "_base", "config.json"), JSON.stringify({
      heartbeatInterval: 30000,
      logLevel: "info",
    }));

    // Role files
    await writeFile(join(tmpDir, "pm", "SOUL.md"), "# PM Soul");
    await writeFile(join(tmpDir, "pm", "config.json"), JSON.stringify({
      model: "anthropic/claude-sonnet-4-5",
      logLevel: "debug",
    }));
    await writeFile(join(tmpDir, "pm", "tools.json"), JSON.stringify({
      tools: [{ name: "create-task" }],
    }));

    const config = await loadRoleConfig(tmpDir, "pm", silentLogger);

    expect(config.soulMd).toBe("# PM Soul");
    expect(config.agentsMd).toBe("# Base Agents"); // from _base
    expect(config.toolsMd).toBe("# Base Tools");   // from _base

    const mergedConfig = JSON.parse(config.configJson);
    expect(mergedConfig.heartbeatInterval).toBe(30000);        // from _base
    expect(mergedConfig.model).toBe("anthropic/claude-sonnet-4-5"); // from role
    expect(mergedConfig.logLevel).toBe("debug");               // overridden by role

    const tools = JSON.parse(config.toolsJson!);
    expect(tools.tools[0].name).toBe("create-task");
  });
});

// ---------------------------------------------------------------------------
// Tests: verifyInstallation
// ---------------------------------------------------------------------------

describe("verifyInstallation", () => {
  it("succeeds when daemon is active", async () => {
    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("is-active")) {
          return { exitCode: 0, stdout: "active\n", stderr: "" };
        }
        if (cmd.includes("systemctl status")) {
          return {
            exitCode: 0,
            stdout: "● hivemi-daemon.service - HiveMI Agent Daemon\n   Active: active (running)\n",
            stderr: "",
          };
        }
        if (cmd.includes("journalctl")) {
          return {
            exitCode: 0,
            stdout: "Jan 01 12:00:00 agent hivemi-daemon[123]: Started\n",
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    const result = await verifyInstallation(ssh, silentLogger);

    expect(result.running).toBe(true);
    expect(result.statusOutput).toContain("active (running)");
    expect(result.logs).toContain("Started");
  });

  it("throws when daemon is not running", async () => {
    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("is-active")) {
          return { exitCode: 3, stdout: "inactive\n", stderr: "" };
        }
        if (cmd.includes("systemctl status")) {
          return {
            exitCode: 3,
            stdout: "● hivemi-daemon.service - HiveMI Agent Daemon\n   Active: inactive (dead)\n",
            stderr: "",
          };
        }
        if (cmd.includes("journalctl")) {
          return {
            exitCode: 0,
            stdout: "Jan 01 12:00:00 agent hivemi-daemon[123]: Error: module not found\n",
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(verifyInstallation(ssh, silentLogger)).rejects.toThrow(
      "Agent Daemon is not running",
    );
  });

  it("throws when daemon has failed status", async () => {
    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("is-active")) {
          return { exitCode: 1, stdout: "failed\n", stderr: "" };
        }
        if (cmd.includes("systemctl status")) {
          return { exitCode: 1, stdout: "Active: failed", stderr: "" };
        }
        if (cmd.includes("journalctl")) {
          return { exitCode: 0, stdout: "crash logs here", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(verifyInstallation(ssh, silentLogger)).rejects.toThrow(
      "Agent Daemon is not running",
    );
  });

  it("returns status output and logs for diagnostics", async () => {
    const statusText = "● hivemi-daemon.service\n   Active: active (running) since Mon\n   PID: 12345";
    const logText = "Log line 1\nLog line 2\nLog line 3";

    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("is-active")) {
          return { exitCode: 0, stdout: "active\n", stderr: "" };
        }
        if (cmd.includes("systemctl status")) {
          return { exitCode: 0, stdout: statusText, stderr: "" };
        }
        if (cmd.includes("journalctl")) {
          return { exitCode: 0, stdout: logText, stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    const result = await verifyInstallation(ssh, silentLogger);

    expect(result.statusOutput).toBe(statusText);
    expect(result.logs).toBe(logText);
  });

  it("calls correct commands", async () => {
    const execFn = vi.fn(async (cmd: string): Promise<SSHExecResult> => {
      if (cmd.includes("is-active")) {
        return { exitCode: 0, stdout: "active\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const ssh = createMockSSH({ exec: execFn });
    await verifyInstallation(ssh, silentLogger);

    const commands = execFn.mock.calls.map((c) => c[0] as string);
    expect(commands.some((c) => c.includes("systemctl is-active hivemi-daemon"))).toBe(true);
    expect(commands.some((c) => c.includes("systemctl status hivemi-daemon"))).toBe(true);
    expect(commands.some((c) => c.includes("journalctl -u hivemi-daemon"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Configure orchestration with verify phase
// ---------------------------------------------------------------------------

describe("configure (with verify-install phase)", () => {
  function createTestConfig(): BootstrapConfig {
    return {
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
        soulMd: "# Test Soul",
        agentsMd: "# Test Agents",
        toolsMd: "# Test Tools",
        configJson: "{}",
      },
      secrets: [],
      secretProvider: new EnvFileProvider(new Map()),
      registryUrl: "http://registry:4001",
      hivemiSecret: "secret-123",
    };
  }

  it("calls all 5 phases in order including verify-install", async () => {
    const phasesStarted: string[] = [];
    const phasesCompleted: string[] = [];

    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("is-active")) {
          return { exitCode: 0, stdout: "active\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    await configure(ssh, createTestConfig(), silentLogger, {
      onPhaseStart: (phase) => phasesStarted.push(phase),
      onPhaseComplete: (phase) => phasesCompleted.push(phase),
    });

    expect(phasesStarted).toEqual([
      "inject-secrets",
      "configure-openclaw",
      "copy-role-config",
      "install-daemon",
      "verify-install",
    ]);
    expect(phasesCompleted).toEqual([
      "inject-secrets",
      "configure-openclaw",
      "copy-role-config",
      "install-daemon",
      "verify-install",
    ]);
  });

  it("reports verify-install error when daemon is not running", async () => {
    const errors: { phase: string; error: Error }[] = [];

    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("is-active")) {
          return { exitCode: 3, stdout: "inactive\n", stderr: "" };
        }
        if (cmd.includes("systemctl status")) {
          return { exitCode: 3, stdout: "Active: inactive", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(
      configure(ssh, createTestConfig(), silentLogger, {
        onPhaseError: (phase, error) => errors.push({ phase, error }),
      }),
    ).rejects.toThrow("Agent Daemon is not running");

    expect(errors.length).toBe(1);
    expect(errors[0].phase).toBe("verify-install");
  });

  it("does not run verify-install if install-daemon fails", async () => {
    const phasesStarted: string[] = [];

    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("daemon-reload")) {
          return { exitCode: 1, stdout: "", stderr: "reload failed" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(
      configure(ssh, createTestConfig(), silentLogger, {
        onPhaseStart: (phase) => phasesStarted.push(phase),
      }),
    ).rejects.toThrow();

    expect(phasesStarted).toContain("install-daemon");
    expect(phasesStarted).not.toContain("verify-install");
  });
});

// ---------------------------------------------------------------------------
// Tests: OpenClaw configuration details
// ---------------------------------------------------------------------------

describe("configureOpenClaw (detailed)", () => {
  it("creates workspace directory before writing files", async () => {
    const execCalls: string[] = [];
    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        execCalls.push(cmd);
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    const agent = {
      agentId: "id",
      agentName: "name",
      roleId: "role",
      teamId: "team",
      model: "test/model",
      daemonPort: 4002,
    };

    await configureOpenClaw(ssh, agent, "# Soul", undefined, silentLogger);

    expect(execCalls.some((c) => c.includes("mkdir -p"))).toBe(true);
  });

  it("writes config without auth when no apiToken provided", async () => {
    const ssh = createMockSSH();
    const agent = {
      agentId: "id",
      agentName: "name",
      roleId: "role",
      teamId: "team",
      model: "test/model",
      daemonPort: 4002,
    };

    await configureOpenClaw(ssh, agent, "# Soul", undefined, silentLogger);

    const configCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0].includes("config.yaml"),
    );
    const config = JSON.parse(configCall[1]);
    expect(config.gateway.http.endpoints.chatCompletions.enabled).toBe(true);
    expect(config.gateway.http.endpoints.chatCompletions.auth).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Copy role config details
// ---------------------------------------------------------------------------

describe("copyRoleConfig (detailed)", () => {
  it("writes optional tools.json when provided", async () => {
    const ssh = createMockSSH();
    const role: RoleConfig = {
      soulMd: "# Soul",
      agentsMd: "# Agents",
      toolsMd: "# Tools",
      configJson: "{}",
      toolsJson: '{"tools": []}',
    };

    await copyRoleConfig(ssh, role, silentLogger);

    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.openclaw/workspace/tools.json",
      '{"tools": []}',
    );
  });

  it("skips tools.json when not provided", async () => {
    const ssh = createMockSSH();
    const role: RoleConfig = {
      soulMd: "# Soul",
      agentsMd: "# Agents",
      toolsMd: "# Tools",
      configJson: "{}",
    };

    await copyRoleConfig(ssh, role, silentLogger);

    const writeFileCalls = (ssh.writeFile as any).mock.calls;
    const toolsJsonCall = writeFileCalls.find(
      (c: string[]) => c[0].includes("tools.json"),
    );
    expect(toolsJsonCall).toBeUndefined();
  });

  it("skips empty string files", async () => {
    const ssh = createMockSSH();
    const role: RoleConfig = {
      soulMd: "",
      agentsMd: "",
      toolsMd: "# Has content",
      configJson: "{}",
    };

    await copyRoleConfig(ssh, role, silentLogger);

    const writeFileCalls = (ssh.writeFile as any).mock.calls;
    const soulCall = writeFileCalls.find(
      (c: string[]) => c[0].includes("SOUL.md"),
    );
    // Empty strings are falsy so they should be skipped
    expect(soulCall).toBeUndefined();

    // TOOLS.md should be written
    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.openclaw/workspace/TOOLS.md",
      "# Has content",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Install daemon details
// ---------------------------------------------------------------------------

describe("installDaemon (detailed)", () => {
  function createConfig(overrides?: Partial<BootstrapConfig>): BootstrapConfig {
    return {
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
      ...overrides,
    };
  }

  it("writes all required env vars to .env", async () => {
    const ssh = createMockSSH();
    const config = createConfig();
    const secrets = new Map<string, string>();

    await installDaemon(ssh, config, secrets, silentLogger);

    const envCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0].includes(".env"),
    );
    const envContent = envCall[1] as string;

    expect(envContent).toContain("AGENT_ID=agent-uuid");
    expect(envContent).toContain("AGENT_NAME=test-agent");
    expect(envContent).toContain("ROLE_ID=role-uuid");
    expect(envContent).toContain("TEAM_ID=team-uuid");
    expect(envContent).toContain("MODEL=anthropic/claude-sonnet-4-5");
    expect(envContent).toContain("REGISTRY_URL=http://registry:4001");
    expect(envContent).toContain("HIVEMI_SECRET=secret-123");
    expect(envContent).toContain("DAEMON_PORT=4002");
  });

  it("includes resolved secrets in .env", async () => {
    const ssh = createMockSSH();
    const config = createConfig();
    const secrets = new Map([
      ["ANTHROPIC_API_KEY", "sk-ant-123"],
      ["OPENAI_API_KEY", "sk-oai-456"],
    ]);

    await installDaemon(ssh, config, secrets, silentLogger);

    const envCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0].includes(".env"),
    );
    const envContent = envCall[1] as string;

    expect(envContent).toContain("ANTHROPIC_API_KEY=sk-ant-123");
    expect(envContent).toContain("OPENAI_API_KEY=sk-oai-456");
  });

  it("creates daemon directory at correct path", async () => {
    const ssh = createMockSSH();
    await installDaemon(ssh, createConfig(), new Map(), silentLogger);

    expect(ssh.exec).toHaveBeenCalledWith("mkdir -p /home/openclaw/.hivemi/daemon");
  });

  it("writes systemd unit to correct path", async () => {
    const ssh = createMockSSH();
    await installDaemon(ssh, createConfig(), new Map(), silentLogger);

    const unitCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0] === "/etc/systemd/system/hivemi-daemon.service",
    );
    expect(unitCall).toBeDefined();
    const unit = unitCall[1] as string;

    expect(unit).toContain("WorkingDirectory=/home/openclaw/.hivemi/daemon");
    expect(unit).toContain("EnvironmentFile=/home/openclaw/.hivemi/daemon/.env");
    expect(unit).toContain("User=openclaw");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("ProtectSystem=strict");
  });

  it("throws if daemon-reload fails", async () => {
    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("daemon-reload")) {
          return { exitCode: 1, stdout: "", stderr: "failed to reload" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(
      installDaemon(ssh, createConfig(), new Map(), silentLogger),
    ).rejects.toThrow("daemon-reload failed");
  });

  it("throws if enable fails", async () => {
    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("systemctl enable")) {
          return { exitCode: 1, stdout: "", stderr: "enable failed" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(
      installDaemon(ssh, createConfig(), new Map(), silentLogger),
    ).rejects.toThrow("enable failed");
  });

  it("throws if start fails", async () => {
    const ssh = createMockSSH({
      exec: vi.fn(async (cmd: string): Promise<SSHExecResult> => {
        if (cmd.includes("systemctl start")) {
          return { exitCode: 1, stdout: "", stderr: "start failed" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });

    await expect(
      installDaemon(ssh, createConfig(), new Map(), silentLogger),
    ).rejects.toThrow("start failed");
  });
});

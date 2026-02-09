// =============================================================================
// Secret Provider Tests
// Tests for secret utilities, providers, target parsing, masking, and
// full injection flow with SSH.
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import { parseSecretTarget, maskSecret, isRequired } from "../secrets/utils.js";
import { EnvFileProvider } from "../secrets/envfile.js";
import { OnePasswordProvider } from "../secrets/onepassword.js";
import { injectSecrets } from "../phases/configure.js";
import type {
  ISSHClient,
  SSHExecResult,
  SecretMapping,
  BootstrapperLogger,
  ISecretProvider,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSSH(overrides?: Partial<ISSHClient>): ISSHClient {
  const files = new Map<string, { content: string; mode?: string }>();

  return {
    connected: true,
    connect: vi.fn(async () => {}),
    exec: vi.fn(async (_cmd: string): Promise<SSHExecResult> => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    })),
    writeFile: vi.fn(async (path: string, content: string, mode?: string) => {
      files.set(path, { content, mode });
    }),
    fileExists: vi.fn(async (_path: string) => false),
    disconnect: vi.fn(async () => {}),
    ...overrides,
  };
}

const silentLogger: BootstrapperLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ---------------------------------------------------------------------------
// Tests: parseSecretTarget
// ---------------------------------------------------------------------------

describe("parseSecretTarget", () => {
  it("parses env target", () => {
    const result = parseSecretTarget({ ref: "key", target: "env:API_KEY" });
    expect(result).toEqual({ kind: "env", value: "API_KEY" });
  });

  it("parses file target", () => {
    const result = parseSecretTarget({ ref: "key", target: "file:/home/user/.secret" });
    expect(result).toEqual({ kind: "file", value: "/home/user/.secret" });
  });

  it("parses file target with deep path", () => {
    const result = parseSecretTarget({
      ref: "key",
      target: "file:/home/openclaw/.openclaw/secrets/api-token",
    });
    expect(result).toEqual({
      kind: "file",
      value: "/home/openclaw/.openclaw/secrets/api-token",
    });
  });

  it("supports legacy envVar field when target is missing", () => {
    const result = parseSecretTarget({
      ref: "key",
      target: undefined as any,
      envVar: "LEGACY_VAR",
    });
    expect(result).toEqual({ kind: "env", value: "LEGACY_VAR" });
  });

  it("throws on empty env var name", () => {
    expect(() =>
      parseSecretTarget({ ref: "key", target: "env:" }),
    ).toThrow("Empty env var name");
  });

  it("throws on empty file path", () => {
    expect(() =>
      parseSecretTarget({ ref: "key", target: "file:" }),
    ).toThrow("Empty file path");
  });

  it("throws on relative file path", () => {
    expect(() =>
      parseSecretTarget({ ref: "key", target: "file:relative/path" }),
    ).toThrow("absolute path");
  });

  it("throws on unknown target format", () => {
    expect(() =>
      parseSecretTarget({ ref: "key", target: "s3://bucket/key" }),
    ).toThrow("Unknown secret target format");
  });

  it("throws when neither target nor envVar is set", () => {
    expect(() =>
      parseSecretTarget({ ref: "key", target: undefined as any }),
    ).toThrow("no target or envVar");
  });

  it("throws on invalid env var name (starts with number)", () => {
    expect(() =>
      parseSecretTarget({ ref: "key", target: "env:1INVALID" }),
    ).toThrow("Invalid env var name");
  });

  it("throws on env var with special chars", () => {
    expect(() =>
      parseSecretTarget({ ref: "key", target: "env:MY-VAR" }),
    ).toThrow("Invalid env var name");
  });

  it("accepts underscores in env var name", () => {
    const result = parseSecretTarget({ ref: "key", target: "env:MY_VAR_123" });
    expect(result).toEqual({ kind: "env", value: "MY_VAR_123" });
  });

  it("accepts env var starting with underscore", () => {
    const result = parseSecretTarget({ ref: "key", target: "env:_PRIVATE" });
    expect(result).toEqual({ kind: "env", value: "_PRIVATE" });
  });
});

// ---------------------------------------------------------------------------
// Tests: maskSecret
// ---------------------------------------------------------------------------

describe("maskSecret", () => {
  it("masks long secrets showing first 2 and last 2 chars", () => {
    expect(maskSecret("sk-ant-1234567890")).toMatch(/^sk\*+90$/);
  });

  it("fully masks short secrets (< 8 chars)", () => {
    expect(maskSecret("short")).toBe("***");
    expect(maskSecret("1234567")).toBe("***");
  });

  it("masks exactly 8 char secrets", () => {
    const result = maskSecret("12345678");
    expect(result).toMatch(/^12\*+78$/);
    expect(result.length).toBeLessThan("12345678".length + 10);
  });

  it("masks empty string", () => {
    expect(maskSecret("")).toBe("***");
  });

  it("caps asterisks at 20", () => {
    const longSecret = "a".repeat(100);
    const masked = maskSecret(longSecret);
    // first 2 + max 20 asterisks + last 2 = 24
    expect(masked.length).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// Tests: isRequired
// ---------------------------------------------------------------------------

describe("isRequired", () => {
  it("returns true when required is undefined (default)", () => {
    expect(isRequired({ ref: "key", target: "env:X" })).toBe(true);
  });

  it("returns true when required is true", () => {
    expect(isRequired({ ref: "key", target: "env:X", required: true })).toBe(true);
  });

  it("returns false when required is false", () => {
    expect(isRequired({ ref: "key", target: "env:X", required: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: EnvFileProvider — detailed
// ---------------------------------------------------------------------------

describe("EnvFileProvider (detailed)", () => {
  it("resolves known secrets", async () => {
    const provider = new EnvFileProvider(new Map([["MY_KEY", "my-value"]]));
    expect(await provider.getSecret("MY_KEY")).toBe("my-value");
  });

  it("throws for unknown secrets", async () => {
    const provider = new EnvFileProvider(new Map());
    await expect(provider.getSecret("MISSING")).rejects.toThrow("not found");
  });

  it("skips optional secrets in resolveAll", async () => {
    const provider = new EnvFileProvider(new Map([["FOUND", "val"]]));

    const result = await provider.resolveAll([
      { ref: "FOUND", target: "env:FOUND_VAR" },
      { ref: "MISSING", target: "env:MISSING_VAR", required: false },
    ]);

    expect(result.get("FOUND_VAR")).toBe("val");
    expect(result.has("MISSING_VAR")).toBe(false);
  });

  it("throws for required missing secrets in resolveAll", async () => {
    const provider = new EnvFileProvider(new Map());

    await expect(
      provider.resolveAll([
        { ref: "REQUIRED_KEY", target: "env:VAR", required: true },
      ]),
    ).rejects.toThrow("REQUIRED_KEY");
  });

  it("throws for missing secrets when required is undefined (default)", async () => {
    const provider = new EnvFileProvider(new Map());

    await expect(
      provider.resolveAll([
        { ref: "DEFAULT_REQUIRED", target: "env:VAR" },
      ]),
    ).rejects.toThrow("DEFAULT_REQUIRED");
  });

  it("resolves file targets in resolveAll", async () => {
    const provider = new EnvFileProvider(
      new Map([["CERT", "cert-data"]]),
    );

    const result = await provider.resolveAll([
      { ref: "CERT", target: "file:/etc/certs/ca.pem" },
    ]);

    expect(result.get("/etc/certs/ca.pem")).toBe("cert-data");
  });

  it("handles empty secrets map", async () => {
    const provider = new EnvFileProvider(new Map());
    const result = await provider.resolveAll([]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: OnePasswordProvider — constructor validation
// ---------------------------------------------------------------------------

describe("OnePasswordProvider (constructor)", () => {
  it("throws when no service account token is available", () => {
    const originalEnv = process.env.OP_SERVICE_ACCOUNT_TOKEN;
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;

    try {
      expect(() => new OnePasswordProvider()).toThrow("service account token required");
    } finally {
      if (originalEnv) {
        process.env.OP_SERVICE_ACCOUNT_TOKEN = originalEnv;
      }
    }
  });

  it("accepts token via constructor", () => {
    const provider = new OnePasswordProvider("test-token");
    expect(provider.name).toBe("1password");
  });

  it("validates op:// prefix on getSecret", async () => {
    const provider = new OnePasswordProvider("test-token");

    await expect(
      provider.getSecret("not-an-op-ref"),
    ).rejects.toThrow('must start with "op://"');
  });
});

// ---------------------------------------------------------------------------
// Tests: injectSecrets — full injection flow
// ---------------------------------------------------------------------------

describe("injectSecrets (full flow)", () => {
  it("resolves env secrets without writing files", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([["KEY", "value"]]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [{ ref: "KEY", target: "env:API_KEY" }],
      silentLogger,
    );

    expect(result.envSecrets.get("API_KEY")).toBe("value");
    expect(result.fileSecrets).toHaveLength(0);
    // writeFile should NOT be called for env targets (env goes to .env later)
    expect(ssh.writeFile).not.toHaveBeenCalled();
  });

  it("writes file secrets to VM with mode 600", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([["TOKEN", "secret-token"]]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [{ ref: "TOKEN", target: "file:/home/openclaw/.secrets/token" }],
      silentLogger,
    );

    expect(result.fileSecrets).toContain("/home/openclaw/.secrets/token");
    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.secrets/token",
      "secret-token",
      "600",
    );
  });

  it("handles mix of env and file targets", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([
        ["API_REF", "sk-123"],
        ["CERT_REF", "cert-data"],
        ["TOKEN_REF", "tok-456"],
      ]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [
        { ref: "API_REF", target: "env:OPENAI_API_KEY" },
        { ref: "CERT_REF", target: "file:/etc/ssl/certs/custom.pem" },
        { ref: "TOKEN_REF", target: "env:HIVEMI_SECRET" },
      ],
      silentLogger,
    );

    expect(result.envSecrets.size).toBe(2);
    expect(result.envSecrets.get("OPENAI_API_KEY")).toBe("sk-123");
    expect(result.envSecrets.get("HIVEMI_SECRET")).toBe("tok-456");
    expect(result.fileSecrets).toEqual(["/etc/ssl/certs/custom.pem"]);
  });

  it("skips optional missing secrets and records them", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([["FOUND", "val"]]),
    );

    const result = await injectSecrets(
      ssh,
      provider,
      [
        { ref: "FOUND", target: "env:FOUND_VAR" },
        { ref: "OPT1", target: "env:OPT_VAR1", required: false },
        { ref: "OPT2", target: "file:/opt/secrets/opt2", required: false },
      ],
      silentLogger,
    );

    expect(result.envSecrets.size).toBe(1);
    expect(result.fileSecrets).toHaveLength(0);
    expect(result.skipped).toEqual(["OPT1", "OPT2"]);
  });

  it("throws on required missing secret", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(new Map());

    await expect(
      injectSecrets(
        ssh,
        provider,
        [{ ref: "REQUIRED_SECRET", target: "env:VAR" }],
        silentLogger,
      ),
    ).rejects.toThrow("REQUIRED_SECRET");
  });

  it("throws on required missing secret even when required is explicit", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(new Map());

    await expect(
      injectSecrets(
        ssh,
        provider,
        [{ ref: "EXPLICIT_REQ", target: "env:VAR", required: true }],
        silentLogger,
      ),
    ).rejects.toThrow("EXPLICIT_REQ");
  });

  it("returns empty result for empty mappings", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(new Map());

    const result = await injectSecrets(ssh, provider, [], silentLogger);

    expect(result.envSecrets.size).toBe(0);
    expect(result.fileSecrets).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("does not log secret values", async () => {
    const loggedMessages: string[] = [];
    const capturingLogger: BootstrapperLogger = {
      debug: (msg) => loggedMessages.push(msg),
      info: (msg) => loggedMessages.push(msg),
      warn: (msg) => loggedMessages.push(msg),
      error: (msg) => loggedMessages.push(msg),
    };

    const ssh = createMockSSH();
    const secretValue = "super-secret-api-key-12345";
    const provider = new EnvFileProvider(
      new Map([["REF", secretValue]]),
    );

    await injectSecrets(
      ssh,
      provider,
      [{ ref: "REF", target: "env:API_KEY" }],
      capturingLogger,
    );

    // The full secret value should never appear in logs
    const allLogs = loggedMessages.join("\n");
    expect(allLogs).not.toContain(secretValue);
    // But masked version should be present
    expect(allLogs).toContain("su");
    expect(allLogs).toContain("***");
  });

  it("handles multiple file targets with correct permissions", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([
        ["SECRET1", "val1"],
        ["SECRET2", "val2"],
      ]),
    );

    await injectSecrets(
      ssh,
      provider,
      [
        { ref: "SECRET1", target: "file:/home/openclaw/.secrets/s1" },
        { ref: "SECRET2", target: "file:/home/openclaw/.secrets/s2" },
      ],
      silentLogger,
    );

    expect(ssh.writeFile).toHaveBeenCalledTimes(2);
    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.secrets/s1", "val1", "600",
    );
    expect(ssh.writeFile).toHaveBeenCalledWith(
      "/home/openclaw/.secrets/s2", "val2", "600",
    );
  });

  it("default secrets for every agent (LLM key + HIVEMI_SECRET)", async () => {
    const ssh = createMockSSH();
    const provider = new EnvFileProvider(
      new Map([
        ["op://Clawdia/Anthropic/credential", "sk-ant-real-key"],
        ["op://Clawdia/HiveMI/secret", "hivemi-secret-123"],
      ]),
    );

    const defaultSecrets: SecretMapping[] = [
      { ref: "op://Clawdia/Anthropic/credential", target: "env:ANTHROPIC_API_KEY" },
      { ref: "op://Clawdia/HiveMI/secret", target: "env:HIVEMI_SECRET" },
    ];

    const result = await injectSecrets(ssh, provider, defaultSecrets, silentLogger);

    expect(result.envSecrets.get("ANTHROPIC_API_KEY")).toBe("sk-ant-real-key");
    expect(result.envSecrets.get("HIVEMI_SECRET")).toBe("hivemi-secret-123");
  });
});

// ---------------------------------------------------------------------------
// Tests: SecretMapping validation (edge cases)
// ---------------------------------------------------------------------------

describe("SecretMapping validation", () => {
  it("env target with single char var name", () => {
    const result = parseSecretTarget({ ref: "r", target: "env:X" });
    expect(result).toEqual({ kind: "env", value: "X" });
  });

  it("file target at root", () => {
    const result = parseSecretTarget({ ref: "r", target: "file:/secret" });
    expect(result).toEqual({ kind: "file", value: "/secret" });
  });

  it("env target is case-sensitive", () => {
    const lower = parseSecretTarget({ ref: "r", target: "env:apiKey" });
    const upper = parseSecretTarget({ ref: "r", target: "env:API_KEY" });
    expect(lower.value).toBe("apiKey");
    expect(upper.value).toBe("API_KEY");
  });
});

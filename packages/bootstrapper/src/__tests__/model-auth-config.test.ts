// =============================================================================
// Model & Auth Configuration Tests
// Tests for model-config.ts — provider detection, auth profiles, key validation,
// fallback models, and integration with the configure phase.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectProvider,
  extractModelName,
  getRequiredProviders,
  getProviderConfig,
  validateKeyFormat,
  validateKeyLive,
  buildModelConfig,
  resolveAuthProfiles,
  validateAuthProfiles,
  authProfilesToEnv,
  generateFallbackConfig,
  logModelAuthSummary,
  PROVIDER_REGISTRY,
} from "../model-config.js";
import type {
  LLMProviderName,
  LLMProviderConfig,
  AuthProfile,
  ModelConfigOptions,
  KeyValidationResult,
} from "../model-config.js";
import {
  generateOpenClawConfig,
  validateOpenClawConfig,
} from "../openclaw-config.js";
import { configureOpenClaw } from "../phases/configure.js";
import { EnvFileProvider } from "../secrets/envfile.js";
import type {
  ISSHClient,
  SSHExecResult,
  BootstrapperLogger,
  ISecretProvider,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSSH(overrides?: Partial<ISSHClient>): ISSHClient {
  return {
    connected: true,
    connect: vi.fn(async () => {}),
    exec: vi.fn(async (_cmd: string): Promise<SSHExecResult> => ({
      exitCode: 0,
      stdout: "500\n",
      stderr: "",
    })),
    writeFile: vi.fn(async () => {}),
    fileExists: vi.fn(async () => false),
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

function createCapturingLogger(): { logger: BootstrapperLogger; messages: string[] } {
  const messages: string[] = [];
  const logger: BootstrapperLogger = {
    debug: (msg) => messages.push(`[debug] ${msg}`),
    info: (msg) => messages.push(`[info] ${msg}`),
    warn: (msg) => messages.push(`[warn] ${msg}`),
    error: (msg) => messages.push(`[error] ${msg}`),
  };
  return { logger, messages };
}

function createAgent(model = "anthropic/claude-sonnet-4-5") {
  return {
    agentId: "agent-uuid-123",
    agentName: "test-agent",
    roleId: "role-uuid",
    teamId: "team-uuid",
    model,
    daemonPort: 3100,
  };
}

// ---------------------------------------------------------------------------
// Tests: detectProvider
// ---------------------------------------------------------------------------

describe("detectProvider", () => {
  it("detects anthropic from explicit prefix", () => {
    expect(detectProvider("anthropic/claude-sonnet-4-5")).toBe("anthropic");
  });

  it("detects openai from explicit prefix", () => {
    expect(detectProvider("openai/gpt-4o")).toBe("openai");
  });

  it("detects google from explicit prefix", () => {
    expect(detectProvider("google/gemini-2.5-pro")).toBe("google");
  });

  it("detects github-copilot from explicit prefix", () => {
    expect(detectProvider("github-copilot/claude-sonnet-4-5")).toBe("github-copilot");
  });

  it("detects anthropic from model name (no prefix)", () => {
    expect(detectProvider("claude-sonnet-4-5")).toBe("anthropic");
    expect(detectProvider("claude-3-5-sonnet")).toBe("anthropic");
    expect(detectProvider("claude-3-5-haiku")).toBe("anthropic");
    expect(detectProvider("claude-opus-4")).toBe("anthropic");
  });

  it("detects openai from model name (no prefix)", () => {
    expect(detectProvider("gpt-4")).toBe("openai");
    expect(detectProvider("gpt-4o")).toBe("openai");
    expect(detectProvider("gpt-4o-mini")).toBe("openai");
    expect(detectProvider("o1")).toBe("openai");
    expect(detectProvider("o3-mini")).toBe("openai");
  });

  it("detects google from model name (no prefix)", () => {
    expect(detectProvider("gemini-2.0-flash")).toBe("google");
    expect(detectProvider("gemini-2.5-pro")).toBe("google");
  });

  it("returns custom for unknown models", () => {
    expect(detectProvider("some-random-model")).toBe("custom");
  });

  it("returns custom for empty string", () => {
    expect(detectProvider("")).toBe("custom");
  });

  it("returns custom for unknown prefix", () => {
    expect(detectProvider("mistral/mixtral-8x7b")).toBe("custom");
  });

  it("is case-insensitive for prefixes", () => {
    expect(detectProvider("Anthropic/claude-sonnet-4-5")).toBe("anthropic");
    expect(detectProvider("OPENAI/gpt-4")).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// Tests: extractModelName
// ---------------------------------------------------------------------------

describe("extractModelName", () => {
  it("strips provider prefix", () => {
    expect(extractModelName("anthropic/claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  });

  it("returns model name as-is when no prefix", () => {
    expect(extractModelName("gpt-4")).toBe("gpt-4");
  });

  it("handles model with multiple slashes", () => {
    expect(extractModelName("provider/model/variant")).toBe("model/variant");
  });

  it("handles empty string", () => {
    expect(extractModelName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Tests: getRequiredProviders
// ---------------------------------------------------------------------------

describe("getRequiredProviders", () => {
  it("returns unique providers for model list", () => {
    const providers = getRequiredProviders([
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4o",
    ]);
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toHaveLength(2);
  });

  it("deduplicates same provider", () => {
    const providers = getRequiredProviders([
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-3-5-haiku",
    ]);
    expect(providers).toEqual(["anthropic"]);
  });

  it("returns empty for empty list", () => {
    expect(getRequiredProviders([])).toEqual([]);
  });

  it("handles mix of explicit and implicit providers", () => {
    const providers = getRequiredProviders([
      "anthropic/claude-sonnet-4-5",
      "gpt-4o",
    ]);
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
  });
});

// ---------------------------------------------------------------------------
// Tests: PROVIDER_REGISTRY
// ---------------------------------------------------------------------------

describe("PROVIDER_REGISTRY", () => {
  it("has anthropic provider", () => {
    expect(PROVIDER_REGISTRY.anthropic.envVar).toBe("ANTHROPIC_API_KEY");
    expect(PROVIDER_REGISTRY.anthropic.displayName).toBe("Anthropic");
    expect(PROVIDER_REGISTRY.anthropic.validateKey).toBe(true);
  });

  it("has openai provider", () => {
    expect(PROVIDER_REGISTRY.openai.envVar).toBe("OPENAI_API_KEY");
    expect(PROVIDER_REGISTRY.openai.displayName).toBe("OpenAI");
  });

  it("has google provider", () => {
    expect(PROVIDER_REGISTRY.google.envVar).toBe("GOOGLE_API_KEY");
    expect(PROVIDER_REGISTRY.google.displayName).toBe("Google AI");
  });

  it("has github-copilot provider", () => {
    expect(PROVIDER_REGISTRY["github-copilot"].envVar).toBe("GITHUB_TOKEN");
    expect(PROVIDER_REGISTRY["github-copilot"].validateKey).toBe(false);
  });

  it("has custom provider with base URL support", () => {
    expect(PROVIDER_REGISTRY.custom.envVar).toBe("LLM_API_KEY");
    expect(PROVIDER_REGISTRY.custom.baseUrlEnvVar).toBe("LLM_BASE_URL");
  });

  it("all providers have required fields", () => {
    for (const [name, config] of Object.entries(PROVIDER_REGISTRY)) {
      expect(config.name).toBe(name);
      expect(config.displayName).toBeTruthy();
      expect(config.envVar).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: getProviderConfig
// ---------------------------------------------------------------------------

describe("getProviderConfig", () => {
  it("returns default config for known provider", () => {
    const config = getProviderConfig("anthropic");
    expect(config.name).toBe("anthropic");
    expect(config.envVar).toBe("ANTHROPIC_API_KEY");
  });

  it("applies overrides", () => {
    const config = getProviderConfig("anthropic", {
      secretRef: "op://MyVault/Anthropic/key",
      baseUrl: "https://custom-proxy.example.com",
    });
    expect(config.secretRef).toBe("op://MyVault/Anthropic/key");
    expect(config.baseUrl).toBe("https://custom-proxy.example.com");
    expect(config.envVar).toBe("ANTHROPIC_API_KEY"); // unchanged
  });

  it("handles unknown provider with overrides", () => {
    const config = getProviderConfig("custom" as LLMProviderName, {
      envVar: "CUSTOM_KEY",
    });
    expect(config.envVar).toBe("CUSTOM_KEY");
  });
});

// ---------------------------------------------------------------------------
// Tests: validateKeyFormat
// ---------------------------------------------------------------------------

describe("validateKeyFormat", () => {
  it("validates anthropic key format", () => {
    const result = validateKeyFormat("anthropic", "sk-ant-api123456789012345678901234567890");
    expect(result.valid).toBe(true);
  });

  it("rejects anthropic key with wrong prefix", () => {
    const result = validateKeyFormat("anthropic", "sk-proj-12345678901234567890");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sk-ant-");
  });

  it("rejects short anthropic key", () => {
    const result = validateKeyFormat("anthropic", "sk-ant-short");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too short");
  });

  it("validates openai key format", () => {
    const result = validateKeyFormat("openai", "sk-proj-12345678901234567890");
    expect(result.valid).toBe(true);
  });

  it("rejects openai key with wrong prefix", () => {
    const result = validateKeyFormat("openai", "not-a-valid-key-1234567890");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sk-");
  });

  it("validates google key format", () => {
    const result = validateKeyFormat("google", "AIzaSyB1234567890abcdef");
    expect(result.valid).toBe(true);
  });

  it("rejects short google key", () => {
    const result = validateKeyFormat("google", "short");
    expect(result.valid).toBe(false);
  });

  it("validates github token", () => {
    const result = validateKeyFormat("github-copilot", "ghp_1234567890abcdef1234567890");
    expect(result.valid).toBe(true);
  });

  it("rejects empty key for any provider", () => {
    expect(validateKeyFormat("anthropic", "").valid).toBe(false);
    expect(validateKeyFormat("openai", "").valid).toBe(false);
    expect(validateKeyFormat("google", "").valid).toBe(false);
    expect(validateKeyFormat("custom", "").valid).toBe(false);
  });

  it("rejects whitespace-only key", () => {
    expect(validateKeyFormat("anthropic", "   ").valid).toBe(false);
  });

  it("accepts any non-empty key for custom provider", () => {
    expect(validateKeyFormat("custom", "any-key-works").valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: validateKeyLive
// ---------------------------------------------------------------------------

describe("validateKeyLive", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns valid for anthropic with 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const result = await validateKeyLive("anthropic", "sk-ant-test");
    expect(result.valid).toBe(true);
  });

  it("returns invalid for anthropic with 401 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"invalid"}', { status: 401 }),
    );
    const result = await validateKeyLive("anthropic", "sk-ant-bad");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns valid for openai with 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"data":[]}', { status: 200 }),
    );
    const result = await validateKeyLive("openai", "sk-test");
    expect(result.valid).toBe(true);
  });

  it("returns invalid for openai with 401 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"invalid"}', { status: 401 }),
    );
    const result = await validateKeyLive("openai", "sk-bad");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns valid for google with 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"models":[]}', { status: 200 }),
    );
    const result = await validateKeyLive("google", "AIzaSyTest");
    expect(result.valid).toBe(true);
  });

  it("returns invalid for google with 403 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"forbidden"}', { status: 403 }),
    );
    const result = await validateKeyLive("google", "bad-key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("403");
  });

  it("skips validation for github-copilot", async () => {
    const result = await validateKeyLive("github-copilot", "ghp_test");
    expect(result.valid).toBe(true);
  });

  it("skips validation for custom provider", async () => {
    const result = await validateKeyLive("custom", "any-key");
    expect(result.valid).toBe(true);
  });

  it("returns valid on network error (benefit of the doubt)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
    const result = await validateKeyLive("anthropic", "sk-ant-test");
    expect(result.valid).toBe(true);
  });

  it("returns invalid on timeout (AbortError)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("Aborted"), { name: "AbortError" }),
    );
    const result = await validateKeyLive("anthropic", "sk-ant-test", undefined, 100);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("uses custom base URL when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    await validateKeyLive("anthropic", "sk-ant-test", "https://proxy.example.com");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://proxy.example.com/v1/messages",
      expect.any(Object),
    );
  });

  it("returns valid for anthropic with 400 response (auth passed, bad request)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"bad request"}', { status: 400 }),
    );
    const result = await validateKeyLive("anthropic", "sk-ant-test");
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: buildModelConfig
// ---------------------------------------------------------------------------

describe("buildModelConfig", () => {
  it("builds config for single model", () => {
    const result = buildModelConfig({ model: "anthropic/claude-sonnet-4-5" });
    expect(result.primary).toBe("anthropic/claude-sonnet-4-5");
    expect(result.primaryProvider).toBe("anthropic");
    expect(result.fallbacks).toEqual([]);
    expect(result.requiredProviders).toEqual(["anthropic"]);
  });

  it("builds config with fallback models", () => {
    const result = buildModelConfig({
      model: "anthropic/claude-sonnet-4-5",
      fallbackModels: ["openai/gpt-4o", "anthropic/claude-3-5-haiku"],
    });
    expect(result.primary).toBe("anthropic/claude-sonnet-4-5");
    expect(result.fallbacks).toEqual(["openai/gpt-4o", "anthropic/claude-3-5-haiku"]);
    expect(result.requiredProviders).toContain("anthropic");
    expect(result.requiredProviders).toContain("openai");
    expect(result.requiredProviders).toHaveLength(2); // deduped
  });

  it("applies provider overrides", () => {
    const result = buildModelConfig({
      model: "anthropic/claude-sonnet-4-5",
      providerOverrides: {
        anthropic: { secretRef: "op://Vault/Anthropic/key" },
      },
    });
    const config = result.providerConfigs.get("anthropic");
    expect(config?.secretRef).toBe("op://Vault/Anthropic/key");
  });

  it("builds provider configs for all required providers", () => {
    const result = buildModelConfig({
      model: "anthropic/claude-sonnet-4-5",
      fallbackModels: ["openai/gpt-4o"],
    });
    expect(result.providerConfigs.has("anthropic")).toBe(true);
    expect(result.providerConfigs.has("openai")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveAuthProfiles
// ---------------------------------------------------------------------------

describe("resolveAuthProfiles", () => {
  it("resolves auth profiles from secret provider", async () => {
    const provider = new EnvFileProvider(
      new Map([["op://Vault/Anthropic/key", "sk-ant-api12345678901234567890"]]),
    );

    const configs = new Map<LLMProviderName, LLMProviderConfig>([
      [
        "anthropic",
        {
          ...PROVIDER_REGISTRY.anthropic,
          secretRef: "op://Vault/Anthropic/key",
        },
      ],
    ]);

    const profiles = await resolveAuthProfiles(configs, provider, silentLogger);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].provider).toBe("anthropic");
    expect(profiles[0].envVar).toBe("ANTHROPIC_API_KEY");
    expect(profiles[0].apiKey).toBe("sk-ant-api12345678901234567890");
  });

  it("resolves multiple providers", async () => {
    const provider = new EnvFileProvider(
      new Map([
        ["op://Vault/Anthropic/key", "sk-ant-api12345678901234567890"],
        ["op://Vault/OpenAI/key", "sk-proj-12345678901234567890"],
      ]),
    );

    const configs = new Map<LLMProviderName, LLMProviderConfig>([
      ["anthropic", { ...PROVIDER_REGISTRY.anthropic, secretRef: "op://Vault/Anthropic/key" }],
      ["openai", { ...PROVIDER_REGISTRY.openai, secretRef: "op://Vault/OpenAI/key" }],
    ]);

    const profiles = await resolveAuthProfiles(configs, provider, silentLogger);
    expect(profiles).toHaveLength(2);
    expect(profiles.find((p) => p.provider === "anthropic")).toBeDefined();
    expect(profiles.find((p) => p.provider === "openai")).toBeDefined();
  });

  it("skips providers without secret ref", async () => {
    const provider = new EnvFileProvider(new Map());
    const configs = new Map<LLMProviderName, LLMProviderConfig>([
      ["anthropic", { ...PROVIDER_REGISTRY.anthropic }], // no secretRef
    ]);

    const profiles = await resolveAuthProfiles(configs, provider, silentLogger);
    expect(profiles).toHaveLength(0);
  });

  it("throws when required secret cannot be resolved", async () => {
    const provider = new EnvFileProvider(new Map()); // empty — no secrets
    const configs = new Map<LLMProviderName, LLMProviderConfig>([
      ["anthropic", { ...PROVIDER_REGISTRY.anthropic, secretRef: "op://Missing/Secret" }],
    ]);

    await expect(
      resolveAuthProfiles(configs, provider, silentLogger),
    ).rejects.toThrow("Failed to resolve API key");
  });

  it("throws when key format validation fails", async () => {
    const provider = new EnvFileProvider(
      new Map([["ref", "not-a-valid-anthropic-key"]]),
    );
    const configs = new Map<LLMProviderName, LLMProviderConfig>([
      ["anthropic", { ...PROVIDER_REGISTRY.anthropic, secretRef: "ref", validateKey: true }],
    ]);

    await expect(
      resolveAuthProfiles(configs, provider, silentLogger),
    ).rejects.toThrow("format validation failed");
  });

  it("skips format validation when validateKey is false", async () => {
    const provider = new EnvFileProvider(
      new Map([["ref", "not-standard-format"]]),
    );
    const configs = new Map<LLMProviderName, LLMProviderConfig>([
      ["github-copilot", { ...PROVIDER_REGISTRY["github-copilot"], secretRef: "ref", validateKey: false }],
    ]);

    const profiles = await resolveAuthProfiles(configs, provider, silentLogger);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].apiKey).toBe("not-standard-format");
  });

  it("includes base URL in auth profile", async () => {
    const provider = new EnvFileProvider(new Map([["ref", "custom-key-value"]]));
    const configs = new Map<LLMProviderName, LLMProviderConfig>([
      [
        "custom",
        {
          ...PROVIDER_REGISTRY.custom,
          secretRef: "ref",
          baseUrl: "https://custom-api.example.com",
          baseUrlEnvVar: "LLM_BASE_URL",
          validateKey: false,
        },
      ],
    ]);

    const profiles = await resolveAuthProfiles(configs, provider, silentLogger);
    expect(profiles[0].baseUrl).toBe("https://custom-api.example.com");
    expect(profiles[0].baseUrlEnvVar).toBe("LLM_BASE_URL");
  });
});

// ---------------------------------------------------------------------------
// Tests: validateAuthProfiles
// ---------------------------------------------------------------------------

describe("validateAuthProfiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates all profiles successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    const profiles: AuthProfile[] = [
      { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-test" },
    ];

    const result = await validateAuthProfiles(profiles, silentLogger);
    expect(result.valid).toBe(true);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].valid).toBe(true);
  });

  it("returns invalid when a provider fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401 }),
    );

    const profiles: AuthProfile[] = [
      { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-bad" },
    ];

    const result = await validateAuthProfiles(profiles, silentLogger);
    expect(result.valid).toBe(false);
    expect(result.providers[0].valid).toBe(false);
    expect(result.providers[0].error).toContain("401");
  });

  it("validates multiple profiles independently", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return new Response("{}", { status: 200 });
      return new Response("{}", { status: 401 });
    });

    const profiles: AuthProfile[] = [
      { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-good" },
      { provider: "openai", envVar: "OPENAI_API_KEY", apiKey: "sk-bad" },
    ];

    const result = await validateAuthProfiles(profiles, silentLogger);
    expect(result.valid).toBe(false); // one failed
    expect(result.providers[0].valid).toBe(true);
    expect(result.providers[1].valid).toBe(false);
  });

  it("returns valid for empty profiles", async () => {
    const result = await validateAuthProfiles([], silentLogger);
    expect(result.valid).toBe(true);
    expect(result.providers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: authProfilesToEnv
// ---------------------------------------------------------------------------

describe("authProfilesToEnv", () => {
  it("converts profiles to env map", () => {
    const profiles: AuthProfile[] = [
      { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-123" },
      { provider: "openai", envVar: "OPENAI_API_KEY", apiKey: "sk-oai-456" },
    ];

    const env = authProfilesToEnv(profiles);
    expect(env.get("ANTHROPIC_API_KEY")).toBe("sk-ant-123");
    expect(env.get("OPENAI_API_KEY")).toBe("sk-oai-456");
  });

  it("includes base URL env var when present", () => {
    const profiles: AuthProfile[] = [
      {
        provider: "custom",
        envVar: "LLM_API_KEY",
        apiKey: "custom-key",
        baseUrl: "https://proxy.example.com",
        baseUrlEnvVar: "LLM_BASE_URL",
      },
    ];

    const env = authProfilesToEnv(profiles);
    expect(env.get("LLM_API_KEY")).toBe("custom-key");
    expect(env.get("LLM_BASE_URL")).toBe("https://proxy.example.com");
  });

  it("returns empty map for no profiles", () => {
    const env = authProfilesToEnv([]);
    expect(env.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: generateFallbackConfig
// ---------------------------------------------------------------------------

describe("generateFallbackConfig", () => {
  it("returns undefined for empty fallbacks", () => {
    expect(generateFallbackConfig([])).toBeUndefined();
  });

  it("returns models array for fallbacks", () => {
    const result = generateFallbackConfig(["openai/gpt-4o", "anthropic/claude-3-5-haiku"]);
    expect(result).toEqual({ models: ["openai/gpt-4o", "anthropic/claude-3-5-haiku"] });
  });

  it("returns single fallback", () => {
    const result = generateFallbackConfig(["openai/gpt-4o"]);
    expect(result).toEqual({ models: ["openai/gpt-4o"] });
  });
});

// ---------------------------------------------------------------------------
// Tests: logModelAuthSummary
// ---------------------------------------------------------------------------

describe("logModelAuthSummary", () => {
  it("logs model and provider info without secrets", () => {
    const { logger, messages } = createCapturingLogger();

    logModelAuthSummary(
      {
        primary: "anthropic/claude-sonnet-4-5",
        fallbacks: ["openai/gpt-4o"],
        primaryProvider: "anthropic",
        requiredProviders: ["anthropic", "openai"],
      },
      [
        { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-1234567890abcdef" },
        { provider: "openai", envVar: "OPENAI_API_KEY", apiKey: "sk-proj-1234567890abcdef" },
      ],
      logger,
    );

    const allLogs = messages.join("\n");
    expect(allLogs).toContain("anthropic/claude-sonnet-4-5");
    expect(allLogs).toContain("openai/gpt-4o");
    expect(allLogs).toContain("anthropic");
    expect(allLogs).toContain("openai");
    // Should NOT contain actual API keys
    expect(allLogs).not.toContain("sk-ant-1234567890abcdef");
    expect(allLogs).not.toContain("sk-proj-1234567890abcdef");
    // Should contain masked versions
    expect(allLogs).toContain("***");
  });

  it("logs no fallbacks when none configured", () => {
    const { logger, messages } = createCapturingLogger();

    logModelAuthSummary(
      {
        primary: "anthropic/claude-sonnet-4-5",
        fallbacks: [],
        primaryProvider: "anthropic",
        requiredProviders: ["anthropic"],
      },
      [],
      logger,
    );

    const allLogs = messages.join("\n");
    expect(allLogs).toContain("none");
  });

  it("logs base URL when present", () => {
    const { logger, messages } = createCapturingLogger();

    logModelAuthSummary(
      {
        primary: "custom/my-model",
        fallbacks: [],
        primaryProvider: "custom",
        requiredProviders: ["custom"],
      },
      [
        {
          provider: "custom",
          envVar: "LLM_API_KEY",
          apiKey: "custom-key-value-12345",
          baseUrl: "https://proxy.example.com",
        },
      ],
      logger,
    );

    const allLogs = messages.join("\n");
    expect(allLogs).toContain("https://proxy.example.com");
  });
});

// ---------------------------------------------------------------------------
// Tests: OpenClaw config with fallback models
// ---------------------------------------------------------------------------

describe("OpenClaw config with fallback models", () => {
  it("includes fallback models in config", () => {
    const config = generateOpenClawConfig({
      agent: createAgent(),
      fallbackModels: ["openai/gpt-4o", "anthropic/claude-3-5-haiku"],
    });

    expect(config.llm.fallbacks).toBeDefined();
    expect(config.llm.fallbacks!.models).toEqual(["openai/gpt-4o", "anthropic/claude-3-5-haiku"]);
  });

  it("omits fallbacks when none provided", () => {
    const config = generateOpenClawConfig({
      agent: createAgent(),
    });

    expect(config.llm.fallbacks).toBeUndefined();
  });

  it("omits fallbacks for empty array", () => {
    const config = generateOpenClawConfig({
      agent: createAgent(),
      fallbackModels: [],
    });

    expect(config.llm.fallbacks).toBeUndefined();
  });

  it("config with fallbacks passes validation", () => {
    const config = generateOpenClawConfig({
      agent: createAgent(),
      apiToken: "test-token",
      fallbackModels: ["openai/gpt-4o"],
    });

    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(true);
  });

  it("fallbacks survive JSON round-trip", () => {
    const config = generateOpenClawConfig({
      agent: createAgent(),
      fallbackModels: ["openai/gpt-4o", "google/gemini-2.5-pro"],
    });

    const json = JSON.stringify(config, null, 2);
    const parsed = JSON.parse(json);
    expect(parsed.llm.fallbacks.models).toEqual(["openai/gpt-4o", "google/gemini-2.5-pro"]);
  });
});

// ---------------------------------------------------------------------------
// Tests: configureOpenClaw with auth profiles
// ---------------------------------------------------------------------------

describe("configureOpenClaw with auth profiles", () => {
  it("returns auth env vars from pre-resolved profiles", async () => {
    const ssh = createMockSSH();

    const result = await configureOpenClaw(
      ssh,
      createAgent(),
      "# Test Soul",
      "api-token",
      silentLogger,
      {
        authProfiles: [
          { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-test" },
        ],
      },
    );

    expect(result.authEnvVars.get("ANTHROPIC_API_KEY")).toBe("sk-ant-test");
  });

  it("returns empty env vars when no auth profiles", async () => {
    const ssh = createMockSSH();

    const result = await configureOpenClaw(
      ssh,
      createAgent(),
      "# Test Soul",
      "api-token",
      silentLogger,
    );

    expect(result.authEnvVars.size).toBe(0);
  });

  it("includes fallback models in written config", async () => {
    const ssh = createMockSSH();

    await configureOpenClaw(
      ssh,
      createAgent(),
      "# Test Soul",
      "api-token",
      silentLogger,
      { fallbackModels: ["openai/gpt-4o"] },
    );

    const configCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0].includes("config.yaml"),
    );
    const config = JSON.parse(configCall[1]);
    expect(config.llm.fallbacks).toEqual({ models: ["openai/gpt-4o"] });
  });

  it("throws when live key validation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401 }),
    );

    const ssh = createMockSSH();

    await expect(
      configureOpenClaw(
        ssh,
        createAgent(),
        "# Test Soul",
        "api-token",
        silentLogger,
        {
          authProfiles: [
            { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-bad" },
          ],
          validateKeysLive: true,
        },
      ),
    ).rejects.toThrow("API key validation failed");

    vi.restoreAllMocks();
  });

  it("passes when live key validation succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    const ssh = createMockSSH();

    const result = await configureOpenClaw(
      ssh,
      createAgent(),
      "# Test Soul",
      "api-token",
      silentLogger,
      {
        authProfiles: [
          { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-good" },
        ],
        validateKeysLive: true,
      },
    );

    expect(result.authEnvVars.get("ANTHROPIC_API_KEY")).toBe("sk-ant-good");
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Tests: Integration — full model config + auth + config generation
// ---------------------------------------------------------------------------

describe("Integration: model config → auth → openclaw config", () => {
  it("anthropic primary, openai fallback", async () => {
    const provider = new EnvFileProvider(
      new Map([
        ["op://Vault/Anthropic/key", "sk-ant-api12345678901234567890"],
        ["op://Vault/OpenAI/key", "sk-proj-12345678901234567890"],
      ]),
    );

    // 1. Build model config
    const modelConfig = buildModelConfig({
      model: "anthropic/claude-sonnet-4-5",
      fallbackModels: ["openai/gpt-4o"],
      providerOverrides: {
        anthropic: { secretRef: "op://Vault/Anthropic/key" },
        openai: { secretRef: "op://Vault/OpenAI/key" },
      },
    });

    expect(modelConfig.primaryProvider).toBe("anthropic");
    expect(modelConfig.requiredProviders).toContain("anthropic");
    expect(modelConfig.requiredProviders).toContain("openai");

    // 2. Resolve auth profiles
    const profiles = await resolveAuthProfiles(
      modelConfig.providerConfigs,
      provider,
      silentLogger,
    );

    expect(profiles).toHaveLength(2);

    // 3. Generate OpenClaw config with fallbacks
    const openclawConfig = generateOpenClawConfig({
      agent: createAgent("anthropic/claude-sonnet-4-5"),
      apiToken: "test-token",
      fallbackModels: modelConfig.fallbacks,
    });

    expect(openclawConfig.llm.model).toBe("anthropic/claude-sonnet-4-5");
    expect(openclawConfig.llm.fallbacks?.models).toEqual(["openai/gpt-4o"]);

    // 4. Validate config
    const validation = validateOpenClawConfig(openclawConfig);
    expect(validation.valid).toBe(true);

    // 5. Get env vars
    const envVars = authProfilesToEnv(profiles);
    expect(envVars.get("ANTHROPIC_API_KEY")).toBe("sk-ant-api12345678901234567890");
    expect(envVars.get("OPENAI_API_KEY")).toBe("sk-proj-12345678901234567890");
  });

  it("github-copilot primary, no fallback", async () => {
    const provider = new EnvFileProvider(
      new Map([["gh-token-ref", "ghp_1234567890abcdef"]]),
    );

    const modelConfig = buildModelConfig({
      model: "github-copilot/claude-sonnet-4-5",
      providerOverrides: {
        "github-copilot": { secretRef: "gh-token-ref" },
      },
    });

    expect(modelConfig.primaryProvider).toBe("github-copilot");

    const profiles = await resolveAuthProfiles(
      modelConfig.providerConfigs,
      provider,
      silentLogger,
    );

    expect(profiles).toHaveLength(1);
    expect(profiles[0].envVar).toBe("GITHUB_TOKEN");
  });

  it("custom provider with base URL", async () => {
    const provider = new EnvFileProvider(
      new Map([["custom-ref", "custom-api-key-value"]]),
    );

    const modelConfig = buildModelConfig({
      model: "custom/my-model",
      providerOverrides: {
        custom: {
          secretRef: "custom-ref",
          baseUrl: "https://my-proxy.example.com/v1",
          baseUrlEnvVar: "LLM_BASE_URL",
        },
      },
    });

    const profiles = await resolveAuthProfiles(
      modelConfig.providerConfigs,
      provider,
      silentLogger,
    );

    expect(profiles[0].baseUrl).toBe("https://my-proxy.example.com/v1");
    expect(profiles[0].baseUrlEnvVar).toBe("LLM_BASE_URL");

    const envVars = authProfilesToEnv(profiles);
    expect(envVars.get("LLM_API_KEY")).toBe("custom-api-key-value");
    expect(envVars.get("LLM_BASE_URL")).toBe("https://my-proxy.example.com/v1");
  });

  it("full flow through configureOpenClaw", async () => {
    const ssh = createMockSSH();

    const result = await configureOpenClaw(
      ssh,
      createAgent("anthropic/claude-sonnet-4-5"),
      "# Developer Agent",
      "api-token",
      silentLogger,
      {
        fallbackModels: ["openai/gpt-4o"],
        authProfiles: [
          { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: "sk-ant-api12345678901234567890" },
          { provider: "openai", envVar: "OPENAI_API_KEY", apiKey: "sk-proj-12345678901234567890" },
        ],
      },
    );

    // Auth env vars returned for daemon .env
    expect(result.authEnvVars.get("ANTHROPIC_API_KEY")).toBe("sk-ant-api12345678901234567890");
    expect(result.authEnvVars.get("OPENAI_API_KEY")).toBe("sk-proj-12345678901234567890");

    // Config written with fallbacks
    const configCall = (ssh.writeFile as any).mock.calls.find(
      (c: string[]) => c[0].includes("config.yaml"),
    );
    const config = JSON.parse(configCall[1]);
    expect(config.llm.model).toBe("anthropic/claude-sonnet-4-5");
    expect(config.llm.fallbacks.models).toEqual(["openai/gpt-4o"]);
  });
});

// ---------------------------------------------------------------------------
// Tests: Security — secrets never in logs
// ---------------------------------------------------------------------------

describe("Security: secrets never logged", () => {
  it("resolveAuthProfiles does not log raw API keys", async () => {
    const { logger, messages } = createCapturingLogger();
    const secretValue = "sk-ant-SuperSecretKey1234567890Test";
    const provider = new EnvFileProvider(
      new Map([["ref", secretValue]]),
    );

    const configs = new Map<LLMProviderName, LLMProviderConfig>([
      ["anthropic", { ...PROVIDER_REGISTRY.anthropic, secretRef: "ref" }],
    ]);

    await resolveAuthProfiles(configs, provider, logger);

    const allLogs = messages.join("\n");
    expect(allLogs).not.toContain(secretValue);
    expect(allLogs).toContain("***"); // masked version present
  });

  it("logModelAuthSummary does not log raw API keys", () => {
    const { logger, messages } = createCapturingLogger();
    const key1 = "sk-ant-SuperSecret12345678901234";
    const key2 = "sk-proj-AnotherSecret12345678901234";

    logModelAuthSummary(
      {
        primary: "anthropic/claude-sonnet-4-5",
        fallbacks: [],
        primaryProvider: "anthropic",
        requiredProviders: ["anthropic", "openai"],
      },
      [
        { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", apiKey: key1 },
        { provider: "openai", envVar: "OPENAI_API_KEY", apiKey: key2 },
      ],
      logger,
    );

    const allLogs = messages.join("\n");
    expect(allLogs).not.toContain(key1);
    expect(allLogs).not.toContain(key2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("model with no provider and no known pattern → custom", () => {
    expect(detectProvider("llama-3-70b")).toBe("custom");
  });

  it("empty fallbacks list produces no fallback config", () => {
    const config = generateOpenClawConfig({
      agent: createAgent(),
      fallbackModels: [],
    });
    expect(config.llm.fallbacks).toBeUndefined();
  });

  it("single character model name", () => {
    expect(detectProvider("x")).toBe("custom");
    expect(extractModelName("x")).toBe("x");
  });

  it("model with only slash", () => {
    // "/" — slashIndex is 0, so no prefix detected
    expect(detectProvider("/model")).toBe("custom");
  });

  it("getRequiredProviders with duplicates", () => {
    const providers = getRequiredProviders([
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-3-5-haiku",
      "anthropic/claude-3-opus",
    ]);
    expect(providers).toEqual(["anthropic"]);
  });

  it("buildModelConfig with same provider for primary and fallback", () => {
    const result = buildModelConfig({
      model: "anthropic/claude-sonnet-4-5",
      fallbackModels: ["anthropic/claude-3-5-haiku"],
    });
    expect(result.requiredProviders).toEqual(["anthropic"]);
    expect(result.providerConfigs.size).toBe(1);
  });
});

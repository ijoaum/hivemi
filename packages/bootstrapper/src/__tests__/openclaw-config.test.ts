// =============================================================================
// OpenClaw Config Tests
// Tests for the OpenClaw gateway configuration generator.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  generateOpenClawConfig,
  buildSystemPrompt,
  validateOpenClawConfig,
  logConfigSummary,
  getToolsForRole,
  DEFAULT_SECURITY,
  DEFAULT_WORKER_TOOLS,
  DEFAULT_EXECUTOR_TOOLS,
} from "../openclaw-config.js";
import type {
  OpenClawConfigOptions,
  OpenClawGatewayConfig,
  SecurityConfig,
  ConfigValidationResult,
} from "../openclaw-config.js";
import type { AgentConfig, BootstrapperLogger } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    agentId: "agent-uuid-123",
    agentName: "Atlas",
    roleId: "role-uuid-456",
    teamId: "team-uuid-789",
    model: "anthropic/claude-sonnet-4-5",
    daemonPort: 3100,
    ...overrides,
  };
}

function createOptions(overrides?: Partial<OpenClawConfigOptions>): OpenClawConfigOptions {
  return {
    agent: createAgent(),
    apiToken: "test-token-abc",
    systemPrompt: "# Test Agent\n\nYou are a test agent.",
    roleName: "developer",
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
// Tests: generateOpenClawConfig
// ---------------------------------------------------------------------------

describe("generateOpenClawConfig", () => {
  it("generates config with correct model", () => {
    const config = generateOpenClawConfig(createOptions());
    expect(config.llm.model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("enables chatCompletions", () => {
    const config = generateOpenClawConfig(createOptions());
    expect(config.gateway.http.endpoints.chatCompletions.enabled).toBe(true);
  });

  it("sets sandbox to off", () => {
    const config = generateOpenClawConfig(createOptions());
    expect(config.sandbox).toBe("off");
  });

  it("includes auth token when provided", () => {
    const config = generateOpenClawConfig(createOptions({ apiToken: "my-secret-token" }));
    expect(config.gateway.http.endpoints.chatCompletions.auth?.token).toBe("my-secret-token");
  });

  it("omits auth when no token provided", () => {
    const config = generateOpenClawConfig(createOptions({ apiToken: undefined }));
    expect(config.gateway.http.endpoints.chatCompletions.auth).toBeUndefined();
  });

  it("includes default security settings", () => {
    const config = generateOpenClawConfig(createOptions());
    expect(config.security).toBeDefined();
    expect(config.security!.requestTimeoutSeconds).toBe(300);
    expect(config.security!.maxConcurrentRequests).toBe(1);
    expect(config.security!.rateLimitPerMinute).toBe(30);
    expect(config.security!.toolTimeoutSeconds).toBe(120);
    expect(config.security!.allowElevated).toBe(false);
  });

  it("applies custom security overrides", () => {
    const config = generateOpenClawConfig(createOptions({
      security: {
        requestTimeoutSeconds: 600,
        maxConcurrentRequests: 3,
        rateLimitPerMinute: 60,
      },
    }));
    expect(config.security!.requestTimeoutSeconds).toBe(600);
    expect(config.security!.maxConcurrentRequests).toBe(3);
    expect(config.security!.rateLimitPerMinute).toBe(60);
    // Non-overridden values keep defaults
    expect(config.security!.toolTimeoutSeconds).toBe(120);
    expect(config.security!.allowElevated).toBe(false);
  });

  it("includes maxTokens from security config", () => {
    const config = generateOpenClawConfig(createOptions());
    expect(config.llm.maxTokens).toBe(32768);
  });

  it("overrides maxTokens when provided", () => {
    const config = generateOpenClawConfig(createOptions({
      security: { maxTokens: 65536 },
    }));
    expect(config.llm.maxTokens).toBe(65536);
  });

  it("serializes to valid JSON", () => {
    const config = generateOpenClawConfig(createOptions());
    const json = JSON.stringify(config, null, 2);
    const parsed = JSON.parse(json);
    expect(parsed.llm.model).toBe("anthropic/claude-sonnet-4-5");
    expect(parsed.gateway.http.endpoints.chatCompletions.enabled).toBe(true);
  });

  it("allows overriding sandbox mode via security", () => {
    const config = generateOpenClawConfig(createOptions({
      security: { sandboxMode: "all" },
    }));
    expect(config.sandbox).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// Tests: buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  it("includes base system prompt content", () => {
    const prompt = buildSystemPrompt(createOptions({
      systemPrompt: "# My Agent\n\nCustom instructions here.",
    }));
    expect(prompt).toContain("# My Agent");
    expect(prompt).toContain("Custom instructions here.");
  });

  it("includes agent identity section", () => {
    const prompt = buildSystemPrompt(createOptions());
    expect(prompt).toContain("## Agent Identity");
    expect(prompt).toContain("Atlas");
    expect(prompt).toContain("agent-uuid-123");
    expect(prompt).toContain("team-uuid-789");
    expect(prompt).toContain("anthropic/claude-sonnet-4-5");
  });

  it("includes available tools section", () => {
    const prompt = buildSystemPrompt(createOptions({ roleName: "developer" }));
    expect(prompt).toContain("## Available Tools");
    expect(prompt).toContain("`exec`");
    expect(prompt).toContain("`read`");
    expect(prompt).toContain("`write`");
    expect(prompt).toContain("`edit`");
  });

  it("includes agent rules section", () => {
    const prompt = buildSystemPrompt(createOptions());
    expect(prompt).toContain("## Agent Rules");
    expect(prompt).toContain("Execute tasks assigned");
    expect(prompt).toContain("Report progress");
  });

  it("includes custom instructions when provided", () => {
    const prompt = buildSystemPrompt(createOptions({
      instructions: "Always write tests before code.",
    }));
    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain("Always write tests before code.");
  });

  it("uses explicit tools list over role-based defaults", () => {
    const prompt = buildSystemPrompt(createOptions({
      roleName: "developer",
      tools: ["exec", "read"],
    }));
    expect(prompt).toContain("`exec`");
    expect(prompt).toContain("`read`");
    expect(prompt).not.toContain("`browser`");
    expect(prompt).not.toContain("`web_search`");
  });

  it("shows role name in identity section", () => {
    const prompt = buildSystemPrompt(createOptions({ roleName: "qa" }));
    expect(prompt).toContain("**Role:** qa");
  });

  it("defaults role to worker when not specified", () => {
    const prompt = buildSystemPrompt(createOptions({ roleName: undefined }));
    expect(prompt).toContain("**Role:** worker");
  });

  it("handles empty system prompt", () => {
    const prompt = buildSystemPrompt(createOptions({ systemPrompt: "" }));
    // Should still have identity and tools sections
    expect(prompt).toContain("## Agent Identity");
    expect(prompt).toContain("## Available Tools");
    expect(prompt).toContain("## Agent Rules");
  });

  it("handles undefined system prompt", () => {
    const prompt = buildSystemPrompt(createOptions({ systemPrompt: undefined }));
    expect(prompt).toContain("## Agent Identity");
  });

  it("includes tool usage guidance", () => {
    const prompt = buildSystemPrompt(createOptions());
    expect(prompt).toContain("Use these tools to complete your assigned tasks");
    expect(prompt).toContain("Do not attempt to use tools not in this list");
  });
});

// ---------------------------------------------------------------------------
// Tests: getToolsForRole
// ---------------------------------------------------------------------------

describe("getToolsForRole", () => {
  it("returns worker tools by default", () => {
    expect(getToolsForRole()).toEqual(DEFAULT_WORKER_TOOLS);
  });

  it("returns worker tools for undefined role", () => {
    expect(getToolsForRole(undefined)).toEqual(DEFAULT_WORKER_TOOLS);
  });

  it("returns executor tools for executor role", () => {
    expect(getToolsForRole("executor")).toEqual(DEFAULT_EXECUTOR_TOOLS);
  });

  it("returns executor tools for runner role", () => {
    expect(getToolsForRole("runner")).toEqual(DEFAULT_EXECUTOR_TOOLS);
  });

  it("returns developer tools for developer role", () => {
    const tools = getToolsForRole("developer");
    expect(tools).toContain("exec");
    expect(tools).toContain("web_search");
    expect(tools).toContain("browser");
  });

  it("returns pm tools for pm role", () => {
    const tools = getToolsForRole("pm");
    expect(tools).toContain("read");
    expect(tools).toContain("write");
    expect(tools).toContain("web_search");
    expect(tools).not.toContain("exec");
  });

  it("returns QA tools with browser for qa role", () => {
    const tools = getToolsForRole("qa");
    expect(tools).toContain("browser");
    expect(tools).toContain("exec");
  });

  it("is case-insensitive", () => {
    expect(getToolsForRole("DEVELOPER")).toEqual(getToolsForRole("developer"));
    expect(getToolsForRole("PM")).toEqual(getToolsForRole("pm"));
    expect(getToolsForRole("Executor")).toEqual(getToolsForRole("executor"));
  });

  it("trims whitespace", () => {
    expect(getToolsForRole("  developer  ")).toEqual(getToolsForRole("developer"));
  });

  it("returns default tools for unknown roles", () => {
    expect(getToolsForRole("unknown-role")).toEqual(DEFAULT_WORKER_TOOLS);
  });
});

// ---------------------------------------------------------------------------
// Tests: validateOpenClawConfig
// ---------------------------------------------------------------------------

describe("validateOpenClawConfig", () => {
  it("validates a correct config", () => {
    const config = generateOpenClawConfig(createOptions());
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when model is missing", () => {
    const config = generateOpenClawConfig(createOptions({
      agent: createAgent({ model: "" }),
    }));
    // Manually remove model to simulate edge case
    config.llm.model = "";
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("model is required"));
  });

  it("fails when chatCompletions is disabled", () => {
    const config = generateOpenClawConfig(createOptions());
    config.gateway.http.endpoints.chatCompletions.enabled = false;
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("chatCompletions"));
  });

  it("fails when sandbox is not off", () => {
    const config = generateOpenClawConfig(createOptions());
    config.sandbox = "all";
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("sandbox"));
  });

  it("warns when no auth token is configured", () => {
    const config = generateOpenClawConfig(createOptions({ apiToken: undefined }));
    const result = validateOpenClawConfig(config);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings).toContainEqual(expect.stringContaining("No API token"));
  });

  it("no warning when auth token is configured", () => {
    const config = generateOpenClawConfig(createOptions({ apiToken: "token" }));
    const result = validateOpenClawConfig(config);
    expect(result.warnings).toHaveLength(0);
  });

  it("fails when requestTimeoutSeconds is too low", () => {
    const config = generateOpenClawConfig(createOptions());
    config.security!.requestTimeoutSeconds = 5;
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("requestTimeoutSeconds"));
  });

  it("fails when requestTimeoutSeconds is too high", () => {
    const config = generateOpenClawConfig(createOptions());
    config.security!.requestTimeoutSeconds = 7200;
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);
  });

  it("fails when maxConcurrentRequests is out of range", () => {
    const config = generateOpenClawConfig(createOptions());
    config.security!.maxConcurrentRequests = 0;
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);

    config.security!.maxConcurrentRequests = 50;
    const result2 = validateOpenClawConfig(config);
    expect(result2.valid).toBe(false);
  });

  it("fails when rateLimitPerMinute is out of range", () => {
    const config = generateOpenClawConfig(createOptions());
    config.security!.rateLimitPerMinute = 0;
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);

    config.security!.rateLimitPerMinute = 1000;
    const result2 = validateOpenClawConfig(config);
    expect(result2.valid).toBe(false);
  });

  it("fails when toolTimeoutSeconds is out of range", () => {
    const config = generateOpenClawConfig(createOptions());
    config.security!.toolTimeoutSeconds = 2;
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);

    config.security!.toolTimeoutSeconds = 5000;
    const result2 = validateOpenClawConfig(config);
    expect(result2.valid).toBe(false);
  });

  it("fails when maxTokens is out of range", () => {
    const config = generateOpenClawConfig(createOptions());
    config.llm.maxTokens = 100;
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("maxTokens"));

    config.llm.maxTokens = 500000;
    const result2 = validateOpenClawConfig(config);
    expect(result2.valid).toBe(false);
  });

  it("accepts maxTokens when undefined (default)", () => {
    const config = generateOpenClawConfig(createOptions());
    config.llm.maxTokens = undefined;
    const result = validateOpenClawConfig(config);
    expect(result.errors.filter((e) => e.includes("maxTokens"))).toHaveLength(0);
  });

  it("validates config without security block", () => {
    const config = generateOpenClawConfig(createOptions());
    delete (config as any).security;
    const result = validateOpenClawConfig(config);
    // Should still be valid — security is optional in the config shape
    expect(result.valid).toBe(true);
  });

  it("collects multiple errors", () => {
    const config: OpenClawGatewayConfig = {
      llm: { model: "" },
      gateway: { http: { endpoints: { chatCompletions: { enabled: false } } } },
      sandbox: "all",
    };
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: DEFAULT_SECURITY
// ---------------------------------------------------------------------------

describe("DEFAULT_SECURITY", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_SECURITY.maxTokens).toBe(32768);
    expect(DEFAULT_SECURITY.requestTimeoutSeconds).toBe(300);
    expect(DEFAULT_SECURITY.maxConcurrentRequests).toBe(1);
    expect(DEFAULT_SECURITY.rateLimitPerMinute).toBe(30);
    expect(DEFAULT_SECURITY.sandboxMode).toBe("off");
    expect(DEFAULT_SECURITY.allowElevated).toBe(false);
    expect(DEFAULT_SECURITY.toolTimeoutSeconds).toBe(120);
  });

  it("all default values pass validation", () => {
    const config = generateOpenClawConfig(createOptions());
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Tool Sets
// ---------------------------------------------------------------------------

describe("Tool sets", () => {
  it("DEFAULT_WORKER_TOOLS includes essential tools", () => {
    expect(DEFAULT_WORKER_TOOLS).toContain("exec");
    expect(DEFAULT_WORKER_TOOLS).toContain("read");
    expect(DEFAULT_WORKER_TOOLS).toContain("write");
    expect(DEFAULT_WORKER_TOOLS).toContain("edit");
    expect(DEFAULT_WORKER_TOOLS).toContain("web_search");
    expect(DEFAULT_WORKER_TOOLS).toContain("web_fetch");
    expect(DEFAULT_WORKER_TOOLS).toContain("browser");
  });

  it("DEFAULT_EXECUTOR_TOOLS is more restricted", () => {
    expect(DEFAULT_EXECUTOR_TOOLS).toContain("exec");
    expect(DEFAULT_EXECUTOR_TOOLS).toContain("read");
    expect(DEFAULT_EXECUTOR_TOOLS).toContain("write");
    expect(DEFAULT_EXECUTOR_TOOLS).toContain("edit");
    expect(DEFAULT_EXECUTOR_TOOLS).not.toContain("web_search");
    expect(DEFAULT_EXECUTOR_TOOLS).not.toContain("browser");
  });

  it("executor tools is a subset of worker tools", () => {
    for (const tool of DEFAULT_EXECUTOR_TOOLS) {
      expect(DEFAULT_WORKER_TOOLS).toContain(tool);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: logConfigSummary
// ---------------------------------------------------------------------------

describe("logConfigSummary", () => {
  it("logs all key fields without throwing", () => {
    const config = generateOpenClawConfig(createOptions());
    const logged: string[] = [];
    const logger: BootstrapperLogger = {
      debug: () => {},
      info: (msg: string) => logged.push(msg),
      warn: () => {},
      error: () => {},
    };

    logConfigSummary(config, 1500, logger);

    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).toContain("Model:");
    expect(logged.join("\n")).toContain("Chat Completions:");
    expect(logged.join("\n")).toContain("Sandbox:");
    expect(logged.join("\n")).toContain("1500 chars");
  });

  it("logs security settings when present", () => {
    const config = generateOpenClawConfig(createOptions());
    const logged: string[] = [];
    const logger: BootstrapperLogger = {
      debug: () => {},
      info: (msg: string) => logged.push(msg),
      warn: () => {},
      error: () => {},
    };

    logConfigSummary(config, 1000, logger);

    const allLogs = logged.join("\n");
    expect(allLogs).toContain("Security:");
    expect(allLogs).toContain("Request timeout:");
    expect(allLogs).toContain("Max concurrent:");
    expect(allLogs).toContain("Rate limit:");
    expect(allLogs).toContain("Tool timeout:");
    expect(allLogs).toContain("Elevated:");
  });

  it("shows 'configured' for auth token when present", () => {
    const config = generateOpenClawConfig(createOptions({ apiToken: "secret" }));
    const logged: string[] = [];
    const logger: BootstrapperLogger = {
      debug: () => {},
      info: (msg: string) => logged.push(msg),
      warn: () => {},
      error: () => {},
    };

    logConfigSummary(config, 500, logger);
    expect(logged.join("\n")).toContain("configured");
  });

  it("shows 'none' for auth token when absent", () => {
    const config = generateOpenClawConfig(createOptions({ apiToken: undefined }));
    const logged: string[] = [];
    const logger: BootstrapperLogger = {
      debug: () => {},
      info: (msg: string) => logged.push(msg),
      warn: () => {},
      error: () => {},
    };

    logConfigSummary(config, 500, logger);
    expect(logged.join("\n")).toContain("none");
  });
});

// ---------------------------------------------------------------------------
// Tests: Integration — full config → validate cycle
// ---------------------------------------------------------------------------

describe("Integration: config generation → validation", () => {
  it("developer role config is valid", () => {
    const config = generateOpenClawConfig(createOptions({ roleName: "developer" }));
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(true);
  });

  it("qa role config is valid", () => {
    const config = generateOpenClawConfig(createOptions({ roleName: "qa" }));
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(true);
  });

  it("pm role config is valid", () => {
    const config = generateOpenClawConfig(createOptions({ roleName: "pm" }));
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(true);
  });

  it("executor role config is valid", () => {
    const config = generateOpenClawConfig(createOptions({ roleName: "executor" }));
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(true);
  });

  it("config with all security overrides is valid", () => {
    const config = generateOpenClawConfig(createOptions({
      security: {
        maxTokens: 65536,
        requestTimeoutSeconds: 600,
        maxConcurrentRequests: 2,
        rateLimitPerMinute: 60,
        toolTimeoutSeconds: 300,
        allowElevated: true,
      },
    }));
    const result = validateOpenClawConfig(config);
    expect(result.valid).toBe(true);
  });

  it("system prompt + config round-trip preserves structure", () => {
    const options = createOptions({
      systemPrompt: "# Developer Agent\n\nYou write TypeScript.",
      roleName: "developer",
      instructions: "Use ESLint and Prettier.",
      tools: ["exec", "read", "write", "edit"],
    });

    const systemPrompt = buildSystemPrompt(options);
    const config = generateOpenClawConfig(options);
    const configJson = JSON.stringify(config, null, 2);
    const parsedConfig = JSON.parse(configJson);

    // System prompt has all required sections
    expect(systemPrompt).toContain("# Developer Agent");
    expect(systemPrompt).toContain("## Agent Identity");
    expect(systemPrompt).toContain("## Available Tools");
    expect(systemPrompt).toContain("## Instructions");
    expect(systemPrompt).toContain("## Agent Rules");

    // Config survives JSON round-trip
    expect(parsedConfig.llm.model).toBe("anthropic/claude-sonnet-4-5");
    expect(parsedConfig.gateway.http.endpoints.chatCompletions.enabled).toBe(true);
    expect(parsedConfig.sandbox).toBe("off");
    expect(parsedConfig.security.requestTimeoutSeconds).toBe(300);
  });
});

import { describe, it, expect } from "vitest";
import { mergeAgentConfig } from "../config.js";
import {
  AgentBaseConfigSchema,
  AgentRoleConfigSchema,
  type AgentBaseConfig,
  type AgentRoleConfig,
  type AgentInstanceOverrides,
} from "../types.js";

const BASE_CONFIG: AgentBaseConfig = {
  heartbeatInterval: 30000,
  telemetryInterval: 60000,
  logBatchInterval: 300000,
  logLevel: "info",
  taskTimeout: 600000,
  maxRetries: 3,
};

const ROLE_CONFIG: AgentRoleConfig = {
  model: "openai/gpt-4o",
  maxTokens: 4096,
  temperature: 0.7,
};

describe("mergeAgentConfig", () => {
  it("merges base + role with no overrides", () => {
    const result = mergeAgentConfig(BASE_CONFIG, ROLE_CONFIG);

    expect(result.heartbeatInterval).toBe(30000);
    expect(result.telemetryInterval).toBe(60000);
    expect(result.logBatchInterval).toBe(300000);
    expect(result.logLevel).toBe("info");
    expect(result.taskTimeout).toBe(600000);
    expect(result.maxRetries).toBe(3);
    expect(result.model).toBe("openai/gpt-4o");
    expect(result.maxTokens).toBe(4096);
    expect(result.temperature).toBe(0.7);
    expect(result.timeout).toBeUndefined();
  });

  it("includes role timeout when set", () => {
    const roleWithTimeout: AgentRoleConfig = {
      ...ROLE_CONFIG,
      timeout: 300000,
    };
    const result = mergeAgentConfig(BASE_CONFIG, roleWithTimeout);

    expect(result.timeout).toBe(300000);
  });

  it("applies instance overrides over role and base", () => {
    const overrides: AgentInstanceOverrides = {
      model: "anthropic/claude-sonnet-4-5",
      maxTokens: 8192,
      logLevel: "debug",
      heartbeatInterval: 15000,
    };

    const result = mergeAgentConfig(BASE_CONFIG, ROLE_CONFIG, overrides);

    // Overridden
    expect(result.model).toBe("anthropic/claude-sonnet-4-5");
    expect(result.maxTokens).toBe(8192);
    expect(result.logLevel).toBe("debug");
    expect(result.heartbeatInterval).toBe(15000);

    // Untouched
    expect(result.telemetryInterval).toBe(60000);
    expect(result.temperature).toBe(0.7);
    expect(result.maxRetries).toBe(3);
  });

  it("ignores undefined override fields", () => {
    const overrides: AgentInstanceOverrides = {
      model: undefined,
      maxTokens: undefined,
    };

    const result = mergeAgentConfig(BASE_CONFIG, ROLE_CONFIG, overrides);

    expect(result.model).toBe("openai/gpt-4o");
    expect(result.maxTokens).toBe(4096);
  });

  it("accepts empty overrides object", () => {
    const result = mergeAgentConfig(BASE_CONFIG, ROLE_CONFIG, {});

    expect(result.model).toBe("openai/gpt-4o");
    expect(result.heartbeatInterval).toBe(30000);
  });

  it("override can add timeout when role doesn't have one", () => {
    const overrides: AgentInstanceOverrides = {
      timeout: 120000,
    };

    const result = mergeAgentConfig(BASE_CONFIG, ROLE_CONFIG, overrides);
    expect(result.timeout).toBe(120000);
  });

  it("override can change temperature", () => {
    const overrides: AgentInstanceOverrides = {
      temperature: 0.2,
    };

    const result = mergeAgentConfig(BASE_CONFIG, ROLE_CONFIG, overrides);
    expect(result.temperature).toBe(0.2);
  });
});

describe("AgentBaseConfigSchema", () => {
  it("validates correct base config", () => {
    const result = AgentBaseConfigSchema.parse(BASE_CONFIG);
    expect(result).toEqual(BASE_CONFIG);
  });

  it("applies defaults for missing fields", () => {
    const result = AgentBaseConfigSchema.parse({});
    expect(result.heartbeatInterval).toBe(30000);
    expect(result.logLevel).toBe("info");
    expect(result.maxRetries).toBe(3);
  });

  it("rejects invalid logLevel", () => {
    expect(() =>
      AgentBaseConfigSchema.parse({ ...BASE_CONFIG, logLevel: "trace" }),
    ).toThrow();
  });
});

describe("AgentRoleConfigSchema", () => {
  it("validates correct role config", () => {
    const result = AgentRoleConfigSchema.parse(ROLE_CONFIG);
    expect(result.model).toBe("openai/gpt-4o");
    expect(result.maxTokens).toBe(4096);
  });

  it("requires model", () => {
    expect(() =>
      AgentRoleConfigSchema.parse({ maxTokens: 4096, temperature: 0.7 }),
    ).toThrow();
  });

  it("rejects temperature > 2", () => {
    expect(() =>
      AgentRoleConfigSchema.parse({ ...ROLE_CONFIG, temperature: 3.0 }),
    ).toThrow();
  });
});

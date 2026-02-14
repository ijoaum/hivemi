// =============================================================================
// OpenClaw Gateway Configuration Generator
// Generates the openclaw.json config for agent VMs during bootstrap.
//
// The config enables:
//   - Chat Completions API (headless mode — no messaging channels)
//   - Sandbox disabled (agents need full access to execute tasks)
//   - System prompt with role and tools
//   - Security settings (timeouts, rate limits)
//   - Authentication via API token
//
// Reference: OpenClaw config schema
// =============================================================================

import type { AgentConfig, BootstrapperLogger } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for generating the OpenClaw gateway config.
 */
export interface OpenClawConfigOptions {
  /** Agent configuration (name, model, role, etc.) */
  agent: AgentConfig;
  /** API token for Chat Completions auth */
  apiToken?: string;
  /** System prompt content (usually SOUL.md) */
  systemPrompt?: string;
  /** Role name for the agent (e.g. "developer", "qa", "pm") */
  roleName?: string;
  /** Tools available to the agent */
  tools?: string[];
  /** Behavioral instructions appended to system prompt */
  instructions?: string;
  /** Security overrides */
  security?: Partial<SecurityConfig>;
}

/**
 * Security configuration for the agent's OpenClaw instance.
 */
export interface SecurityConfig {
  /** Maximum tokens per request (default: 32768) */
  maxTokens: number;
  /** Request timeout in seconds (default: 300) */
  requestTimeoutSeconds: number;
  /** Maximum concurrent requests (default: 1 — agents do one task at a time) */
  maxConcurrentRequests: number;
  /** Rate limit: max requests per minute (default: 30) */
  rateLimitPerMinute: number;
  /** Sandbox mode: "off" for agents (default: "off") */
  sandboxMode: string;
  /** Whether to allow elevated operations (default: false) */
  allowElevated: boolean;
  /** Tool execution timeout in seconds (default: 120) */
  toolTimeoutSeconds: number;
}

/**
 * The generated OpenClaw config structure (written as JSON to the VM).
 */
export interface OpenClawGatewayConfig {
  llm: {
    model: string;
    maxTokens?: number;
  };
  gateway: {
    http: {
      endpoints: {
        chatCompletions: {
          enabled: boolean;
          auth?: {
            token: string;
          };
        };
      };
    };
  };
  sandbox: string;
  systemPrompt?: string;
  security?: {
    requestTimeoutSeconds: number;
    maxConcurrentRequests: number;
    rateLimitPerMinute: number;
    allowElevated: boolean;
    toolTimeoutSeconds: number;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SECURITY: SecurityConfig = {
  maxTokens: 32768,
  requestTimeoutSeconds: 300,
  maxConcurrentRequests: 1,
  rateLimitPerMinute: 30,
  sandboxMode: "off",
  allowElevated: false,
  toolTimeoutSeconds: 120,
};

/**
 * Default tools available to worker agents.
 * These map to OpenClaw tool names.
 */
export const DEFAULT_WORKER_TOOLS: string[] = [
  "exec",
  "read",
  "write",
  "edit",
  "web_search",
  "web_fetch",
  "browser",
];

/**
 * Default tools for executor agents (more restricted).
 */
export const DEFAULT_EXECUTOR_TOOLS: string[] = [
  "exec",
  "read",
  "write",
  "edit",
];

// ---------------------------------------------------------------------------
// Tool set resolver
// ---------------------------------------------------------------------------

/**
 * Get the default tool set for a given role type.
 */
export function getToolsForRole(roleName?: string): string[] {
  if (!roleName) return DEFAULT_WORKER_TOOLS;

  const normalized = roleName.toLowerCase().trim();

  switch (normalized) {
    case "executor":
    case "runner":
      return DEFAULT_EXECUTOR_TOOLS;
    case "developer":
    case "dev":
    case "engineer":
      return [...DEFAULT_WORKER_TOOLS];
    case "qa":
    case "tester":
      return [...DEFAULT_WORKER_TOOLS, "browser"];
    case "pm":
    case "manager":
      return ["read", "write", "web_search", "web_fetch"];
    default:
      return DEFAULT_WORKER_TOOLS;
  }
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the agent's OpenClaw instance.
 *
 * The system prompt combines:
 * 1. Base SOUL.md content (personality, role definition)
 * 2. Agent identity block (name, role, team)
 * 3. Available tools documentation
 * 4. Behavioral instructions
 *
 * This becomes the agent's SOUL.md on the VM.
 */
export function buildSystemPrompt(options: OpenClawConfigOptions): string {
  const { agent, systemPrompt, roleName, tools, instructions } = options;
  const resolvedTools = tools ?? getToolsForRole(roleName);

  const parts: string[] = [];

  // 1. Base system prompt (SOUL.md content)
  if (systemPrompt) {
    parts.push(systemPrompt);
  }

  // 2. Agent identity section
  parts.push(`\n## Agent Identity\n`);
  parts.push(`- **Name:** ${agent.agentName}`);
  parts.push(`- **ID:** ${agent.agentId}`);
  parts.push(`- **Role:** ${roleName ?? "worker"}`);
  parts.push(`- **Team:** ${agent.teamId}`);
  parts.push(`- **Model:** ${agent.model}`);

  // 3. Available tools
  if (resolvedTools.length > 0) {
    parts.push(`\n## Available Tools\n`);
    parts.push(`You have access to the following tools:`);
    for (const tool of resolvedTools) {
      parts.push(`- \`${tool}\``);
    }
    parts.push(``);
    parts.push(`Use these tools to complete your assigned tasks efficiently.`);
    parts.push(`Do not attempt to use tools not in this list.`);
  }

  // 4. Behavioral instructions
  if (instructions) {
    parts.push(`\n## Instructions\n`);
    parts.push(instructions);
  }

  // 5. Standard agent rules (always appended)
  parts.push(`\n## Agent Rules\n`);
  parts.push(`- Execute tasks assigned to you via the task queue.`);
  parts.push(`- Report progress and results back to the registry.`);
  parts.push(`- Do not take actions outside the scope of your assigned task.`);
  parts.push(`- If you encounter an error, report it clearly and stop.`);
  parts.push(`- Do not attempt to communicate with external services unless required by the task.`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Config generator
// ---------------------------------------------------------------------------

/**
 * Generate the OpenClaw gateway configuration (openclaw.json) for an agent VM.
 *
 * This config is written to `~/.openclaw/config.yaml` on the VM and controls
 * how the OpenClaw instance behaves.
 *
 * @param options - Configuration options
 * @returns The config object (caller serializes to JSON)
 */
export function generateOpenClawConfig(
  options: OpenClawConfigOptions,
): OpenClawGatewayConfig {
  const { agent, apiToken, security } = options;
  const mergedSecurity = { ...DEFAULT_SECURITY, ...security };

  const config: OpenClawGatewayConfig = {
    llm: {
      model: agent.model,
      maxTokens: mergedSecurity.maxTokens,
    },
    gateway: {
      http: {
        endpoints: {
          chatCompletions: {
            enabled: true,
            ...(apiToken ? { auth: { token: apiToken } } : {}),
          },
        },
      },
    },
    sandbox: mergedSecurity.sandboxMode,
    security: {
      requestTimeoutSeconds: mergedSecurity.requestTimeoutSeconds,
      maxConcurrentRequests: mergedSecurity.maxConcurrentRequests,
      rateLimitPerMinute: mergedSecurity.rateLimitPerMinute,
      allowElevated: mergedSecurity.allowElevated,
      toolTimeoutSeconds: mergedSecurity.toolTimeoutSeconds,
    },
  };

  return config;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validation result for the generated OpenClaw config.
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate the generated OpenClaw config.
 *
 * Checks:
 * - Required fields are present
 * - chatCompletions is enabled
 * - Sandbox is off
 * - Model is specified
 * - Security values are within acceptable ranges
 * - Auth token is present (warning if missing)
 */
export function validateOpenClawConfig(
  config: OpenClawGatewayConfig,
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.llm?.model) {
    errors.push("llm.model is required");
  }

  // chatCompletions must be enabled
  if (!config.gateway?.http?.endpoints?.chatCompletions?.enabled) {
    errors.push("gateway.http.endpoints.chatCompletions.enabled must be true");
  }

  // Sandbox must be off
  if (config.sandbox !== "off") {
    errors.push(`sandbox must be "off" for agent VMs, got "${config.sandbox}"`);
  }

  // Auth token check (warning, not error — dev environments may skip)
  if (!config.gateway?.http?.endpoints?.chatCompletions?.auth?.token) {
    warnings.push("No API token configured for chatCompletions — agent will accept unauthenticated requests");
  }

  // Security value ranges
  if (config.security) {
    const sec = config.security;

    if (sec.requestTimeoutSeconds < 10 || sec.requestTimeoutSeconds > 3600) {
      errors.push(`requestTimeoutSeconds must be 10-3600, got ${sec.requestTimeoutSeconds}`);
    }

    if (sec.maxConcurrentRequests < 1 || sec.maxConcurrentRequests > 10) {
      errors.push(`maxConcurrentRequests must be 1-10, got ${sec.maxConcurrentRequests}`);
    }

    if (sec.rateLimitPerMinute < 1 || sec.rateLimitPerMinute > 600) {
      errors.push(`rateLimitPerMinute must be 1-600, got ${sec.rateLimitPerMinute}`);
    }

    if (sec.toolTimeoutSeconds < 5 || sec.toolTimeoutSeconds > 1800) {
      errors.push(`toolTimeoutSeconds must be 5-1800, got ${sec.toolTimeoutSeconds}`);
    }
  }

  // LLM maxTokens range
  if (config.llm?.maxTokens !== undefined) {
    if (config.llm.maxTokens < 256 || config.llm.maxTokens > 200000) {
      errors.push(`llm.maxTokens must be 256-200000, got ${config.llm.maxTokens}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

/**
 * Log the generated OpenClaw config details (without secrets).
 */
export function logConfigSummary(
  config: OpenClawGatewayConfig,
  systemPromptLength: number,
  logger: BootstrapperLogger,
): void {
  logger.info("OpenClaw config summary:");
  logger.info(`  Model: ${config.llm.model}`);
  logger.info(`  Max tokens: ${config.llm.maxTokens ?? "default"}`);
  logger.info(`  Chat Completions: ${config.gateway.http.endpoints.chatCompletions.enabled ? "enabled" : "disabled"}`);
  logger.info(`  Auth token: ${config.gateway.http.endpoints.chatCompletions.auth?.token ? "configured" : "none"}`);
  logger.info(`  Sandbox: ${config.sandbox}`);
  logger.info(`  System prompt: ${systemPromptLength} chars`);

  if (config.security) {
    logger.info(`  Security:`);
    logger.info(`    Request timeout: ${config.security.requestTimeoutSeconds}s`);
    logger.info(`    Max concurrent: ${config.security.maxConcurrentRequests}`);
    logger.info(`    Rate limit: ${config.security.rateLimitPerMinute}/min`);
    logger.info(`    Tool timeout: ${config.security.toolTimeoutSeconds}s`);
    logger.info(`    Elevated: ${config.security.allowElevated ? "allowed" : "blocked"}`);
  }
}

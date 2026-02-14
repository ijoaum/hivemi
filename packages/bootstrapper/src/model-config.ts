// =============================================================================
// Model & Auth Configuration
// Configures LLM model selection, auth profiles, and API key validation
// for agent VMs during bootstrap.
//
// Responsibilities:
//   - Define supported LLM providers and their config requirements
//   - Map deploy config model → auth profile (which API key to inject)
//   - Validate API keys before finalizing bootstrap
//   - Configure fallback models for resilience
//   - Generate auth-related entries for the daemon .env file
//
// Security:
//   - API keys are resolved via ISecretProvider (1Password, envfile, etc.)
//   - Keys are validated in-memory, never written to logs
//   - Only masked references appear in log output
// =============================================================================

import type { ISecretProvider, BootstrapperLogger } from "./types.js";
import { maskSecret } from "./secrets/utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Supported LLM provider identifiers.
 * These map to the provider prefix in model strings (e.g. "anthropic/claude-sonnet-4-5").
 */
export type LLMProviderName =
  | "anthropic"
  | "openai"
  | "google"
  | "github-copilot"
  | "custom";

/**
 * Configuration for a single LLM provider.
 */
export interface LLMProviderConfig {
  /** Provider identifier */
  name: LLMProviderName;
  /** Display name for logging */
  displayName: string;
  /** Environment variable name for the API key on the agent VM */
  envVar: string;
  /** Secret reference for resolving the API key (e.g. "op://Vault/Item/field") */
  secretRef?: string;
  /** Base URL for the provider's API (optional — used for custom/proxy endpoints) */
  baseUrl?: string;
  /** Environment variable name for the base URL on the agent VM */
  baseUrlEnvVar?: string;
  /** Whether to validate the API key during bootstrap */
  validateKey?: boolean;
}

/**
 * Auth profile — the resolved authentication configuration for a provider.
 */
export interface AuthProfile {
  /** Provider identifier */
  provider: LLMProviderName;
  /** Environment variable name where the key will be stored */
  envVar: string;
  /** The resolved API key value (in memory only — never logged) */
  apiKey: string;
  /** Optional base URL for custom endpoints */
  baseUrl?: string;
  /** Environment variable for base URL */
  baseUrlEnvVar?: string;
}

/**
 * Model configuration for an agent deployment.
 */
export interface ModelConfig {
  /** Primary model identifier (e.g. "anthropic/claude-sonnet-4-5") */
  primary: string;
  /** Fallback models in priority order */
  fallbacks: string[];
  /** Auth profiles for all providers involved (primary + fallbacks) */
  authProfiles: AuthProfile[];
  /** Provider for the primary model */
  primaryProvider: LLMProviderName;
}

/**
 * Options for building a model configuration.
 */
export interface ModelConfigOptions {
  /** Primary model string (e.g. "anthropic/claude-sonnet-4-5") */
  model: string;
  /** Fallback model strings (optional) */
  fallbackModels?: string[];
  /** Provider configurations (overrides for secret refs, base URLs, etc.) */
  providerOverrides?: Partial<Record<LLMProviderName, Partial<LLMProviderConfig>>>;
}

/**
 * Result of API key validation.
 */
export interface KeyValidationResult {
  /** Whether all required keys are valid */
  valid: boolean;
  /** Per-provider validation results */
  providers: {
    provider: LLMProviderName;
    valid: boolean;
    error?: string;
  }[];
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

/**
 * Default provider configurations.
 * Maps provider names to their API key env var and other defaults.
 */
export const PROVIDER_REGISTRY: Record<LLMProviderName, LLMProviderConfig> = {
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    validateKey: true,
  },
  openai: {
    name: "openai",
    displayName: "OpenAI",
    envVar: "OPENAI_API_KEY",
    validateKey: true,
  },
  google: {
    name: "google",
    displayName: "Google AI",
    envVar: "GOOGLE_API_KEY",
    validateKey: true,
  },
  "github-copilot": {
    name: "github-copilot",
    displayName: "GitHub Copilot",
    envVar: "GITHUB_TOKEN",
    validateKey: false, // Copilot tokens use device flow, can't easily validate
  },
  custom: {
    name: "custom",
    displayName: "Custom Provider",
    envVar: "LLM_API_KEY",
    baseUrlEnvVar: "LLM_BASE_URL",
    validateKey: false,
  },
};

/**
 * Known model → provider mappings for common models.
 * Used when the model string doesn't include a provider prefix.
 */
const MODEL_PROVIDER_MAP: Record<string, LLMProviderName> = {
  // Anthropic
  "claude-3-5-sonnet": "anthropic",
  "claude-sonnet-4-5": "anthropic",
  "claude-3-5-haiku": "anthropic",
  "claude-3-opus": "anthropic",
  "claude-opus-4": "anthropic",
  // OpenAI
  "gpt-4": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "gpt-4-turbo": "openai",
  "o1": "openai",
  "o1-mini": "openai",
  "o3": "openai",
  "o3-mini": "openai",
  "o4-mini": "openai",
  // Google
  "gemini-2.0-flash": "google",
  "gemini-2.5-pro": "google",
  "gemini-2.5-flash": "google",
};

// ---------------------------------------------------------------------------
// Provider Detection
// ---------------------------------------------------------------------------

/**
 * Extract the provider from a model string.
 *
 * Supports two formats:
 * - `provider/model-name` (explicit) → provider
 * - `model-name` (implicit) → lookup in MODEL_PROVIDER_MAP
 *
 * @returns The provider name, or "custom" if unknown
 */
export function detectProvider(model: string): LLMProviderName {
  if (!model) return "custom";

  // Explicit prefix: "anthropic/claude-sonnet-4-5"
  const slashIndex = model.indexOf("/");
  if (slashIndex > 0) {
    const prefix = model.slice(0, slashIndex).toLowerCase();
    if (prefix in PROVIDER_REGISTRY) {
      return prefix as LLMProviderName;
    }
  }

  // Implicit: look up model name
  const normalized = model.toLowerCase();
  for (const [pattern, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
    if (normalized.includes(pattern)) {
      return provider;
    }
  }

  return "custom";
}

/**
 * Extract the model name without provider prefix.
 *
 * "anthropic/claude-sonnet-4-5" → "claude-sonnet-4-5"
 * "gpt-4" → "gpt-4"
 */
export function extractModelName(model: string): string {
  const slashIndex = model.indexOf("/");
  if (slashIndex > 0) {
    return model.slice(slashIndex + 1);
  }
  return model;
}

// ---------------------------------------------------------------------------
// Get unique providers from a set of models
// ---------------------------------------------------------------------------

/**
 * Get the set of unique providers needed for a list of models.
 */
export function getRequiredProviders(models: string[]): LLMProviderName[] {
  const seen = new Set<LLMProviderName>();
  for (const model of models) {
    seen.add(detectProvider(model));
  }
  return Array.from(seen);
}

// ---------------------------------------------------------------------------
// Resolve provider config (with overrides)
// ---------------------------------------------------------------------------

/**
 * Get the effective provider config, merging defaults with overrides.
 */
export function getProviderConfig(
  provider: LLMProviderName,
  overrides?: Partial<LLMProviderConfig>,
): LLMProviderConfig {
  const base = PROVIDER_REGISTRY[provider];
  if (!base) {
    return {
      name: provider,
      displayName: provider,
      envVar: "LLM_API_KEY",
      ...overrides,
    } as LLMProviderConfig;
  }
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// API Key Validation
// ---------------------------------------------------------------------------

/**
 * Validate an API key by format inspection.
 *
 * This is a local check — it does NOT call the provider's API.
 * It catches obviously wrong keys (empty, too short, wrong prefix).
 *
 * For production validation against the actual API, use `validateKeyLive()`.
 */
export function validateKeyFormat(provider: LLMProviderName, key: string): { valid: boolean; error?: string } {
  if (!key || key.trim().length === 0) {
    return { valid: false, error: "API key is empty" };
  }

  const trimmed = key.trim();

  switch (provider) {
    case "anthropic":
      if (!trimmed.startsWith("sk-ant-")) {
        return { valid: false, error: `Anthropic key should start with "sk-ant-", got "${trimmed.slice(0, 7)}..."` };
      }
      if (trimmed.length < 20) {
        return { valid: false, error: "Anthropic key is too short (expected 40+ chars)" };
      }
      return { valid: true };

    case "openai":
      if (!trimmed.startsWith("sk-")) {
        return { valid: false, error: `OpenAI key should start with "sk-", got "${trimmed.slice(0, 5)}..."` };
      }
      if (trimmed.length < 20) {
        return { valid: false, error: "OpenAI key is too short (expected 40+ chars)" };
      }
      return { valid: true };

    case "google":
      if (trimmed.length < 10) {
        return { valid: false, error: "Google API key is too short" };
      }
      return { valid: true };

    case "github-copilot":
      // GitHub tokens can be PATs (ghp_), fine-grained (github_pat_), or OAuth tokens
      if (trimmed.length < 10) {
        return { valid: false, error: "GitHub token is too short" };
      }
      return { valid: true };

    case "custom":
      // Can't validate format for custom providers
      if (trimmed.length < 1) {
        return { valid: false, error: "Custom API key is empty" };
      }
      return { valid: true };

    default:
      return { valid: true };
  }
}

/**
 * Validate an API key by making a lightweight API call to the provider.
 *
 * Uses the cheapest possible call to verify the key works:
 * - Anthropic: POST /v1/messages with max_tokens=1
 * - OpenAI: GET /v1/models
 * - Google: GET /v1beta/models (with key param)
 *
 * Returns true if the key is valid (or validation is skipped for the provider).
 */
export async function validateKeyLive(
  provider: LLMProviderName,
  apiKey: string,
  baseUrl?: string,
  timeoutMs: number = 10_000,
): Promise<{ valid: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    switch (provider) {
      case "anthropic": {
        const url = baseUrl ?? "https://api.anthropic.com";
        const res = await fetch(`${url}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
          signal: controller.signal,
        });
        // 200 or 400 (bad request but auth passed) = valid key
        // 401 = invalid key
        if (res.status === 401) {
          return { valid: false, error: "Anthropic API key is invalid (401 Unauthorized)" };
        }
        return { valid: true };
      }

      case "openai": {
        const url = baseUrl ?? "https://api.openai.com";
        const res = await fetch(`${url}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        if (res.status === 401) {
          return { valid: false, error: "OpenAI API key is invalid (401 Unauthorized)" };
        }
        return { valid: true };
      }

      case "google": {
        const url = baseUrl ?? "https://generativelanguage.googleapis.com";
        const res = await fetch(`${url}/v1beta/models?key=${apiKey}`, {
          signal: controller.signal,
        });
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          return { valid: false, error: `Google API key is invalid (${res.status})` };
        }
        return { valid: true };
      }

      case "github-copilot":
        // Can't easily validate Copilot tokens without the full device flow
        return { valid: true };

      case "custom":
        // Can't validate custom providers
        return { valid: true };

      default:
        return { valid: true };
    }
  } catch (err) {
    const error = err as Error;
    if (error.name === "AbortError") {
      return { valid: false, error: `Validation timed out after ${timeoutMs}ms` };
    }
    // Network errors during validation shouldn't fail the bootstrap
    // The key might be valid, we just can't reach the API from the control plane
    return { valid: true };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Build Model Config
// ---------------------------------------------------------------------------

/**
 * Build the full model configuration for an agent deployment.
 *
 * This resolves:
 * 1. Primary model → provider → auth profile
 * 2. Fallback models → providers → auth profiles
 * 3. Deduplicates providers (if primary and fallback use same provider)
 *
 * Does NOT resolve API keys — that's done by `resolveAuthProfiles()`.
 */
export function buildModelConfig(options: ModelConfigOptions): {
  primary: string;
  fallbacks: string[];
  primaryProvider: LLMProviderName;
  requiredProviders: LLMProviderName[];
  providerConfigs: Map<LLMProviderName, LLMProviderConfig>;
} {
  const { model, fallbackModels = [], providerOverrides = {} } = options;

  const primaryProvider = detectProvider(model);
  const allModels = [model, ...fallbackModels];
  const requiredProviders = getRequiredProviders(allModels);

  // Build effective config for each provider
  const providerConfigs = new Map<LLMProviderName, LLMProviderConfig>();
  for (const provider of requiredProviders) {
    const override = providerOverrides[provider];
    providerConfigs.set(provider, getProviderConfig(provider, override));
  }

  return {
    primary: model,
    fallbacks: fallbackModels,
    primaryProvider,
    requiredProviders,
    providerConfigs,
  };
}

// ---------------------------------------------------------------------------
// Resolve Auth Profiles
// ---------------------------------------------------------------------------

/**
 * Resolve API keys for all required providers using the secret provider.
 *
 * For each provider:
 * 1. Look up the secret reference (from provider config or deploy config)
 * 2. Resolve via ISecretProvider (1Password, envfile, etc.)
 * 3. Optionally validate the key format
 * 4. Return as AuthProfile (envVar → apiKey)
 *
 * @throws if a required provider's key cannot be resolved
 */
export async function resolveAuthProfiles(
  providerConfigs: Map<LLMProviderName, LLMProviderConfig>,
  secretProvider: ISecretProvider,
  logger?: BootstrapperLogger,
): Promise<AuthProfile[]> {
  const profiles: AuthProfile[] = [];

  for (const [providerName, config] of providerConfigs) {
    if (!config.secretRef) {
      logger?.warn(`No secret ref configured for provider "${config.displayName}" — skipping auth resolution`);
      continue;
    }

    logger?.info(`Resolving API key for ${config.displayName}...`);

    let apiKey: string;
    try {
      apiKey = await secretProvider.getSecret(config.secretRef);
    } catch (err) {
      throw new Error(
        `Failed to resolve API key for ${config.displayName} (ref: ${config.secretRef}): ${(err as Error).message}`,
      );
    }

    // Format validation (local, no network)
    if (config.validateKey !== false) {
      const formatResult = validateKeyFormat(providerName, apiKey);
      if (!formatResult.valid) {
        throw new Error(
          `API key format validation failed for ${config.displayName}: ${formatResult.error}`,
        );
      }
      logger?.info(`API key format valid for ${config.displayName} [${maskSecret(apiKey)}]`);
    } else {
      logger?.info(`API key resolved for ${config.displayName} [${maskSecret(apiKey)}] (format validation skipped)`);
    }

    const profile: AuthProfile = {
      provider: providerName,
      envVar: config.envVar,
      apiKey,
    };

    if (config.baseUrl) {
      profile.baseUrl = config.baseUrl;
      profile.baseUrlEnvVar = config.baseUrlEnvVar;
    }

    profiles.push(profile);
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Validate All Keys (Live)
// ---------------------------------------------------------------------------

/**
 * Validate all resolved auth profiles by making lightweight API calls.
 *
 * This is optional — called when the deploy config requests live validation.
 * Network errors are treated as "valid" (can't reach API ≠ invalid key).
 */
export async function validateAuthProfiles(
  profiles: AuthProfile[],
  logger?: BootstrapperLogger,
  timeoutMs: number = 10_000,
): Promise<KeyValidationResult> {
  const results: KeyValidationResult["providers"] = [];
  let allValid = true;

  for (const profile of profiles) {
    logger?.info(`Validating API key for ${profile.provider}...`);

    const result = await validateKeyLive(
      profile.provider,
      profile.apiKey,
      profile.baseUrl,
      timeoutMs,
    );

    results.push({
      provider: profile.provider,
      valid: result.valid,
      error: result.error,
    });

    if (!result.valid) {
      allValid = false;
      logger?.error(`API key validation failed for ${profile.provider}: ${result.error}`);
    } else {
      logger?.info(`API key validated for ${profile.provider} ✓`);
    }
  }

  return { valid: allValid, providers: results };
}

// ---------------------------------------------------------------------------
// Generate Auth Environment Entries
// ---------------------------------------------------------------------------

/**
 * Convert auth profiles to environment variable entries for the daemon .env file.
 *
 * Returns a Map of envVar → value, ready to merge with other daemon env vars.
 */
export function authProfilesToEnv(profiles: AuthProfile[]): Map<string, string> {
  const env = new Map<string, string>();

  for (const profile of profiles) {
    env.set(profile.envVar, profile.apiKey);

    if (profile.baseUrl && profile.baseUrlEnvVar) {
      env.set(profile.baseUrlEnvVar, profile.baseUrl);
    }
  }

  return env;
}

// ---------------------------------------------------------------------------
// Generate Fallback Config for OpenClaw
// ---------------------------------------------------------------------------

/**
 * Generate the fallback models configuration section for the OpenClaw config.
 *
 * This is added to the `llm` section of the gateway config to provide
 * automatic model failover.
 *
 * @returns Fallback config object, or undefined if no fallbacks
 */
export function generateFallbackConfig(
  fallbackModels: string[],
): { models: string[] } | undefined {
  if (fallbackModels.length === 0) return undefined;
  return { models: fallbackModels };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Log model and auth configuration summary (without secrets).
 */
export function logModelAuthSummary(
  config: {
    primary: string;
    fallbacks: string[];
    primaryProvider: LLMProviderName;
    requiredProviders: LLMProviderName[];
  },
  profiles: AuthProfile[],
  logger: BootstrapperLogger,
): void {
  logger.info("Model & Auth configuration:");
  logger.info(`  Primary model: ${config.primary}`);
  logger.info(`  Primary provider: ${config.primaryProvider}`);

  if (config.fallbacks.length > 0) {
    logger.info(`  Fallback models: ${config.fallbacks.join(", ")}`);
  } else {
    logger.info("  Fallback models: none");
  }

  logger.info(`  Providers configured: ${config.requiredProviders.join(", ")}`);

  for (const profile of profiles) {
    logger.info(`  Auth: ${profile.provider} → ${profile.envVar} [${maskSecret(profile.apiKey)}]`);
    if (profile.baseUrl) {
      logger.info(`    Base URL: ${profile.baseUrl}`);
    }
  }
}

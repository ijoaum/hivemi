// =============================================================================
// Agent Config Merger
// Merges base + role + instance overrides into a single resolved config.
// =============================================================================

import type {
  AgentBaseConfig,
  AgentRoleConfig,
  AgentInstanceOverrides,
  AgentMergedConfig,
} from "./types.js";
import { AgentMergedConfigSchema } from "./types.js";

/**
 * Merge agent configuration layers: base → role → instance overrides.
 *
 * Priority (highest wins):
 *   1. Instance overrides (from deploy/dashboard)
 *   2. Role config (agents/<role>/config.json)
 *   3. Base config (agents/_base/config.json)
 *
 * @throws ZodError if the merged result is invalid
 */
export function mergeAgentConfig(
  base: AgentBaseConfig,
  role: AgentRoleConfig,
  instanceOverrides?: AgentInstanceOverrides,
): AgentMergedConfig {
  const merged = {
    // Start with base
    heartbeatInterval: base.heartbeatInterval,
    telemetryInterval: base.telemetryInterval,
    logBatchInterval: base.logBatchInterval,
    logLevel: base.logLevel,
    taskTimeout: base.taskTimeout,
    maxRetries: base.maxRetries,

    // Layer role config
    model: role.model,
    maxTokens: role.maxTokens,
    temperature: role.temperature,
    ...(role.timeout != null ? { timeout: role.timeout } : {}),
  };

  // Apply instance overrides (only defined fields)
  if (instanceOverrides) {
    const overrideEntries = Object.entries(instanceOverrides).filter(
      ([, v]) => v !== undefined,
    );
    for (const [key, value] of overrideEntries) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  // Validate and return
  return AgentMergedConfigSchema.parse(merged);
}

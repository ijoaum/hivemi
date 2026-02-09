// =============================================================================
// Role Loader
// Loads and merges agent role configuration from _base + role-specific files.
//
// Merge strategy:
//   - Markdown files (SOUL.md, AGENTS.md, TOOLS.md): role overrides _base entirely
//   - JSON files (config.json): deep merge — role values override _base keys
//   - tools.json: role overrides _base entirely (role defines its own tool set)
//
// If a role file doesn't exist, _base is used as fallback.
// If _base doesn't exist either, empty string is used.
// =============================================================================

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { RoleConfig, BootstrapperLogger } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a file if it exists, return null otherwise.
 */
async function readIfExists(filePath: string): Promise<string | null> {
  try {
    await access(filePath);
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Deep merge two plain objects. `override` values take precedence.
 * Arrays are replaced entirely (not concatenated).
 */
export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Role Loader
// ---------------------------------------------------------------------------

/**
 * Load role configuration by merging `_base` defaults with role-specific overrides.
 *
 * Directory structure expected:
 *   agents/
 *     _base/
 *       AGENTS.md
 *       TOOLS.md
 *       config.json
 *     <roleName>/
 *       SOUL.md          (required)
 *       AGENTS.md         (optional, overrides _base)
 *       TOOLS.md          (optional, overrides _base)
 *       config.json       (optional, deep-merged with _base)
 *       tools.json        (optional, overrides _base)
 *
 * @param agentsDir - Path to the agents directory (e.g. "/path/to/hivemi/agents")
 * @param roleName - Name of the role directory (e.g. "developer", "pm", "qa")
 * @returns Merged RoleConfig ready for deployment
 */
export async function loadRoleConfig(
  agentsDir: string,
  roleName: string,
  logger?: BootstrapperLogger,
): Promise<RoleConfig> {
  const baseDir = join(agentsDir, "_base");
  const roleDir = join(agentsDir, roleName);

  logger?.info(`Loading role config: _base + ${roleName}`);

  // --- Load base files ---
  const baseSoulMd = await readIfExists(join(baseDir, "SOUL.md"));
  const baseAgentsMd = await readIfExists(join(baseDir, "AGENTS.md"));
  const baseToolsMd = await readIfExists(join(baseDir, "TOOLS.md"));
  const baseConfigJson = await readIfExists(join(baseDir, "config.json"));
  const baseToolsJson = await readIfExists(join(baseDir, "tools.json"));

  // --- Load role-specific files ---
  const roleSoulMd = await readIfExists(join(roleDir, "SOUL.md"));
  const roleAgentsMd = await readIfExists(join(roleDir, "AGENTS.md"));
  const roleToolsMd = await readIfExists(join(roleDir, "TOOLS.md"));
  const roleConfigJson = await readIfExists(join(roleDir, "config.json"));
  const roleToolsJson = await readIfExists(join(roleDir, "tools.json"));

  // --- Merge markdown files (role overrides _base entirely) ---
  const soulMd = roleSoulMd ?? baseSoulMd ?? "";
  const agentsMd = roleAgentsMd ?? baseAgentsMd ?? "";
  const toolsMd = roleToolsMd ?? baseToolsMd ?? "";

  logger?.debug(`SOUL.md: ${roleSoulMd ? "role" : baseSoulMd ? "_base" : "empty"}`);
  logger?.debug(`AGENTS.md: ${roleAgentsMd ? "role" : baseAgentsMd ? "_base" : "empty"}`);
  logger?.debug(`TOOLS.md: ${roleToolsMd ? "role" : baseToolsMd ? "_base" : "empty"}`);

  // --- Merge config.json (deep merge: _base + role overrides) ---
  let mergedConfig: Record<string, unknown> = {};
  if (baseConfigJson) {
    try {
      mergedConfig = JSON.parse(baseConfigJson) as Record<string, unknown>;
    } catch (err) {
      logger?.warn(`Failed to parse _base/config.json: ${(err as Error).message}`);
    }
  }
  if (roleConfigJson) {
    try {
      const roleConfig = JSON.parse(roleConfigJson) as Record<string, unknown>;
      mergedConfig = deepMerge(mergedConfig, roleConfig);
      logger?.debug("config.json: deep-merged _base + role");
    } catch (err) {
      logger?.warn(`Failed to parse ${roleName}/config.json: ${(err as Error).message}`);
    }
  }

  // --- tools.json (role overrides _base entirely) ---
  const toolsJson = roleToolsJson ?? baseToolsJson;
  logger?.debug(`tools.json: ${roleToolsJson ? "role" : baseToolsJson ? "_base" : "none"}`);

  logger?.info(`Role config loaded: ${roleName}`);

  return {
    soulMd,
    agentsMd,
    toolsMd,
    configJson: JSON.stringify(mergedConfig, null, 2),
    toolsJson: toolsJson ?? undefined,
  };
}

// =============================================================================
// Secret Utilities
// Parsing, masking, and helpers for secret injection.
// =============================================================================

import type { SecretMapping, ParsedSecretTarget } from "../types.js";

/**
 * Parse a SecretMapping's target field into a structured target.
 *
 * Supports:
 * - `env:VAR_NAME` → { kind: "env", value: "VAR_NAME" }
 * - `file:/path/to/file` → { kind: "file", value: "/path/to/file" }
 * - Legacy: if target is not set but envVar is, uses `env:<envVar>`
 *
 * @throws if target format is invalid
 */
export function parseSecretTarget(mapping: SecretMapping): ParsedSecretTarget {
  // Legacy support: if no target but envVar exists, treat as env target
  const raw = mapping.target ?? (mapping.envVar ? `env:${mapping.envVar}` : undefined);

  if (!raw) {
    throw new Error(
      `Secret mapping for "${mapping.ref}" has no target or envVar specified`,
    );
  }

  if (raw.startsWith("env:")) {
    const value = raw.slice(4).trim();
    if (!value) {
      throw new Error(`Empty env var name in target "${raw}" for secret "${mapping.ref}"`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      throw new Error(
        `Invalid env var name "${value}" in target "${raw}" for secret "${mapping.ref}"`,
      );
    }
    return { kind: "env", value };
  }

  if (raw.startsWith("file:")) {
    const value = raw.slice(5).trim();
    if (!value) {
      throw new Error(`Empty file path in target "${raw}" for secret "${mapping.ref}"`);
    }
    if (!value.startsWith("/")) {
      throw new Error(
        `File target must be an absolute path: "${value}" for secret "${mapping.ref}"`,
      );
    }
    return { kind: "file", value };
  }

  throw new Error(
    `Unknown secret target format "${raw}" for secret "${mapping.ref}". ` +
    `Expected "env:VAR_NAME" or "file:/path/to/file"`,
  );
}

/**
 * Mask a secret value for safe logging.
 * Shows only the first 2 and last 2 characters.
 * Short secrets (< 8 chars) are fully masked.
 */
export function maskSecret(value: string): string {
  if (value.length < 8) {
    return "***";
  }
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 20))}${value.slice(-2)}`;
}

/**
 * Check if a mapping is required.
 * Defaults to true if the field is not specified.
 */
export function isRequired(mapping: SecretMapping): boolean {
  return mapping.required !== false;
}

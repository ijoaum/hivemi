// =============================================================================
// EnvFile Secret Provider
// Fallback provider that reads secrets from a local .env-style file or a map.
// Useful for development/testing without 1Password.
// =============================================================================

import { readFile } from "node:fs/promises";
import type { ISecretProvider, SecretMapping } from "../types.js";

/**
 * EnvFile secret provider — resolves references from a local key=value map.
 *
 * Can be initialized with:
 * - A Map of ref → value
 * - A path to a .env file (KEY=VALUE per line)
 */
export class EnvFileProvider implements ISecretProvider {
  readonly name = "envfile";
  private secrets: Map<string, string>;

  constructor(secrets?: Map<string, string>) {
    this.secrets = secrets ?? new Map();
  }

  /**
   * Create an EnvFileProvider from a .env file.
   * Format: KEY=VALUE (one per line, # comments, empty lines ignored)
   */
  static async fromFile(path: string): Promise<EnvFileProvider> {
    const content = await readFile(path, "utf-8");
    const secrets = new Map<string, string>();

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      secrets.set(key, value);
    }

    return new EnvFileProvider(secrets);
  }

  async getSecret(ref: string): Promise<string> {
    const value = this.secrets.get(ref);
    if (value === undefined) {
      throw new Error(`Secret not found in env file: "${ref}"`);
    }
    return value;
  }

  async resolveAll(mappings: SecretMapping[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    for (const mapping of mappings) {
      try {
        const value = await this.getSecret(mapping.ref);
        result.set(mapping.envVar, value);
      } catch (err) {
        throw new Error(
          `Secret resolution failed for "${mapping.ref}" → ${mapping.envVar}: ${(err as Error).message}`,
        );
      }
    }

    return result;
  }
}

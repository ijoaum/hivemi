// =============================================================================
// 1Password Secret Provider
// Resolves secret references using `op read` (1Password CLI)
// =============================================================================

import { execFile } from "node:child_process";
import type { ISecretProvider, SecretMapping } from "../types.js";

/**
 * 1Password secret provider using the `op` CLI with a service account token.
 *
 * References follow the format: `op://VaultName/ItemName/field`
 *
 * Requires either:
 * - `OP_SERVICE_ACCOUNT_TOKEN` env var set, or
 * - `serviceAccountToken` passed in constructor
 */
export class OnePasswordProvider implements ISecretProvider {
  readonly name = "1password";
  private readonly token: string;

  constructor(serviceAccountToken?: string) {
    const token = serviceAccountToken ?? process.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (!token) {
      throw new Error(
        "1Password service account token required: pass it to constructor or set OP_SERVICE_ACCOUNT_TOKEN",
      );
    }
    this.token = token;
  }

  async getSecret(ref: string): Promise<string> {
    if (!ref.startsWith("op://")) {
      throw new Error(`Invalid 1Password reference (must start with "op://"): ${ref}`);
    }

    return new Promise((resolve, reject) => {
      execFile(
        "op",
        ["read", ref],
        {
          env: {
            ...process.env,
            OP_SERVICE_ACCOUNT_TOKEN: this.token,
          },
          timeout: 30_000,
          encoding: "utf-8",
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `Failed to read secret "${ref}": ${stderr || error.message}`,
              ),
            );
            return;
          }
          resolve(stdout.trim());
        },
      );
    });
  }

  async resolveAll(mappings: SecretMapping[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    for (const mapping of mappings) {
      try {
        const value = await this.getSecret(mapping.ref);
        result.set(mapping.envVar, value);
      } catch (err) {
        throw new Error(
          `Secret injection failed for "${mapping.ref}" → ${mapping.envVar}: ${(err as Error).message}`,
        );
      }
    }

    return result;
  }
}

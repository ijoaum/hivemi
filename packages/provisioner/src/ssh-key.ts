// =============================================================================
// SSH Key Management
// High-level helper wrapping provider.ensureSSHKey with caching
// =============================================================================

import type { ICloudProvider, ProvisionerLogger } from "./types.js";
import { consoleLogger } from "./types.js";

const DEFAULT_KEY_NAME = "hivemi-deploy";

/**
 * SSH Key Manager.
 * Ensures deploy keys exist on the provider before VM creation.
 * Caches key IDs to avoid redundant API calls.
 */
export class SSHKeyManager {
  private readonly provider: ICloudProvider;
  private readonly log: ProvisionerLogger;
  private readonly cache = new Map<string, string>();

  constructor(provider: ICloudProvider, logger?: ProvisionerLogger) {
    this.provider = provider;
    this.log = logger ?? consoleLogger;
  }

  /**
   * Ensure the deploy SSH key exists on the provider.
   * Returns the key ID.
   *
   * @param publicKey - SSH public key content (e.g. "ssh-ed25519 AAAA...")
   * @param name - Key name (default: "hivemi-deploy")
   */
  async ensureDeployKey(publicKey: string, name: string = DEFAULT_KEY_NAME): Promise<string> {
    const cached = this.cache.get(name);
    if (cached) {
      this.log.debug(`SSH key "${name}" cached: ${cached}`);
      return cached;
    }

    const keyId = await this.provider.ensureSSHKey(name, publicKey);
    this.cache.set(name, keyId);
    return keyId;
  }

  /**
   * Clear the cache (e.g. after key rotation).
   */
  clearCache(): void {
    this.cache.clear();
  }
}

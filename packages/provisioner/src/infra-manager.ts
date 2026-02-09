// =============================================================================
// Infrastructure Manager
// Orchestrates SSH key lifecycle, firewall management, and IP detection
// for the HiveMI deploy infrastructure.
//
// This is the top-level coordinator that:
//   1. Generates SSH keypairs (or loads existing ones)
//   2. Stores private keys securely (via SecretStore abstraction)
//   3. Registers public keys with cloud providers
//   4. Manages the shared agent firewall
//   5. Detects and handles control plane IP changes
// =============================================================================

import type {
  ICloudProvider,
  ProvisionerLogger,
} from "./types.js";
import { consoleLogger } from "./types.js";
import { SSHKeyManager } from "./ssh-key.js";
import { FirewallManager } from "./firewall.js";
import { generateSSHKeyPair, isValidSSHPublicKey } from "./ssh-keygen.js";
import { detectControlPlaneIP, detectIPChange } from "./ip-detect.js";

// ---------------------------------------------------------------------------
// Secret Store Abstraction
// ---------------------------------------------------------------------------

/**
 * Abstraction for storing and retrieving secrets.
 * Implementations: 1Password (production), in-memory (testing).
 */
export interface ISecretStore {
  /** Get a secret by reference (e.g. "op://Vault/Item/field") */
  get(ref: string): Promise<string | null>;
  /** Store a secret. Returns true on success. */
  set(ref: string, value: string): Promise<boolean>;
  /** Check if a secret exists */
  exists(ref: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Infrastructure State
// ---------------------------------------------------------------------------

/**
 * Persistent state for infrastructure management.
 * Stored in the Registry's cloud config or a settings store.
 */
export interface InfraState {
  /** SSH key ID registered with the cloud provider */
  sshKeyId: string | null;
  /** Secret store reference for the private key */
  sshPrivateKeyRef: string | null;
  /** SSH public key content */
  sshPublicKey: string | null;
  /** Firewall ID */
  firewallId: string | null;
  /** Last known control plane IP */
  controlPlaneIp: string | null;
  /** When the state was last updated */
  updatedAt: string | null;
}

/**
 * Result of the infrastructure setup operation.
 */
export interface InfraSetupResult {
  /** SSH key ID on the provider */
  sshKeyId: string;
  /** SSH public key content */
  sshPublicKey: string;
  /** Firewall ID on the provider */
  firewallId: string;
  /** Detected control plane IP */
  controlPlaneIp: string;
  /** Whether a new keypair was generated */
  keyGenerated: boolean;
  /** Whether the firewall was newly created */
  firewallCreated: boolean;
  /** Whether the control plane IP changed */
  ipChanged: boolean;
}

// ---------------------------------------------------------------------------
// Infrastructure Manager
// ---------------------------------------------------------------------------

/**
 * Manages the deploy infrastructure: SSH keys, firewall, and IP detection.
 *
 * Usage:
 * ```typescript
 * const infra = new InfraManager(provider, secretStore, logger);
 * const result = await infra.setup();
 * // result.sshKeyId — use when creating VMs
 * // result.firewallId — attach to new VMs
 * // result.controlPlaneIp — current server IP
 * ```
 */
export class InfraManager {
  private readonly provider: ICloudProvider;
  private readonly secrets: ISecretStore;
  private readonly log: ProvisionerLogger;

  private readonly sshKeyManager: SSHKeyManager;
  private readonly firewallManager: FirewallManager;

  /** Persistent state — loaded from settings, saved after changes */
  private state: InfraState = {
    sshKeyId: null,
    sshPrivateKeyRef: null,
    sshPublicKey: null,
    firewallId: null,
    controlPlaneIp: null,
    updatedAt: null,
  };

  constructor(
    provider: ICloudProvider,
    secretStore: ISecretStore,
    logger?: ProvisionerLogger,
  ) {
    this.provider = provider;
    this.secrets = secretStore;
    this.log = logger ?? consoleLogger;

    this.sshKeyManager = new SSHKeyManager(provider, this.log);
    this.firewallManager = new FirewallManager(provider, this.log);
  }

  /**
   * Full infrastructure setup.
   *
   * Idempotent — safe to call multiple times.
   * On first run: generates keypair, stores in secret store, registers with provider, creates firewall.
   * On subsequent runs: reuses existing keypair and firewall, checks for IP changes.
   */
  async setup(options?: {
    /** Key name for the provider (default: "hivemi-deploy") */
    keyName?: string;
    /** Firewall name (default: "hivemi-agents") */
    firewallName?: string;
    /** Reference path for private key storage (default: "hivemi-deploy-private-key") */
    privateKeyRef?: string;
  }): Promise<InfraSetupResult> {
    const keyName = options?.keyName ?? "hivemi-deploy";
    const firewallName = options?.firewallName ?? "hivemi-agents";
    const privateKeyRef = options?.privateKeyRef ?? "hivemi-deploy-private-key";

    let keyGenerated = false;
    let firewallCreated = false;
    let ipChanged = false;

    // =====================================================================
    // Step 1: Ensure SSH keypair exists
    // =====================================================================
    let publicKey = this.state.sshPublicKey;

    if (!publicKey) {
      // Try to load from secret store
      const existingPrivateKey = await this.secrets.get(privateKeyRef);
      if (existingPrivateKey) {
        this.log.info("SSH private key found in secret store, need public key from provider");
        // We have the private key but need the public key — try provider
        // The SSHKeyManager.ensureDeployKey will check if key exists by name
      }

      // Check if we have the public key stored
      const storedPublicKey = await this.secrets.get(`${privateKeyRef}-public`);
      if (storedPublicKey && isValidSSHPublicKey(storedPublicKey)) {
        publicKey = storedPublicKey;
        this.log.info("SSH public key loaded from secret store");
      }
    }

    if (!publicKey) {
      // Generate new keypair
      this.log.info("Generating new ed25519 SSH keypair...");
      const keypair = generateSSHKeyPair(keyName);
      publicKey = keypair.publicKey;

      // Store private key in secret store
      const stored = await this.secrets.set(privateKeyRef, keypair.privateKey);
      if (!stored) {
        throw new Error("Failed to store SSH private key in secret store");
      }

      // Store public key too (for future reference)
      await this.secrets.set(`${privateKeyRef}-public`, keypair.publicKey);

      this.state.sshPrivateKeyRef = privateKeyRef;
      keyGenerated = true;
      this.log.info("SSH keypair generated and stored");
    }

    this.state.sshPublicKey = publicKey;

    // =====================================================================
    // Step 2: Register SSH key with cloud provider
    // =====================================================================
    const sshKeyId = await this.sshKeyManager.ensureDeployKey(publicKey, keyName);
    this.state.sshKeyId = sshKeyId;
    this.log.info(`SSH key registered with ${this.provider.name}: ${sshKeyId}`);

    // =====================================================================
    // Step 3: Detect control plane IP
    // =====================================================================
    const controlPlaneIp = await detectControlPlaneIP(this.log);

    // Check for IP change
    if (this.state.controlPlaneIp && this.state.controlPlaneIp !== controlPlaneIp) {
      ipChanged = true;
      this.log.warn(`Control plane IP changed: ${this.state.controlPlaneIp} → ${controlPlaneIp}`);
    }
    this.state.controlPlaneIp = controlPlaneIp;

    // =====================================================================
    // Step 4: Ensure firewall
    // =====================================================================
    if (this.state.firewallId) {
      // Firewall already exists — restore it and check for IP change
      this.firewallManager.setFirewallId(this.state.firewallId);

      if (ipChanged) {
        // Update firewall rules with new IP
        await this.firewallManager.updateControlPlaneIP(controlPlaneIp, firewallName);
        this.log.info("Firewall rules updated with new control plane IP");
      }
    } else {
      // Create firewall
      const firewallId = await this.firewallManager.ensureFirewall(
        controlPlaneIp,
        firewallName,
      );
      this.state.firewallId = firewallId;
      firewallCreated = true;
    }

    // =====================================================================
    // Update state timestamp
    // =====================================================================
    this.state.updatedAt = new Date().toISOString();

    return {
      sshKeyId,
      sshPublicKey: publicKey,
      firewallId: this.state.firewallId!,
      controlPlaneIp,
      keyGenerated,
      firewallCreated,
      ipChanged,
    };
  }

  /**
   * Check if the control plane IP has changed and update firewall if needed.
   * Lightweight check suitable for periodic calls (e.g., heartbeat).
   *
   * @returns The new IP if it changed, null if unchanged
   */
  async checkIPChange(): Promise<string | null> {
    if (!this.state.controlPlaneIp) {
      this.log.debug("No known IP to compare — run setup() first");
      return null;
    }

    const newIp = await detectIPChange(this.state.controlPlaneIp, this.log);

    if (newIp) {
      this.state.controlPlaneIp = newIp;

      // Update firewall if it exists
      if (this.state.firewallId) {
        await this.firewallManager.updateControlPlaneIP(newIp);
        this.log.info("Firewall rules updated after IP change");
      }

      this.state.updatedAt = new Date().toISOString();
    }

    return newIp;
  }

  /**
   * Add a newly created instance to the agent firewall.
   */
  async addInstanceToFirewall(instanceId: string): Promise<void> {
    if (!this.state.firewallId) {
      throw new Error("Infrastructure not set up — call setup() first");
    }
    await this.firewallManager.addInstance(instanceId);
  }

  /**
   * Remove an instance from the agent firewall.
   */
  async removeInstanceFromFirewall(instanceId: string): Promise<void> {
    if (!this.state.firewallId) {
      throw new Error("Infrastructure not set up — call setup() first");
    }
    await this.firewallManager.removeInstance(instanceId);
  }

  /**
   * Get the SSH private key from the secret store.
   * Used when the bootstrapper needs to SSH into a new VM.
   */
  async getPrivateKey(): Promise<string | null> {
    const ref = this.state.sshPrivateKeyRef;
    if (!ref) return null;
    return this.secrets.get(ref);
  }

  /**
   * Get the current infrastructure state.
   */
  getState(): Readonly<InfraState> {
    return { ...this.state };
  }

  /**
   * Load state from external storage (e.g., Registry cloud config).
   */
  loadState(state: Partial<InfraState>): void {
    if (state.sshKeyId) this.state.sshKeyId = state.sshKeyId;
    if (state.sshPrivateKeyRef) this.state.sshPrivateKeyRef = state.sshPrivateKeyRef;
    if (state.sshPublicKey) this.state.sshPublicKey = state.sshPublicKey;
    if (state.firewallId) {
      this.state.firewallId = state.firewallId;
      this.firewallManager.setFirewallId(state.firewallId);
    }
    if (state.controlPlaneIp) this.state.controlPlaneIp = state.controlPlaneIp;
    if (state.updatedAt) this.state.updatedAt = state.updatedAt;
  }

  /**
   * Get the underlying SSH Key Manager.
   */
  getSSHKeyManager(): SSHKeyManager {
    return this.sshKeyManager;
  }

  /**
   * Get the underlying Firewall Manager.
   */
  getFirewallManager(): FirewallManager {
    return this.firewallManager;
  }
}

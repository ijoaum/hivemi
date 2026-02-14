// =============================================================================
// Tests for Firewall & SSH Key Management (Issue #62)
// SSH key generation, IP detection, firewall rules, InfraManager
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  ICloudProvider,
  SizeMappings,
  ProvisionerLogger,
} from "../types.js";
import { generateSSHKeyPair, isValidSSHPublicKey } from "../ssh-keygen.js";
import { isValidIPv4, clearIPCache, detectControlPlaneIP, detectIPChange } from "../ip-detect.js";
import { FirewallManager, createDefaultRules } from "../firewall.js";
import { SSHKeyManager } from "../ssh-key.js";
import { InfraManager } from "../infra-manager.js";
import type { ISecretStore } from "../infra-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSizeMappings: SizeMappings = {
  small: { slug: "s-1vcpu-1gb", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 6 },
  medium: { slug: "s-2vcpu-2gb", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 12 },
  large: { slug: "s-2vcpu-4gb", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 24 },
};

function createMockProvider(overrides: Partial<ICloudProvider> = {}): ICloudProvider {
  return {
    name: "mock",
    sizeMappings: mockSizeMappings,
    createInstance: vi.fn().mockResolvedValue({
      id: "inst-123", name: "test", publicIp: "1.2.3.4", privateIp: "10.0.0.1",
      status: "active", region: "nyc1", size: "small", tags: [], createdAt: new Date(),
    }),
    destroyInstance: vi.fn().mockResolvedValue(undefined),
    listInstances: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue({}),
    waitReady: vi.fn().mockResolvedValue({}),
    ensureSSHKey: vi.fn().mockResolvedValue("key-42"),
    ensureFirewall: vi.fn().mockResolvedValue("fw-99"),
    addInstanceToFirewall: vi.fn().mockResolvedValue(undefined),
    removeInstanceFromFirewall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockSecretStore(data: Record<string, string> = {}): ISecretStore {
  const store = new Map(Object.entries(data));
  return {
    get: vi.fn(async (ref: string) => store.get(ref) ?? null),
    set: vi.fn(async (ref: string, value: string) => {
      store.set(ref, value);
      return true;
    }),
    exists: vi.fn(async (ref: string) => store.has(ref)),
  };
}

const silentLogger: ProvisionerLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// =============================================================================
// SSH Key Generation
// =============================================================================

describe("generateSSHKeyPair", () => {
  it("should generate a valid ed25519 keypair", () => {
    const keypair = generateSSHKeyPair();

    expect(keypair.privateKey).toContain("BEGIN PRIVATE KEY");
    expect(keypair.privateKey).toContain("END PRIVATE KEY");
    expect(keypair.publicKey).toMatch(/^ssh-ed25519 /);
  });

  it("should include the comment in the public key", () => {
    const keypair = generateSSHKeyPair("my-custom-key");
    expect(keypair.publicKey).toMatch(/ my-custom-key$/);
  });

  it("should use default comment", () => {
    const keypair = generateSSHKeyPair();
    expect(keypair.publicKey).toMatch(/ hivemi-deploy$/);
  });

  it("should generate unique keypairs each time", () => {
    const kp1 = generateSSHKeyPair();
    const kp2 = generateSSHKeyPair();

    expect(kp1.privateKey).not.toBe(kp2.privateKey);
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
  });

  it("should produce a valid SSH public key format", () => {
    const keypair = generateSSHKeyPair();
    expect(isValidSSHPublicKey(keypair.publicKey)).toBe(true);
  });

  it("should produce a public key that starts with ssh-ed25519", () => {
    const keypair = generateSSHKeyPair();
    const parts = keypair.publicKey.split(" ");
    expect(parts[0]).toBe("ssh-ed25519");
    expect(parts.length).toBe(3); // type, base64, comment
  });

  it("should have base64-decodable key data", () => {
    const keypair = generateSSHKeyPair();
    const base64Part = keypair.publicKey.split(" ")[1]!;
    const decoded = Buffer.from(base64Part, "base64");
    // OpenSSH format: 4-byte length + "ssh-ed25519" (11) + 4-byte length + 32-byte key
    expect(decoded.length).toBe(4 + 11 + 4 + 32); // 51 bytes
  });
});

describe("isValidSSHPublicKey", () => {
  it("should accept ed25519 keys", () => {
    const keypair = generateSSHKeyPair();
    expect(isValidSSHPublicKey(keypair.publicKey)).toBe(true);
  });

  it("should reject empty string", () => {
    expect(isValidSSHPublicKey("")).toBe(false);
  });

  it("should reject random text", () => {
    expect(isValidSSHPublicKey("not-a-key")).toBe(false);
  });

  it("should reject unsupported key types", () => {
    expect(isValidSSHPublicKey("ssh-dss AAAA comment")).toBe(false);
  });

  it("should accept key without comment", () => {
    const keypair = generateSSHKeyPair();
    const parts = keypair.publicKey.split(" ");
    const noComment = `${parts[0]} ${parts[1]}`;
    expect(isValidSSHPublicKey(noComment)).toBe(true);
  });

  it("should accept rsa key type string", () => {
    expect(isValidSSHPublicKey("ssh-rsa AAAA comment")).toBe(true);
  });

  it("should accept ecdsa key type string", () => {
    expect(isValidSSHPublicKey("ecdsa-sha2-nistp256 AAAA comment")).toBe(true);
  });
});

// =============================================================================
// IP Validation
// =============================================================================

describe("isValidIPv4", () => {
  it("should accept valid IPv4", () => {
    expect(isValidIPv4("192.168.1.1")).toBe(true);
    expect(isValidIPv4("10.0.0.1")).toBe(true);
    expect(isValidIPv4("255.255.255.255")).toBe(true);
    expect(isValidIPv4("0.0.0.0")).toBe(true);
  });

  it("should reject invalid IPs", () => {
    expect(isValidIPv4("256.0.0.1")).toBe(false);
    expect(isValidIPv4("1.2.3")).toBe(false);
    expect(isValidIPv4("1.2.3.4.5")).toBe(false);
    expect(isValidIPv4("")).toBe(false);
    expect(isValidIPv4("abc.def.ghi.jkl")).toBe(false);
  });

  it("should reject leading zeros", () => {
    expect(isValidIPv4("01.02.03.04")).toBe(false);
  });

  it("should handle whitespace", () => {
    expect(isValidIPv4(" 192.168.1.1 ")).toBe(true);
  });
});

// =============================================================================
// IP Detection
// =============================================================================

describe("detectControlPlaneIP", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearIPCache();
  });

  it("should return IP from first successful service", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "165.245.132.133",
    }) as any;

    const ip = await detectControlPlaneIP(silentLogger);
    expect(ip).toBe("165.245.132.133");
  });

  it("should try next service on failure", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Connection refused");
      }
      return {
        ok: true,
        text: async () => "10.20.30.40",
      };
    }) as any;

    const ip = await detectControlPlaneIP(silentLogger);
    expect(ip).toBe("10.20.30.40");
    expect(callCount).toBe(2);
  });

  it("should reject invalid IP responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "not-an-ip",
    }) as any;

    await expect(detectControlPlaneIP(silentLogger)).rejects.toThrow(
      "Failed to detect control plane IP",
    );
  });

  it("should use cached result within TTL", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        text: async () => "1.2.3.4",
      };
    }) as any;

    await detectControlPlaneIP(silentLogger);
    await detectControlPlaneIP(silentLogger);

    // Only one actual fetch call (second was cached)
    expect(callCount).toBe(1);
  });

  it("should throw when all services fail", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as any;

    await expect(detectControlPlaneIP(silentLogger)).rejects.toThrow(
      "Failed to detect control plane IP",
    );
  });

  it("should handle HTTP error responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    }) as any;

    await expect(detectControlPlaneIP(silentLogger)).rejects.toThrow(
      "Failed to detect control plane IP",
    );
  });
});

describe("detectIPChange", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearIPCache();
  });

  it("should return new IP when changed", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "5.6.7.8",
    }) as any;

    const newIp = await detectIPChange("1.2.3.4", silentLogger);
    expect(newIp).toBe("5.6.7.8");
  });

  it("should return null when unchanged", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "1.2.3.4",
    }) as any;

    const newIp = await detectIPChange("1.2.3.4", silentLogger);
    expect(newIp).toBeNull();
  });

  it("should return null on detection failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as any;

    const newIp = await detectIPChange("1.2.3.4", silentLogger);
    expect(newIp).toBeNull();
  });
});

// =============================================================================
// Firewall Rules (updated with ICMP)
// =============================================================================

describe("createDefaultRules (updated)", () => {
  it("should include ICMP inbound rule", () => {
    const rules = createDefaultRules("165.245.132.133");
    const icmpInbound = rules.find(
      (r) => r.direction === "inbound" && r.protocol === "icmp",
    );

    expect(icmpInbound).toBeDefined();
    expect(icmpInbound!.sources).toEqual(["0.0.0.0/0", "::/0"]);
  });

  it("should have 5 inbound rules (SSH, daemon, VPC TCP, VPC UDP, ICMP)", () => {
    const rules = createDefaultRules("10.0.0.1");
    const inbound = rules.filter((r) => r.direction === "inbound");
    expect(inbound).toHaveLength(5);
  });

  it("should have 3 outbound rules (TCP, UDP, ICMP)", () => {
    const rules = createDefaultRules("10.0.0.1");
    const outbound = rules.filter((r) => r.direction === "outbound");
    expect(outbound).toHaveLength(3);
  });

  it("should restrict SSH to control plane IP", () => {
    const rules = createDefaultRules("10.20.30.40");
    const ssh = rules.find((r) => r.ports === "22");
    expect(ssh!.sources).toEqual(["10.20.30.40/32"]);
  });

  it("should restrict daemon port to control plane IP", () => {
    const rules = createDefaultRules("10.20.30.40");
    const daemon = rules.find((r) => r.ports === "3100");
    expect(daemon!.sources).toEqual(["10.20.30.40/32"]);
  });

  it("should handle CIDR input without double-slashing", () => {
    const rules = createDefaultRules("10.0.0.0/24");
    const ssh = rules.find((r) => r.ports === "22");
    expect(ssh!.sources).toEqual(["10.0.0.0/24"]);
  });

  it("should allow all outbound traffic", () => {
    const rules = createDefaultRules("1.1.1.1");
    const outbound = rules.filter((r) => r.direction === "outbound");
    for (const rule of outbound) {
      expect(rule.sources).toContain("0.0.0.0/0");
    }
  });
});

// =============================================================================
// FirewallManager — IP Change Detection
// =============================================================================

describe("FirewallManager (IP update)", () => {
  let provider: ICloudProvider;
  let manager: FirewallManager;

  beforeEach(() => {
    provider = createMockProvider();
    manager = new FirewallManager(provider, silentLogger);
  });

  it("should track last known IP after ensureFirewall", async () => {
    await manager.ensureFirewall("1.2.3.4");
    expect(manager.getLastKnownIP()).toBe("1.2.3.4");
  });

  it("should update rules when IP changes", async () => {
    await manager.ensureFirewall("1.2.3.4");
    const updated = await manager.updateControlPlaneIP("5.6.7.8");

    expect(updated).toBe(true);
    expect(provider.ensureFirewall).toHaveBeenCalledTimes(2); // initial + update
    expect(manager.getLastKnownIP()).toBe("5.6.7.8");
  });

  it("should skip update when IP is unchanged", async () => {
    await manager.ensureFirewall("1.2.3.4");
    const updated = await manager.updateControlPlaneIP("1.2.3.4");

    expect(updated).toBe(false);
    expect(provider.ensureFirewall).toHaveBeenCalledTimes(1); // only initial
  });

  it("should throw if updating before ensureFirewall", async () => {
    await expect(manager.updateControlPlaneIP("1.2.3.4")).rejects.toThrow(
      "Firewall not initialized",
    );
  });

  it("should pass correct rules to provider on update", async () => {
    await manager.ensureFirewall("1.1.1.1");
    await manager.updateControlPlaneIP("2.2.2.2");

    const lastCall = (provider.ensureFirewall as any).mock.calls.at(-1);
    expect(lastCall[0]).toBe("hivemi-agents");

    const rules = lastCall[1];
    const ssh = rules.find((r: any) => r.ports === "22");
    expect(ssh.sources).toEqual(["2.2.2.2/32"]);
  });
});

// =============================================================================
// InfraManager — Full Integration
// =============================================================================

describe("InfraManager", () => {
  const originalFetch = globalThis.fetch;
  let provider: ICloudProvider;
  let secrets: ISecretStore;
  let infra: InfraManager;

  beforeEach(() => {
    clearIPCache();
    provider = createMockProvider();
    secrets = createMockSecretStore();
    infra = new InfraManager(provider, secrets, silentLogger);

    // Mock IP detection
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "165.245.132.133",
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearIPCache();
  });

  describe("setup", () => {
    it("should generate keypair on first run", async () => {
      const result = await infra.setup();

      expect(result.keyGenerated).toBe(true);
      expect(result.sshKeyId).toBe("key-42");
      expect(result.sshPublicKey).toMatch(/^ssh-ed25519 /);
    });

    it("should store private key in secret store", async () => {
      await infra.setup();

      expect(secrets.set).toHaveBeenCalledWith(
        "hivemi-deploy-private-key",
        expect.stringContaining("BEGIN PRIVATE KEY"),
      );
    });

    it("should store public key in secret store", async () => {
      await infra.setup();

      expect(secrets.set).toHaveBeenCalledWith(
        "hivemi-deploy-private-key-public",
        expect.stringMatching(/^ssh-ed25519 /),
      );
    });

    it("should register SSH key with provider", async () => {
      await infra.setup();

      expect(provider.ensureSSHKey).toHaveBeenCalledWith(
        "hivemi-deploy",
        expect.stringMatching(/^ssh-ed25519 /),
      );
    });

    it("should detect control plane IP", async () => {
      const result = await infra.setup();
      expect(result.controlPlaneIp).toBe("165.245.132.133");
    });

    it("should create firewall", async () => {
      const result = await infra.setup();

      expect(result.firewallCreated).toBe(true);
      expect(result.firewallId).toBe("fw-99");
      expect(provider.ensureFirewall).toHaveBeenCalled();
    });

    it("should reuse existing key from secret store", async () => {
      // Pre-populate secret store with existing keys
      const keypair = generateSSHKeyPair("hivemi-deploy");
      const secretsWithKeys = createMockSecretStore({
        "hivemi-deploy-private-key": "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
        "hivemi-deploy-private-key-public": keypair.publicKey,
      });

      const infra2 = new InfraManager(provider, secretsWithKeys, silentLogger);
      const result = await infra2.setup();

      expect(result.keyGenerated).toBe(false);
      expect(result.sshPublicKey).toBe(keypair.publicKey);
    });

    it("should be idempotent", async () => {
      const result1 = await infra.setup();

      // Load state from first run
      infra.loadState(infra.getState());
      clearIPCache();

      const result2 = await infra.setup();

      // Second run should reuse everything
      expect(result2.keyGenerated).toBe(false);
      expect(result2.firewallCreated).toBe(false);
      expect(result2.ipChanged).toBe(false);
      expect(result2.sshKeyId).toBe(result1.sshKeyId);
    });

    it("should detect IP change on second run", async () => {
      await infra.setup();

      // Change IP
      clearIPCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "99.99.99.99",
      }) as any;

      const result = await infra.setup();
      expect(result.ipChanged).toBe(true);
      expect(result.controlPlaneIp).toBe("99.99.99.99");
    });

    it("should update firewall when IP changes", async () => {
      await infra.setup();

      // Change IP
      clearIPCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "99.99.99.99",
      }) as any;

      await infra.setup();

      // ensureFirewall called at least twice (initial + update via updateControlPlaneIP)
      expect(provider.ensureFirewall).toHaveBeenCalledTimes(2);
    });

    it("should use custom key name", async () => {
      await infra.setup({ keyName: "custom-key" });

      expect(provider.ensureSSHKey).toHaveBeenCalledWith(
        "custom-key",
        expect.any(String),
      );
    });

    it("should use custom firewall name", async () => {
      await infra.setup({ firewallName: "custom-firewall" });

      expect(provider.ensureFirewall).toHaveBeenCalledWith(
        "custom-firewall",
        expect.any(Array),
      );
    });

    it("should throw if secret store fails to save", async () => {
      const failingStore = createMockSecretStore();
      (failingStore.set as any).mockResolvedValue(false);

      const infraFail = new InfraManager(provider, failingStore, silentLogger);
      await expect(infraFail.setup()).rejects.toThrow(
        "Failed to store SSH private key",
      );
    });
  });

  describe("checkIPChange", () => {
    it("should return null when no known IP", async () => {
      const result = await infra.checkIPChange();
      expect(result).toBeNull();
    });

    it("should return new IP when changed", async () => {
      await infra.setup();

      clearIPCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "99.99.99.99",
      }) as any;

      const newIp = await infra.checkIPChange();
      expect(newIp).toBe("99.99.99.99");
    });

    it("should update firewall on IP change", async () => {
      await infra.setup();
      const initialCalls = (provider.ensureFirewall as any).mock.calls.length;

      clearIPCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "99.99.99.99",
      }) as any;

      await infra.checkIPChange();

      expect((provider.ensureFirewall as any).mock.calls.length).toBe(initialCalls + 1);
    });

    it("should return null when IP unchanged", async () => {
      await infra.setup();

      clearIPCache();

      const newIp = await infra.checkIPChange();
      expect(newIp).toBeNull();
    });
  });

  describe("addInstanceToFirewall", () => {
    it("should add instance after setup", async () => {
      await infra.setup();
      await infra.addInstanceToFirewall("inst-456");

      expect(provider.addInstanceToFirewall).toHaveBeenCalledWith("fw-99", "inst-456");
    });

    it("should throw before setup", async () => {
      await expect(infra.addInstanceToFirewall("inst-456")).rejects.toThrow(
        "Infrastructure not set up",
      );
    });
  });

  describe("removeInstanceFromFirewall", () => {
    it("should remove instance after setup", async () => {
      await infra.setup();
      await infra.removeInstanceFromFirewall("inst-456");

      expect(provider.removeInstanceFromFirewall).toHaveBeenCalledWith("fw-99", "inst-456");
    });
  });

  describe("getPrivateKey", () => {
    it("should return private key from secret store", async () => {
      await infra.setup();
      const key = await infra.getPrivateKey();
      expect(key).toContain("BEGIN PRIVATE KEY");
    });

    it("should return null when no key ref", async () => {
      const key = await infra.getPrivateKey();
      expect(key).toBeNull();
    });
  });

  describe("state management", () => {
    it("should expose current state", async () => {
      await infra.setup();
      const state = infra.getState();

      expect(state.sshKeyId).toBe("key-42");
      expect(state.firewallId).toBe("fw-99");
      expect(state.controlPlaneIp).toBe("165.245.132.133");
      expect(state.sshPublicKey).toMatch(/^ssh-ed25519 /);
      expect(state.updatedAt).toBeTruthy();
    });

    it("should load state from external storage", () => {
      infra.loadState({
        sshKeyId: "saved-key-id",
        firewallId: "saved-fw-id",
        controlPlaneIp: "1.2.3.4",
        sshPublicKey: "ssh-ed25519 AAAA test",
      });

      const state = infra.getState();
      expect(state.sshKeyId).toBe("saved-key-id");
      expect(state.firewallId).toBe("saved-fw-id");
      expect(state.controlPlaneIp).toBe("1.2.3.4");
    });

    it("should restore firewall manager state", () => {
      infra.loadState({ firewallId: "restored-fw" });
      expect(infra.getFirewallManager().getFirewallId()).toBe("restored-fw");
    });

    it("should provide access to sub-managers", async () => {
      expect(infra.getSSHKeyManager()).toBeInstanceOf(SSHKeyManager);
      expect(infra.getFirewallManager()).toBeInstanceOf(FirewallManager);
    });
  });
});

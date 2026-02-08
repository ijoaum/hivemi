// =============================================================================
// Cloud Config Settings Routes
// GET/PUT /api/settings/cloud, POST /test, GET /regions, POST /ssh-key/generate
// =============================================================================

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, settings } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  UpdateCloudConfigSchema,
} from "@hivemi/protocol";
import { generateKeyPairSync, createPublicKey } from "node:crypto";

// Settings key constants
const CLOUD_CONFIG_KEY = "cloud_config";
const CLOUD_SECRETS_KEY = "cloud_secrets";

// DO region friendly names + flags
const DO_REGIONS_MAP: Record<string, { name: string; flag: string }> = {
  nyc1: { name: "New York 1", flag: "🇺🇸" },
  nyc2: { name: "New York 2", flag: "🇺🇸" },
  nyc3: { name: "New York 3", flag: "🇺🇸" },
  sfo1: { name: "San Francisco 1", flag: "🇺🇸" },
  sfo2: { name: "San Francisco 2", flag: "🇺🇸" },
  sfo3: { name: "San Francisco 3", flag: "🇺🇸" },
  ams2: { name: "Amsterdam 2", flag: "🇳🇱" },
  ams3: { name: "Amsterdam 3", flag: "🇳🇱" },
  sgp1: { name: "Singapore 1", flag: "🇸🇬" },
  lon1: { name: "London 1", flag: "🇬🇧" },
  fra1: { name: "Frankfurt 1", flag: "🇩🇪" },
  tor1: { name: "Toronto 1", flag: "🇨🇦" },
  blr1: { name: "Bangalore 1", flag: "🇮🇳" },
  syd1: { name: "Sydney 1", flag: "🇦🇺" },
};

const app = new Hono();

// =============================================================================
// GET /api/settings/cloud — Return config (secrets redacted)
// =============================================================================

app.get("/", async (c) => {
  try {
    const configRow = await db.select().from(settings).where(eq(settings.key, CLOUD_CONFIG_KEY));
    const secretsRow = await db.select().from(settings).where(eq(settings.key, CLOUD_SECRETS_KEY));

    if (configRow.length === 0) {
      // No config yet — return empty defaults
      return c.json({
        success: true,
        data: {
          provider: "digitalocean",
          region: "nyc1",
          instanceSize: "small",
          hasApiToken: false,
          hasSSHKey: false,
          sshKeyId: null,
        },
      });
    }

    const config = configRow[0].value as Record<string, unknown>;
    const secrets = secretsRow.length > 0
      ? (secretsRow[0].value as Record<string, unknown>)
      : {};

    return c.json({
      success: true,
      data: {
        provider: config.provider ?? "digitalocean",
        region: config.region ?? "nyc1",
        instanceSize: config.instanceSize ?? "small",
        hasApiToken: !!secrets.apiToken,
        hasSSHKey: !!secrets.sshPrivateKey || !!config.sshPublicKey,
        sshKeyId: (config.sshKeyId as string) ?? null,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to get cloud config");
    return c.json({ success: false, error: "Failed to get cloud config" }, 500);
  }
});

// =============================================================================
// PUT /api/settings/cloud — Update config (with Zod validation)
// =============================================================================

app.put("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = UpdateCloudConfigSchema.parse(body);

    const now = new Date();

    // Separate public config from secrets
    const configValue: Record<string, unknown> = {
      provider: parsed.provider,
      region: parsed.region,
      instanceSize: parsed.instanceSize,
    };

    if (parsed.sshKeyId !== undefined) {
      configValue.sshKeyId = parsed.sshKeyId;
    }
    if (parsed.sshPublicKey !== undefined) {
      configValue.sshPublicKey = parsed.sshPublicKey;
    }

    // Preserve existing values for fields not in this update
    const existingConfig = await db.select().from(settings).where(eq(settings.key, CLOUD_CONFIG_KEY));
    if (existingConfig.length > 0) {
      const existing = existingConfig[0].value as Record<string, unknown>;
      if (parsed.sshKeyId === undefined && existing.sshKeyId) {
        configValue.sshKeyId = existing.sshKeyId;
      }
      if (parsed.sshPublicKey === undefined && existing.sshPublicKey) {
        configValue.sshPublicKey = existing.sshPublicKey;
      }
    }

    // Upsert public config
    await db
      .insert(settings)
      .values({ key: CLOUD_CONFIG_KEY, value: configValue, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: configValue, updatedAt: now },
      });

    // Handle secrets (apiToken, sshPrivateKey) — encrypt at rest
    if (parsed.apiToken || parsed.sshPrivateKey) {
      // Load existing secrets to merge
      const existingSecrets = await db.select().from(settings).where(eq(settings.key, CLOUD_SECRETS_KEY));
      const currentSecrets = existingSecrets.length > 0
        ? (existingSecrets[0].value as Record<string, unknown>)
        : {};

      const secretsValue: Record<string, unknown> = { ...currentSecrets };

      if (parsed.apiToken) {
        secretsValue.apiToken = encrypt(parsed.apiToken);
      }
      if (parsed.sshPrivateKey) {
        secretsValue.sshPrivateKey = encrypt(parsed.sshPrivateKey);
      }

      await db
        .insert(settings)
        .values({ key: CLOUD_SECRETS_KEY, value: secretsValue, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: secretsValue, updatedAt: now },
        });
    }

    logger.info("Cloud config updated");

    return c.json({
      success: true,
      data: {
        provider: configValue.provider,
        region: configValue.region,
        instanceSize: configValue.instanceSize,
        hasApiToken: !!(parsed.apiToken || (await getEncryptedSecret("apiToken"))),
        hasSSHKey: !!(parsed.sshPrivateKey || configValue.sshPublicKey || (await getEncryptedSecret("sshPrivateKey"))),
        sshKeyId: (configValue.sshKeyId as string) ?? null,
      },
    });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return c.json({ success: false, error: "Validation failed", details: error.issues }, 400);
    }
    logger.error(error, "Failed to update cloud config");
    return c.json({ success: false, error: "Failed to update cloud config" }, 500);
  }
});

// =============================================================================
// POST /api/settings/cloud/test — Test provider connection
// =============================================================================

app.post("/test", async (c) => {
  try {
    const apiToken = await getDecryptedSecret("apiToken");
    if (!apiToken) {
      return c.json({
        success: true,
        data: { valid: false, error: "No API token configured" },
      });
    }

    const configRow = await db.select().from(settings).where(eq(settings.key, CLOUD_CONFIG_KEY));
    const provider = configRow.length > 0
      ? (configRow[0].value as Record<string, unknown>).provider as string
      : "digitalocean";

    if (provider === "digitalocean") {
      const result = await testDigitalOcean(apiToken);
      return c.json({ success: true, data: result });
    }

    // GCP test not implemented yet
    return c.json({
      success: true,
      data: { valid: false, error: `Provider "${provider}" test not implemented` },
    });
  } catch (error) {
    logger.error(error, "Failed to test cloud connection");
    return c.json({
      success: true,
      data: { valid: false, error: "Connection test failed" },
    });
  }
});

// =============================================================================
// GET /api/settings/cloud/regions — Dynamic regions from provider
// =============================================================================

app.get("/regions", async (c) => {
  try {
    const apiToken = await getDecryptedSecret("apiToken");
    const configRow = await db.select().from(settings).where(eq(settings.key, CLOUD_CONFIG_KEY));
    const provider = configRow.length > 0
      ? (configRow[0].value as Record<string, unknown>).provider as string
      : "digitalocean";

    if (provider === "digitalocean") {
      if (!apiToken) {
        // Return static list if no token configured
        return c.json({
          success: true,
          data: Object.entries(DO_REGIONS_MAP).map(([slug, info]) => ({
            slug,
            name: info.name,
            available: true,
            flag: info.flag,
          })),
        });
      }

      const regions = await fetchDORegions(apiToken);
      return c.json({ success: true, data: regions });
    }

    // GCP: return empty for now
    return c.json({ success: true, data: [] });
  } catch (error) {
    logger.error(error, "Failed to fetch regions");
    return c.json({ success: false, error: "Failed to fetch regions" }, 500);
  }
});

// =============================================================================
// GET /api/settings/cloud/internal — Full config with decrypted secrets
// Internal-only: used by Manager's Deploy Orchestrator
// =============================================================================

app.get("/internal", async (c) => {
  try {
    const configRow = await db.select().from(settings).where(eq(settings.key, CLOUD_CONFIG_KEY));
    if (configRow.length === 0) {
      return c.json({ success: false, error: "Cloud config not configured" }, 404);
    }

    const config = configRow[0].value as Record<string, unknown>;

    // Decrypt secrets
    let apiToken: string | null = null;
    let sshPrivateKey: string | null = null;

    const secretsRow = await db.select().from(settings).where(eq(settings.key, CLOUD_SECRETS_KEY));
    if (secretsRow.length > 0) {
      const secrets = secretsRow[0].value as Record<string, unknown>;
      if (secrets.apiToken) {
        try { apiToken = decrypt(secrets.apiToken as string); } catch { /* key rotated */ }
      }
      if (secrets.sshPrivateKey) {
        try { sshPrivateKey = decrypt(secrets.sshPrivateKey as string); } catch { /* key rotated */ }
      }
    }

    return c.json({
      success: true,
      data: {
        provider: config.provider ?? "digitalocean",
        region: config.region ?? "nyc1",
        instanceSize: config.instanceSize ?? "small",
        sshKeyId: (config.sshKeyId as string) ?? null,
        sshPublicKey: (config.sshPublicKey as string) ?? null,
        apiToken,
        sshPrivateKey,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to get internal cloud config");
    return c.json({ success: false, error: "Failed to get cloud config" }, 500);
  }
});

// =============================================================================
// POST /api/settings/cloud/ssh-key/generate — Generate ed25519 keypair
// =============================================================================

app.post("/ssh-key/generate", async (c) => {
  try {
    // Generate ed25519 keypair using Node.js crypto
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // Convert PEM public key to OpenSSH format
    const sshPublicKey = convertToOpenSSH(publicKey);

    const now = new Date();

    // Store private key encrypted
    const existingSecrets = await db.select().from(settings).where(eq(settings.key, CLOUD_SECRETS_KEY));
    const currentSecrets = existingSecrets.length > 0
      ? (existingSecrets[0].value as Record<string, unknown>)
      : {};

    const secretsValue: Record<string, unknown> = {
      ...currentSecrets,
      sshPrivateKey: encrypt(privateKey),
    };

    await db
      .insert(settings)
      .values({ key: CLOUD_SECRETS_KEY, value: secretsValue, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: secretsValue, updatedAt: now },
      });

    // Store public key in config
    const existingConfig = await db.select().from(settings).where(eq(settings.key, CLOUD_CONFIG_KEY));
    const configValue: Record<string, unknown> = existingConfig.length > 0
      ? { ...(existingConfig[0].value as Record<string, unknown>) }
      : { provider: "digitalocean", region: "nyc1", instanceSize: "small" };

    configValue.sshPublicKey = sshPublicKey;
    // Clear sshKeyId since we have a new key that hasn't been registered yet
    configValue.sshKeyId = null;

    await db
      .insert(settings)
      .values({ key: CLOUD_CONFIG_KEY, value: configValue, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: configValue, updatedAt: now },
      });

    logger.info("SSH keypair generated and stored");

    return c.json({
      success: true,
      data: {
        publicKey: sshPublicKey,
      },
    });
  } catch (error) {
    logger.error(error, "Failed to generate SSH key");
    return c.json({ success: false, error: "Failed to generate SSH key" }, 500);
  }
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get an encrypted secret field from the cloud_secrets settings row.
 * Returns the encrypted hex string, or null if not found.
 */
async function getEncryptedSecret(field: string): Promise<string | null> {
  const row = await db.select().from(settings).where(eq(settings.key, CLOUD_SECRETS_KEY));
  if (row.length === 0) return null;
  const val = (row[0].value as Record<string, unknown>)[field] as string | undefined;
  return val ?? null;
}

/**
 * Get a decrypted secret field from the cloud_secrets settings row.
 */
async function getDecryptedSecret(field: string): Promise<string | null> {
  const encrypted = await getEncryptedSecret(field);
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    logger.warn(`Failed to decrypt secret: ${field}`);
    return null;
  }
}

/**
 * Test DigitalOcean connection using GET /v2/account.
 */
async function testDigitalOcean(token: string) {
  try {
    const res = await fetch("https://api.digitalocean.com/v2/account", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return { valid: false, error: "Invalid API token" };
    }

    const data = (await res.json()) as {
      account: {
        email: string;
        droplet_limit: number;
        status: string;
      };
    };

    return {
      valid: true,
      account: data.account.email,
      dropletLimit: data.account.droplet_limit,
    };
  } catch {
    return { valid: false, error: "Connection failed" };
  }
}

/**
 * Fetch available regions from DigitalOcean API.
 */
async function fetchDORegions(token: string) {
  const res = await fetch("https://api.digitalocean.com/v2/regions?per_page=100", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`DO regions API failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    regions: Array<{
      slug: string;
      name: string;
      available: boolean;
    }>;
  };

  return data.regions
    .filter((r) => r.available)
    .map((r) => ({
      slug: r.slug,
      name: DO_REGIONS_MAP[r.slug]?.name ?? r.name,
      available: r.available,
      flag: DO_REGIONS_MAP[r.slug]?.flag ?? "🌐",
    }));
}

/**
 * Convert PEM-encoded ed25519 public key to OpenSSH format.
 * Uses Node.js built-in createPublicKey to get the raw key bytes,
 * then manually formats as SSH wire format.
 */
function convertToOpenSSH(pemPublicKey: string): string {
  // Parse the PEM to get the raw key
  const keyObj = createPublicKey(pemPublicKey);
  const rawDer = keyObj.export({ type: "spki", format: "der" });

  // For ed25519, the SPKI DER has a fixed 12-byte header, followed by 32 bytes of key
  // OID for ed25519: 06 03 2b 65 70
  // Full header: 30 2a 30 05 06 03 2b 65 70 03 21 00
  const ED25519_SPKI_HEADER_LEN = 12;
  const rawKey = rawDer.subarray(ED25519_SPKI_HEADER_LEN);

  // SSH wire format: string "ssh-ed25519" + string <32-byte key>
  const keyType = Buffer.from("ssh-ed25519");
  const buf = Buffer.alloc(4 + keyType.length + 4 + rawKey.length);
  let offset = 0;

  buf.writeUInt32BE(keyType.length, offset); offset += 4;
  keyType.copy(buf, offset); offset += keyType.length;
  buf.writeUInt32BE(rawKey.length, offset); offset += 4;
  rawKey.copy(buf, offset);

  return `ssh-ed25519 ${buf.toString("base64")} hivemi-deploy`;
}

export default app;

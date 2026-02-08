// =============================================================================
// Cloud Config Service
// High-level API for reading cloud config — used by Provisioner and other modules
// =============================================================================

import { eq } from "drizzle-orm";
import { db, settings } from "../db/index.js";
import { decrypt } from "./crypto.js";

const CLOUD_CONFIG_KEY = "cloud_config";
const CLOUD_SECRETS_KEY = "cloud_secrets";

/**
 * Full cloud config with decrypted secrets.
 * Only used server-side by internal modules (Provisioner, Bootstrapper).
 * NEVER expose this shape through API responses.
 */
export interface CloudConfig {
  provider: "digitalocean" | "gcp";
  region: string;
  instanceSize: "small" | "medium" | "large";
  sshKeyId: string | null;
  sshPublicKey: string | null;
  apiToken: string | null;
  sshPrivateKey: string | null;
}

/**
 * Load the full cloud config including decrypted secrets.
 * Returns null if no config has been saved yet.
 */
export async function getCloudConfig(): Promise<CloudConfig | null> {
  const configRow = await db.select().from(settings).where(eq(settings.key, CLOUD_CONFIG_KEY));
  if (configRow.length === 0) return null;

  const config = configRow[0].value as Record<string, unknown>;

  const secretsRow = await db.select().from(settings).where(eq(settings.key, CLOUD_SECRETS_KEY));
  const secrets = secretsRow.length > 0
    ? (secretsRow[0].value as Record<string, unknown>)
    : {};

  let apiToken: string | null = null;
  let sshPrivateKey: string | null = null;

  if (secrets.apiToken) {
    try {
      apiToken = decrypt(secrets.apiToken as string);
    } catch {
      // decryption failed — key may have rotated
    }
  }

  if (secrets.sshPrivateKey) {
    try {
      sshPrivateKey = decrypt(secrets.sshPrivateKey as string);
    } catch {
      // decryption failed
    }
  }

  return {
    provider: (config.provider as "digitalocean" | "gcp") ?? "digitalocean",
    region: (config.region as string) ?? "nyc1",
    instanceSize: (config.instanceSize as "small" | "medium" | "large") ?? "small",
    sshKeyId: (config.sshKeyId as string) ?? null,
    sshPublicKey: (config.sshPublicKey as string) ?? null,
    apiToken,
    sshPrivateKey,
  };
}

/**
 * Update the sshKeyId after the key has been registered with the provider.
 * Called by the Provisioner after ensureSSHKey.
 */
export async function updateSSHKeyId(sshKeyId: string): Promise<void> {
  const configRow = await db.select().from(settings).where(eq(settings.key, CLOUD_CONFIG_KEY));
  if (configRow.length === 0) return;

  const config = { ...(configRow[0].value as Record<string, unknown>), sshKeyId };
  await db
    .update(settings)
    .set({ value: config, updatedAt: new Date() })
    .where(eq(settings.key, CLOUD_CONFIG_KEY));
}

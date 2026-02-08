// =============================================================================
// Encryption helpers for secrets at rest (AES-256-GCM)
// =============================================================================
//
// Uses a 32-byte key derived from SETTINGS_ENCRYPTION_KEY env var.
// If the env var is not set, falls back to a deterministic key derived from
// DATABASE_URL — not ideal for production but ensures things work out of the box.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;
const KEY_LEN = 32;

/**
 * Derive a 32-byte encryption key.
 * Priority: SETTINGS_ENCRYPTION_KEY > DATABASE_URL fallback.
 */
function getKey(): Buffer {
  const explicit = process.env.SETTINGS_ENCRYPTION_KEY;
  if (explicit) {
    // Derive from explicit secret so user can supply any-length passphrase
    return scryptSync(explicit, "hivemi-settings", KEY_LEN);
  }
  // Fallback: derive from DATABASE_URL (always present)
  const dbUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/hivemi";
  return scryptSync(dbUrl, "hivemi-settings-fallback", KEY_LEN);
}

/**
 * Encrypt a plaintext string. Returns a hex-encoded string:
 *   iv (32 hex) + authTag (32 hex) + ciphertext (variable)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return iv.toString("hex") + tag.toString("hex") + encrypted;
}

/**
 * Decrypt a hex-encoded ciphertext produced by `encrypt`.
 */
export function decrypt(data: string): string {
  const key = getKey();
  const iv = Buffer.from(data.slice(0, IV_LEN * 2), "hex");
  const tag = Buffer.from(data.slice(IV_LEN * 2, IV_LEN * 2 + TAG_LEN * 2), "hex");
  const ciphertext = data.slice(IV_LEN * 2 + TAG_LEN * 2);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

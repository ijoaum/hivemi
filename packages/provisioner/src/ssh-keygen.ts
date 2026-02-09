// =============================================================================
// SSH Key Generation
// Generate ed25519 keypairs for HiveMI deploy operations
// =============================================================================

import { generateKeyPairSync } from "node:crypto";

/**
 * Result of generating an SSH keypair.
 */
export interface SSHKeyPair {
  /** PEM-encoded private key */
  privateKey: string;
  /** OpenSSH-format public key (e.g. "ssh-ed25519 AAAA... hivemi-deploy") */
  publicKey: string;
}

/**
 * Generate an ed25519 SSH keypair.
 *
 * Uses Node's built-in crypto — no external dependencies needed.
 *
 * @param comment - Comment appended to the public key (default: "hivemi-deploy")
 * @returns Private key in PEM format, public key in OpenSSH format
 */
export function generateSSHKeyPair(comment: string = "hivemi-deploy"): SSHKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  // Convert PEM public key to OpenSSH format
  const opensshPublicKey = pemToOpenSSH(publicKey, comment);

  return {
    privateKey,
    publicKey: opensshPublicKey,
  };
}

/**
 * Convert a PEM-encoded ed25519 public key to OpenSSH format.
 *
 * OpenSSH format: "ssh-ed25519 <base64-encoded-key-data> <comment>"
 *
 * The ed25519 public key in SPKI PEM contains a fixed 12-byte header
 * followed by the 32-byte raw key. The OpenSSH wire format prepends
 * a 4-byte length + "ssh-ed25519" type string + 4-byte length + raw key.
 */
function pemToOpenSSH(pemPublicKey: string, comment: string): string {
  // Extract base64 from PEM
  const pem = pemPublicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s/g, "");

  const der = Buffer.from(pem, "base64");

  // ed25519 SPKI DER: 12-byte header + 32-byte raw public key
  // Header: 30 2a 30 05 06 03 2b 65 70 03 21 00
  const rawKey = der.subarray(12); // 32 bytes

  if (rawKey.length !== 32) {
    throw new Error(`Unexpected ed25519 public key length: ${rawKey.length} (expected 32)`);
  }

  // Build OpenSSH wire format:
  // uint32 length of "ssh-ed25519" (11)
  // "ssh-ed25519"
  // uint32 length of raw key (32)
  // raw key bytes
  const keyType = Buffer.from("ssh-ed25519");
  const buf = Buffer.alloc(4 + keyType.length + 4 + rawKey.length);

  let offset = 0;
  buf.writeUInt32BE(keyType.length, offset);
  offset += 4;
  keyType.copy(buf, offset);
  offset += keyType.length;
  buf.writeUInt32BE(rawKey.length, offset);
  offset += 4;
  rawKey.copy(buf, offset);

  return `ssh-ed25519 ${buf.toString("base64")} ${comment}`;
}

/**
 * Validate that a string looks like a valid SSH public key.
 */
export function isValidSSHPublicKey(key: string): boolean {
  const parts = key.trim().split(/\s+/);
  if (parts.length < 2) return false;

  const validTypes = ["ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"];
  if (!validTypes.includes(parts[0]!)) return false;

  // Check if base64 part is valid
  try {
    const decoded = Buffer.from(parts[1]!, "base64");
    return decoded.length > 0;
  } catch {
    return false;
  }
}

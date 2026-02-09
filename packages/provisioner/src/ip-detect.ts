// =============================================================================
// Control Plane IP Detection
// Auto-detect the public IP of the current server
// =============================================================================

import type { ProvisionerLogger } from "./types.js";
import { consoleLogger } from "./types.js";

/** Known public IP detection services, ordered by preference */
const IP_SERVICES = [
  "https://api.ipify.org",
  "https://ifconfig.me/ip",
  "https://checkip.amazonaws.com",
  "https://icanhazip.com",
];

/** Timeout for each IP detection request */
const REQUEST_TIMEOUT_MS = 5000;

/** How long to cache the detected IP (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Cached IP detection result */
interface IPCache {
  ip: string;
  detectedAt: number;
}

let cache: IPCache | null = null;

/**
 * Validate that a string is a valid IPv4 address.
 */
export function isValidIPv4(ip: string): boolean {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
  });
}

/**
 * Detect the public IP of the current server.
 *
 * Tries multiple services in sequence. First successful response wins.
 * Results are cached for 5 minutes to avoid excessive external calls.
 *
 * @param logger - Optional logger
 * @returns Public IPv4 address
 * @throws If no service returns a valid IP
 */
export async function detectControlPlaneIP(
  logger?: ProvisionerLogger,
): Promise<string> {
  const log = logger ?? consoleLogger;

  // Check cache
  if (cache && Date.now() - cache.detectedAt < CACHE_TTL_MS) {
    log.debug(`Using cached control plane IP: ${cache.ip}`);
    return cache.ip;
  }

  const errors: string[] = [];

  for (const service of IP_SERVICES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(service, {
        signal: controller.signal,
        headers: { Accept: "text/plain" },
      });

      clearTimeout(timeout);

      if (!res.ok) {
        errors.push(`${service}: HTTP ${res.status}`);
        continue;
      }

      const text = (await res.text()).trim();

      if (!isValidIPv4(text)) {
        errors.push(`${service}: invalid IP "${text}"`);
        continue;
      }

      // Cache and return
      cache = { ip: text, detectedAt: Date.now() };
      log.info(`Control plane IP detected: ${text} (via ${service})`);
      return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${service}: ${message}`);
      continue;
    }
  }

  throw new Error(
    `Failed to detect control plane IP. Tried ${IP_SERVICES.length} services:\n${errors.join("\n")}`,
  );
}

/**
 * Clear the IP detection cache.
 * Useful when you know the IP has changed or for testing.
 */
export function clearIPCache(): void {
  cache = null;
}

/**
 * Check if the control plane IP has changed since the last detection.
 * Returns the new IP if changed, null if unchanged.
 *
 * @param knownIp - The previously known IP
 * @param logger - Optional logger
 */
export async function detectIPChange(
  knownIp: string,
  logger?: ProvisionerLogger,
): Promise<string | null> {
  const log = logger ?? consoleLogger;

  // Force fresh detection
  clearIPCache();

  try {
    const currentIp = await detectControlPlaneIP(log);

    if (currentIp !== knownIp) {
      log.warn(`Control plane IP changed: ${knownIp} → ${currentIp}`);
      return currentIp;
    }

    log.debug(`Control plane IP unchanged: ${currentIp}`);
    return null;
  } catch (err) {
    log.error(`Failed to check IP change: ${(err as Error).message}`);
    // Don't throw — return null (assume unchanged) on detection failure
    return null;
  }
}

// =============================================================================
// DigitalOcean Cloud Provider
// Full implementation using DO API v2 with rate limiting and pagination
// =============================================================================

import { Socket } from "node:net";
import type {
  ICloudProvider,
  InstanceSpec,
  Instance,
  InstanceSize,
  InstanceStatus,
  FirewallRule,
  WaitReadyOptions,
  SizeMappings,
  ProviderConfig,
  ProvisionerLogger,
} from "../types.js";
import { consoleLogger } from "../types.js";

const DO_API = "https://api.digitalocean.com/v2";

/**
 * DigitalOcean size mappings.
 *
 * | Abstract | vCPU | RAM | DO slug         | ~Cost/mo |
 * |----------|------|-----|-----------------|----------|
 * | small    | 1    | 1GB | s-1vcpu-1gb     | $6       |
 * | medium   | 2    | 2GB | s-2vcpu-2gb     | $12      |
 * | large    | 2    | 4GB | s-2vcpu-4gb-amd | $24      |
 */
const DO_SIZE_MAPPINGS: SizeMappings = {
  small: { slug: "s-1vcpu-1gb", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 6 },
  medium: { slug: "s-2vcpu-2gb", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 12 },
  large: { slug: "s-2vcpu-4gb-amd", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 24 },
};

const DEFAULT_IMAGE = "ubuntu-24-04-x64";
const DEFAULT_REGION = "nyc1";

/**
 * Supported DigitalOcean regions.
 * Validated on createInstance to fail fast on typos.
 */
const SUPPORTED_REGIONS = new Set([
  "nyc1", "nyc3",  // New York
  "sfo3",          // San Francisco
  "ams3",          // Amsterdam
  "sgp1",          // Singapore
]);

/** Maximum retries for rate-limited (429) requests */
const MAX_RATE_LIMIT_RETRIES = 3;

/** Base backoff in ms for 429 retries (doubles each attempt) */
const RATE_LIMIT_BACKOFF_MS = 1000;

/** Map DO droplet status to our abstract status */
function mapStatus(doStatus: string): InstanceStatus {
  switch (doStatus) {
    case "new":
      return "creating";
    case "active":
      return "active";
    case "archive":
    case "off":
      return "destroyed";
    default:
      return "error";
  }
}

/** Map abstract size to DO slug */
function sizeToSlug(size: InstanceSize): string {
  return DO_SIZE_MAPPINGS[size].slug;
}

// DO API response types (partial — just what we use)
interface DODroplet {
  id: number;
  name: string;
  status: string;
  created_at: string;
  region: { slug: string };
  size_slug: string;
  tags: string[];
  networks: {
    v4: Array<{
      ip_address: string;
      type: "public" | "private";
    }>;
  };
}

interface DOSSHKey {
  id: number;
  name: string;
  fingerprint: string;
  public_key: string;
}

interface DOFirewall {
  id: string;
  name: string;
  droplet_ids: number[];
  inbound_rules: DOFirewallRule[];
  outbound_rules: DOFirewallRule[];
}

interface DOFirewallRule {
  protocol: string;
  ports: string;
  sources?: { addresses: string[] };
  destinations?: { addresses: string[] };
}

/** Pagination metadata from DO API responses */
interface DOPagination {
  pages?: {
    next?: string;
    last?: string;
  };
  total?: number;
}

/** Rate limit state tracked across API calls */
interface RateLimitState {
  remaining: number | null;
  resetAt: number | null;
}

/**
 * Check if a TCP port is reachable on a host.
 */
function checkPort(host: string, port: number, timeoutMs: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.connect(port, host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Parse a DO droplet into our Instance type.
 */
function parseDroplet(droplet: DODroplet): Instance {
  const publicNet = droplet.networks.v4.find((n) => n.type === "public");
  const privateNet = droplet.networks.v4.find((n) => n.type === "private");

  // Reverse-map slug to abstract size
  let size: InstanceSize = "small";
  for (const [key, mapping] of Object.entries(DO_SIZE_MAPPINGS)) {
    if (mapping.slug === droplet.size_slug) {
      size = key as InstanceSize;
      break;
    }
  }

  return {
    id: String(droplet.id),
    name: droplet.name,
    publicIp: publicNet?.ip_address ?? null,
    privateIp: privateNet?.ip_address ?? null,
    status: mapStatus(droplet.status),
    region: droplet.region.slug,
    size,
    tags: droplet.tags,
    createdAt: new Date(droplet.created_at),
  };
}

/**
 * Error thrown when the DO API returns a rate limit (429) and all retries are exhausted.
 */
export class RateLimitError extends Error {
  readonly retryAfterMs: number;
  readonly remaining: number;

  constructor(retryAfterMs: number, remaining: number) {
    super(`DigitalOcean rate limit exceeded. Retry after ${retryAfterMs}ms (remaining: ${remaining})`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.remaining = remaining;
  }
}

/**
 * Error thrown when an unsupported region is specified.
 */
export class UnsupportedRegionError extends Error {
  readonly region: string;
  readonly supported: string[];

  constructor(region: string) {
    const supported = [...SUPPORTED_REGIONS].sort();
    super(`Unsupported region "${region}". Supported: ${supported.join(", ")}`);
    this.name = "UnsupportedRegionError";
    this.region = region;
    this.supported = supported;
  }
}

export class DigitalOceanProvider implements ICloudProvider {
  readonly name = "digitalocean";
  readonly sizeMappings = DO_SIZE_MAPPINGS;

  private readonly token: string;
  private readonly defaultRegion: string;
  private readonly defaultImage: string;
  private readonly log: ProvisionerLogger;

  /** Track rate limit state from response headers */
  private rateLimit: RateLimitState = { remaining: null, resetAt: null };

  constructor(config: ProviderConfig, logger?: ProvisionerLogger) {
    if (!config.token) {
      throw new Error("DigitalOcean API token is required");
    }
    this.token = config.token;
    this.defaultRegion = config.defaultRegion ?? DEFAULT_REGION;
    this.defaultImage = config.defaultImage ?? DEFAULT_IMAGE;
    this.log = logger ?? consoleLogger;
  }

  /**
   * Get current rate limit state (for monitoring/debugging).
   */
  getRateLimitState(): Readonly<RateLimitState> {
    return { ...this.rateLimit };
  }

  /**
   * Get the set of supported regions.
   */
  static getSupportedRegions(): ReadonlySet<string> {
    return SUPPORTED_REGIONS;
  }

  // ---------------------------------------------------------------------------
  // Internal API helpers
  // ---------------------------------------------------------------------------

  /**
   * Update rate limit tracking from response headers.
   */
  private updateRateLimit(res: Response): void {
    const remaining = res.headers.get("ratelimit-remaining");
    const reset = res.headers.get("ratelimit-reset");

    if (remaining !== null) {
      this.rateLimit.remaining = parseInt(remaining, 10);
    }
    if (reset !== null) {
      this.rateLimit.resetAt = parseInt(reset, 10) * 1000; // convert to ms
    }

    // Warn when getting low
    if (this.rateLimit.remaining !== null && this.rateLimit.remaining < 100) {
      this.log.warn(`DO rate limit low: ${this.rateLimit.remaining} remaining`);
    }
  }

  /**
   * Calculate retry delay from response headers or use exponential backoff.
   */
  private getRetryDelay(res: Response, attempt: number): number {
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
    // Exponential backoff: 1s, 2s, 4s
    return RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt);
  }

  /**
   * Core API request with rate limit handling and retries.
   */
  private async api<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${DO_API}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      this.updateRateLimit(res);

      // Handle rate limiting (429)
      if (res.status === 429) {
        const delay = this.getRetryDelay(res, attempt);

        if (attempt < MAX_RATE_LIMIT_RETRIES) {
          this.log.warn(
            `Rate limited (429) on ${method} ${path}, retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} after ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // All retries exhausted
        throw new RateLimitError(delay, this.rateLimit.remaining ?? 0);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `DO API ${method} ${path} failed (${res.status}): ${text}`,
        );
      }

      // 204 No Content
      if (res.status === 204) {
        return undefined as T;
      }

      return (await res.json()) as T;
    }

    // Should never reach here, but TypeScript needs it
    throw new Error(`DO API ${method} ${path}: exceeded max retries`);
  }

  /**
   * Paginated GET — collects all pages for a list endpoint.
   * Extracts items from the response using the given key.
   */
  private async apiPaginated<T>(
    basePath: string,
    key: string,
  ): Promise<T[]> {
    const allItems: T[] = [];
    let url: string | null = basePath.startsWith("http")
      ? basePath
      : `${DO_API}${basePath}`;

    // Ensure per_page is set
    if (!url.includes("per_page=")) {
      url += (url.includes("?") ? "&" : "?") + "per_page=200";
    }

    while (url) {
      const data = await this.api<Record<string, unknown>>("GET", url);

      const items = data[key] as T[] | undefined;
      if (items && Array.isArray(items)) {
        allItems.push(...items);
      }

      // Check for next page
      const links = data.links as DOPagination | undefined;
      url = links?.pages?.next ?? null;
    }

    return allItems;
  }

  // ---------------------------------------------------------------------------
  // Region validation
  // ---------------------------------------------------------------------------

  /**
   * Validate that a region is in the supported set.
   */
  private validateRegion(region: string): void {
    if (!SUPPORTED_REGIONS.has(region)) {
      throw new UnsupportedRegionError(region);
    }
  }

  // ---------------------------------------------------------------------------
  // ICloudProvider implementation
  // ---------------------------------------------------------------------------

  async createInstance(spec: InstanceSpec): Promise<Instance> {
    const region = spec.region || this.defaultRegion;

    // Validate region
    this.validateRegion(region);

    this.log.info(`Creating droplet "${spec.name}" (${spec.size}) in ${region}`);

    const body: Record<string, unknown> = {
      name: spec.name,
      region,
      size: sizeToSlug(spec.size),
      image: spec.image || this.defaultImage,
      ssh_keys: [spec.sshKeyId],
      tags: spec.tags,
      monitoring: true,
      ipv6: false,
    };

    if (spec.userData) {
      body.user_data = spec.userData;
    }
    if (spec.vpcId) {
      body.vpc_uuid = spec.vpcId;
    }

    const data = await this.api<{ droplet: DODroplet }>("POST", "/droplets", body);
    const instance = parseDroplet(data.droplet);

    // Attach to firewall if specified
    if (spec.firewallId) {
      try {
        await this.addInstanceToFirewall(spec.firewallId, instance.id);
      } catch (err) {
        this.log.warn(`Failed to attach firewall ${spec.firewallId} to ${instance.id}: ${err}`);
      }
    }

    this.log.info(`Droplet created: ${instance.id} (${instance.name})`);
    return instance;
  }

  async destroyInstance(id: string): Promise<void> {
    this.log.info(`Destroying droplet ${id}`);
    await this.api("DELETE", `/droplets/${id}`);
    this.log.info(`Droplet ${id} destroyed`);
  }

  async listInstances(tags?: string[]): Promise<Instance[]> {
    // DO API supports filtering by a single tag
    const tag = tags?.[0];
    const path = tag
      ? `/droplets?tag_name=${encodeURIComponent(tag)}`
      : "/droplets";

    const droplets = await this.apiPaginated<DODroplet>(path, "droplets");
    let instances = droplets.map(parseDroplet);

    // If multiple tags requested, filter client-side
    if (tags && tags.length > 1) {
      instances = instances.filter((inst) =>
        tags.every((t) => inst.tags.includes(t)),
      );
    }

    return instances;
  }

  async getStatus(id: string): Promise<Instance> {
    const data = await this.api<{ droplet: DODroplet }>("GET", `/droplets/${id}`);
    return parseDroplet(data.droplet);
  }

  async waitReady(id: string, options?: WaitReadyOptions): Promise<Instance> {
    const timeoutMs = options?.timeoutMs ?? 300_000;
    const pollMs = options?.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;

    this.log.info(`Waiting for droplet ${id} to be ready (timeout: ${timeoutMs}ms)`);

    while (Date.now() < deadline) {
      const instance = await this.getStatus(id);

      if (instance.status === "error") {
        throw new Error(`Droplet ${id} entered error state`);
      }

      if (instance.status === "active" && instance.publicIp) {
        // Check SSH reachability
        const sshReady = await checkPort(instance.publicIp, 22, 3000);
        if (sshReady) {
          this.log.info(`Droplet ${id} ready: ${instance.publicIp}`);
          return instance;
        }
        this.log.debug(`Droplet ${id} active but SSH not ready yet`);
      } else {
        this.log.debug(`Droplet ${id} status: ${instance.status}, IP: ${instance.publicIp ?? "pending"}`);
      }

      await new Promise((r) => setTimeout(r, pollMs));
    }

    throw new Error(`Droplet ${id} not ready after ${timeoutMs}ms`);
  }

  async ensureSSHKey(name: string, publicKey: string): Promise<string> {
    this.log.info(`Ensuring SSH key "${name}" exists`);

    const keys = await this.apiPaginated<DOSSHKey>("/account/keys", "ssh_keys");
    const existing = keys.find((k) => k.name === name);

    if (existing) {
      this.log.info(`SSH key "${name}" already exists (ID: ${existing.id})`);
      return String(existing.id);
    }

    // Register new key
    const created = await this.api<{ ssh_key: DOSSHKey }>("POST", "/account/keys", {
      name,
      public_key: publicKey,
    });

    this.log.info(`SSH key "${name}" registered (ID: ${created.ssh_key.id})`);
    return String(created.ssh_key.id);
  }

  async ensureFirewall(name: string, rules: FirewallRule[]): Promise<string> {
    this.log.info(`Ensuring firewall "${name}" exists`);

    const firewalls = await this.apiPaginated<DOFirewall>("/firewalls", "firewalls");
    const existing = firewalls.find((fw) => fw.name === name);

    const doInbound = rules
      .filter((r) => r.direction === "inbound")
      .map((r) => ({
        protocol: r.protocol,
        ports: r.ports,
        sources: { addresses: r.sources },
      }));

    const doOutbound = rules
      .filter((r) => r.direction === "outbound")
      .map((r) => ({
        protocol: r.protocol,
        ports: r.ports,
        destinations: { addresses: r.sources },
      }));

    if (existing) {
      // Update rules
      this.log.info(`Firewall "${name}" exists (ID: ${existing.id}), updating rules`);
      await this.api("PUT", `/firewalls/${existing.id}`, {
        name,
        inbound_rules: doInbound,
        outbound_rules: doOutbound,
        droplet_ids: existing.droplet_ids,
      });
      return existing.id;
    }

    // Create new firewall
    const created = await this.api<{ firewall: DOFirewall }>("POST", "/firewalls", {
      name,
      inbound_rules: doInbound,
      outbound_rules: doOutbound,
      droplet_ids: [],
    });

    this.log.info(`Firewall "${name}" created (ID: ${created.firewall.id})`);
    return created.firewall.id;
  }

  async addInstanceToFirewall(firewallId: string, instanceId: string): Promise<void> {
    this.log.info(`Adding droplet ${instanceId} to firewall ${firewallId}`);
    await this.api("POST", `/firewalls/${firewallId}/droplets`, {
      droplet_ids: [Number(instanceId)],
    });
  }

  async removeInstanceFromFirewall(firewallId: string, instanceId: string): Promise<void> {
    this.log.info(`Removing droplet ${instanceId} from firewall ${firewallId}`);
    await this.api("DELETE", `/firewalls/${firewallId}/droplets`, {
      droplet_ids: [Number(instanceId)],
    });
  }
}

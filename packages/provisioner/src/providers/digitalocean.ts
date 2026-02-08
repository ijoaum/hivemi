// =============================================================================
// DigitalOcean Cloud Provider
// Full implementation using DO API v2
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
 * | Abstrato | vCPU | RAM | DO slug        | ~Custo/mês |
 * |----------|------|-----|----------------|------------|
 * | small    | 1    | 1GB | s-1vcpu-1gb    | $6         |
 * | medium   | 2    | 2GB | s-2vcpu-2gb    | $12        |
 * | large    | 2    | 4GB | s-2vcpu-4gb    | $24        |
 */
const DO_SIZE_MAPPINGS: SizeMappings = {
  small: { slug: "s-1vcpu-1gb", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 6 },
  medium: { slug: "s-2vcpu-2gb", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 12 },
  large: { slug: "s-2vcpu-4gb-amd", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 24 },
};

const DEFAULT_IMAGE = "ubuntu-24-04-x64";
const DEFAULT_REGION = "nyc1";

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

export class DigitalOceanProvider implements ICloudProvider {
  readonly name = "digitalocean";
  readonly sizeMappings = DO_SIZE_MAPPINGS;

  private readonly token: string;
  private readonly defaultRegion: string;
  private readonly defaultImage: string;
  private readonly log: ProvisionerLogger;

  constructor(config: ProviderConfig, logger?: ProvisionerLogger) {
    if (!config.token) {
      throw new Error("DigitalOcean API token is required");
    }
    this.token = config.token;
    this.defaultRegion = config.defaultRegion ?? DEFAULT_REGION;
    this.defaultImage = config.defaultImage ?? DEFAULT_IMAGE;
    this.log = logger ?? consoleLogger;
  }

  // ---------------------------------------------------------------------------
  // Internal API helpers
  // ---------------------------------------------------------------------------

  private async api<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${DO_API}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

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

  // ---------------------------------------------------------------------------
  // ICloudProvider implementation
  // ---------------------------------------------------------------------------

  async createInstance(spec: InstanceSpec): Promise<Instance> {
    this.log.info(`Creating droplet "${spec.name}" (${spec.size}) in ${spec.region || this.defaultRegion}`);

    const body: Record<string, unknown> = {
      name: spec.name,
      region: spec.region || this.defaultRegion,
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
      ? `/droplets?tag_name=${encodeURIComponent(tag)}&per_page=200`
      : "/droplets?per_page=200";

    const data = await this.api<{ droplets: DODroplet[] }>("GET", path);
    let instances = data.droplets.map(parseDroplet);

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

    // Check if key exists by name
    const data = await this.api<{ ssh_keys: DOSSHKey[] }>("GET", "/account/keys?per_page=200");
    const existing = data.ssh_keys.find((k) => k.name === name);

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

    // Check if firewall exists
    const data = await this.api<{ firewalls: DOFirewall[] }>("GET", "/firewalls?per_page=200");
    const existing = data.firewalls.find((fw) => fw.name === name);

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

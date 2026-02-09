// =============================================================================
// Tests for DigitalOcean Cloud Provider
// Unit tests with mocked fetch — validates DO API integration, rate limiting,
// pagination, region validation, and instance lifecycle
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProvisionerLogger, InstanceSpec } from "../types.js";
import { DigitalOceanProvider, RateLimitError, UnsupportedRegionError } from "../providers/digitalocean.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const silentLogger: ProvisionerLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeDODroplet(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    name: "test-vm",
    status: "active",
    created_at: "2026-01-15T10:00:00Z",
    region: { slug: "nyc1" },
    size_slug: "s-1vcpu-1gb",
    tags: ["hivemi"],
    networks: {
      v4: [
        { ip_address: "1.2.3.4", type: "public" },
        { ip_address: "10.0.0.1", type: "private" },
      ],
    },
    ...overrides,
  };
}

function makeSpec(overrides: Partial<InstanceSpec> = {}): InstanceSpec {
  return {
    name: "test-agent",
    region: "nyc1",
    size: "small",
    sshKeyId: "key-42",
    tags: ["hivemi"],
    ...overrides,
  };
}

function mockFetchOk(body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({
      "ratelimit-remaining": "4999",
      "ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
      ...headers,
    }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetch204(headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 204,
    headers: new Headers({
      "ratelimit-remaining": "4998",
      ...headers,
    }),
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(""),
  });
}

function mockFetchSequence(responses: Array<{
  ok?: boolean;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve({
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      headers: new Headers({
        "ratelimit-remaining": "4999",
        ...resp.headers,
      }),
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(JSON.stringify(resp.body ?? "")),
    });
  });
}

let provider: DigitalOceanProvider;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  provider = new DigitalOceanProvider({ token: "test-token" }, silentLogger);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// =============================================================================
// Constructor
// =============================================================================

describe("DigitalOceanProvider constructor", () => {
  it("should throw without token", () => {
    expect(() => new DigitalOceanProvider({ token: "" }, silentLogger)).toThrow(
      "token is required",
    );
  });

  it("should use default region and image", () => {
    const p = new DigitalOceanProvider({ token: "t" }, silentLogger);
    expect(p.name).toBe("digitalocean");
    expect(p.sizeMappings.small.slug).toBe("s-1vcpu-1gb");
  });

  it("should accept custom defaults", () => {
    const p = new DigitalOceanProvider(
      { token: "t", defaultRegion: "ams3", defaultImage: "debian-12-x64" },
      silentLogger,
    );
    expect(p.name).toBe("digitalocean");
  });
});

// =============================================================================
// Size mappings
// =============================================================================

describe("size mappings", () => {
  it("should have correct small mapping", () => {
    expect(provider.sizeMappings.small).toMatchObject({
      slug: "s-1vcpu-1gb",
      vcpu: 1,
      memoryMb: 1024,
      monthlyCostUsd: 6,
    });
  });

  it("should have correct medium mapping", () => {
    expect(provider.sizeMappings.medium).toMatchObject({
      slug: "s-2vcpu-2gb",
      vcpu: 2,
      memoryMb: 2048,
      monthlyCostUsd: 12,
    });
  });

  it("should have correct large mapping", () => {
    expect(provider.sizeMappings.large).toMatchObject({
      slug: "s-2vcpu-4gb-amd",
      vcpu: 2,
      memoryMb: 4096,
      monthlyCostUsd: 24,
    });
  });
});

// =============================================================================
// Supported regions
// =============================================================================

describe("supported regions", () => {
  it("should include nyc1, nyc3, sfo3, ams3, sgp1", () => {
    const regions = DigitalOceanProvider.getSupportedRegions();
    expect(regions.has("nyc1")).toBe(true);
    expect(regions.has("nyc3")).toBe(true);
    expect(regions.has("sfo3")).toBe(true);
    expect(regions.has("ams3")).toBe(true);
    expect(regions.has("sgp1")).toBe(true);
  });

  it("should not include unsupported regions", () => {
    const regions = DigitalOceanProvider.getSupportedRegions();
    expect(regions.has("lon1")).toBe(false);
    expect(regions.has("fra1")).toBe(false);
    expect(regions.has("us-east-1")).toBe(false);
  });
});

// =============================================================================
// Create Instance
// =============================================================================

describe("createInstance", () => {
  it("should send correct API request", async () => {
    const droplet = makeDODroplet();
    globalThis.fetch = mockFetchOk({ droplet });

    await provider.createInstance(makeSpec());

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.digitalocean.com/v2/droplets");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(body.name).toBe("test-agent");
    expect(body.region).toBe("nyc1");
    expect(body.size).toBe("s-1vcpu-1gb");
    expect(body.image).toBe("ubuntu-24-04-x64");
    expect(body.ssh_keys).toEqual(["key-42"]);
    expect(body.tags).toEqual(["hivemi"]);
    expect(body.monitoring).toBe(true);
  });

  it("should parse droplet response correctly", async () => {
    const droplet = makeDODroplet({
      id: 99999,
      name: "my-agent",
      status: "new",
    });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.createInstance(makeSpec({ name: "my-agent" }));

    expect(instance.id).toBe("99999");
    expect(instance.name).toBe("my-agent");
    expect(instance.publicIp).toBe("1.2.3.4");
    expect(instance.privateIp).toBe("10.0.0.1");
    expect(instance.status).toBe("creating"); // "new" maps to "creating"
    expect(instance.region).toBe("nyc1");
    expect(instance.size).toBe("small");
    expect(instance.tags).toEqual(["hivemi"]);
  });

  it("should include user_data when provided", async () => {
    const droplet = makeDODroplet();
    globalThis.fetch = mockFetchOk({ droplet });

    await provider.createInstance(makeSpec({ userData: "#cloud-config\npackages: [git]" }));

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.user_data).toBe("#cloud-config\npackages: [git]");
  });

  it("should include vpc_uuid when provided", async () => {
    const droplet = makeDODroplet();
    globalThis.fetch = mockFetchOk({ droplet });

    await provider.createInstance(makeSpec({ vpcId: "vpc-123" }));

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.vpc_uuid).toBe("vpc-123");
  });

  it("should attach firewall after creation", async () => {
    const droplet = makeDODroplet({ id: 555 });
    globalThis.fetch = mockFetchSequence([
      { body: { droplet } },   // POST /droplets
      { status: 204 },         // POST /firewalls/:id/droplets
    ]);

    const instance = await provider.createInstance(
      makeSpec({ firewallId: "fw-99" }),
    );

    expect(instance.id).toBe("555");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const [fwUrl, fwOpts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]!;
    expect(fwUrl).toContain("/firewalls/fw-99/droplets");
    expect(JSON.parse(fwOpts.body).droplet_ids).toEqual([555]);
  });

  it("should map medium size correctly", async () => {
    const droplet = makeDODroplet({ size_slug: "s-2vcpu-2gb" });
    globalThis.fetch = mockFetchOk({ droplet });

    await provider.createInstance(makeSpec({ size: "medium" }));

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.size).toBe("s-2vcpu-2gb");
  });

  it("should map large size correctly", async () => {
    const droplet = makeDODroplet({ size_slug: "s-2vcpu-4gb-amd" });
    globalThis.fetch = mockFetchOk({ droplet });

    await provider.createInstance(makeSpec({ size: "large" }));

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.size).toBe("s-2vcpu-4gb-amd");
  });

  it("should reject unsupported region", async () => {
    await expect(
      provider.createInstance(makeSpec({ region: "lon1" })),
    ).rejects.toThrow(UnsupportedRegionError);
  });

  it("should reject invalid region with helpful message", async () => {
    await expect(
      provider.createInstance(makeSpec({ region: "us-east-1" })),
    ).rejects.toThrow(/Supported:.*nyc1/);
  });

  it("should use default region when spec region is empty", async () => {
    // Empty region should fall through to default region validation
    // The default region is "nyc1" which IS supported
    const p = new DigitalOceanProvider({ token: "t", defaultRegion: "nyc1" }, silentLogger);
    const droplet = makeDODroplet();
    globalThis.fetch = mockFetchOk({ droplet });

    await p.createInstance(makeSpec({ region: "" }));

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.region).toBe("nyc1");
  });

  it("should accept all supported regions", async () => {
    const regions = ["nyc1", "nyc3", "sfo3", "ams3", "sgp1"];

    for (const region of regions) {
      const droplet = makeDODroplet({ region: { slug: region } });
      globalThis.fetch = mockFetchOk({ droplet });

      const instance = await provider.createInstance(makeSpec({ region }));
      expect(instance.region).toBe(region);
    }
  });
});

// =============================================================================
// Destroy Instance
// =============================================================================

describe("destroyInstance", () => {
  it("should send DELETE request", async () => {
    globalThis.fetch = mockFetch204();

    await provider.destroyInstance("12345");

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.digitalocean.com/v2/droplets/12345");
    expect(opts.method).toBe("DELETE");
  });

  it("should not throw on 204 response", async () => {
    globalThis.fetch = mockFetch204();
    await expect(provider.destroyInstance("12345")).resolves.toBeUndefined();
  });

  it("should throw on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ "ratelimit-remaining": "4999" }),
      text: () => Promise.resolve('{"id":"not_found","message":"not found"}'),
    });

    await expect(provider.destroyInstance("99999")).rejects.toThrow("404");
  });
});

// =============================================================================
// List Instances
// =============================================================================

describe("listInstances", () => {
  it("should list by tag", async () => {
    const droplets = [
      makeDODroplet({ id: 1, name: "agent-1" }),
      makeDODroplet({ id: 2, name: "agent-2" }),
    ];
    globalThis.fetch = mockFetchOk({ droplets, links: {}, meta: { total: 2 } });

    const instances = await provider.listInstances(["hivemi"]);

    expect(instances).toHaveLength(2);
    expect(instances[0]!.name).toBe("agent-1");
    expect(instances[1]!.name).toBe("agent-2");

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("tag_name=hivemi");
  });

  it("should list all when no tags specified", async () => {
    globalThis.fetch = mockFetchOk({ droplets: [], links: {} });

    await provider.listInstances();

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/droplets");
    expect(url).not.toContain("tag_name");
  });

  it("should filter by multiple tags client-side", async () => {
    const droplets = [
      makeDODroplet({ id: 1, name: "a1", tags: ["hivemi", "agent"] }),
      makeDODroplet({ id: 2, name: "a2", tags: ["hivemi"] }),
    ];
    globalThis.fetch = mockFetchOk({ droplets, links: {} });

    const instances = await provider.listInstances(["hivemi", "agent"]);

    expect(instances).toHaveLength(1);
    expect(instances[0]!.name).toBe("a1");
  });

  it("should paginate across multiple pages", async () => {
    const page1Droplets = [makeDODroplet({ id: 1, name: "agent-1" })];
    const page2Droplets = [makeDODroplet({ id: 2, name: "agent-2" })];

    globalThis.fetch = mockFetchSequence([
      {
        body: {
          droplets: page1Droplets,
          links: {
            pages: { next: "https://api.digitalocean.com/v2/droplets?page=2&per_page=200" },
          },
        },
      },
      {
        body: {
          droplets: page2Droplets,
          links: { pages: {} },
        },
      },
    ]);

    const instances = await provider.listInstances();

    expect(instances).toHaveLength(2);
    expect(instances[0]!.name).toBe("agent-1");
    expect(instances[1]!.name).toBe("agent-2");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("should reverse-map size slugs", async () => {
    const droplets = [
      makeDODroplet({ id: 1, size_slug: "s-1vcpu-1gb" }),
      makeDODroplet({ id: 2, size_slug: "s-2vcpu-2gb" }),
      makeDODroplet({ id: 3, size_slug: "s-2vcpu-4gb-amd" }),
    ];
    globalThis.fetch = mockFetchOk({ droplets, links: {} });

    const instances = await provider.listInstances();

    expect(instances[0]!.size).toBe("small");
    expect(instances[1]!.size).toBe("medium");
    expect(instances[2]!.size).toBe("large");
  });

  it("should default to small for unknown size slug", async () => {
    const droplets = [makeDODroplet({ id: 1, size_slug: "g-8vcpu-32gb" })];
    globalThis.fetch = mockFetchOk({ droplets, links: {} });

    const instances = await provider.listInstances();
    expect(instances[0]!.size).toBe("small"); // fallback
  });
});

// =============================================================================
// Get Status
// =============================================================================

describe("getStatus", () => {
  it("should return instance status", async () => {
    const droplet = makeDODroplet({ id: 12345, status: "active" });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");

    expect(instance.id).toBe("12345");
    expect(instance.status).toBe("active");
    expect(instance.publicIp).toBe("1.2.3.4");
  });

  it("should map 'new' status to 'creating'", async () => {
    const droplet = makeDODroplet({ status: "new" });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.status).toBe("creating");
  });

  it("should map 'off' status to 'destroyed'", async () => {
    const droplet = makeDODroplet({ status: "off" });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.status).toBe("destroyed");
  });

  it("should map 'archive' status to 'destroyed'", async () => {
    const droplet = makeDODroplet({ status: "archive" });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.status).toBe("destroyed");
  });

  it("should map unknown status to 'error'", async () => {
    const droplet = makeDODroplet({ status: "borked" });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.status).toBe("error");
  });

  it("should handle missing public IP", async () => {
    const droplet = makeDODroplet({
      networks: { v4: [{ ip_address: "10.0.0.1", type: "private" }] },
    });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.publicIp).toBeNull();
    expect(instance.privateIp).toBe("10.0.0.1");
  });

  it("should handle missing private IP", async () => {
    const droplet = makeDODroplet({
      networks: { v4: [{ ip_address: "1.2.3.4", type: "public" }] },
    });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.publicIp).toBe("1.2.3.4");
    expect(instance.privateIp).toBeNull();
  });
});

// =============================================================================
// Wait Ready (limited — checkPort uses real sockets)
// =============================================================================

describe("waitReady", () => {
  it("should throw on error state", async () => {
    const droplet = makeDODroplet({ status: "errored" });
    globalThis.fetch = mockFetchOk({ droplet });

    await expect(
      provider.waitReady("12345", { timeoutMs: 1000, pollIntervalMs: 100 }),
    ).rejects.toThrow("error state");
  });

  it("should timeout when instance never gets IP", async () => {
    const droplet = makeDODroplet({
      status: "new",
      networks: { v4: [] },
    });
    globalThis.fetch = mockFetchOk({ droplet });

    await expect(
      provider.waitReady("12345", { timeoutMs: 500, pollIntervalMs: 100 }),
    ).rejects.toThrow("not ready after");
  });
});

// =============================================================================
// SSH Key Management
// =============================================================================

describe("ensureSSHKey", () => {
  it("should return existing key ID", async () => {
    const ssh_keys = [
      { id: 42, name: "hivemi-deploy", fingerprint: "ab:cd", public_key: "ssh-ed25519 AAAA" },
    ];
    globalThis.fetch = mockFetchOk({ ssh_keys, links: {} });

    const id = await provider.ensureSSHKey("hivemi-deploy", "ssh-ed25519 AAAA");
    expect(id).toBe("42");
  });

  it("should create new key when not found", async () => {
    globalThis.fetch = mockFetchSequence([
      { body: { ssh_keys: [], links: {} } },  // GET — not found
      {
        body: {
          ssh_key: { id: 99, name: "hivemi-deploy", fingerprint: "ef:gh", public_key: "ssh-ed25519 BBBB" },
        },
      },  // POST — created
    ]);

    const id = await provider.ensureSSHKey("hivemi-deploy", "ssh-ed25519 BBBB");
    expect(id).toBe("99");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // Verify POST body
    const [, postOpts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]!;
    const body = JSON.parse(postOpts.body);
    expect(body.name).toBe("hivemi-deploy");
    expect(body.public_key).toBe("ssh-ed25519 BBBB");
  });
});

// =============================================================================
// Firewall Management
// =============================================================================

describe("ensureFirewall", () => {
  it("should update existing firewall", async () => {
    const firewalls = [
      { id: "fw-1", name: "hivemi-agents", droplet_ids: [100], inbound_rules: [], outbound_rules: [] },
    ];
    globalThis.fetch = mockFetchSequence([
      { body: { firewalls, links: {} } },  // GET — found
      { body: {} },                         // PUT — update
    ]);

    const rules = [
      { direction: "inbound" as const, protocol: "tcp" as const, ports: "22", sources: ["1.2.3.4/32"] },
    ];

    const id = await provider.ensureFirewall("hivemi-agents", rules);
    expect(id).toBe("fw-1");

    // Verify PUT was called
    const [putUrl, putOpts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]!;
    expect(putUrl).toContain("/firewalls/fw-1");
    expect(putOpts.method).toBe("PUT");

    const body = JSON.parse(putOpts.body);
    expect(body.inbound_rules[0].protocol).toBe("tcp");
    expect(body.inbound_rules[0].ports).toBe("22");
    expect(body.inbound_rules[0].sources.addresses).toEqual(["1.2.3.4/32"]);
    expect(body.droplet_ids).toEqual([100]); // preserved
  });

  it("should create new firewall when not found", async () => {
    globalThis.fetch = mockFetchSequence([
      { body: { firewalls: [], links: {} } },
      {
        body: {
          firewall: { id: "fw-new", name: "hivemi-agents", droplet_ids: [], inbound_rules: [], outbound_rules: [] },
        },
      },
    ]);

    const rules = [
      { direction: "outbound" as const, protocol: "tcp" as const, ports: "0", sources: ["0.0.0.0/0"] },
    ];

    const id = await provider.ensureFirewall("hivemi-agents", rules);
    expect(id).toBe("fw-new");
  });
});

describe("addInstanceToFirewall", () => {
  it("should send POST with droplet ID as number", async () => {
    globalThis.fetch = mockFetch204();

    await provider.addInstanceToFirewall("fw-99", "12345");

    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/firewalls/fw-99/droplets");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body).droplet_ids).toEqual([12345]);
  });
});

describe("removeInstanceFromFirewall", () => {
  it("should send DELETE with droplet ID as number", async () => {
    globalThis.fetch = mockFetch204();

    await provider.removeInstanceFromFirewall("fw-99", "12345");

    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/firewalls/fw-99/droplets");
    expect(opts.method).toBe("DELETE");
    expect(JSON.parse(opts.body).droplet_ids).toEqual([12345]);
  });
});

// =============================================================================
// Rate Limiting
// =============================================================================

describe("rate limiting", () => {
  it("should retry on 429 with backoff", async () => {
    const droplet = makeDODroplet();
    globalThis.fetch = mockFetchSequence([
      {
        ok: false,
        status: 429,
        headers: { "retry-after": "1", "ratelimit-remaining": "0" },
        body: { id: "too_many_requests", message: "rate limited" },
      },
      { body: { droplet } },
    ]);

    const instance = await provider.getStatus("12345");

    expect(instance.id).toBe("12345");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("should use retry-after header for delay", async () => {
    const droplet = makeDODroplet();
    const start = Date.now();

    globalThis.fetch = mockFetchSequence([
      {
        ok: false,
        status: 429,
        headers: { "retry-after": "1", "ratelimit-remaining": "0" },
      },
      { body: { droplet } },
    ]);

    await provider.getStatus("12345");

    // Should have waited ~1 second (retry-after: 1)
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it("should throw RateLimitError after max retries", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({
        "retry-after": "0",
        "ratelimit-remaining": "0",
        "ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
      }),
      text: () => Promise.resolve("rate limited"),
    });

    await expect(provider.getStatus("12345")).rejects.toThrow(RateLimitError);
    // Initial attempt + 3 retries = 4 calls
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it("should track rate limit state from headers", async () => {
    const droplet = makeDODroplet();
    globalThis.fetch = mockFetchOk({ droplet }, { "ratelimit-remaining": "4242" });

    await provider.getStatus("12345");

    const state = provider.getRateLimitState();
    expect(state.remaining).toBe(4242);
  });

  it("should warn when rate limit remaining is low", async () => {
    const warnFn = vi.fn();
    const warnLogger: ProvisionerLogger = {
      ...silentLogger,
      warn: warnFn,
    };
    const p = new DigitalOceanProvider({ token: "t" }, warnLogger);

    const droplet = makeDODroplet();
    globalThis.fetch = mockFetchOk({ droplet }, { "ratelimit-remaining": "50" });

    await p.getStatus("12345");

    expect(warnFn).toHaveBeenCalledWith(expect.stringContaining("rate limit low"));
  });
});

// =============================================================================
// Error classes
// =============================================================================

describe("RateLimitError", () => {
  it("should have correct properties", () => {
    const err = new RateLimitError(5000, 0);
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfterMs).toBe(5000);
    expect(err.remaining).toBe(0);
    expect(err.message).toContain("5000ms");
  });
});

describe("UnsupportedRegionError", () => {
  it("should have correct properties", () => {
    const err = new UnsupportedRegionError("lon1");
    expect(err.name).toBe("UnsupportedRegionError");
    expect(err.region).toBe("lon1");
    expect(err.supported).toContain("nyc1");
    expect(err.message).toContain("lon1");
    expect(err.message).toContain("Supported:");
  });
});

// =============================================================================
// API error handling
// =============================================================================

describe("API error handling", () => {
  it("should throw descriptive error on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ "ratelimit-remaining": "4999" }),
      text: () => Promise.resolve('{"id":"unauthorized","message":"Unable to authenticate"}'),
    });

    await expect(provider.getStatus("12345")).rejects.toThrow(
      /401.*Unable to authenticate/,
    );
  });

  it("should throw descriptive error on 500", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ "ratelimit-remaining": "4999" }),
      text: () => Promise.resolve("internal server error"),
    });

    await expect(provider.listInstances()).rejects.toThrow(/500/);
  });
});

// =============================================================================
// Droplet parsing edge cases
// =============================================================================

describe("droplet parsing", () => {
  it("should handle empty networks", async () => {
    const droplet = makeDODroplet({ networks: { v4: [] } });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.publicIp).toBeNull();
    expect(instance.privateIp).toBeNull();
  });

  it("should parse creation date", async () => {
    const droplet = makeDODroplet({ created_at: "2026-03-15T14:30:00Z" });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.createdAt).toEqual(new Date("2026-03-15T14:30:00Z"));
  });

  it("should handle droplet with no tags", async () => {
    const droplet = makeDODroplet({ tags: [] });
    globalThis.fetch = mockFetchOk({ droplet });

    const instance = await provider.getStatus("12345");
    expect(instance.tags).toEqual([]);
  });
});

// =============================================================================
// Authorization header
// =============================================================================

describe("authorization", () => {
  it("should send Bearer token in headers", async () => {
    const p = new DigitalOceanProvider({ token: "do-secret-token" }, silentLogger);
    const droplet = makeDODroplet();
    globalThis.fetch = mockFetchOk({ droplet });

    await p.getStatus("12345");

    const [, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(opts.headers.Authorization).toBe("Bearer do-secret-token");
  });
});

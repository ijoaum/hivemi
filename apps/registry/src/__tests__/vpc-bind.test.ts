// =============================================================================
// VPC Bind Tests
// Tests for BIND_ADDRESS configuration and private network binding (#80)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Project root is 4 levels up from __tests__: __tests__ → src → registry → apps → root
const ROOT = resolve(__dirname, "../../../../");

// ---------------------------------------------------------------------------
// Registry BIND_ADDRESS tests
// ---------------------------------------------------------------------------

describe("Registry BIND_ADDRESS", () => {
  let registrySource: string;

  beforeEach(() => {
    registrySource = readFileSync(resolve(ROOT, "apps/registry/src/index.ts"), "utf-8");
  });

  it("defaults to 127.0.0.1 (safe fallback, not 0.0.0.0)", () => {
    expect(registrySource).toContain('|| "127.0.0.1"');
    expect(registrySource).not.toMatch(/BIND_ADDRESS.*\|\|.*"0\.0\.0\.0"/);
  });

  it("reads BIND_ADDRESS env var", () => {
    expect(registrySource).toContain("process.env.BIND_ADDRESS");
  });

  it("supports legacy REGISTRY_HOST for backward compatibility", () => {
    expect(registrySource).toContain("process.env.REGISTRY_HOST");
  });

  it("BIND_ADDRESS takes priority over REGISTRY_HOST", () => {
    const bindIdx = registrySource.indexOf("process.env.BIND_ADDRESS");
    const hostIdx = registrySource.indexOf("process.env.REGISTRY_HOST");
    expect(bindIdx).toBeGreaterThan(-1);
    expect(hostIdx).toBeGreaterThan(-1);
    expect(bindIdx).toBeLessThan(hostIdx);
  });

  it("passes hostname to serve()", () => {
    expect(registrySource).toContain("hostname: host");
  });

  it("logs the host on startup", () => {
    expect(registrySource).toMatch(/logger\.info\(.*host.*Starting/);
  });
});

// ---------------------------------------------------------------------------
// Manager BIND_ADDRESS tests
// ---------------------------------------------------------------------------

describe("Manager BIND_ADDRESS", () => {
  let managerSource: string;

  beforeEach(() => {
    managerSource = readFileSync(resolve(ROOT, "apps/manager/src/index.ts"), "utf-8");
  });

  it("defaults to 0.0.0.0 (Manager is public-facing)", () => {
    expect(managerSource).toContain('|| "0.0.0.0"');
  });

  it("reads BIND_ADDRESS env var", () => {
    expect(managerSource).toContain("process.env.BIND_ADDRESS");
  });

  it("passes hostname to serve()", () => {
    expect(managerSource).toContain("hostname: host");
  });

  it("logs the host on startup", () => {
    expect(managerSource).toMatch(/logger\.info\(.*host.*Starting/);
  });
});

// ---------------------------------------------------------------------------
// Daemon registry URL tests
// ---------------------------------------------------------------------------

describe("Daemon registryUrl config", () => {
  let typesSource: string;

  beforeEach(() => {
    typesSource = readFileSync(resolve(ROOT, "packages/agent-daemon/src/types.ts"), "utf-8");
  });

  it("registryUrl documented for VPC usage", () => {
    expect(typesSource).toMatch(/VPC|private/i);
  });

  it("registryUrl is a required config field", () => {
    expect(typesSource).toContain("registryUrl: string");
  });
});

// ---------------------------------------------------------------------------
// Manager registry client tests
// ---------------------------------------------------------------------------

describe("Manager RegistryClient", () => {
  let clientSource: string;

  beforeEach(() => {
    clientSource = readFileSync(resolve(ROOT, "apps/manager/src/lib/registry-client.ts"), "utf-8");
  });

  it("reads REGISTRY_URL from environment", () => {
    expect(clientSource).toContain("process.env.REGISTRY_URL");
  });

  it("documents VPC usage for REGISTRY_URL", () => {
    expect(clientSource).toMatch(/private|VPC/i);
  });
});

// ---------------------------------------------------------------------------
// Deploy orchestrator — private registry URL
// ---------------------------------------------------------------------------

describe("Deploy orchestrator registry URL", () => {
  let orchSource: string;

  beforeEach(() => {
    orchSource = readFileSync(resolve(ROOT, "apps/manager/src/lib/deploy-orchestrator.ts"), "utf-8");
  });

  it("supports REGISTRY_PRIVATE_URL for explicit private URL", () => {
    expect(orchSource).toContain("process.env.REGISTRY_PRIVATE_URL");
  });

  it("auto-constructs private URL from controlPlaneIp", () => {
    expect(orchSource).toContain("this.controlPlaneIp");
    expect(orchSource).toMatch(/`http:\/\/\$\{this\.controlPlaneIp\}/);
  });

  it("skips auto-construction for localhost controlPlaneIp", () => {
    expect(orchSource).toContain('"127.0.0.1"');
  });

  it("falls back to REGISTRY_URL env var", () => {
    expect(orchSource).toContain("process.env.REGISTRY_URL");
  });

  it("reads REGISTRY_PORT for auto-constructed URL", () => {
    expect(orchSource).toContain("process.env.REGISTRY_PORT");
  });
});

// ---------------------------------------------------------------------------
// Bootstrapper — daemon .env includes REGISTRY_URL
// ---------------------------------------------------------------------------

describe("Bootstrapper daemon config", () => {
  let configureSource: string;

  beforeEach(() => {
    configureSource = readFileSync(resolve(ROOT, "packages/bootstrapper/src/phases/configure.ts"), "utf-8");
  });

  it("writes REGISTRY_URL to daemon .env file", () => {
    expect(configureSource).toContain("REGISTRY_URL=${registryUrl}");
  });

  it("registryUrl comes from bootstrap config (set by orchestrator)", () => {
    expect(configureSource).toContain("const { agent, registryUrl, hivemiSecret } = config");
  });
});

// ---------------------------------------------------------------------------
// Deploy documentation
// ---------------------------------------------------------------------------

describe("Deploy documentation", () => {
  let docsContent: string;

  beforeEach(() => {
    docsContent = readFileSync(resolve(ROOT, "docs/DEPLOY.md"), "utf-8");
  });

  it("documents BIND_ADDRESS variable", () => {
    expect(docsContent).toContain("BIND_ADDRESS");
  });

  it("documents the default 127.0.0.1 fallback", () => {
    expect(docsContent).toContain("127.0.0.1");
  });

  it("documents VPC network architecture", () => {
    expect(docsContent).toMatch(/VPC|private network/i);
  });

  it("documents REGISTRY_URL for Manager", () => {
    expect(docsContent).toContain("REGISTRY_URL");
  });

  it("documents CONTROL_PLANE_IP", () => {
    expect(docsContent).toContain("CONTROL_PLANE_IP");
  });

  it("includes verification steps", () => {
    expect(docsContent).toMatch(/ss -tlnp|curl.*health/);
  });

  it("warns against 0.0.0.0 in production", () => {
    expect(docsContent).toMatch(/0\.0\.0\.0.*dev|development/i);
  });

  it("documents DigitalOcean VPC setup", () => {
    expect(docsContent).toMatch(/DigitalOcean/);
  });
});

// ---------------------------------------------------------------------------
// Daemon RegistryClient — private IP detection
// ---------------------------------------------------------------------------

describe("Daemon RegistryClient private IP detection", () => {
  let clientSource: string;

  beforeEach(() => {
    clientSource = readFileSync(resolve(ROOT, "packages/agent-daemon/src/registry-client.ts"), "utf-8");
  });

  it("detects private VPC IP from network interfaces", () => {
    expect(clientSource).toContain("detectPrivateIp");
  });

  it("matches RFC1918 private ranges (10.x, 172.16-31.x, 192.168.x)", () => {
    expect(clientSource).toContain('addr.address.startsWith("10.")');
    expect(clientSource).toContain('addr.address.startsWith("172.');
    expect(clientSource).toContain('addr.address.startsWith("192.168.")');
  });

  it("sends privateIp in registration payload", () => {
    expect(clientSource).toContain("privateIp");
  });

  it("uses privateIp as host when available", () => {
    expect(clientSource).toMatch(/host:\s*privateIp\s*\|\|/);
  });
});

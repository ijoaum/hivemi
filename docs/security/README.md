# HiveMI Security Architecture

## Overview

HiveMI uses a **private network (VPC) model** for all internal communication. Components communicate over the cloud provider's private network (e.g. DigitalOcean VPC, `10.x.x.x`). No TLS, no certificates — plain HTTP between internal components, secured by network isolation and shared secret authentication.

## Network Architecture

```
                    ┌─── Public Internet ───┐
                    │                       │
              ┌─────┴─────┐          ┌──────┴──────┐
              │ Dashboard │          │  LLM APIs   │
              │ (Next.js) │          │ (HTTPS/ext) │
              └─────┬─────┘          └──────▲──────┘
                    │                       │
════════════════════╪═══════════════════════╪════════════
  VPC Private       │                       │
  Network           │                       │
  (10.x.x.x)       │                       │
                    ▼                       │
              ┌───────────┐           ┌─────┴─────┐
              │  Manager  │◄─────────►│  Registry  │
              │  :4000    │           │  :4001     │
              └─────┬─────┘           └──────▲─────┘
                    │                        │
           ┌───────┼────────┐               │
           ▼       ▼        ▼               │
     ┌─────────┐ ┌─────────┐ ┌─────────┐   │
     │ Agent 1 │ │ Agent 2 │ │ Agent N │───┘
     │ Daemon  │ │ Daemon  │ │ Daemon  │
     │ :3100   │ │ :3100   │ │ :3100   │
     └─────────┘ └─────────┘ └─────────┘
```

### Key Rules

1. **All agents in the same VPC region** as the control plane
2. **Registry and Manager bind to the private interface** (`REGISTRY_HOST=10.x.x.x`)
3. **Agent daemons communicate via private IP** (detected automatically on boot)
4. **No internal traffic touches the public internet** — zero cost, zero exposure
5. **LLM API calls** (OpenAI, Anthropic) go out via HTTPS (handled by SDKs)

## Firewall (Public IP)

The `hivemi-agents` firewall is applied to all agent VMs:

| Direction | Protocol | Port | Source/Dest | Purpose |
|-----------|----------|------|-------------|---------|
| Inbound | TCP | 22 | Control Plane IP/32 | SSH (maintenance & bootstrap) |
| Outbound | TCP | all | 0.0.0.0/0 | LLM APIs, packages |
| Outbound | UDP | all | 0.0.0.0/0 | DNS |
| Outbound | ICMP | all | 0.0.0.0/0 | Ping |

**Everything else is blocked** on the public IP. The daemon port (3100) is NOT exposed publicly — it's only accessible via the private VPC network.

## Authentication

### HIVEMI_SECRET

A shared secret used to authenticate all internal API communication.

- **Set via:** `HIVEMI_SECRET` environment variable on all components
- **Transport:** `Authorization: Bearer <secret>` header on every API request
- **Validated by:** Registry and Manager auth middleware (constant-time comparison)
- **Purpose:** Even on a private network, prevents any arbitrary process on a VM from impersonating an agent

```
Agent Daemon → Registry: Authorization: Bearer <HIVEMI_SECRET>
Manager → Registry:      Authorization: Bearer <HIVEMI_SECRET>
Dashboard → Manager:     Authorization: Bearer <HIVEMI_SECRET>
```

In **development mode** (no `HIVEMI_SECRET` set), auth is bypassed for convenience.

### SSH Keys

- **Algorithm:** ed25519 (dedicated `hivemi-deploy` key)
- **Used by:** Bootstrapper to SSH into VMs during setup
- **Storage:** Private key encrypted at rest in the `settings` table (AES-256-GCM)
- **VM access:** Public key injected via cloud-init user-data

## Secrets Management

### Secret Inventory

| Secret | Where it lives | Who uses it |
|--------|---------------|-------------|
| `HIVEMI_SECRET` | Control plane `.env`, agent daemon `.env` | All components |
| SSH private key | Settings table (encrypted) | Bootstrapper |
| DO API token | Settings table (encrypted) | Provisioner |
| LLM API keys | Agent daemon `.env` | OpenClaw on VMs |
| 1Password token | Control plane only (never persisted on VMs) | Bootstrapper |
| OpenClaw API token | Agent daemon `.env` | Daemon → OpenClaw |

### File Permissions on VMs

All sensitive files on agent VMs are created with restricted permissions:

| File | Mode | Contents |
|------|------|----------|
| `~/.hivemi/daemon/.env` | `600` | HIVEMI_SECRET, API keys, tokens |
| `~/.openclaw/config.yaml` | `600` | OpenClaw config with API token |

Mode `600` = readable/writable only by the `openclaw` user (owner). No group or world access.

### Secret Injection Flow

```
1. Deploy initiated from Dashboard
2. Bootstrapper resolves secrets via 1Password CLI (on control plane)
3. SSH into VM → write .env file (mode 600)
4. 1Password token never leaves the control plane
5. Agent daemon loads secrets from .env on startup
```

## What We Intentionally Don't Do

- ~~TLS between agents and Registry~~ — same VPC, no need
- ~~Certificates (Let's Encrypt)~~ — no public-facing HTTP services on agents
- ~~HTTPS for the daemon~~ — private network only
- ~~Certificate rotation~~ — no certificates to rotate
- ~~VPN/WireGuard~~ — same VPC handles isolation

## Constraints

- **Single region only.** All agents must be in the same cloud region as the control plane.
- **Multi-region** would require VPN or WireGuard between VPCs — future work.

---

## Secret Rotation

See [Secret Rotation Guide](./secret-rotation.md) for step-by-step procedures.

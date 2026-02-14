# HiveMI Deploy Guide

## Network Architecture

HiveMI components communicate over a **private VPC network**. Only the Manager (and optionally the Dashboard) should be exposed to the public internet. The Registry and agent daemons communicate exclusively over private IPs.

```
┌─────────────────────────────────────────────────────────────────┐
│                        PUBLIC INTERNET                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                    ┌───────▼───────┐
                    │    Manager    │  ← Public-facing (reverse proxy)
                    │  0.0.0.0:4000 │
                    └───────┬───────┘
                            │ VPC only
            ┌───────────────┼───────────────┐
            │               │               │
    ┌───────▼───────┐       │       ┌───────▼───────┐
    │   Registry    │       │       │   Dashboard   │
    │ 10.x.x.x:4001│       │       │  (Next.js)    │
    └───────┬───────┘       │       └───────────────┘
            │               │
    ┌───────┴───────────────┴───────┐
    │      VPC Private Network      │
    ├───────────┬───────────────────┤
    │  Agent A  │  Agent B  │  ...  │
    │ 10.x.x.y │ 10.x.x.z │       │
    └───────────┴───────────┴───────┘
```

## Environment Variables

### Registry

| Variable | Default | Description |
|----------|---------|-------------|
| `BIND_ADDRESS` | `127.0.0.1` | Interface to bind to. Set to VPC IP (e.g. `10.116.0.2`) in production. |
| `PORT` | `4001` | Port number. |
| `REGISTRY_HOST` | — | **Deprecated**. Use `BIND_ADDRESS` instead. Still works for backward compatibility. |
| `DATABASE_URL` | — | PostgreSQL connection string. |

**Production example:**
```bash
BIND_ADDRESS=10.116.0.2
PORT=4001
```

**Development:**
```bash
# No BIND_ADDRESS needed — defaults to 127.0.0.1 (localhost)
PORT=4001
```

### Manager

| Variable | Default | Description |
|----------|---------|-------------|
| `BIND_ADDRESS` | `0.0.0.0` | Interface to bind to. Default is all interfaces since Manager is the public entry point. |
| `PORT` | `4000` | Port number. |
| `REGISTRY_URL` | `http://localhost:4001` | Registry URL. **Must use private VPC IP in production.** |
| `REGISTRY_PRIVATE_URL` | — | Explicit private URL for the Registry (used in bootstrap config). Takes priority over auto-detection. |
| `REGISTRY_PORT` | `4001` | Registry port (used for auto-constructing private URL from `CONTROL_PLANE_IP`). |
| `CONTROL_PLANE_IP` | `127.0.0.1` | Private VPC IP of the control plane. Used to construct registry URL for agents and firewall rules. |
| `HIVEMI_SECRET` | — | Shared auth secret for daemon ↔ registry communication. |

**Production example:**
```bash
BIND_ADDRESS=0.0.0.0
PORT=4000
REGISTRY_URL=http://10.116.0.2:4001
CONTROL_PLANE_IP=10.116.0.2
HIVEMI_SECRET=<your-secret>
```

### Agent Daemon

| Variable | Default | Description |
|----------|---------|-------------|
| `REGISTRY_URL` | — | **Required.** Registry URL using private VPC IP (e.g. `http://10.116.0.2:4001`). |
| `AGENT_ID` | — | Agent UUID from the Registry. |
| `HIVEMI_SECRET` | — | Shared auth secret. |
| `DAEMON_PORT` | `3100` | Port for daemon HTTP API. |

The daemon's `REGISTRY_URL` is automatically set by the bootstrapper during deploy. It uses the control plane's private IP so agents never need to reach the registry over the public internet.

## Security Model

### What BIND_ADDRESS protects

By binding the Registry to a private VPC IP:

1. **Public internet cannot reach the Registry** — even if firewall rules are misconfigured
2. **Only VPC-connected machines can connect** — agents must be in the same VPC
3. **Defense in depth** — BIND_ADDRESS + firewall rules + HIVEMI_SECRET auth

### Fallback behavior

| BIND_ADDRESS value | Who can connect |
|--------------------|-----------------|
| `127.0.0.1` (default) | Only localhost — safe, nothing external |
| `10.x.x.x` | Only VPC machines on that subnet |
| `0.0.0.0` | Everything — **only for development** |

### Recommended production setup

1. Set `BIND_ADDRESS=<VPC_IP>` on the Registry
2. Set `REGISTRY_URL=http://<VPC_IP>:4001` on the Manager
3. Set `CONTROL_PLANE_IP=<VPC_IP>` on the Manager (for bootstrap)
4. Configure cloud firewall to allow VPC traffic only to port 4001
5. Use `HIVEMI_SECRET` for all daemon ↔ registry communication

## DigitalOcean VPC Setup

On DigitalOcean, droplets in the same datacenter automatically get a private VPC IP (10.x.x.x range).

```bash
# Find your droplet's private IP
curl -s http://169.254.169.254/metadata/v1/interfaces/private/0/ipv4/address

# Or check network interfaces
ip addr show eth1  # private interface on DO
```

Set this IP as your `BIND_ADDRESS` and `CONTROL_PLANE_IP`.

## Verifying the Setup

### Check Registry is bound correctly
```bash
# Should show the private IP, not 0.0.0.0
ss -tlnp | grep 4001
# Expected: LISTEN  10.116.0.2:4001
```

### Verify agents can connect via VPC
```bash
# From an agent VM (in the same VPC)
curl http://10.116.0.2:4001/health
# Expected: {"status":"ok","service":"registry"}
```

### Verify public access is blocked
```bash
# From outside the VPC (your laptop, another datacenter)
curl http://<PUBLIC_IP>:4001/health
# Expected: connection refused or timeout
```

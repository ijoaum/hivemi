# HiveMI Development Journal

## 2026-02-09 — Issue #44: Provisioner — Cloud Provider Abstraction

### Summary
Implemented `packages/provisioner` — cloud-agnostic VM management abstraction. Handles creating/destroying VMs, SSH key registration, firewall management, reconciliation, and cost estimation. Knows nothing about HiveMI agents — pure infra.

### Done
- **types.ts:** Full type system — `ICloudProvider` interface, `InstanceSpec`, `Instance`, `FirewallRule`, `SizeMappings`, `ProvisionerLogger`, etc.
- **providers/digitalocean.ts:** Complete DO API v2 implementation:
  - `createInstance` — creates droplet with tags, cloud-init, VPC, auto-attaches firewall
  - `destroyInstance` — DELETE /droplets/:id
  - `listInstances` — supports tag filtering (server + client-side for multi-tag)
  - `getStatus` — single droplet lookup
  - `waitReady` — polls for active status + SSH port 22 reachable via TCP socket
  - `ensureSSHKey` — upsert by name, returns ID
  - `ensureFirewall` — upsert by name, creates or updates rules
  - `addInstanceToFirewall` / `removeInstanceFromFirewall`
- **providers/gcp.ts:** Stub — size mappings and cost data ready, all methods throw "not implemented"
- **ssh-key.ts:** `SSHKeyManager` — wraps provider.ensureSSHKey with in-memory cache, avoids redundant API calls
- **firewall.ts:** `FirewallManager` — manages "hivemi-agents" firewall lifecycle:
  - `createDefaultRules()` — SSH(22) + daemon(3100) from control plane only, all outbound
  - `ensureFirewall()` — idempotent, caches ID
  - `addInstance()` / `removeInstance()`
- **reconciliation.ts:** Detects orphaned VMs (no agent), phantom agents (no VM), and healthy matches
- **cost.ts:** Estimates monthly cost from size mappings, generates human-readable summary
- **index.ts:** Re-exports everything + `createProvider()` factory function
- **23 unit tests** — all passing, mock provider, covers all modules

### Key Decisions
- **`ICloudProvider` is the core interface** — everything else (SSHKeyManager, FirewallManager, reconciliation, cost) composes on top of it. Adding a new provider = implement one interface.
- **Size abstraction** (small/medium/large) maps to provider-specific slugs + cost. Most agents use "small" ($6/mo on DO).
- **TCP socket check** for SSH readiness instead of spawning `ssh` — faster, no auth needed, no dependencies.
- **Firewall includes daemon port 3100** — the agent daemon that the Deploy Orchestrator communicates with.
- **ProvisionerLogger interface** — pluggable, defaults to console. Tests use silent logger.
- **No @hivemi/protocol runtime coupling** — types are self-contained. Protocol is a dev dependency for potential future use.

### Structure
```
packages/provisioner/
  src/
    index.ts                    — exports + createProvider factory
    types.ts                    — all type definitions
    providers/
      digitalocean.ts           — full DO API v2 implementation
      gcp.ts                    — stub
      index.ts                  — re-exports
    firewall.ts                 — FirewallManager + createDefaultRules
    ssh-key.ts                  — SSHKeyManager with caching
    reconciliation.ts           — VM vs Registry drift detection
    cost.ts                     — monthly cost estimation
    __tests__/
      provisioner.test.ts       — 23 unit tests
```

### Commits
- `437136c` — feat(provisioner): implement cloud provider abstraction

### Note
Code was originally written in a previous run (issue-44 run at 2026-02-08T22:04:36Z) that failed due to API fetch error — the code was good but never committed. This run fixed unused imports in tests, verified build + tests, and committed properly.

### Next
- #61 (DigitalOcean Provider enhancements) — additional DO-specific features
- #62 (Firewall and SSH Key management) — more advanced key rotation, multi-key support
- #63 (Reconciliation and Costs) — dashboard integration, scheduled reconciliation
- #49 (Deploy Orchestrator) — consumes provisioner to manage full deploy lifecycle

---

## 2026-02-09 — Issue #45: Bootstrapper — VM Configuration Package

### Summary
Implemented `packages/bootstrapper` — transforms a provisioned VM into a functional HiveMI agent with OpenClaw, secrets, role config, and the Agent Daemon as a systemd service.

### Done
- **types.ts:** Full type system — `BootstrapConfig`, `ISecretProvider`, `ISSHClient`, `BootstrapPhase` tracking, configurable timeouts with defaults
- **ssh-client.ts:** SSH wrapper using system `ssh` binary (no native deps needed), supports exec, writeFile (base64-encoded for safety), fileExists, connect/disconnect with temp key management
- **phases/cloud-init.ts:** `generateCloudInit()` produces cloud-init YAML (user creation, swap config, package install, OpenClaw install, completion flag); `waitCloudInit()` polls for flag file
- **phases/configure.ts:** Four sub-phases orchestrated with callbacks:
  1. `injectSecrets()` — resolves secrets via provider, returns envVar→value map
  2. `configureOpenClaw()` — writes SOUL.md, OpenClaw config (model, Chat Completions API, sandbox off)
  3. `copyRoleConfig()` — writes SOUL.md, AGENTS.md, TOOLS.md, config.json to workspace
  4. `installDaemon()` — writes .env (mode 600), systemd unit file, daemon-reload/enable/start
- **phases/wait-registration.ts:** Polls `GET /api/agents/:id` until agent transitions out of "provisioning" and has a heartbeat; fetches journalctl logs on timeout for diagnostics
- **secrets/onepassword.ts:** `OnePasswordProvider` using `op read` CLI with service account token
- **secrets/envfile.ts:** `EnvFileProvider` as fallback — loads from Map or .env file
- **index.ts:** `bootstrap()` orchestrator — runs all phases in sequence with per-phase status tracking, error capture, and cleanup
- **20 unit tests** — all passing with mock SSH client and EnvFileProvider

### Key Decisions
- **System SSH binary** instead of a Node.js SSH library (like ssh2). The system `ssh` handles key formats, agent forwarding, etc. natively — one less native dep to compile on the VM. Trade-off: requires `ssh` on the machine running the bootstrapper (always present on Linux).
- **Base64 encoding for file writes** via SSH heredoc to avoid shell escaping issues with special characters in configs.
- **Phase callbacks** in `configure()` allow the caller (Deploy Orchestrator) to update deploy status in real-time as each sub-phase progresses.
- **Idempotency**: cloud-init runs only on first boot (cloud provider guarantees), SSH config overwrites existing files, daemon systemd unit gets daemon-reload+restart.
- **`ISSHClient` interface** allows full mocking in tests without real SSH connections.
- **No `@hivemi/protocol` runtime dependency** — types are defined locally to avoid coupling with the registry's Drizzle types. The protocol package is a workspace dep for potential future use.

### Structure
```
packages/bootstrapper/
  src/
    index.ts              — bootstrap() orchestrator + exports
    types.ts              — all type definitions
    ssh-client.ts         — SSH via system binary
    phases/
      cloud-init.ts       — cloud-init generation + wait
      configure.ts        — secrets, openclaw, role, daemon
      wait-registration.ts — registry polling
    secrets/
      onepassword.ts      — 1Password provider
      envfile.ts          — .env file fallback
    templates/
      cloud-init.yaml     — reference template
    __tests__/
      bootstrapper.test.ts — 20 unit tests
```

### Commits
- `8932862` — feat(bootstrapper): implement VM bootstrap package

### Next
- #46 (Config Management) — OpenClaw config generation in more detail
- #47 (Agent Daemon) — the daemon that `installDaemon()` installs
- #49 (Deploy Orchestrator) — calls `bootstrap()` and manages deploy lifecycle

---

## 2026-02-09 — Issue #71: Settings — Cloud Config Backend

### Summary
Implemented the backend for cloud provider configuration. All settings are persisted in the `settings` table (key-value with JSONB). Secrets are encrypted at rest with AES-256-GCM.

### Done
- **Protocol schemas:** `UpdateCloudConfigSchema`, `CloudConfigResponseSchema`, `CloudTestResultSchema`, `CloudRegionSchema` added to `@hivemi/protocol`
- **Encryption:** `apps/registry/src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt using key derived from `SETTINGS_ENCRYPTION_KEY` env var (falls back to `DATABASE_URL`)
- **5 endpoints** in `apps/registry/src/routes/cloud-settings.ts`:
  - `GET /api/settings/cloud` — returns config with redacted secrets (`hasApiToken`, `hasSSHKey` booleans)
  - `PUT /api/settings/cloud` — Zod-validated update, merges with existing, encrypts secrets
  - `POST /api/settings/cloud/test` — tests DO connection via `GET /v2/account`
  - `GET /api/settings/cloud/regions` — fetches available regions from DO API (static fallback if no token)
  - `POST /api/settings/cloud/ssh-key/generate` — generates ed25519 keypair, stores private encrypted, returns public in OpenSSH format
- **Cloud config service:** `apps/registry/src/lib/cloud-config.ts` — `getCloudConfig()` returns full config with decrypted secrets for Provisioner/Bootstrapper; `updateSSHKeyId()` for post-registration
- **Dashboard proxy routes:** 4 Next.js API routes proxy to registry

### Key Decisions
- **Two settings rows:** `cloud_config` (public: provider, region, size, sshKeyId, sshPublicKey) and `cloud_secrets` (encrypted: apiToken, sshPrivateKey). This separates redactable data from secrets.
- **No sshpk dependency:** OpenSSH format conversion for ed25519 done natively using Node.js crypto DER export + manual SSH wire format encoding.
- **Encryption key:** Derived via scrypt from env var or DATABASE_URL fallback. Not ideal for production but works zero-config in dev.
- **GCP:** Test and regions endpoints return graceful "not implemented" responses — pluggable when GCP support lands.
- **Pre-existing bug:** `apps/dashboard/src/app/agents/[id]/page.tsx` has a parse error (unterminated regex). Unrelated to this issue.

### Settings Table Layout
| key | value (JSONB) |
|-----|---------------|
| `cloud_config` | `{ provider, region, instanceSize, sshKeyId, sshPublicKey }` |
| `cloud_secrets` | `{ apiToken: "<encrypted>", sshPrivateKey: "<encrypted>" }` |

### Files Changed
- `packages/protocol/src/types.ts` — +4 schemas
- `apps/registry/src/lib/crypto.ts` — NEW (encryption)
- `apps/registry/src/lib/cloud-config.ts` — NEW (internal service)
- `apps/registry/src/routes/cloud-settings.ts` — NEW (5 endpoints)
- `apps/registry/src/routes.ts` — mount cloud settings routes
- `apps/dashboard/src/app/api/settings/cloud/` — 4 proxy routes

### Commits
- `aee897b` — feat(settings): cloud config backend
- `f2cc7f7` — feat(settings): cloud config service for internal consumers

### Next: #44 (Provisioner) can now call `getCloudConfig()` to get provider token and SSH keys

---

## 2026-02-09 — Issue #69: Database Migrations for Deploy System

### Summary
Implemented all database schema changes for the deploy system. Updated Drizzle schema, protocol types, and all codebase references to match new enum values.

### Done
- **3 enums altered:** `agent_status` (+provisioning, +unreachable, +destroyed, -online), `task_status` (+locked, +cancelling, -running), `log_level` (+lifecycle)
- **3 new enums:** `deploy_status`, `instance_size`, `cloud_provider`
- **4 new tables:** `deploys` (deploy tracking with phases), `agent_telemetry` (infra/LLM/task metrics), `settings` (global key-value config), `task_progress` (schema ready, Phase 2)
- **6 new columns on agents:** `version`, `openclaw_version`, `cloud` (JSONB), `capabilities_list` (JSONB), `private_ip`, `deploy_id`
- **5 new columns on tasks:** `role_target`, `locked_by`, `locked_at`, `parent_task_id`, `artifacts` (JSONB)
- **1 new column on logs:** `component`
- **8 new indexes** + ensured 4 existing indexes
- **Type exports:** `Deploy`, `NewDeploy`, `AgentTelemetryRecord`, `Setting`, `TaskProgressRecord`
- **Protocol types updated:** all Zod schemas match new DB schema
- **Codebase updated:** dashboard, manager, CLI, seed all use new enum values

### Key Decisions
- `deploys.agentId` does NOT have a Drizzle FK reference to avoid circular dependency with `agents.deployId` → `deploys.id`. The SQL migration has the proper FK constraint.
- `agents.capabilities_list` column name avoids conflict with `roles.capabilities` in JOINs
- Old enum values (`online`, `running`) kept in PostgreSQL type (can't remove from PG enum directly) but migrated in data via UPDATE statements
- All new columns are nullable for backward compatibility
- `task_progress` table schema is ready but implementation deferred to Phase 2 (#68)

### Migration File
`apps/registry/drizzle/0001_deploy_system.sql` — idempotent (IF NOT EXISTS / IF NOT EXISTS throughout), safe to run on existing DB

### Commits
- `5592f83` — feat(db): deploy system schema
- `aa87973` — feat(protocol): update types for deploy system
- `e45a0c8` — refactor: update codebase for new enum values
- `02d43b5` — fix(db): add FK comment + drizzle migration meta

### Next: #44 (Provisioner) — requires this migration to be run first

---

## 2026-02-08 — Day 2: Deploy Architecture & Issues

### Summary
Designed full deploy system architecture. Created 29 GitHub issues (#44-#72).

### Done
- Random agent name + dice button in deploy modal (`b40e022`)
- SSH hardened on control plane (pubkey only, João's ed25519 key)
- Full architecture: Provisioner → Bootstrapper → Agent Daemon → Deploy Orchestrator
- Issues #44-#68: core arch, protocol, bootstrap, provisioner, CI/CD, task execution
- Issues #69-#72: DB migrations, undeploy, settings backend, task cancellation
- Schema review: 3 enums altered, 3 new, 4 new tables, 12 new columns, 8 indexes
- Fixed accidental node_modules commit (.gitignore added)

### Key Decisions
- Pull model (queue) — `SELECT FOR UPDATE SKIP LOCKED`
- VPC private network, no TLS internally
- Immutable deploys (destroy + redeploy to update)
- `running` → `locked` in task_status; `online` removed from agent_status
- Cloud API token in 1Password, settings table holds reference only
- **Daemon → OpenClaw via Chat Completions API** (`POST /v1/chat/completions`): cada task = um request HTTP = sessão nova com contexto limpo. Sem WebSocket, sem acumular histórico. O daemon faz um POST com o prompt da task e recebe a resposta quando terminar.

### Architecture: Task Execution Flow
```
Registry (task queue) → Agent Daemon (polls) → OpenClaw Chat Completions API (local)
                                                  ↓
                                            Nova sessão por task
                                            Sandbox off, elevated full
                                            Acesso ao filesystem (git, pnpm, etc)
                                                  ↓
                                            Resposta com resultado
                                                  ↓
                                        Daemon reporta resultado ao Registry
```

### Implementation Order
`#69 DB → #44 Provisioner → #71 Settings → #45 Bootstrapper → #46 Config → #48 Registry → #47 Daemon → #55 Queue → #49 Orchestrator → #50 Dashboard → #70 Undeploy → #72 Cancellation`

### Issue #73 — Bootstrap: Chat Completions API config
Configurar no OpenClaw de cada agente: endpoint habilitado, sandbox off, elevated full, token único.

### Branch: `dev` — Latest: `b40e022`

---

## 2026-02-07 — Day 1: Dashboard from Zero

### Summary
Built full HiveMI dashboard, integrated with Postgres, polished UI/UX.

### Infrastructure
- Postgres `:5432`, Manager `:4000`, Registry `:4001` (Docker), Dashboard `:3000` (Next.js 16)

### Built
- 7 pages: Home, Tasks, Teams, Roles, Settings, Logs, Agent Detail
- Full CRUD for Agents, Teams, Roles via Registry API
- Dark/light mode, responsive layout, Lucide icons, role colors
- Performance: persistent layout, API cache (10s TTL), shimmer loading, nav feedback, fadeIn

### Issues Closed
#39-#43 (DB integration, CRUD, roles, deploy modal, populated agents) ✅

### Branch: `dev` — Latest: `803de10` (49 commits)

---
*Journal maintained by Clawdia 🦞*

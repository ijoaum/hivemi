# HiveMI Development Journal

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

# HiveMI Development Journal

## 2026-02-08 — Day 2: Deploy Real Architecture

### Session Summary
Planned the real agent deployment architecture and created GitHub issues for all components.

### What Was Done

#### Dashboard Improvement
- Random agent name pre-filled in deploy modal with dice button (Dices icon) to regenerate
- 64 cool agent names (Atlas, Nova, Cipher, Vega, etc.)
- Commit: `b40e022`

#### Architecture Design: Real Agent Deploy
Designed the full architecture for deploying agents to real cloud VMs:

**Control Plane** (existing server) — Registry, Manager, Dashboard, Postgres
**Agent VMs** (cloud) — Each agent runs on its own VM with OpenClaw + agent-daemon

**4 New Components:**
1. **Provisioner** — Cloud provider abstraction (create/destroy VMs). Interface-based, swap DO↔GCP easily.
2. **Bootstrapper** — Configures VM post-creation. Cloud-init installs OpenClaw, SSH injects secrets + config. SecretProvider abstraction (1Password, env file).
3. **Agent Daemon** — Systemd service on agent VM. Auto-registers in Registry, heartbeat, telemetry, task execution via local OpenClaw.
4. **Deploy Orchestrator** — In Manager, coordinates full flow: create VM → wait boot → configure → wait registration → done.

#### GitHub Issues Created (#44-#51)
- #44 — Provisioner: Cloud Provider abstraction (DigitalOcean first)
- #45 — Bootstrapper: Automated VM configuration (cloud-init + SSH)
- #46 — Agent Config: System prompts and role configuration structure
- #47 — Agent Daemon: Resident process on agent VM (systemd, telemetry, tasks)
- #48 — Registry: Telemetry endpoints and deploy status tracking
- #49 — Deploy Orchestrator: End-to-end deploy flow via Manager
- #50 — Dashboard: Real deploy UI with progress and telemetry
- #51 — Security: SSH keys, networking, secure communication

#### Server Hardening
- SSH hardened: password auth disabled, pubkey only
- João's ed25519 key added to root authorized_keys

### Architecture Decision
- Registry remains the single source of truth for agents (already is today)
- No separate agent persistence — daemon self-registers, Registry owns it
- OpenClaw is the LLM runtime, not reimplemented
- Abstractions via interfaces for cloud and secrets — swap providers without changing orchestrator

### Execution Order
```
#44 Provisioner → #45 Bootstrapper → #46 Agent Config
                                          ↓
#48 Registry Telemetry → #47 Agent Daemon
                              ↓
#49 Deploy Orchestrator → #50 Dashboard UI
#51 Security (parallel)
```

### Branch
`dev` — Latest commit: `b40e022`

---

## 2026-02-07 — Day 1: From Zero to Full Dashboard

### Session Summary
Two long sessions building the HiveMI dashboard from scratch, integrating with the database, and polishing the UI.

### What Was Built

#### Infrastructure
- Postgres container running on `:5432` with database `hivemi`
- Manager service on `:4000`, Registry on `:4001` (Docker)
- Dashboard (Next.js 16 + Turbopack) on `:3000`
- ngrok tunnel for remote access

#### Database Integration (Issues #39-#43)
- Full CRUD for Agents, Teams, Roles via Registry API
- Tasks & Logs integrated with database
- API returns agents with populated role/team objects (joins)
- Database seed script with roles and teams
- **All 5 issues closed** ✅

#### Dashboard Pages
- **Home (The Hive)** — Agent cards grouped by team, real-time status, deploy modal
- **Tasks** — Task list with filters by status/team
- **Teams** — Full CRUD with create/edit/delete modals
- **Roles** — Full CRUD with icon picker, color, description
- **Settings** — Tabbed settings page (general, agents, LLM, secrets, notifications, danger zone)
- **Logs** — Real-time log viewer with level filters and auto-refresh
- **Agent Detail** — Dedicated page with stats, tasks, logs, config, action menu

#### UI/UX Polish
- Dark/light mode toggle
- Responsive layout (mobile hamburger menu, desktop sidebar)
- Lucide icons replacing emojis everywhere (62 icons in library)
- Role icons with role colors on agent cards
- Agent action menu (start/stop/restart/delete with confirmations)
- Agent name links to detail page
- Hexagon icon branding (replacing bee emoji)

#### Performance Optimization (Session 2)
- **Persistent layout** — Moved `<AppLayout>` to root `layout.tsx` so sidebar never remounts on navigation
- **API cache** — Global cache with 10s TTL in `useApi` hook; revisited pages load instantly from cache
- **Shimmer loading** — `loading.tsx` with skeleton UI and shimmer gradient animation during transitions
- **Nav feedback** — Spinner icon + amber highlight on sidebar menu item click for instant perceived response
- **FadeIn animation** — `template.tsx` applies smooth fadeIn on every route change

### Commits (49 total)
Key commits from this session:
```
803de10 perf: smoother page transitions with API cache and nav feedback
8a0dbaa feat: shimmer loading skeleton for page transitions
d350d20 perf: persistent layout - sidebar no longer remounts on navigation
542601a fix: replace bee emoji with Hexagon icon across dashboard
6ac26a2 feat: dark/light mode toggle
02c2778 feat: full seed with agents, tasks, and logs
1f584c4 feat: agent card shows role icon with role color
1fa01de feat: agent detail page with actions menu
2a07674 feat: add Teams page with full CRUD
d682d52 feat: implement issues #39-#43 - full CRUD, populated agents, roles UI
af92bfe feat: integrate dashboard with PostgreSQL database
```

### Architecture Decisions
- **No route groups** — Tried `(dashboard)/` route group for persistent layout but caused file conflicts. Simpler approach: `AppLayout` in root `layout.tsx` directly.
- **useApi with cache** — Lightweight global cache instead of adding SWR/React Query dependency. 10s TTL keeps data fresh.
- **template.tsx over layout animation** — `template.tsx` re-renders on every navigation (unlike `layout.tsx`), perfect for entry animations.

### Lessons Learned
- Sub-agents (sessions_spawn) can `write`/`edit` files on host but `exec` runs sandboxed — don't delegate file cleanup tasks
- Always `rm -rf .next` after major file structure changes in Next.js
- `git clean -fd` might miss files if they were created by tools with different permissions

### Issues Closed
- #39 — Database Integration Phase 2: Full CRUD ✅
- #40 — Database Integration Phase 3: Tasks & Logs ✅
- #41 — Roles Page Full CRUD with Database ✅
- #42 — Deploy Agent via Dashboard ✅
- #43 — API agents with populated role/team ✅

### Branch
All work on `dev` branch. Latest commit: `803de10`

---
*Journal maintained by Clawdia 🦞*

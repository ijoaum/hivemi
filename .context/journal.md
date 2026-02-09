# HiveMI Development Journal

## 2026-02-11 — Issue #58: Bootstrap Fase 1 — Cloud-init Template

### Summary
Upgraded the cloud-init template to support the new bootstrap script workflow. Instead of running OpenClaw install inline, the cloud-init now downloads and executes `hivemi-agent-bootstrap.sh` from a GitHub Release. The script handles all the heavy lifting (user setup, swap, OpenClaw, daemon). Template variables (`hostname`, `releaseUrl`, `ghToken`) are interpolated by the Provisioner before injecting as VM user-data.

### Done
- **CloudInitContext expanded** (`packages/bootstrapper/src/types.ts`):
  - `hostname?: string` — VM hostname (e.g. "hivemi-agent-atlas")
  - `releaseUrl?: string` — GitHub Release URL for downloading the bootstrap script
  - `ghToken?: string` — GitHub token for private repo access

- **Cloud-init template rewritten** (`packages/bootstrapper/src/phases/cloud-init.ts`):
  - Sets `hostname` via cloud-init `hostname:` directive + `hostnamectl set-hostname` in runcmd
  - Sets `manage_etc_hosts: true` for automatic /etc/hosts update
  - Three modes for runcmd:
    1. **Private repo** (releaseUrl + ghToken): Downloads `hivemi-agent-bootstrap.sh` with `Authorization: token` header, executes with both args
    2. **Public repo** (releaseUrl only): Downloads without auth, executes with releaseUrl arg
    3. **Legacy fallback** (no releaseUrl): Direct OpenClaw install via `curl | bash` — backward compatible
  - Bootstrap output logged to `/var/log/hivemi-bootstrap.log` via `tee`
  - Completion flag `/tmp/hivemi-cloud-init-done` always written last (all modes)
  - `final_message` includes hostname for identification

- **Deploy Orchestrator updated** (`apps/manager/src/lib/deploy-orchestrator.ts`):
  - Passes `hostname`, `releaseUrl`, and `ghToken` from cloud config to `generateCloudInit`
  - `IBootstrapperOps.generateCloudInit` interface typed with proper context fields (was `any`)

- **Manager routes proxy fixed** (`apps/manager/src/routes.ts`):
  - Replaced inline duplicate cloud-init template with lazy-loaded import of real `generateCloudInit` from `@hivemi/bootstrapper`
  - Minimal fallback only if import fails

- **15 new cloud-init tests** (was 4, now 15):
  - Basic structure: `#cloud-config` header, SSH key, openclaw user, required packages
  - Swap: enabled with custom size, disabled, default 2048MB
  - Hostname: custom hostname in config + runcmd, default hostname, in final_message
  - Bootstrap script: private repo (with auth), public repo (no auth), legacy fallback
  - Completion flag: written in all modes
  - Full integration: all variables combined in single template

### Key Decisions
- **Three modes, not just one** — the template supports private repo (auth), public repo (no auth), and legacy (no releaseUrl). This ensures backward compatibility and flexibility during development.
- **`hostnamectl` in runcmd AND `hostname:` directive** — cloud-init's `hostname:` sets it during cloud-init. `hostnamectl` in runcmd is belt-and-suspenders, ensuring systemd knows the hostname too. Some cloud providers override cloud-init's hostname module, so both methods maximize reliability.
- **Log to `/var/log/hivemi-bootstrap.log`** — bootstrap script output is tee'd to a log file for debugging. If cloud-init completes but the daemon doesn't register, this log tells us exactly what happened.
- **Replaced inline duplicate in manager routes** — the routes.ts had a full copy of the old cloud-init template. Replaced with a proper import from the bootstrapper package, eliminating the maintenance burden of keeping two copies in sync.
- **Completion flag after everything** — `/tmp/hivemi-cloud-init-done` is the last command in all modes. The Bootstrapper polls for this flag, so it must only appear after the bootstrap script finishes.

### Template Output (with all variables)
```yaml
#cloud-config
hostname: hivemi-agent-atlas
manage_etc_hosts: true

users:
  - name: openclaw
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - ${SSH_PUBLIC_KEY}

package_update: true
package_upgrade: true
packages: [curl, jq, git, htop, unzip]

swap:
  filename: /swapfile
  size: 2147483648

runcmd:
  - hostnamectl set-hostname "hivemi-agent-atlas"
  - |
    export RELEASE_URL="${RELEASE_URL}"
    export GH_TOKEN="${GH_TOKEN}"
    curl -fsSL -H "Authorization: token $GH_TOKEN" -H "Accept: application/octet-stream" \
      -o /tmp/hivemi-agent-bootstrap.sh "$RELEASE_URL/hivemi-agent-bootstrap.sh"
    chmod +x /tmp/hivemi-agent-bootstrap.sh
    /tmp/hivemi-agent-bootstrap.sh "$RELEASE_URL" "$GH_TOKEN" 2>&1 | tee /var/log/hivemi-bootstrap.log
  - touch /tmp/hivemi-cloud-init-done
  - chown openclaw:openclaw /tmp/hivemi-cloud-init-done

final_message: "HiveMI cloud-init complete for hivemi-agent-atlas after $UPTIME seconds"
```

### Files Changed
| File | Change |
|------|--------|
| `packages/bootstrapper/src/types.ts` | +hostname, +releaseUrl, +ghToken in CloudInitContext |
| `packages/bootstrapper/src/phases/cloud-init.ts` | Rewritten: bootstrap script download + execution + 3 modes |
| `packages/bootstrapper/src/__tests__/bootstrapper.test.ts` | 15 cloud-init tests (was 4) |
| `apps/manager/src/lib/deploy-orchestrator.ts` | Pass hostname/releaseUrl/ghToken, typed interface |
| `apps/manager/src/routes.ts` | Replace inline template with bootstrapper import |

### Commits
- `8196677` — feat(bootstrapper): cloud-init template with bootstrap script support (#58)

### Next
- #66 (Bootstrap Script) — the `hivemi-agent-bootstrap.sh` that cloud-init downloads and runs
- #65 (Release Pipeline) — where the bootstrap script is published
- #44 (Provisioner) — uses cloud-init template via `spec.userData`

---

## 2026-02-11 — Issue #57: Protocol — Batch Log Shipping

### Summary
Implemented the batch log shipping protocol: daemons accumulate warn/error/lifecycle logs locally and ship them to the Registry in a single `POST /api/logs` request every 5 minutes. Debug and info logs stay local in journalctl. The Registry endpoint validates with Zod, batch-inserts all entries, and the GET endpoint now supports filtering by agentId, level, and time range. Dashboard updated with lifecycle log level support and per-agent filtering.

### Done
- **Protocol schemas** (`packages/protocol/src/types.ts`):
  - `ShippableLogLevelSchema` — enum: `warn | error | lifecycle` (debug/info excluded from shipping)
  - `LogBatchEntrySchema` — validates individual log entry (level, message, timestamp, optional metadata with taskId/component)
  - `SubmitLogBatchSchema` — validates batch payload: `{ agentId: UUID, entries: LogBatchEntry[] }` (min 1, max 500 entries)
  - Message max length: 10,000 chars; component max: 50 chars; metadata passthrough for extensibility

- **Registry batch endpoint** (`apps/registry/src/routes/logs.ts`):
  - `POST /api/logs` — accepts `{ agentId, entries[] }` batch format
  - Zod validation rejects debug/info levels at the protocol boundary
  - Verifies agent exists (404 if not), uses agent name as log source
  - Batch insert (single SQL statement) for all entries
  - Returns `{ received: N }` count
  - `GET /api/logs` — enhanced with filters: `?agentId=`, `?level=warn,error`, `?from=&to=`, `?limit=` (max 1000)
  - Comma-separated level filter support (`?level=warn,error`)
  - Replaced inline log handlers in `routes.ts` with modular route file

- **Daemon log shipping** (`packages/agent-daemon/src/registry-client.ts`):
  - `sendLogs()` now sends single POST with `{ agentId, entries[] }` batch format
  - Filters out debug/info entries before shipping — only warn/error/lifecycle are sent
  - Builds metadata object from taskId + component + extra metadata
  - Throws on failure (caller handles retry via log buffer)

- **Dashboard updates**:
  - `LogLevel` type now includes `lifecycle`
  - `logsApi.list()` supports `agentId`, `level`, `from`, `to` query params
  - Logs page: new lifecycle stat card (green) + lifecycle level config
  - Agent filter dropdown showing agent IDs (truncated to 8 chars)
  - Dashboard proxy routes forward POST to registry
  - Grid layout updated to 5 columns for the new stat card

- **49 new tests** — all passing:
  - 29 protocol tests (`packages/protocol/src/__tests__/log-batch.test.ts`):
    - ShippableLogLevelSchema: accepts warn/error/lifecycle, rejects debug/info/unknown
    - LogBatchEntrySchema: full entry, minimal, lifecycle, empty message, missing timestamp, invalid timestamp, debug rejected, info rejected, passthrough metadata, invalid taskId UUID, component > 50 chars, message limits (10000 ok, 10001 rejected)
    - SubmitLogBatchSchema: valid batch, multiple entries, empty entries, missing agentId, invalid agentId, > 500 entries, exactly 500, exact Issue #57 payload, info/debug rejection
  - 20 registry tests (`apps/registry/src/__tests__/log-batch.test.ts`):
    - POST: valid batch (201), correct row data, unknown agent (404), missing agentId (400), empty entries (400), debug (400), info (400), invalid timestamp (400), empty message (400), DB failure (500), metadata without taskId/component, entries without metadata, validation details on 400
    - GET: default limit, custom limit, cap at 1000, agentId filter, level filter, comma-separated levels, from/to range

### Key Decisions
- **Batch over one-by-one** — the old `sendLogs()` sent one HTTP request per log entry. The new approach sends all entries in a single POST, reducing network overhead from N requests to 1.
- **Level filtering at daemon AND registry** — the daemon filters before sending (saves bandwidth), the registry validates with Zod (defense in depth). Even if a daemon has a bug, debug/info entries can't reach the DB.
- **Max 500 entries per batch** — prevents abuse/memory issues. At 5-minute intervals with only warn/error/lifecycle, 500 is more than enough for normal operation.
- **Modular route file** — replaced inline `app.get`/`app.post` in `routes.ts` with `routes/logs.ts` for consistency with other route modules (telemetry, heartbeat, tasks, etc.).
- **Passthrough metadata** — `LogBatchEntrySchema.metadata` uses `.passthrough()` so daemons can include extra context fields beyond taskId/component without breaking validation.
- **GET filters are AND-combined** — multiple query params narrow results. Comma-separated levels use `inArray` (OR within level filter, AND with other filters).

### Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/logs` | Batch log submission from daemon |
| GET | `/api/logs` | Query logs with filters (agentId, level, from, to, limit) |

### Payload (Issue #57 spec)
```json
{
  "agentId": "uuid",
  "entries": [
    {
      "level": "warn | error | lifecycle",
      "message": "Task xyz failed: timeout",
      "timestamp": "ISO 8601",
      "metadata": {
        "taskId": "uuid",
        "component": "task-executor"
      }
    }
  ]
}
```

### Files Changed
| File | Change |
|------|--------|
| `packages/protocol/src/types.ts` | +ShippableLogLevelSchema, +LogBatchEntrySchema, +SubmitLogBatchSchema |
| `packages/protocol/src/__tests__/log-batch.test.ts` | NEW — 29 tests |
| `apps/registry/src/routes/logs.ts` | NEW — batch POST + filtered GET |
| `apps/registry/src/routes.ts` | Replace inline log handlers with route module |
| `apps/registry/src/__tests__/log-batch.test.ts` | NEW — 20 tests |
| `packages/agent-daemon/src/registry-client.ts` | sendLogs() → batch format + level filter |
| `apps/dashboard/src/types/log.ts` | +lifecycle level, +component field |
| `apps/dashboard/src/lib/api.ts` | logsApi.list() with filter params |
| `apps/dashboard/src/app/api/logs/route.ts` | +POST proxy to registry |
| `apps/dashboard/src/app/logs/page.tsx` | +lifecycle stat, +agent filter |

### Commits
- `3a98903` — feat(protocol): add SubmitLogBatchSchema for batch log shipping (#57)
- `e6946f4` — feat(registry): batch log endpoint with filters and validation (#57)
- `573fcbe` — feat(agent-daemon): batch log shipping with level filtering (#57)
- `afea352` — feat(dashboard): lifecycle log level and agent filtering (#57)

### Next
- #58 (Protocol: Error Reporting) — structured error reports with context
- #50 (Dashboard) — more UI enhancements for agent metrics and status
- #68 (Task Progress) — real-time progress tracking during task execution

---

## 2026-02-11 — Issue #56: Protocol — P2P Agent-to-Agent Communication

### Summary
Implemented the P2P communication protocol for direct agent-to-agent messaging. While the primary communication path remains the task queue (#55), P2P enables low-latency interactions for advanced scenarios: synchronous code review, brainstorming, collaborative problem-solving, and direct liveness checks between agents.

### Status
This issue was marked as **deprioritized** — the task queue handles most inter-agent communication. This implementation provides the foundational protocol, discovery mechanism, client/handler, and retry logic so P2P is ready when advanced scenarios are needed.

### Done
- **Expanded P2P Protocol Types** (`packages/protocol/src/types.ts`):
  - `P2PMessageTypeSchema` — five message types: request, response, delegate, ping, pong
  - `P2PMessageSchema` — full envelope with id, type, from, to, payload, timestamp, correlationId, ttlMs
  - `P2PRequestPayloadSchema` — synchronous request (action + content + optional taskId/metadata)
  - `P2PResponsePayloadSchema` — reply to request (success + content/error + metadata)
  - `P2PDelegatePayloadSchema` — fire-and-forget delegation (action + content + priority)
  - `P2PPingPayloadSchema` / `P2PPongPayloadSchema` — liveness probes with status/uptime
  - `P2PMessageAckSchema` — delivery acknowledgment with optional inline response
  - `AgentEndpointSchema` — discovery response (host, port, status, privateIp)
  - `P2PRetryConfigSchema` — exponential backoff config (defaults: 3 retries, 1s→3s→9s)
  - Legacy `MessageTypeSchema` alias maintained for backward compat

- **Registry Discovery Endpoints** (`apps/registry/src/routes/discovery.ts`):
  - `GET /api/agents/:id/endpoint` — resolve single agent's network endpoint for P2P
  - `GET /api/agents/endpoints` — list all agent endpoints with filters (?status, ?roleId, ?teamId)
  - Returns host, port, status, privateIp (callers on same VPC should prefer privateIp)
  - Returns status info even for offline agents — caller decides whether to attempt communication

- **P2P Client** (`packages/agent-daemon/src/p2p-client.ts`):
  - `discover(agentId)` — resolves endpoint via registry, cached for 60s
  - `send(targetId, type, payload, options)` — full send with discovery + retry
  - `request()` — convenience for synchronous request-response
  - `delegate()` — convenience for fire-and-forget delegation
  - `ping()` — convenience for liveness check (fast timeout, 1 retry)
  - Retry with exponential backoff: 1s → 3s → 9s (configurable)
  - Non-retryable errors (400, 404) fail immediately
  - Cache cleared on delivery failure (endpoint may have changed)
  - `P2PError` with typed error codes: AGENT_NOT_FOUND, DISCOVERY_FAILED, MESSAGE_REJECTED, TIMEOUT, DELIVERY_FAILED
  - Prefers privateIp over public host for same-VPC communication

- **P2P Message Handler** (`packages/agent-daemon/src/p2p-handler.ts`):
  - HTTP server on daemon port for incoming P2P messages
  - `POST /message` — accepts P2P messages, validates, dispatches by type
  - `GET /health` — health check endpoint
  - Validates: required fields (id, type, from, to), addressing (must be for this agent), TTL expiration
  - Ping → immediate inline pong response (no callback needed)
  - Request → calls callback, wraps result as inline response
  - Response → resolves pending request via correlationId
  - Delegate → calls callback, returns ack
  - `waitForResponse(correlationId, timeout)` — for request-response correlation
  - Configurable max body size (default: 1MB)

- **Dashboard Proxy Routes**:
  - `GET /api/agents/:id/endpoint` → Registry
  - `GET /api/agents/endpoints` → Registry

- **82 new tests** — all passing:
  - 47 protocol tests (`packages/protocol/src/__tests__/p2p.test.ts`):
    - P2PMessageTypeSchema: valid types, invalid types, legacy alias
    - P2PMessageSchema: full message, correlationId, ttlMs, invalid UUIDs, missing type, negative ttlMs, unknown payloads, null payload
    - P2PRequestPayloadSchema: full, minimal, empty action, action > 100 chars, missing content
    - P2PResponsePayloadSchema: success, error, minimal, missing success
    - P2PDelegatePayloadSchema: full, minimal, empty action
    - P2PPingPayloadSchema: with status, empty, invalid status
    - P2PPongPayloadSchema: full, without uptimeMs, missing status, negative uptimeMs
    - P2PMessageAckSchema: accepted, rejected, with inline response, missing accepted
    - AgentEndpointSchema: full, without privateIp, null privateIp, all status values, invalid port
    - P2PRetryConfigSchema: defaults, custom, max retries, multiplier, initial delay, backoff sequence
  - 35 daemon tests (`packages/agent-daemon/src/__tests__/p2p.test.ts`):
    - P2PClient discovery: fetch, cache, 404, server error, cache invalidation
    - P2PClient send: discover + send, correlationId/ttlMs, retry on server error, exhausted retries, non-retryable 400, cache cleared on failure
    - P2PClient convenience: request(), delegate(), ping()
    - P2PError: code, instanceof, all codes
    - P2PHandler: health check, request/delegate acceptance, ping/pong, inline response, validation (fields, empty, invalid JSON, wrong agent, expired TTL, valid TTL), 404 routes, response correlation, timeout, callback error, clean stop

### Key Decisions
- **Deprioritized but complete** — implemented the full protocol spec from the issue's "original scope" so it's ready for future use. The task queue remains the primary communication path.
- **Message types simplified** — replaced the old task-oriented types (task:assign, task:progress, etc.) with P2P-specific types (request, response, delegate, ping, pong). Task communication goes through the queue.
- **Discovery via registry** — agents don't know each other's IPs directly. The registry acts as a service directory. Results are cached 60s to avoid hammering the registry.
- **Prefer privateIp** — on the same VPC, agents should communicate via private IPs for lower latency and no egress costs. The client automatically prefers privateIp when available.
- **Inline responses** — for ping/pong and simple requests, the response is included directly in the HTTP response (no need for a separate callback). Complex async work still goes through the task queue.
- **TTL support** — messages can include a TTL; the receiver discards expired messages. Useful for time-sensitive requests.
- **Correlation IDs** — request/response pairs are linked via correlationId. The handler has `waitForResponse()` for async correlation.

### Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents/:id/endpoint` | Discover agent network endpoint |
| GET | `/api/agents/endpoints` | List all agent endpoints (filterable) |
| POST | `http://<agent>:<port>/message` | Send P2P message to agent daemon |
| GET | `http://<agent>:<port>/health` | Agent daemon health check |

### Files Changed
| File | Change |
|------|--------|
| `packages/protocol/src/types.ts` | Expanded P2P types: 10 new schemas |
| `packages/protocol/src/__tests__/p2p.test.ts` | NEW — 47 tests |
| `apps/registry/src/routes/discovery.ts` | NEW — discovery endpoints |
| `apps/registry/src/routes.ts` | Mount discovery routes |
| `packages/agent-daemon/src/p2p-client.ts` | NEW — P2P client with discovery + retry |
| `packages/agent-daemon/src/p2p-handler.ts` | NEW — P2P message HTTP server |
| `packages/agent-daemon/src/index.ts` | Export P2P modules |
| `packages/agent-daemon/src/__tests__/p2p.test.ts` | NEW — 35 tests |
| `apps/dashboard/src/app/api/agents/[id]/endpoint/route.ts` | NEW — proxy |
| `apps/dashboard/src/app/api/agents/endpoints/route.ts` | NEW — proxy |

### Commits
- `4bbd1f4` — feat(protocol): P2P agent-to-agent communication protocol (#56)

### Next
- #64 (Daemon ↔ OpenClaw integration) — deeper integration, tool results, streaming
- #50 (Dashboard) — UI for agent status and communication
- Future: integrate P2P into daemon lifecycle (start handler on boot, use for brainstorming sessions)

---

## 2026-02-10 — Issue #55: Protocol — Task Queue with Lock (Pull Model)

### Summary
Implemented the pull-model task queue using PostgreSQL's `SELECT FOR UPDATE SKIP LOCKED` for atomic, race-free task claiming. Agents poll `GET /api/tasks/next?role=<roleId>`, and the registry atomically finds the highest-priority queued task, locks it, and returns it — all in a single SQL statement. No two agents can ever grab the same task.

### Done
- **Atomic task claim** (`apps/registry/src/routes/tasks.ts`):
  - `GET /api/tasks/next?role=<roleId>&agentId=<agentId>` — core pull-model endpoint
  - Uses CTE with `SELECT ... FOR UPDATE SKIP LOCKED` + immediate `UPDATE` in same statement
  - Priority ordering: `CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 END DESC`
  - FIFO within same priority: `ORDER BY created_at ASC`
  - Role matching: `WHERE role_target = <roleId> OR role_target IS NULL`
  - Sets `status = locked`, `locked_by`, `locked_at`, `started_at`, `agent_id` atomically
  - Returns 204 No Content when no tasks available
  - Validates role and agent existence before attempting claim

- **Structured task completion** (`PUT /api/tasks/:id/complete`):
  - Validates task is in `locked` status (409 if not)
  - Accepts: `status` (completed/failed), `output`, `error`, `artifacts`, `subtasks`, `duration`, `tokensUsed`
  - Clears lock fields (`lockedBy`, `lockedAt`) on completion
  - Auto-creates subtasks with `parentTaskId` set — enables task trees
  - Updates agent status back to `idle` and clears `currentTaskId`

- **Subtask creation** (`POST /api/tasks/:id/subtasks`):
  - Creates subtask linked to parent via `parentTaskId`
  - Inherits `teamId` from parent task
  - Validates `roleTarget` exists if provided
  - Born with `status = queued` — immediately available for claiming

- **Lock timeout job** (`apps/registry/src/lib/lock-timeout.ts`):
  - Runs every 60s (configurable via `LOCK_CHECK_INTERVAL_MS`)
  - Default lock timeout: 10 minutes (configurable via `LOCK_TIMEOUT_MS`)
  - Checks each stale locked task:
    - Agent offline/unreachable/destroyed → release task back to `queued`
    - Agent still alive (idle/working/error) → keep locked (task may be heavy)
    - Agent doesn't exist → release
    - No `lockedBy` → release
  - Releases by setting `status = queued`, clearing `lockedBy/lockedAt/startedAt/agentId`
  - Started automatically when registry server boots

- **Protocol schemas** (`packages/protocol/src/types.ts`):
  - `CompleteTaskSchema` — validates completion payload with artifacts, subtasks, duration, tokensUsed
  - `CreateSubtaskSchema` — validates subtask creation with title, description, roleTarget, priority, input

- **Daemon update** (`packages/agent-daemon/src/registry-client.ts`):
  - `reportTaskResult()` now uses `PUT /api/tasks/:id/complete` first
  - Falls back to old `PUT /api/tasks/:id` if complete endpoint returns 404
  - Sends `duration` (elapsed ms) instead of separate `elapsedMs` field

- **Existing endpoints updated** (`apps/registry/src/routes.ts`):
  - `POST /api/tasks/:id/retry` — now clears `lockedBy`, `lockedAt`, `agentId`
  - `POST /api/tasks/:id/cancel` — now clears `lockedBy`, `lockedAt`

- **Dashboard proxy routes**:
  - `GET /api/tasks/next` → Registry
  - `PUT /api/tasks/:id/complete` → Registry
  - `POST /api/tasks/:id/subtasks` → Registry

- **39 new tests** (`apps/registry/src/__tests__/task-queue.test.ts`):
  - CompleteTaskSchema: full payload, minimal, failure, invalid status, missing status, negative duration, negative tokens, multiple artifacts, multiple subtasks
  - CreateSubtaskSchema: full, minimal, empty title, long title, invalid UUID, null roleTarget
  - Lock timeout logic: dead statuses, alive statuses, default timeout, cutoff calculation, release payload, null lockedBy, missing agent
  - Priority ordering: valid values, invalid values
  - Task completion flow: PM→subtasks, Dev→PR artifact, failure with error
  - Role matching: matching role, null role (any), different role
  - Subtask tree: teamId inheritance, born queued

### Key Decisions
- **Single SQL statement for claim** — the CTE `WITH next_task AS (SELECT ... FOR UPDATE SKIP LOCKED) UPDATE tasks ... FROM next_task` approach ensures the SELECT and UPDATE happen in a single round-trip. No gap between finding and locking the task.
- **Agent-aware lock timeout** — unlike a simple "release after X minutes", we check if the agent is still alive. A working agent with a heavy 30-minute task shouldn't have its lock stolen. Only dead agents (offline/unreachable/destroyed) lose their locks.
- **Subtask creation in completion** — agents can create subtasks atomically as part of completing their own task. This enables the PM→Dev→QA workflow naturally.
- **204 for empty queue** — returns no body when no tasks match. The daemon already handles this correctly.
- **Role validation on claim** — validates that the roleId and agentId exist before running the lock query. Prevents orphaned locks from invalid IDs.

### SQL: The Atomic Lock
```sql
WITH next_task AS (
  SELECT id FROM tasks
  WHERE status = 'queued'
    AND (role_target = $1 OR role_target IS NULL)
  ORDER BY
    CASE priority
      WHEN 'high' THEN 3
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 1
    END DESC,
    created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE tasks
SET status = 'locked', locked_by = $2, locked_at = NOW(), started_at = NOW(), agent_id = $2
FROM next_task
WHERE tasks.id = next_task.id
RETURNING tasks.*
```

### Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tasks/next?role=&agentId=` | Atomic task claim (pull model) |
| PUT | `/api/tasks/:id/complete` | Report task result |
| POST | `/api/tasks/:id/subtasks` | Create subtask |

### Files Changed
| File | Change |
|------|--------|
| `apps/registry/src/routes/tasks.ts` | NEW — task queue endpoints |
| `apps/registry/src/lib/lock-timeout.ts` | NEW — stale lock release job |
| `apps/registry/src/index.ts` | Start lock timeout job on boot |
| `apps/registry/src/routes.ts` | Mount task queue, clear locks on retry/cancel |
| `apps/registry/src/__tests__/task-queue.test.ts` | NEW — 39 tests |
| `packages/protocol/src/types.ts` | +CompleteTaskSchema, +CreateSubtaskSchema |
| `packages/agent-daemon/src/registry-client.ts` | Use /complete endpoint with fallback |
| `apps/dashboard/src/app/api/tasks/next/route.ts` | NEW — proxy |
| `apps/dashboard/src/app/api/tasks/[id]/complete/route.ts` | NEW — proxy |
| `apps/dashboard/src/app/api/tasks/[id]/subtasks/route.ts` | NEW — proxy |

### Commits
- `9c6b58b` — feat(registry): task queue with SELECT FOR UPDATE SKIP LOCKED (#55)

### Next
- #50 (Dashboard) — UI for task queue (task tree view, real-time status)
- #72 (Task Cancellation) — cancel running/locked tasks via agent notification
- #68 (Task Progress) — real-time progress tracking during task execution

---

## 2026-02-10 — Issue #54: Protocol — Agent Telemetry

### Summary
Refined and completed the agent telemetry protocol. The base endpoints and daemon collector existed from Issue #48, but this issue formalized the protocol spec: added `ts` field for daemon-provided timestamps, aligned `loadAvg` to send a single number (1-min average) per the spec, added Zod validation constraints, and implemented three-tier data retention.

### Done
- **Protocol types** (`packages/protocol/src/types.ts`):
  - Added `ts` (ISO 8601 datetime, optional) to `SubmitTelemetrySchema` — daemon sends its own timestamp
  - Updated `TelemetryInfraSchema.loadAvg` to accept `z.union([z.number(), z.array(z.number())])` — single number per spec, array for backward compat
  - Added validation constraints: `cpu` 0-100, `memUsed`/`memTotal`/`diskUsed`/`diskTotal` non-negative integers, LLM counters non-negative, `uptime` non-negative
  - Added JSDoc comments documenting the protocol

- **Registry telemetry routes** (`apps/registry/src/routes/telemetry.ts`):
  - POST now uses daemon-provided `ts` as record timestamp when present, falls back to server time
  - Three-tier retention in cleanup endpoint:
    1. Last 24h: granular (every 60s)
    2. 24h → 7d: aggregate to 1 record per hour
    3. 7d → 30d: aggregate to 1 record per day
    4. >30d: delete
  - Response now includes `deletedHourlyAggregated` and `deletedDailyAggregated` counts

- **Daemon telemetry** (`packages/agent-daemon/src/telemetry.ts`):
  - `buildSnapshot()` now includes `ts` field (ISO 8601 from daemon clock)
  - `collectInfra()` sends `loadAvg` as single number (1-min average) instead of array
  - Updated `TelemetrySnapshot` type in `types.ts` to match

- **DB schema** (`apps/registry/src/db/schema.ts`):
  - Updated `TelemetryInfra.loadAvg` type to `number | number[]` for backward compat

- **27 new tests** (`apps/registry/src/__tests__/telemetry.test.ts`):
  - POST: full payload, no ts, partial payload, empty payload, array loadAvg, 404, validation errors, ts format, heartbeat update, single loadAvg
  - GET: latest, null when empty, 404, limit param
  - GET history: default range, from/to, limit, limit cap, 404, invalid date
  - Cleanup: results reporting, no records, three-tier stages
  - Protocol compliance: exact Issue #54 payload, cpu range, negative memory, negative LLM counters

- **Daemon tests updated**: snapshot test now checks for `ts` field and single number `loadAvg`

### Key Decisions
- **`ts` is optional** — server falls back to `new Date()` if the daemon doesn't provide it. This ensures backward compat with daemons that haven't been updated.
- **`loadAvg` union type** — protocol spec says single number (0.75), but we accept arrays too. The daemon sends the 1-minute average as a single number. The schema `z.union([z.number(), z.array(z.number())])` handles both.
- **30-day retention** — extended from 7d to 30d. Data beyond 24h is aggregated to hourly, beyond 7d to daily, beyond 30d is deleted. This gives good historical visibility without unbounded storage growth.
- **Validation constraints** — added `.min(0)`, `.max(100)` etc. to prevent obviously invalid data from being stored. Better to reject bad data at the API boundary.

### Endpoints (unchanged from #48, refined)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/agents/:id/telemetry` | Daemon submits metrics (every 60s) |
| GET | `/api/agents/:id/telemetry` | Latest metrics (supports `?limit=N`) |
| GET | `/api/agents/:id/telemetry/history` | Historical with `?from=&to=&limit=` |
| POST | `/api/telemetry/cleanup` | Three-tier retention cleanup |

### Files Changed
| File | Change |
|------|--------|
| `packages/protocol/src/types.ts` | +ts field, +validation constraints, +union loadAvg |
| `apps/registry/src/routes/telemetry.ts` | Use ts, three-tier retention |
| `apps/registry/src/db/schema.ts` | TelemetryInfra.loadAvg type update |
| `apps/registry/src/__tests__/telemetry.test.ts` | NEW — 27 tests |
| `packages/agent-daemon/src/types.ts` | TelemetrySnapshot +ts, loadAvg: number |
| `packages/agent-daemon/src/telemetry.ts` | Send ts + single loadAvg |
| `packages/agent-daemon/src/__tests__/agent-daemon.test.ts` | Updated snapshot assertions |

### Commits
- `c0d5581` — feat(protocol): agent telemetry protocol with ts field, retention tiers, and validation

### Next
- #55 (Task Queue) — server-side `SELECT FOR UPDATE SKIP LOCKED` for atomic task claiming
- #50 (Dashboard) — UI for agent telemetry (charts, metrics display)

---

## 2026-02-10 — Issue #53: Protocol — Heartbeat & Offline Detection

### Summary
Implemented the heartbeat protocol between daemon and registry, plus an offline detection job that automatically marks agents as offline/unreachable when heartbeats stop.

### Done
- **HeartbeatPayloadSchema** (`packages/protocol/src/types.ts`):
  - `status` — "idle" | "working" | "error"
  - `currentTaskId` — UUID or null
  - `timestamp` — ISO 8601 datetime
  - `HeartbeatResponseSchema` — `{ ack: boolean }`

- **Heartbeat Route** (`apps/registry/src/routes/heartbeat.ts`):
  - `POST /api/agents/:id/heartbeat` — validates payload with Zod
  - Updates agent's `lastHeartbeat`, `status`, and `currentTaskId`
  - Returns `{ ack: true }` on 200
  - Returns 404 when agent not found (daemon should re-register)
  - Replaces the old inline heartbeat handler (which just set status to "idle")

- **Offline Detection Job** (`apps/registry/src/lib/offline-detection.ts`):
  - Runs every 30 seconds via `setInterval`
  - Phase 1: Agents >5min without heartbeat → "unreachable" (runs first to avoid re-marking)
  - Phase 2: Agents >90s without heartbeat → "offline"
  - Excludes agents in "provisioning", "destroyed" statuses
  - Agents are NOT deleted — remain in registry for Dashboard visibility
  - Auto-recovery: when heartbeat resumes, the heartbeat endpoint sets the agent's status back
  - Started automatically when registry server boots (`index.ts`)

- **Daemon Heartbeat Update** (`packages/agent-daemon/src/registry-client.ts`):
  - `heartbeat()` now sends `{ status, currentTaskId, timestamp }` payload
  - Returns `boolean`: `true` = ack, `false` = 404 (need re-register)
  - Server errors return `true` (don't trigger unnecessary re-registration)

- **Daemon 404 Recovery** (`packages/agent-daemon/src/index.ts`):
  - Heartbeat loop checks return value
  - On `false` (404): automatically calls `register()` to re-announce
  - Logs lifecycle events for re-registration attempts
  - Sends current task status in every heartbeat (idle vs working + task ID)

- **23 new tests** (15 heartbeat endpoint + 8 offline detection), all passing
  - Heartbeat: valid payloads, validation errors, 404 handling, status updates
  - Offline detection: stale marking, logging, DB error handling, lifecycle
  - Daemon: heartbeat with payload, 404 re-register, server error handling

- **Updated 3 daemon tests** to match new heartbeat signature

### Key Decisions
- **Status-aware heartbeat** — the old endpoint blindly set status to "idle". The new one accepts the daemon's actual status (idle/working/error) so the registry always reflects reality.
- **Unreachable before offline** — the detection job checks 5min threshold first, then 90s. This prevents agents that should be "unreachable" from being re-marked as "offline" on the next cycle.
- **404 = re-register** — if an agent is removed from the registry (manual deletion, data loss), the daemon detects this via 404 and re-announces itself automatically.
- **Server errors don't trigger re-register** — a 500 from the registry doesn't mean the agent was removed, so we return `true` to avoid unnecessary re-registration spam.
- **Separate route file** — heartbeat route is in its own file (`routes/heartbeat.ts`) for maintainability, mounted alongside the agent registration route.

### Files Changed
| File | Change |
|------|--------|
| `packages/protocol/src/types.ts` | +HeartbeatPayloadSchema, +HeartbeatResponseSchema |
| `apps/registry/src/routes/heartbeat.ts` | NEW — heartbeat endpoint |
| `apps/registry/src/lib/offline-detection.ts` | NEW — offline detection job |
| `apps/registry/src/routes.ts` | Mount heartbeat route, remove old inline handler |
| `apps/registry/src/index.ts` | Start offline detection on boot |
| `apps/registry/src/__tests__/heartbeat.test.ts` | NEW — 15 tests |
| `apps/registry/src/__tests__/offline-detection.test.ts` | NEW — 8 tests |
| `packages/agent-daemon/src/types.ts` | Updated IRegistryClient.heartbeat signature |
| `packages/agent-daemon/src/registry-client.ts` | Heartbeat with payload + 404 handling |
| `packages/agent-daemon/src/index.ts` | Heartbeat loop with re-registration on 404 |
| `packages/agent-daemon/src/__tests__/agent-daemon.test.ts` | Updated heartbeat tests |

### Commits
- `d4295d9` — feat(protocol): heartbeat payload schema and offline detection

### Next
- #55 (Task Queue) — server-side `SELECT FOR UPDATE SKIP LOCKED` for atomic task claiming
- #50 (Dashboard) — UI for agent status (show offline/unreachable indicators)

---

## 2026-02-10 — Issue #52: Protocol — Agent Registration in Registry

### Summary
Implemented the agent registration protocol: a single `POST /api/agents` endpoint that handles upsert (create or update). When an agent daemon boots, it announces itself with identity, role/team binding, capabilities, and cloud info. If the agent ID already exists (redeploy), the record is updated instead of duplicated.

### Done
- **RegisterAgentSchema** (`packages/protocol/src/types.ts`):
  - Full Zod schema for daemon registration payload
  - Fields: `id` (UUID), `name`, `roleId`, `teamId`, `model`, `host`, `port`, `version`, `openclawVersion`, `cloud` (provider/region/instanceId), `capabilities` (string[])
  - `version`, `openclawVersion`, `cloud` are optional; `capabilities` defaults to `[]`

- **Agent Registration Route** (`apps/registry/src/routes/agents.ts`):
  - `POST /api/agents` — upsert with Zod validation
  - Validates `roleId` exists in `roles` table (400 if not)
  - Validates `teamId` exists in `teams` table (400 if not)
  - Checks if agent with given `id` already exists:
    - Exists → UPDATE (status=idle, lastHeartbeat=now) → returns 200
    - New → INSERT → returns 201
  - Detailed validation error response with field-level errors

- **Daemon Registry Client Update** (`packages/agent-daemon/src/registry-client.ts`):
  - Simplified `register()` from PUT-then-POST fallback to single POST upsert
  - Cleaner error handling, status-aware logging (created vs updated)

- **17 unit tests** (`apps/registry/src/__tests__/agent-registration.test.ts`):
  - Validation: missing fields, invalid UUID, port out of range, empty name, missing model
  - Role/team validation: 400 when roleId or teamId doesn't exist
  - Create flow: new agent → 201, minimal payload → 201
  - Update flow: existing agent → 200, insert not called
  - Schema unit tests: full payload, defaults, missing id, invalid cloud, optional fields, length limits

- **Daemon test update** — updated RegistryClient tests to match new single-POST behavior

### Key Decisions
- **Single POST for upsert** — the daemon sends one POST with its full identity. The registry checks existence by ID and decides create vs update. Simpler than the old PUT-then-POST-on-404 pattern.
- **Role/team validation before insert** — prevents orphaned agents with invalid foreign keys. Returns 400 with clear message instead of a 500 from a DB constraint violation.
- **Modular route file** — `routes/agents.ts` mounted on `/api/agents` in main routes, keeping the codebase organized as routes grow.
- **Status set to "idle" on registration** — both create and update set the agent to idle, since registration means the daemon is alive and ready for tasks.

### Files Changed
| File | Change |
|------|--------|
| `packages/protocol/src/types.ts` | +RegisterAgentSchema |
| `apps/registry/src/routes/agents.ts` | NEW — registration route |
| `apps/registry/src/routes.ts` | Mount agent registration, remove old POST handler |
| `apps/registry/src/__tests__/agent-registration.test.ts` | NEW — 17 tests |
| `apps/registry/vitest.config.ts` | NEW — vitest config |
| `apps/registry/package.json` | +vitest dev dep, +test scripts |
| `apps/registry/tsconfig.json` | Exclude __tests__ from build |
| `packages/agent-daemon/src/registry-client.ts` | Simplified register() |
| `packages/agent-daemon/src/__tests__/agent-daemon.test.ts` | Updated registration tests |
| `packages/protocol/tsconfig.json` | Exclude __tests__ from build |

### Commits
- `627166c` — feat(registry): agent registration endpoint with upsert and validation

### Next
- #55 (Task Queue) — server-side `SELECT FOR UPDATE SKIP LOCKED` for atomic task claiming
- #50 (Dashboard) — UI for agent management and deploy progress

---

## 2026-02-09 — Issue #49: Deploy Orchestrator — Full Deploy Flow via Manager

### Summary
Implemented the Deploy Orchestrator in the Manager — the central coordinator for the full deploy lifecycle (provision → bootstrap → register) and task queue creation. Includes SSE streaming, phase retry, undeploy/redeploy, and comprehensive tests.

### Done
- **DeployOrchestrator class** (`apps/manager/src/lib/deploy-orchestrator.ts`):
  - Full deploy sequence: create agent → create deploy record → provision VM → bootstrap (secrets, OpenClaw, role config, daemon) → wait for registration → mark ready
  - Phase tracking with timeouts: provisioning (2m), installing (10m), configuring (5m), registering (2m)
  - `startDeploy()` — returns immediately with deployId/agentId, runs pipeline async
  - `undeploy()` — destroys VM, updates agent/deploy status to destroyed
  - `redeploy()` — undeploy + startDeploy in sequence
  - `retryPhase()` — retries a failed deploy from a specific phase (resets failed + subsequent phases)
  - Event emission via EventEmitter for SSE streaming
  - Bootstrapper phase mapping: cloud-init → installing, ssh-connect → installing, inject-secrets/configure-openclaw/copy-role-config/install-daemon → configuring, wait-registration → registering
  - In-memory active deploy state for real-time queries

- **Enhanced RegistryClient** (`apps/manager/src/lib/registry-client.ts`):
  - Full CRUD for agents, tasks, deploys, roles, teams
  - Cloud config fetch with internal endpoint (decrypted secrets)
  - Deploy operations: create, update, get, list
  - Task operations: create, get, list with roleTarget/status/teamId/limit filters

- **Manager Routes** (`apps/manager/src/routes.ts`):
  - `GET /api/deploy` — list all deploys (enriched with live state for active deploys)
  - `POST /api/deploy` — start new deploy
  - `GET /api/deploy/:id` — get deploy status (live or from registry)
  - `DELETE /api/deploy/:id` — undeploy
  - `POST /api/deploy/:id/redeploy` — destroy and recreate
  - `POST /api/deploy/:id/retry` — retry failed deploy from a phase
  - `GET /api/deploy/:id/stream` — SSE event stream with heartbeat
  - Lazy orchestrator initialization with provisioner/bootstrapper proxies

- **Task Routes** (`apps/manager/src/routes/tasks.ts`):
  - `POST /api/tasks` — create task in queue (status: queued, roleTarget for pull model)
  - `GET /api/tasks` — list with status/teamId/roleTarget/limit filters
  - `GET /api/tasks/:id` — get single task

- **Registry Enhancements** (`apps/registry/src/routes.ts`):
  - GET /api/tasks now supports `roleTarget` and `limit` query params
  - Internal cloud config endpoint with decrypted secrets for Manager

- **Dashboard Proxy Routes**:
  - 5 deploy proxy routes (POST, GET/:id, DELETE/:id, POST/:id/redeploy, POST/:id/retry, GET/:id/stream)
  - Task routes now proxy to Manager (not Registry) for proper orchestration

- **35 unit tests** — all passing, covering:
  - Deploy start (records, state, phases, custom config, events, provisioner calls, bootstrapper calls, completion)
  - Error handling (missing cloud config, missing tokens, missing SSH keys, provisioner failure, bootstrapper failure, agent cleanup)
  - Undeploy (VM destroy, agent status, active deploy removal, graceful VM-not-found, events)
  - Redeploy (destroy old → create new)
  - Phase retry (validation, phase reset, events)
  - State accessors (active deploys, unknown deploy)
  - Event emission (deploy-specific channel, phase_update events)

### Key Decisions
- **Lazy orchestrator initialization** — the orchestrator is created on first deploy request, not at startup. This avoids requiring cloud config to be configured before the Manager can start.
- **Provisioner/Bootstrapper proxies** — dynamic imports of `@hivemi/provisioner` and `@hivemi/bootstrapper` avoid requiring these packages at startup. The provisioner proxy lazy-loads the cloud provider based on cloud config from the registry.
- **Task creation routes through Manager** — Dashboard POSTs tasks to Manager (not Registry directly) so the Manager can add orchestration logic in the future (e.g., automatic task decomposition by PM agent).
- **Phase retry is declarative** — `retryPhase()` resets the failed phase and all subsequent phases, then re-tracks the deploy in memory. Full re-execution from a specific phase is noted for a future iteration.
- **SSE includes heartbeat** — 15s keepalive heartbeats prevent proxy/load balancer timeouts.
- **Deploy list enriched with live state** — `GET /api/deploy` merges registry data with in-memory active deploy state for real-time accuracy.

### API Summary
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/deploy` | List all deploys |
| POST | `/api/deploy` | Start new deploy |
| GET | `/api/deploy/:id` | Deploy status |
| DELETE | `/api/deploy/:id` | Undeploy (destroy VM) |
| POST | `/api/deploy/:id/redeploy` | Destroy + recreate |
| POST | `/api/deploy/:id/retry` | Retry from failed phase |
| GET | `/api/deploy/:id/stream` | SSE event stream |
| POST | `/api/tasks` | Create task in queue |
| GET | `/api/tasks` | List tasks with filters |
| GET | `/api/tasks/:id` | Get single task |

### Structure
```
apps/manager/
  src/
    lib/
      deploy-orchestrator.ts   — DeployOrchestrator class + types
      registry-client.ts       — Enhanced HTTP client for Registry
      logger.ts                — Pino logger
    routes/
      deploy.ts                — Deploy route handlers (modular)
      tasks.ts                 — Task route handlers
    routes.ts                  — Main Hono app with all routes
    index.ts                   — Server entry point
    __tests__/
      deploy-orchestrator.test.ts — 35 unit tests
  vitest.config.ts             — Test configuration
```

### Commits
- `ffff019` — feat(manager): deploy orchestrator with full lifecycle, SSE streaming, and task queue
- `1a6a2c5` — feat(registry): add roleTarget + limit filters to task list and internal cloud config endpoint
- `6a24e26` — feat(dashboard): proxy routes for deploy and task operations via Manager

### Next
- #50 (Dashboard) — UI for deploy progress (SSE), task list, task creation
- #55 (Task Queue) — server-side `SELECT FOR UPDATE SKIP LOCKED` for atomic task claiming
- #70 (Undeploy Enhancement) — more sophisticated cleanup and resource reclamation
- #72 (Task Cancellation) — cancel running tasks via agent notification

---

## 2026-02-09 — Issue #47 (Refinement): Daemon Path Alignment

### Summary
Fixed daemon working directory paths to match the issue #47 spec (`/home/openclaw/.hivemi/daemon`). Both the systemd template in the daemon package and the bootstrapper's `DAEMON_DIR` constant were using `/home/openclaw/agent-daemon`. Updated for consistency.

### Changes
- `packages/agent-daemon/systemd/hivemi-agent.service` — WorkingDirectory + EnvironmentFile → `~/.hivemi/daemon`
- `packages/bootstrapper/src/phases/configure.ts` — `DAEMON_DIR` → `/home/openclaw/.hivemi/daemon`

### Commits
- `77189a8` — fix(agent-daemon): align daemon paths to /home/openclaw/.hivemi/daemon per spec

---

## 2026-02-09 — Issue #48: Registry — Telemetry & Deploy Status Endpoints

### Summary
Added telemetry submission/query and deploy lifecycle tracking endpoints to the Registry API. Dashboard proxy routes included.

### Done
- **Protocol schemas:** `SubmitTelemetrySchema` (POST telemetry validation), `UpdateDeploySchema` (PUT deploy validation) added to `@hivemi/protocol`
- **Telemetry routes** (`apps/registry/src/routes/telemetry.ts`):
  - `POST /api/agents/:id/telemetry` — daemon submits metrics (infra, llm, tasks, daemon), validates with Zod, auto-updates agent lastHeartbeat
  - `GET /api/agents/:id/telemetry` — latest metrics (supports `?limit=N`)
  - `GET /api/agents/:id/telemetry/history` — historical with `?from=&to=&limit=` (defaults: last 24h, limit 100)
  - `POST /api/telemetry/cleanup` — retention: keeps 24h detailed, aggregates to 1/hour for 24h-7d, deletes >7d
- **Deploy routes** (`apps/registry/src/routes/deploys.ts`):
  - `POST /api/deploys` — register new deploy with initial phases (provisioning→installing→configuring→registering)
  - `GET /api/deploys` — list recent deploys (supports `?limit=&status=`)
  - `GET /api/deploys/:id` — single deploy status
  - `PUT /api/deploys/:id` — update phase/status/instanceId/agentId/error, auto-manages agent status on "ready" or "failed"
- **Dashboard proxy routes:** 6 Next.js API routes proxy all new endpoints to registry
- **Route mounting:** telemetry and deploy routes mounted in main `routes.ts`

### Key Decisions
- **Telemetry also updates lastHeartbeat** — receiving telemetry from an agent is proof of liveness, so we set lastHeartbeat on the agent row. Avoids the daemon needing two separate calls.
- **Cleanup via SQL aggregation** — `POST /api/telemetry/cleanup` uses a CTE with `array_agg` to identify duplicate records within the same hour, keeping only the most recent per hour. This makes retention automatic without needing a separate aggregation table.
- **Deploy phase tracking is append-based** — the `PUT /api/deploys/:id` endpoint accepts a `phase` object and merges it into the phases array (update existing by name or append new). The Deploy Orchestrator calls this as it progresses through bootstrap phases.
- **Agent status auto-update on deploy completion** — when a deploy transitions to "ready", the linked agent is set to "idle". On "failed", agent goes to "error". This keeps agent status consistent without the Orchestrator needing separate calls.
- **Zod validation on all mutations** — both telemetry submission and deploy updates are validated with Zod schemas, returning 400 with details on validation failure.

### Endpoints Summary
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/agents/:id/telemetry` | Daemon submits metrics |
| GET | `/api/agents/:id/telemetry` | Dashboard queries latest |
| GET | `/api/agents/:id/telemetry/history` | Historical with time range |
| POST | `/api/telemetry/cleanup` | Retention cleanup |
| POST | `/api/deploys` | Register new deploy |
| GET | `/api/deploys` | List recent deploys |
| GET | `/api/deploys/:id` | Deploy status |
| PUT | `/api/deploys/:id` | Update deploy phase/status |

### Commits
- `acd31c9` — feat(registry): telemetry and deploy status endpoints

### Next
- #47 (Agent Daemon) — will call `POST /api/agents/:id/telemetry` periodically
- #49 (Deploy Orchestrator) — will use deploy endpoints to track lifecycle
- #50 (Dashboard) — will use telemetry GET endpoints to show agent metrics

---

## 2026-02-09 — Issue #47: Agent Daemon — Resident VM Process

### Summary
Implemented `packages/agent-daemon` — the resident process that runs on each agent VM. Polls the registry task queue, executes tasks via OpenClaw Chat Completions API, reports results, and maintains heartbeat/telemetry loops.

### Done
- **types.ts:** Full type system — `DaemonConfig` (loaded from `.env`), `DaemonTask`, `TaskResult`, `TelemetrySnapshot`, `LogEntry`, plus `IRegistryClient` and `IOpenClawClient` interfaces for testability
- **registry-client.ts:** HTTP client for all Registry API interactions:
  - `register()` — upsert via PUT (then POST on 404)
  - `heartbeat()` — POST /api/agents/:id/heartbeat
  - `updateStatus()` — PUT /api/agents/:id with status
  - `pollTask()` — GET /api/tasks/next with role filter, fallback to GET /api/tasks?status=queued + client-side lock
  - `reportTaskResult()` — PUT /api/tasks/:id with output/error/artifacts
  - `sendTelemetry()` — POST /api/agents/:id/telemetry (fallback to PUT)
  - `sendLogs()` — POST /api/logs (batch)
  - `setOffline()` — graceful shutdown status update
- **openclaw-client.ts:** Local OpenClaw gateway integration:
  - `healthCheck()` — GET /v1/models to verify gateway is running
  - `executeTask()` — POST /v1/chat/completions with task prompt (one request = one session = clean context)
  - `restart()` — exec `openclaw gateway restart` + wait + verify
- **task-poller.ts:** Pull-model task execution:
  - Polls registry every 15s (configurable)
  - Lock-free single-task execution (skips poll while executing)
  - Builds structured prompts from task title/description/input
  - Reports success/failure to registry
  - Tracks completed/failed counters + active task
  - Adds log entries to shared buffer
- **telemetry.ts:** OS metrics via native Node.js modules:
  - CPU usage from os.cpus()
  - Memory used/total from os.totalmem/freemem
  - Disk usage via `df -B1`
  - Load average from os.loadavg()
  - LLM request/token/error counters
  - Daemon uptime and OpenClaw status
- **index.ts:** `AgentDaemon` orchestrator class:
  - Starts all loops: heartbeat (30s), telemetry (60s), task poll (15s), log shipping (5min), health check
  - OpenClaw health monitoring: 3 consecutive failures triggers auto-restart; reports error status if restart fails
  - Log buffer with backpressure (1000 entry cap, retry on ship failure)
  - Graceful shutdown on SIGTERM/SIGINT: stops loops, ships remaining logs, sets offline in registry
  - Entry point: loads config from process.env, sets up signal handlers
- **systemd/hivemi-agent.service:** Production systemd unit with security hardening (NoNewPrivileges, ProtectSystem)
- **25 unit tests** — all passing, covering config parsing, task execution, telemetry, registry client, daemon lifecycle

### Key Decisions
- **Chat Completions API** (not WebSocket/sessions) — one HTTP POST per task = guaranteed clean context. The daemon is stateless between tasks.
- **Pull model** with fallback — tries `GET /api/tasks/next?role=` first (optimized server-side locking), falls back to listing + client-side lock if endpoint doesn't exist yet (backward compatible).
- **Interface-based design** — `IRegistryClient` and `IOpenClawClient` allow full mocking in tests without HTTP calls. Same pattern as bootstrapper's `ISSHClient`.
- **Self-healing OpenClaw** — daemon monitors gateway health and auto-restarts after 3 consecutive failures. If restart fails, reports error status to registry so the Deploy Orchestrator knows.
- **Log buffer with cap** — logs buffer in memory and ship every 5 min. If ship fails, entries go back to buffer front. Buffer capped at 1000 entries to prevent memory leaks.
- **All intervals configurable** via env vars (POLL_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, etc.) with sensible defaults.

### Structure
```
packages/agent-daemon/
  src/
    index.ts              — AgentDaemon class + entry point
    registry-client.ts    — HTTP client for Registry API
    task-poller.ts        — poll loop + task execution
    openclaw-client.ts    — Chat Completions API integration
    telemetry.ts          — OS metrics collection
    types.ts              — all type definitions + config loader
    __tests__/
      agent-daemon.test.ts — 25 unit tests
  systemd/
    hivemi-agent.service  — systemd unit file
```

### Commits
- `e726a5b` — feat(agent-daemon): implement resident VM process for task execution

### Next
- #48 (Registry: telemetry endpoint) — the `/api/agents/:id/telemetry` endpoint the daemon posts to
- #55 (Protocol: task queue) — server-side `GET /api/tasks/next` with `SELECT FOR UPDATE SKIP LOCKED`
- #64 (Daemon ↔ OpenClaw integration) — deeper integration, tool results, streaming
- #49 (Deploy Orchestrator) — orchestrates provisioner + bootstrapper + daemon lifecycle

---

## 2026-02-09 — Issue #46: Agent Config — System Prompts & Config by Role

### Summary
Extracted hardcoded system prompts from agent source code into SOUL.md files, created a full config structure (base + role + instance overrides), and added Zod schemas + merge utility to `@hivemi/protocol`.

### Done
- **agents/_base/AGENTS.md:** Shared behavioral rules for all agents (task handling, communication, security)
- **agents/_base/TOOLS.md:** Shared tool documentation (registry API, daemon, OpenClaw, env vars)
- **agents/_base/config.json:** Base operational config (heartbeat, telemetry, log, task timeout, retries)
- **Per-role SOUL.md:** Extracted SYSTEM_PROMPT from each agent's `src/index.ts` into rich Markdown files with personality, responsibilities, output format, and guidelines for: PM, Developer, QA, Tech Lead
- **Per-role config.json:** Model, maxTokens, temperature, timeout — tuned per role (e.g. Developer gets higher maxTokens=8192 + lower temperature=0.3)
- **Per-role tools.json:** Tool definitions with name, description, enabled flag per role
- **Protocol schemas (Zod):**
  - `AgentBaseConfigSchema` — validates base config
  - `AgentRoleConfigSchema` — validates role config
  - `AgentToolSchema` + `AgentToolsConfigSchema` — tool definitions
  - `AgentInstanceOverridesSchema` — deploy-time overrides (all optional)
  - `AgentMergedConfigSchema` — final resolved config
  - `AgentRoleFilesSchema` — complete file bundle for bootstrapper
- **`mergeAgentConfig()`** — merges base + role + instance overrides with Zod validation
- **Agent source refactor:** All 4 agents now load SOUL.md from file at startup (workspace → role dir → inline fallback)
- **Bootstrapper update:** RoleConfig now supports optional `toolsJson`, copyRoleConfig writes it to VM workspace
- **13 unit tests** for config schemas and merger (all passing)
- **20 bootstrapper tests** still passing (backward compatible)

### Key Decisions
- **SOUL.md as rich Markdown** (not plain text) — includes personality, responsibilities, output format, and guidelines. More context for the LLM than a bare system prompt.
- **Three-layer merge:** base → role → instance. Instance overrides come from Dashboard at deploy time. Only defined fields override.
- **File loading order** in agents: OpenClaw workspace (`~/.openclaw/workspace/SOUL.md`) first (production, bootstrapper puts it there), then adjacent role directory (development), then inline fallback (should never happen).
- **tools.json is declarative** — defines what tools a role _should_ have access to. Actual tool implementation is a later concern (Agent Daemon / OpenClaw integration).
- **Temperature per role:** PM=0.7 (creative analysis), Developer=0.3 (precise code), QA=0.3 (systematic review), Tech Lead=0.5 (balanced).

### Structure
```
agents/
  _base/
    AGENTS.md              # shared behavior rules
    TOOLS.md               # shared tool docs
    config.json            # heartbeat, telemetry, log, task params
  pm/
    SOUL.md                # PM personality + output format
    config.json            # model, maxTokens=4096, temp=0.7
    tools.json             # create-subtask, query-tasks, notify-agent
  developer/
    SOUL.md                # Developer personality + output format
    config.json            # model, maxTokens=8192, temp=0.3
    tools.json             # file-read, file-write, shell-exec, query-tasks
  qa/
    SOUL.md                # QA personality + output format
    config.json            # model, maxTokens=4096, temp=0.3
    tools.json             # file-read, shell-exec, report-issue, query-tasks
  tech-lead/
    SOUL.md                # Tech Lead personality + output format
    config.json            # model, maxTokens=4096, temp=0.5
    tools.json             # file-read, create-subtask, query-tasks, notify-agent
```

### Commits
- `ba3d16d` — feat(agents): extract system prompts to SOUL.md and create config structure
- `19af011` — feat(protocol): add agent config schemas and merge utility
- `293e53b` — refactor(agents): load SOUL.md from file instead of hardcoded strings
- `6bbcd71` — feat(bootstrapper): support tools.json in role config

### Next
- #47 (Agent Daemon) — will use merged config + tools.json to configure agent behavior
- #49 (Deploy Orchestrator) — will call mergeAgentConfig() when building BootstrapConfig

---

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

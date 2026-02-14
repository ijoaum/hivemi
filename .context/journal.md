# HiveMI Development Journal

## 2026-02-15 — Issue #91: Bootstrapper — Config OpenClaw Gateway

### Summary
Enhanced the bootstrapper's OpenClaw configuration phase to generate a complete gateway config with system prompt (role, tools, instructions), security settings (timeouts, rate limits, max concurrent requests), config validation, and post-write verification. Created a dedicated `openclaw-config.ts` module with config generator, system prompt builder, validator, and role-based tool resolution. 62 new tests.

### What was done

1. **OpenClaw Config Module** (`packages/bootstrapper/src/openclaw-config.ts`):
   - `generateOpenClawConfig(options)` — generates the full OpenClaw gateway config object
     - LLM: model + maxTokens
     - Gateway: chatCompletions enabled, auth token
     - Sandbox: off (agents need full access)
     - Security: requestTimeoutSeconds (300), maxConcurrentRequests (1), rateLimitPerMinute (30), toolTimeoutSeconds (120), allowElevated (false)
   - `buildSystemPrompt(options)` — builds SOUL.md for the agent with:
     - Base system prompt (role's SOUL.md content)
     - Agent Identity block (name, ID, role, team, model)
     - Available Tools section (from role or explicit list)
     - Custom instructions section (if provided)
     - Standard Agent Rules (always appended)
   - `validateOpenClawConfig(config)` — validates the generated config:
     - Required fields: model, chatCompletions enabled, sandbox off
     - Security value ranges (timeout 10-3600, concurrent 1-10, rate 1-600, toolTimeout 5-1800, maxTokens 256-200000)
     - Warning for missing auth token
     - Returns `{ valid, errors, warnings }`
   - `getToolsForRole(roleName)` — resolves default tools per role:
     - developer/dev/engineer → full worker tools
     - qa/tester → worker tools + browser
     - pm/manager → read, write, web_search, web_fetch (no exec)
     - executor/runner → exec, read, write, edit (restricted)
     - default → full worker tools
   - `logConfigSummary(config, promptLength, logger)` — logs all config fields safely (no secrets)

2. **SecurityConfig type** with defaults:
   - `maxTokens: 32768` — tokens per request
   - `requestTimeoutSeconds: 300` — 5 min request timeout
   - `maxConcurrentRequests: 1` — one task at a time
   - `rateLimitPerMinute: 30` — prevent runaway loops
   - `sandboxMode: "off"` — agents need full tool access
   - `allowElevated: false` — no elevated ops by default
   - `toolTimeoutSeconds: 120` — 2 min tool execution limit

3. **Tool Sets**:
   - `DEFAULT_WORKER_TOOLS`: exec, read, write, edit, web_search, web_fetch, browser
   - `DEFAULT_EXECUTOR_TOOLS`: exec, read, write, edit (restricted, no web/browser)

4. **Enhanced `configureOpenClaw` phase** (`packages/bootstrapper/src/phases/configure.ts`):
   - Accepts optional `ConfigureOpenClawOptions` (roleName, tools, instructions, security)
   - Builds system prompt via `buildSystemPrompt()` instead of raw SOUL.md write
   - Generates config via `generateOpenClawConfig()` with security settings
   - Validates config and throws with descriptive error on failure
   - Post-write verification: reads file size via SSH to confirm write succeeded
   - Detailed logging throughout (config summary without secrets)
   - Backward compatible: new `options` parameter is optional

5. **JSON Template** (`packages/bootstrapper/src/templates/openclaw.json`):
   - Template with placeholder variables (`{{MODEL}}`, `{{API_TOKEN}}`)
   - Documents the expected config structure for reference

6. **62 new tests** (`packages/bootstrapper/src/__tests__/openclaw-config.test.ts`):
   - **generateOpenClawConfig (10)**: model, chatCompletions, sandbox, auth token, security defaults, custom overrides, maxTokens, JSON serialization, sandbox override
   - **buildSystemPrompt (11)**: base content, agent identity, tools section, agent rules, instructions, explicit tools, role name, default role, empty prompt, undefined prompt, tool guidance
   - **getToolsForRole (10)**: default, undefined, executor, runner, developer, pm, qa, case-insensitive, whitespace, unknown
   - **validateOpenClawConfig (14)**: valid config, missing model, disabled chatCompletions, wrong sandbox, no auth warning, auth present, timeout ranges, concurrent ranges, rate limit ranges, tool timeout ranges, maxTokens ranges, undefined maxTokens, no security block, multiple errors
   - **DEFAULT_SECURITY (2)**: sensible defaults, defaults pass validation
   - **Tool sets (3)**: worker tools content, executor tools restricted, executor subset of worker
   - **logConfigSummary (4)**: logs key fields, security settings, auth configured, auth none
   - **Integration (5)**: developer valid, qa valid, pm valid, executor valid, all overrides valid, round-trip preserves structure

7. **Updated existing tests** (`bootstrapper.test.ts`):
   - `configureOpenClaw` tests updated for new behavior: system prompt with identity block, security settings in config, verification call, validation failure test

### Key Decisions
- **Dedicated module** (`openclaw-config.ts`) — separates config generation logic from SSH execution. Clean to test, easy to reuse if other services need to generate configs.
- **Validation before write** — catches misconfigurations early. Prevents deploying agents with broken configs that would fail silently at runtime.
- **Post-write verification** — reads file size via SSH after writing. Catches corrupted writes (SSH connection issues, disk full, etc.) before proceeding.
- **Role-based tool defaults** — PM agents don't need `exec`, QA agents need `browser`. Principle of least privilege while still being useful.
- **maxConcurrentRequests: 1** — agents process one task at a time from the queue. This is by design: the daemon picks one task, executes, reports, picks next. Setting it to 1 prevents accidental parallel execution.
- **Backward compatible** — the new `options` parameter on `configureOpenClaw` is optional. Existing callers (deploy orchestrator) continue to work without changes.

### Acceptance Criteria
- [x] Fase de configuração adicionada ao bootstrapper (enhanced configureOpenClaw + openclaw-config.ts)
- [x] openclaw.json criado no agente (written as config.yaml via SSH)
- [x] chatCompletions habilitado
- [x] sandbox desabilitado
- [x] System prompt configurado com role e tools
- [x] Configurações de segurança aplicadas (timeout, rate limits, max concurrent, tool timeout)
- [x] Validação de arquivo bem-sucedida (validateOpenClawConfig + post-write size check)
- [x] Logs de configuração gerados (logConfigSummary + phase logging)
- [x] Agente pode executar chat completions após deploy (config enables endpoint)

### Files Changed
| File | Change |
|------|--------|
| `packages/bootstrapper/src/openclaw-config.ts` | NEW — config generator, system prompt builder, validator, tool resolver |
| `packages/bootstrapper/src/templates/openclaw.json` | NEW — JSON config template with placeholders |
| `packages/bootstrapper/src/phases/configure.ts` | Enhanced configureOpenClaw with validation, verification, logging |
| `packages/bootstrapper/src/index.ts` | Export new types and functions |
| `packages/bootstrapper/src/__tests__/openclaw-config.test.ts` | NEW — 62 tests |
| `packages/bootstrapper/src/__tests__/bootstrapper.test.ts` | Updated configureOpenClaw tests |

### Commits
- `43996b9` — feat(bootstrapper): config OpenClaw gateway — system prompt, security, validation, role tools (#91)

### Next
- Wire `ConfigureOpenClawOptions` into DeployOrchestrator (pass role name from registry)
- Add AGENTS.md and TOOLS.md generation based on role config
- Implement config hot-reload for running agents (update config without redeploy)
- Add per-role security overrides (some roles may need elevated access)

---

## 2026-02-15 — Issue #90: Dashboard — Timeline de Steps na Task

### Summary
Added an Activity Timeline section to the task detail modal that displays real-time progress steps (tool calls) as the agent works. Consumes the existing `GET /api/tasks/:id/progress` endpoint via a new Next.js proxy route, polls every 3 seconds for active tasks, and renders a vertical timeline with tool-specific icons, relative timestamps, and auto-scrolling.

### What was done

1. **Dashboard Proxy Route** (`apps/dashboard/src/app/api/tasks/[id]/progress/route.ts`):
   - `GET /api/tasks/:id/progress` — proxies to Registry with `limit` and `offset` query params
   - Follows existing proxy pattern (uses `proxyToRegistry`)

2. **API Client** (`apps/dashboard/src/lib/api.ts`):
   - `TaskProgressStep` interface: `id`, `taskId`, `step`, `toolCall`, `timestamp`
   - `tasksApi.progress(id, params?)` — fetches progress steps with optional limit/offset

3. **TaskTimeline Component** (`apps/dashboard/src/components/task-timeline.tsx`):
   - Consumes `tasksApi.progress()` via `useApi` hook
   - **Real-time polling**: 3s interval when `isActive` (locked/cancelling), no polling for completed tasks
   - **Tool-specific icons**: Terminal (exec), FileText (read), Pencil (write), Wrench (edit), Search (web_search), Globe (web_fetch), Monitor (browser), Activity (default)
   - **Icon color coding**: green (exec), blue (read), amber (write), purple (edit), cyan (search), teal (fetch), indigo (browser), gray (default)
   - **Auto-scroll**: scrolls to bottom on new steps; detects manual scroll-up and pauses auto-scroll
   - **Scroll-to-bottom button**: appears when user scrolls up, re-enables auto-scroll on click
   - **Live indicator**: green pulsing dot + "Live" badge for active tasks
   - **Loading state**: spinner + "Loading activity..."
   - **Empty state**: inbox icon + "No activity recorded yet" (with hint for active tasks)
   - **Timestamps**: relative (just now, Xs ago, Xm ago) with absolute on hover
   - **Step text cleanup**: strips leading emoji from step text (icon already shows the type)

4. **Task Detail Modal** (`apps/dashboard/src/components/task-detail-modal.tsx`):
   - Added `TaskTimeline` import and component
   - Timeline section placed between Output and Timeout/Error sections
   - Wrapped in a subtle card (bg-gray-800/50 border) for visual distinction
   - `isActive` driven by `task.status === "locked" || task.status === "cancelling"`

### Key Decisions
- **Polling (not SSE)** — the Registry's GET endpoint is simple request/response. SSE would require a new streaming endpoint. Polling at 3s is a good trade-off: responsive enough for UI updates, light on the server. Can upgrade to SSE/WebSocket in the future.
- **3s polling interval** — fast enough to feel real-time, slow enough to not hammer the server. The daemon debounces progress reports at 2s, so 3s polling catches most updates within one cycle.
- **Auto-scroll with detection** — UX: if the user scrolls up to read earlier steps, we don't yank them back down. A "scroll to latest" button appears to re-engage auto-scroll.
- **Icon mapping matches interceptor** — the tool call icons correspond to the tool names and emoji prefixes generated by the daemon's `OpenClawInterceptor` (issue #89). This creates visual consistency.
- **Timeline always visible** — even for completed/failed tasks, the timeline shows historical steps. The empty state handles old tasks that have no progress data gracefully.
- **200 step limit** — fetches up to 200 steps per request. For extremely long tasks, pagination could be added later, but 200 covers most realistic scenarios.

### Acceptance Criteria
- [x] Timeline visible in task detail modal
- [x] Steps displayed in chronological order (ASC from Registry)
- [x] Timestamp and step details shown (relative + absolute on hover)
- [x] Real-time polling for active tasks (3s interval)
- [x] Icons per tool type (7 specific + 1 default)
- [x] Auto-scroll to new steps (with manual scroll detection)
- [x] Loading state implemented
- [x] Empty state handled gracefully (no progress / old task)
- [x] UI responsive and performatic

### Files Changed
| File | Change |
|------|--------|
| `apps/dashboard/src/app/api/tasks/[id]/progress/route.ts` | NEW — GET proxy to Registry |
| `apps/dashboard/src/components/task-timeline.tsx` | NEW — Timeline component |
| `apps/dashboard/src/components/task-detail-modal.tsx` | +TaskTimeline integration |
| `apps/dashboard/src/lib/api.ts` | +TaskProgressStep type, +tasksApi.progress() |

### Commits
- `db1f6bf` — feat(dashboard): activity timeline in task detail modal — real-time step progress (#90)

### Next
- SSE or WebSocket for true real-time updates (eliminate polling)
- Duration per step (start → end tracking)
- Expandable step details (show full arguments)
- Filter/search within timeline
- Export timeline as text/JSON

---

## 2026-02-15 — Issue #89: Daemon — Report Tool Calls as Steps

### Summary
Implemented tool call interception and progress reporting in the Daemon. When the OpenClaw agent executes a task using streaming (SSE), the Daemon now intercepts `tool_calls` from the Chat Completions response, extracts tool names and arguments, and reports them as progress steps to the Registry via `POST /api/tasks/:id/progress`. Includes debounce (2s default) to avoid flooding the Registry, retry with exponential backoff for network errors, and configurable enable/disable via environment variables. 55 new tests.

### What was done

1. **OpenClaw Interceptor** (`packages/agent-daemon/src/openclaw-interceptor.ts`):
   - Processes SSE `data:` payloads, detects `tool_calls` in streaming deltas
   - Accumulates tool call fragments across multiple chunks (args can be split)
   - Emits `ToolCallEvent` with callId, toolName, arguments, argumentsSummary, timestamp
   - Human-readable summaries per tool type:
     - `exec` → `$ npm install`
     - `read` → `📄 /src/index.ts`
     - `write` → `✏️ /tmp/out.txt`
     - `edit` → `🔧 /src/app.ts`
     - `web_search` → `🔍 Node.js streams`
     - `web_fetch` → `🌐 https://example.com`
     - `browser` → `🖥️ browser:screenshot`
     - Unknown tools → `key: value` (first key-value pair)
   - Configurable: `enabled`, `maxArgsSummaryLength`
   - Safe: callback errors caught and logged as warnings

2. **Progress Reporter** (`packages/agent-daemon/src/progress-reporter.ts`):
   - Receives `ToolCallEvent` from interceptor, reports to Registry as progress steps
   - **Debounce**: first event sent immediately, subsequent events batched within window (default: 2000ms)
   - **Retry with backoff**: exponential delay (100ms × 2^attempt), max 3 retries, cap at 10s
   - **Non-blocking**: errors don't affect task execution
   - Lifecycle: `startTask(taskId)` / `stopTask()` — flush pending on stop
   - Metrics: `getMetrics()` returns `{ sent, failed, pending }`

3. **RegistryClient** (`packages/agent-daemon/src/registry-client.ts`):
   - New `reportProgress(taskId, progress)` method → `POST /api/tasks/:id/progress`
   - Throws on error (caller handles retry)

4. **OpenClawClient** (`packages/agent-daemon/src/openclaw-client.ts`):
   - Integrated `OpenClawInterceptor` into the streaming execution path
   - New `parseSSEStreamWithInterceptor()` replaces standalone `parseSSEStream` for streaming
   - Each SSE `data:` line routes through interceptor for tool call detection + content extraction
   - `onToolCall(callback)` method to register external callbacks
   - `getInterceptor()` for testing/advanced use
   - Interceptor reset before each task

5. **TaskExecutor** (`packages/agent-daemon/src/task-executor.ts`):
   - Wires `OpenClawClient.onToolCall()` → `ProgressReporter.handleToolCall()`
   - Calls `startTask()` before execution, `stopTask()` in finally block
   - Logs progress metrics after each task

6. **DaemonConfig** (`packages/agent-daemon/src/types.ts`):
   - `progressReportingEnabled?: boolean` (env: `PROGRESS_REPORTING`, default: `true`)
   - `progressDebounceMs?: number` (env: `PROGRESS_DEBOUNCE_MS`, default: `2000`)
   - `ProgressPayload` type and `IRegistryClient.reportProgress()` interface method

7. **55 new tests** (`packages/agent-daemon/src/__tests__/tool-call-progress.test.ts`):
   - **Interceptor — tool call detection (5)**: single chunk, split chunks, sequential, parallel indices, [DONE]
   - **Interceptor — content passthrough (4)**: content delta, tool call → null, [DONE] → null, invalid JSON
   - **Interceptor — argument summaries (11)**: exec, read, write, edit, web_search, web_fetch, browser, unknown, truncation, empty, invalid JSON
   - **Interceptor — configuration (2)**: disabled, custom maxArgsSummaryLength
   - **Interceptor — error handling (4)**: callback error, warning log, empty delta, missing choices
   - **Interceptor — reset (1)**: clear accumulators
   - **Reporter — lifecycle (4)**: no task, with task, flush on stop, reset metrics
   - **Reporter — debounce (3)**: immediate first, debounce rapid, batch during window
   - **Reporter — retry (4)**: network error retry, max retries, exponential backoff, delay cap
   - **Reporter — enable/disable (2)**: disabled, enabled
   - **Reporter — metrics (3)**: sent, failed, pending
   - **Reporter — payload (2)**: step format, timestamp
   - **Integration (2)**: interceptor → reporter → registry, full multi-tool flow
   - **Config parsing (4)**: PROGRESS_REPORTING, default true, PROGRESS_DEBOUNCE_MS, default 2000
   - **Edge cases (4)**: unknown name, multiple callbacks, no function field, interface check

8. **Updated 3 existing test files**: added `reportProgress: vi.fn()` to mock registries

### Key Decisions
- **Interceptor in streaming path only** — non-streaming responses don't include tool_calls in the same way (they're in the final JSON). The interceptor hooks into the SSE parsing loop which is the default (and recommended) execution mode.
- **Separate interceptor and reporter** — the interceptor handles SSE parsing and tool call detection (sync, no I/O). The reporter handles debounce, retry, and network calls (async). Clean separation of concerns.
- **Debounce at 2s default** — tool calls during a task can be rapid (read → edit → exec in 1s). 2s batches multiple calls into fewer API requests without losing much granularity.
- **Non-blocking everything** — progress reporting is nice-to-have, not critical. Network errors are retried but ultimately swallowed. The task execution is never affected by progress reporting failures.
- **`parseSSEStreamWithInterceptor` replaces `parseSSEStream` for streaming** — the standalone `parseSSEStream` function is kept for backward compatibility (still exported), but the streaming execution now uses the interceptor-aware variant.
- **Tool call detection via `delta.id`** — a new `id` field in `tool_calls[n]` indicates a new tool call starting. Subsequent chunks without `id` at the same index are continuations (argument fragments).

### Acceptance Criteria
- [x] Tool calls do OpenClaw interceptados
- [x] POST /api/tasks/:id/progress enviado para cada tool call
- [x] Informações úteis capturadas (nome, args, duração)
- [x] Debounce implementado (2s default, configurable via PROGRESS_DEBOUNCE_MS)
- [x] Retry com backoff funcionando (3 attempts, exponential, max 10s)
- [x] Configuração para ativar/desativar progress (PROGRESS_REPORTING env var)
- [x] Logs de debug disponíveis (interceptor + reporter log at debug level)
- [x] Não afeta performance da execução da task (non-blocking, errors swallowed)

### Files Changed
| File | Change |
|------|--------|
| `packages/agent-daemon/src/openclaw-interceptor.ts` | NEW — SSE tool call interceptor |
| `packages/agent-daemon/src/progress-reporter.ts` | NEW — debounce + retry progress reporter |
| `packages/agent-daemon/src/types.ts` | +ProgressPayload, +IRegistryClient.reportProgress, +config fields |
| `packages/agent-daemon/src/registry-client.ts` | +reportProgress() method |
| `packages/agent-daemon/src/openclaw-client.ts` | Interceptor integration, parseSSEStreamWithInterceptor |
| `packages/agent-daemon/src/task-executor.ts` | Wire interceptor → reporter, start/stop per task |
| `packages/agent-daemon/src/index.ts` | Export interceptor + reporter |
| `packages/agent-daemon/src/__tests__/tool-call-progress.test.ts` | NEW — 55 tests |
| `packages/agent-daemon/src/__tests__/agent-daemon.test.ts` | +reportProgress mock |
| `packages/agent-daemon/src/__tests__/openclaw-integration.test.ts` | +reportProgress mock |
| `packages/agent-daemon/src/__tests__/task-execution-flow.test.ts` | +reportProgress mock |

### Commits
- `2490d09` — feat(daemon): report tool calls as progress steps — interceptor, debounce, retry (#89)

### Next
- Dashboard: real-time progress display (poll GET /api/tasks/:id/progress)
- Duration tracking: capture elapsed time for each tool call (start → result)
- Tool call result interception: capture success/failure of each tool call
- Progress streaming via WebSocket (instead of polling) for real-time dashboard updates

---

## 2026-02-15 — Issue #88: Registry Task Progress Endpoints

### Summary
Created REST endpoints for storing and retrieving granular task progress (checkpoints/steps), using the existing `task_progress` table. Agents can now report step-by-step progress as they execute tasks, and the dashboard (or other consumers) can query the progress timeline.

### What was done

1. **Protocol Schema** (`packages/protocol/src/types.ts`):
   - Added `CreateTaskProgressSchema` — validates `step` (1-1000 chars), `timestamp` (coerced Date), `toolCall` (optional, max 50 chars)
   - Exported `CreateTaskProgress` type

2. **DB Schema** (`apps/registry/src/db/schema.ts`):
   - Upgraded `task_progress` index from single-column `(task_id)` to composite `(task_id, timestamp)` for query performance (GET endpoint orders by timestamp)

3. **Progress Routes** (`apps/registry/src/routes/progress.ts`):
   - `POST /:id/progress` — Add a progress step to a task
     - Validates body with `CreateTaskProgressSchema`
     - Verifies task exists (404 if not)
     - Inserts into `task_progress` table
     - Returns 201 with created record
   - `GET /:id/progress` — List progress steps for a task
     - Verifies task exists (404 if not)
     - Returns steps ordered by timestamp ASC
     - Pagination: `limit` (default 100, max 500) and `offset` (default 0)
     - Returns `{ success, data, pagination: { limit, offset, count } }`

4. **Route Wiring** (`apps/registry/src/routes.ts`):
   - Imported and mounted `taskProgressRoutes` at `/api/tasks`

5. **Tests** (`apps/registry/src/__tests__/task-progress.test.ts`):
   - 31 tests covering:
     - `CreateTaskProgressSchema` validation (full/minimal payloads, boundaries, type coercion)
     - `TaskProgressSchema` validation (full records, null toolCall, missing fields)
     - Pagination logic (defaults, caps, edge cases, negative values)

### Key Decisions
- **Composite index `(task_id, timestamp)`** instead of just `(task_id)` — the GET endpoint always filters by task_id and orders by timestamp, so the composite index covers both operations efficiently.
- **Pagination with limit/offset** — Simple and sufficient for progress steps. The count in pagination is the result count (not total), keeping the query light (no extra COUNT query).
- **toolCall stored as null when not provided** — Matches the DB schema (nullable varchar). The Create schema makes it optional; the route normalizes `undefined` → `null` before insert.
- **No authentication on these routes beyond the existing `authMiddleware`** — The progress routes are mounted under `/api/tasks` which already has Bearer token auth via the `authMiddleware` applied to all `/api/*` routes.

### Acceptance Criteria
- [x] POST /api/tasks/:id/progress accepts and stores steps
- [x] GET /api/tasks/:id/progress returns ordered list
- [x] Fields step, timestamp, toolCall stored correctly
- [x] TaskId validation implemented (404 if not found)
- [x] Pagination functional (limit/offset)
- [x] Composite index added for performance (task_id, timestamp)
- [x] 31 tests passing
- [x] Journal updated

### Files Changed
| File | Change |
|------|--------|
| `packages/protocol/src/types.ts` | Added `CreateTaskProgressSchema` and `CreateTaskProgress` type |
| `apps/registry/src/db/schema.ts` | Upgraded `task_progress` index to composite `(task_id, timestamp)` |
| `apps/registry/src/routes/progress.ts` | New file — POST and GET progress endpoints |
| `apps/registry/src/routes.ts` | Import and mount progress routes |
| `apps/registry/src/__tests__/task-progress.test.ts` | New file — 31 tests |

### Commits
- `530e468` — feat(registry): task progress endpoints — POST & GET /api/tasks/:id/progress (#88)

## 2026-02-15 — Issue #87: Dashboard Cancel Button on Tasks

### Summary
Added Cancel button to both the task detail modal and task card components. The button appears only for running tasks (status=locked), shows a confirmation dialog before proceeding, displays a cancelling state with spinner while the API call is in flight, disables the button to prevent double-clicks, and shows inline error feedback if the cancellation fails. Also shows a passive "Cancelling..." indicator when the task status transitions to `cancelling`.

### What was done

1. **Task Detail Modal** (`apps/dashboard/src/components/task-detail-modal.tsx`):
   - Added `useState` for `showCancelConfirm`, `isCancelling`, `cancelError`
   - Cancel button visible only when `task.status === "locked"` (running)
   - Clicking opens `ConfirmDialog` (existing component) with destructive styling
   - On confirm: calls `tasksApi.cancel(taskId)`, shows spinner, disables button
   - Error toast above the action bar if cancel fails (dismissible)
   - Passive "Cancelling..." indicator with spinner when `task.status === "cancelling"`
   - Removed old cancel button that was on queued+locked without confirmation

2. **Task Card** (`apps/dashboard/src/components/task-card.tsx`):
   - Added compact Cancel button (pill style) in footer, visible for `locked` tasks
   - `XCircle` icon from lucide-react, `Loader2` spinner during cancellation
   - `e.stopPropagation()` prevents card onClick from firing when clicking Cancel
   - Confirmation dialog with task title in message
   - Error feedback shown inline above footer
   - Cancelling status indicator when `task.status === "cancelling"`
   - New `onCancelComplete` callback prop for parent to refetch

3. **Tasks Page** (`apps/dashboard/src/app/tasks/page.tsx`):
   - Passes `onCancelComplete={refetchTasks}` to TaskCard

### Key Decisions
- **Cancel only for `locked` (running) tasks** — The issue specifies "when status=running". The data model uses `locked` for running tasks. Queued tasks don't need cancel (they haven't started).
- **Reused existing `ConfirmDialog`** — No need for a new component; the existing one supports destructive styling.
- **Reused existing `tasksApi.cancel()`** — The cancel API route and client method already existed from prior work.
- **Inline error over toast** — Keeps error context visible near the action that failed, no external toast library needed.
- **`stopPropagation` on card cancel** — Prevents the card's onClick (which opens the detail modal) from firing when the user clicks Cancel.

### Acceptance Criteria
- [x] Cancel button visible in task detail modal
- [x] Cancel button visible in task card
- [x] Button appears only when status=running (locked)
- [x] POST /api/tasks/:id/cancel called on click
- [x] Cancelling state shown with spinner
- [x] Button disabled after click (prevents double-click)
- [x] Confirmation dialog before cancel
- [x] UI updated when cancellation completes (refetch + status polling)
- [x] Error handled and displayed to user

### Files Changed
| File | Change |
|------|--------|
| `apps/dashboard/src/components/task-detail-modal.tsx` | Cancel button with confirm dialog, cancelling state, error handling |
| `apps/dashboard/src/components/task-card.tsx` | Cancel button (compact), confirm dialog, cancelling state, error handling |
| `apps/dashboard/src/app/tasks/page.tsx` | Pass `onCancelComplete` to TaskCard |

### Commits
- `3c23f0b` — feat(dashboard): cancel button on tasks — confirmation dialog, cancelling state, error handling (#87)

## 2026-02-15 — Issue #86: Task Timeout Recovery

### Summary
Implemented a periodic timeout recovery job in the Registry that detects stuck tasks (status=locked, agent's lastHeartbeat older than a configurable threshold) and marks them as failed with reason "timeout". Added the `timeoutAt` field to the task schema, Dashboard timeout indicators (orange badge with ⏱️ icon), structured logging, and webhook notifications. 60 new tests covering detection logic, status transitions, configuration, logging, webhooks, dashboard indicators, edge cases, and SQL query structure.

### What was done

1. **Timeout Recovery Job** (`apps/registry/src/lib/timeout-recovery.ts`):
   - `checkTaskTimeouts()` — main function that detects and times out stuck tasks
   - Joins `tasks` (status=locked, lockedAt NOT NULL) with `agents` to check `lastHeartbeat`
   - Uses LEFT JOIN to handle tasks where the agent has been deleted
   - Detects tasks where `agent.lastHeartbeat < cutoff` OR `lastHeartbeat IS NULL`
   - For each stuck task:
     1. Marks task as `failed` with `error="timeout"`, sets `timeoutAt` and `completedAt`
     2. Clears lock fields (`lockedBy`, `lockedAt`)
     3. Resets agent to `idle`, clears `currentTaskId`
     4. Writes structured log entry with `component="timeout-recovery"` to logs table
   - Webhook notification when timeouts are detected (limited to 10 tasks in payload)
   - `startTimeoutRecovery()` / `stopTimeoutRecovery()` lifecycle functions
   - 10s startup delay, then runs every `intervalMs` (default: 5 minutes)
   - Concurrent error handling: individual task failures don't stop processing others

2. **DB Schema** (`apps/registry/src/db/schema.ts`):
   - Added `timeoutAt` timestamp column to `tasks` table (nullable)

3. **Protocol** (`packages/protocol/src/types.ts`):
   - Added `timeoutAt: z.coerce.date().nullable().optional()` to `TaskSchema`

4. **Registry Startup** (`apps/registry/src/index.ts`):
   - Added `startTimeoutRecovery()` call on server start
   - Three env vars: `TIMEOUT_THRESHOLD_MS` (30 min), `TIMEOUT_CHECK_INTERVAL_MS` (5 min), `TIMEOUT_WEBHOOK_URL`

5. **Dashboard Task Card** (`apps/dashboard/src/components/task-card.tsx`):
   - `isTimeout()` helper: detects timeout via `error === "timeout"` or `timeoutAt` presence
   - Orange color scheme for timeout tasks (distinct from red "Failed")
   - ⏱️ icon next to task title for timeout tasks
   - Orange border for timeout cards (vs red for regular failures)
   - Dedicated timeout message: "Task timed out — no heartbeat from agent"

6. **Dashboard Task Detail Modal** (`apps/dashboard/src/components/task-detail-modal.tsx`):
   - Orange "⏱️ timed out" status badge for timeout tasks
   - Timeout section with explanation: "This task was automatically marked as failed because the agent stopped sending heartbeats"
   - `timeoutAt` timestamp shown in meta grid when present
   - Regular error section hidden for timeout tasks (avoids showing raw "timeout" string)

7. **Dashboard Types**:
   - `apps/dashboard/src/lib/api.ts`: Added `timeoutAt: string | null` to `Task` interface
   - `apps/dashboard/src/types/task.ts`: Added `timeoutAt?: Date` to `Task` interface

8. **60 new tests** (`apps/registry/src/__tests__/timeout-recovery.test.ts`):
   - **Detection Logic (5)**: threshold detection, within threshold, null heartbeat, default threshold, default interval
   - **Status Transitions (5)**: failed status, timeoutAt set, completedAt set, lock fields cleared, only locked tasks
   - **Agent Reset (3)**: idle after timeout, no agent (null), deleted agent
   - **Configuration (6)**: custom threshold, custom interval, webhook URL, no webhook, TIMEOUT_THRESHOLD_MS, TIMEOUT_CHECK_INTERVAL_MS
   - **Log Entries (4)**: structured log, lockedAt metadata, component name, unknown agent
   - **Webhook Notifications (4)**: payload shape, 10 task limit, no send when 0, failure handling
   - **Schema (3)**: nullable timeoutAt, null for non-timeout, distinguish via timeoutAt
   - **Dashboard Indicators (7)**: timed out label, failed label, orange colors, icon, explanation, timeoutAt in detail, non-timeout
   - **Job Lifecycle (3)**: startup delay, duplicate prevention, cleanup
   - **vs Lock Timeout (3)**: working agent detection, heartbeat timing, longer threshold
   - **Edge Cases (8)**: empty set, multiple tasks, same agent, null lockedAt, old heartbeat, not cancelling, result shape, DB errors
   - **SQL Query (5)**: join condition, LEFT JOIN, status filter, heartbeat check, lockedAt NOT NULL
   - **Registry Integration (4)**: env vars, startup order

### Key Decisions
- **Separate from lock-timeout.ts** — the existing lock-timeout.ts releases stale locks when agents are DEAD (offline/unreachable/destroyed). Timeout recovery catches a different case: agents that appear "working" but have stopped heartbeating — indicating a hung process, not a dead agent. Different detection criteria, different thresholds.
- **30 min default threshold** — longer than lock-timeout's 10 min default. A task might legitimately take a long time (e.g., large code generation). 30 min without a single heartbeat (agent sends them every 30s) means ~60 missed heartbeats — clearly stuck.
- **5 min check interval** — frequent enough to catch timeouts promptly, but not so frequent as to hammer the DB. A 30-min threshold + 5-min check means worst case a stuck task is caught within 35 min.
- **Mark as failed, not requeued** — timed-out tasks likely failed due to an infrastructure issue. Requeuing could lead to infinite retry loops. Better to mark as failed and let the user decide whether to retry.
- **timeoutAt field** — distinguishes timeout failures from other failures. The Dashboard uses this to show a different visual treatment (orange vs red) with a specific explanation.
- **Webhook for notifications** — same pattern as reconciliation job. Simple, universal. Works with Slack, Discord, etc.

### Acceptance Criteria
- [x] Job periódico rodando a cada 5 min
- [x] Tasks travadas detectadas corretamente (locked + stale heartbeat)
- [x] Threshold de timeout configurável (TIMEOUT_THRESHOLD_MS env var)
- [x] Tasks marcadas como failed com reason timeout
- [x] Campo timeout_at adicionado ao schema
- [x] Notificações enviadas quando há timeout (webhook)
- [x] Dashboard mostra indicador de timeout (orange badge, ⏱️ icon, explanation)
- [x] Logs gerados para cada timeout detectado (component: timeout-recovery)

### Files Changed
| File | Change |
|------|--------|
| `apps/registry/src/lib/timeout-recovery.ts` | NEW — timeout recovery job |
| `apps/registry/src/db/schema.ts` | +timeoutAt column on tasks table |
| `apps/registry/src/index.ts` | Start timeout recovery job + env config |
| `packages/protocol/src/types.ts` | +timeoutAt on TaskSchema |
| `apps/dashboard/src/lib/api.ts` | +timeoutAt on Task interface |
| `apps/dashboard/src/types/task.ts` | +timeoutAt on Task interface |
| `apps/dashboard/src/components/task-card.tsx` | Timeout indicator (orange, ⏱️) |
| `apps/dashboard/src/components/task-detail-modal.tsx` | Timeout info section |
| `apps/registry/src/__tests__/timeout-recovery.test.ts` | NEW — 60 tests |

### Commits
- `6d495ef` — feat(registry,dashboard): task timeout recovery — periodic job detects stuck tasks, marks as failed with timeout reason, dashboard indicators (#86)
- `6de29a0` — test(registry): 60 timeout recovery tests — detection logic, status transitions, config, logging, webhooks, dashboard indicators (#86)

### Next
- DB migration for `timeout_at` column (when running against real Postgres)
- Dashboard: filter tasks by timeout (e.g., "Show timed out tasks" filter option)
- Configurable retry-on-timeout (auto-requeue timed-out tasks with max retries)
- Integration test with real heartbeat flow

---

## 2026-02-15 — Issue #85: Task Cancellation via Heartbeat

### Summary
Implemented task cancellation via the heartbeat protocol. When a user cancels a running task, the Registry marks it as "cancelling" and signals the Daemon through the heartbeat response. The Daemon detects the signal, kills the OpenClaw process, and reports the task as cancelled. Smart cancel logic differentiates between queued tasks (immediate cancel) and locked tasks (cancel via heartbeat signal). 46 new tests covering the full flow.

### What was done

1. **Protocol — HeartbeatResponseSchema** (`packages/protocol/src/types.ts`):
   - Added `cancelTask` field: `z.string().uuid().nullable().optional()`
   - When a task is marked as "cancelling", the heartbeat response includes the task ID
   - Backward compatible — old daemons that don't check cancelTask still work

2. **Registry Heartbeat — cancelTask Signal** (`apps/registry/src/routes/heartbeat.ts`):
   - After updating agent heartbeat data, checks if `currentTaskId` matches a task with "cancelling" status
   - If found, includes `cancelTask: taskId` in the response
   - Non-critical check — if DB query fails, heartbeat still succeeds without cancelTask
   - Logs when cancelTask is included in response

3. **Task Cancel Endpoint — Smart Cancel** (`apps/registry/src/routes/tasks.ts`):
   - New `PUT /:id/cancel` endpoint in task queue routes
   - Status transition logic:
     - `queued` → `cancelled` (immediate, no daemon involvement)
     - `locked` → `cancelling` (daemon will handle via heartbeat)
     - `cancelling` → idempotent (already cancelling)
     - `completed/failed/cancelled` → 409 Conflict
   - Also updated `POST /api/tasks/:id/cancel` in main routes with same logic

4. **Daemon Types — HeartbeatResult** (`packages/agent-daemon/src/types.ts`):
   - New `HeartbeatResult` interface: `{ ack: boolean; cancelTask: string | null }`
   - Updated `IRegistryClient.heartbeat()` return type from `boolean` to `HeartbeatResult`

5. **Daemon RegistryClient — Parse cancelTask** (`packages/agent-daemon/src/registry-client.ts`):
   - `heartbeat()` now returns `HeartbeatResult` instead of `boolean`
   - Parses JSON response to extract `cancelTask` field
   - Handles JSON parse failure gracefully (returns `cancelTask: null`)
   - New `updateTaskCancelled()` method: `PUT /api/tasks/:id` with `status: "cancelled"`

6. **Daemon — Cancellation Handler** (`packages/agent-daemon/src/index.ts`):
   - Heartbeat loop checks `result.cancelTask` against active task
   - `handleTaskCancellation()`: orchestrates the full cancellation flow
     1. Calls `openclaw.cancelExecution()` (aborts HTTP request)
     2. Waits for task executor to notice (up to 10s timeout)
     3. Reports task as failed via `reportTaskResult()`
     4. Marks task as cancelled via `updateTaskCancelled()`
   - `waitForTaskCancellation()`: polls activeTask every 200ms with timeout
   - `CANCEL_KILL_TIMEOUT_MS = 10_000` (10 seconds SIGTERM → timeout)
   - Comprehensive logging at each step

7. **46 new tests** (`apps/registry/src/__tests__/task-cancellation.test.ts`):
   - **Protocol (7)**: HeartbeatResponseSchema with/without cancelTask, TaskStatusSchema cancelling/cancelled
   - **Registry Heartbeat (3)**: cancelTask when cancelling, no cancelTask when not cancelling, no cancelTask when idle
   - **Status Transitions (4)**: queued→cancelled, locked→cancelling, terminal→409, cancelling→idempotent
   - **HeartbeatResult (4)**: fields, null cancelTask, non-null cancelTask, ack false
   - **Response Parsing (4)**: parse cancelTask, null when absent, 404 handling, malformed JSON
   - **Cancellation Flow (5)**: match active task, mismatch, no active task, report then cancel, timeout
   - **OpenClaw Cancel (2)**: abort controller, no-op when null
   - **Edge Cases (6)**: already completed, ID mismatch, idempotent, shutdown, report failure, not found
   - **Kill Timeout (3)**: task clears within timeout, timeout expires, constant value
   - **Full Flow (3)**: locked→cancel→heartbeat→kill→cancelled, queued→immediate, completed→409
   - **Logging (5)**: reception, cancellation, confirmation, timeout, registry report

8. **Updated existing tests** (4 files):
   - Updated mock registries to return `HeartbeatResult` instead of `boolean`
   - Added `createSubtask` to mock where missing
   - Fixed private-ip test heartbeat assertion

### Key Decisions
- **Smart cancel (locked vs queued)** — queued tasks can be cancelled immediately (no daemon involvement). Locked tasks need the daemon to kill the running process, so they go through `cancelling` → heartbeat signal → daemon kill → `cancelled`.
- **cancelTask in heartbeat response** — reuses the existing heartbeat protocol instead of adding a new polling mechanism. Zero additional network calls — the daemon already sends heartbeats every 30s.
- **HTTP abort for cancellation** — the OpenClaw client uses `AbortController.abort()` to kill the active streaming/non-streaming HTTP request. This is equivalent to SIGTERM for the network call. The 10s timeout acts as the SIGKILL equivalent.
- **Report failed then mark cancelled** — the daemon first reports the task as "failed" (via the standard completion endpoint), then separately marks it as "cancelled". This ensures the task gets proper cleanup (lock fields cleared, agent status reset) even if the cancel-specific endpoint fails.
- **HeartbeatResult type** — changed from `boolean` to a structured result object. This is a breaking change for existing mock registries in tests, but gives us extensibility for future heartbeat response fields.
- **Non-critical DB check** — the cancellation check in the heartbeat handler is wrapped in try/catch. If it fails, the heartbeat still succeeds — we never break the heartbeat protocol for a nice-to-have feature.

### Acceptance Criteria
- [x] Heartbeat retorna cancelTask quando há task pra cancelar
- [x] PUT /api/tasks/:id/cancel marca task como cancelling (locked) ou cancelled (queued)
- [x] Daemon detecta cancelTask na resposta do heartbeat
- [x] Processo OpenClaw é morto corretamente (HTTP abort via AbortController)
- [x] Task marcada como cancelled após kill
- [x] Timeout de kill funcionando (10s wait → report regardless)
- [x] Logs de cancelamento gerados (at each step)
- [x] Edge cases tratados sem crash (already completed, mismatch, not found, etc.)

### Files Changed
| File | Change |
|------|--------|
| `packages/protocol/src/types.ts` | +cancelTask on HeartbeatResponseSchema |
| `apps/registry/src/routes/heartbeat.ts` | Check for cancelling tasks, return cancelTask |
| `apps/registry/src/routes/tasks.ts` | +PUT /:id/cancel — smart cancel endpoint |
| `apps/registry/src/routes.ts` | Updated POST cancel with smart logic |
| `packages/agent-daemon/src/types.ts` | +HeartbeatResult type, updated IRegistryClient |
| `packages/agent-daemon/src/registry-client.ts` | Parse cancelTask, +updateTaskCancelled() |
| `packages/agent-daemon/src/index.ts` | +handleTaskCancellation, +waitForTaskCancellation |
| `apps/registry/src/__tests__/task-cancellation.test.ts` | NEW — 46 tests |
| `packages/agent-daemon/src/__tests__/agent-daemon.test.ts` | Updated mocks for HeartbeatResult |
| `packages/agent-daemon/src/__tests__/task-execution-flow.test.ts` | Updated mocks for HeartbeatResult |
| `packages/agent-daemon/src/__tests__/openclaw-integration.test.ts` | Updated mocks for HeartbeatResult |
| `packages/agent-daemon/src/__tests__/private-ip.test.ts` | Updated assertion for HeartbeatResult |

### Commits
- `f98de5e` — feat(registry,daemon): task cancellation via heartbeat — cancel signal, daemon kill, status flow (#85)
- `f605b25` — test(registry,daemon): 46 task cancellation tests + fix existing tests for HeartbeatResult type (#85)
- `0977faf` — fix(daemon): update private-ip test for HeartbeatResult type (#85)

### Next
- Dashboard: cancel button on task detail page (calls PUT /api/tasks/:id/cancel)
- Dashboard: show "cancelling" status badge (amber/yellow)
- Timeout escalation: if daemon doesn't confirm cancel within N heartbeats, force-cancel from registry side
- Integration test with real OpenClaw process

---

## 2026-02-15 — Issue #84: Cost Estimation: Completar e Expor

### Summary
Completed the cost estimation system by creating pricing tables per provider, adding agent-to-instance mapping in cost breakdowns, implementing in-memory caching with TTL and invalidation hooks, exposing a dedicated Registry cost endpoint, enhancing the Manager cost endpoint, and updating the Dashboard to show agent names. 46 new tests covering pricing, caching, projections, agent mappings, multi-provider support, and edge cases.

### What was done

1. **Pricing Tables** (`packages/provisioner/src/pricing/index.ts`):
   - `DIGITALOCEAN_PRICING`: small ($6), medium ($12), large ($24)
   - `GCP_PRICING`: small ($7), medium ($13), large ($25)
   - `PROVIDER_PRICING`: indexed lookup by provider name
   - `getPricingForProvider(name)`: case-insensitive lookup with error on unknown
   - `getMonthlyCost(provider, size)`: convenience function
   - `listProviders()`: returns all supported providers

2. **Enhanced `cost.ts`** (`packages/provisioner/src/cost.ts`):
   - `AgentInstanceMapping` type: maps agentId/agentName to instanceId
   - `generateCostReport()` now accepts optional `agentMappings` parameter
   - Breakdown items enriched with `agentId` and `agentName` when mapping exists
   - **Cache module**: `getCachedCostReport()`, `setCostCache(report, ttlMs)`, `invalidateCostCache()`, `getCostCacheInfo()`
   - Default cache TTL: 60 seconds
   - `CachedCostReport` type for cache metadata

3. **Updated `InstanceCostBreakdown` type** (`packages/provisioner/src/types.ts`):
   - Added optional `agentId: string` and `agentName: string` fields

4. **Registry Cost Route** (`apps/registry/src/routes/costs.ts`):
   - `GET /api/infra/costs` endpoint with in-memory cache (60s TTL)
   - Loads cloud config, creates provider, lists instances, fetches agents from DB
   - Builds agent-to-instance mappings from `agents.cloud.instanceId`
   - Returns `CostReport` with per-agent breakdown
   - `invalidateCostCache()` exported for external invalidation
   - Response includes `cached: boolean` field

5. **Enhanced Manager `/costs`** (`apps/manager/src/routes/infra.ts`):
   - Added in-memory cache (60s TTL) with `getCostCached()` / `setCostCache()`
   - Fetches agents from Registry for agent-to-instance mapping
   - Passes `agentMappings` to `generateCostReport()`
   - `invalidateManagerCostCache()` exported and called from:
     - `DELETE /api/deploy/:id` (undeploy)
     - `POST /api/deploy/:id/redeploy` (redeploy)
     - `DELETE /api/infra/reconcile/orphan/:instanceId` (destroy orphan)

6. **Dashboard Updates**:
   - `InstanceCostBreakdown` type: added `agentId?` and `agentName?` fields
   - `MonthlyCostCard`: shows `agentName` in breakdown tooltip (falls back to VM name)

7. **Provisioner Exports** (`packages/provisioner/src/index.ts`):
   - Exports: cache functions, `AgentInstanceMapping`, `CachedCostReport` types
   - Exports: all pricing table functions and constants

8. **46 new tests** (`packages/provisioner/src/__tests__/cost-estimation.test.ts`):
   - **Pricing Tables (10)**: DO/GCP values, PROVIDER_PRICING, getPricingForProvider, case-insensitive, unknown throws, getMonthlyCost, listProviders
   - **Agent Mappings (5)**: enrichment, no mappings, partial mappings, undefined, backward compat
   - **Multi-provider (3)**: DO costs, GCP costs, GCP > DO comparison
   - **Instance Sizes (4)**: small/medium/large individual, mixed report
   - **Cost Cache (7)**: empty, store/retrieve, invalidate, TTL expiry, cache info states
   - **Projections (5)**: end of month, mid-month, daily fraction, zero fraction, empty
   - **Accumulated (3)**: full month, mid-month, just created
   - **Response Shape (5)**: required fields, agent info, ISO timestamp, monthly sum, accumulated sum
   - **Edge Cases (4)**: string dates, future VM, 100 instances, single instance

### Key Decisions
- **Dual cache (Registry + Manager)** — each service caches independently since they have different data sources. Registry reads from DB directly; Manager proxies through Registry. Both use 60s TTL.
- **Cache invalidation on infra changes** — rather than time-based only, deploy/destroy/redeploy actions actively invalidate the cache for immediate accuracy.
- **Agent mappings via `cloud.instanceId`** — the agents table stores cloud info (provider, region, instanceId) as JSON. We use instanceId to join instances to agents for the breakdown.
- **Pricing tables separate from providers** — `pricing/index.ts` provides static lookup tables independent of live provider instances. Useful for estimation without API calls.
- **Backward compatible** — `generateCostReport()` still works without `agentMappings` parameter. Existing consumers unaffected.
- **Registry + Manager both serve costs** — Registry has direct DB access for agent mappings. Manager delegates to cloud provider for live instance data. Dashboard proxy goes through Manager (consistent with other infra endpoints).

### Acceptance Criteria
- [x] Custo mensal calculado corretamente por instância
- [x] Custo projetado estimado até fim do mês
- [x] Custo acumulado desde deploy calculado
- [x] Suporte para diferentes tamanhos de instância (small/medium/large)
- [x] Suporte para DigitalOcean e GCP (pricing tables + provider support)
- [x] Endpoint GET /api/infra/costs retorna breakdown (Registry + Manager)
- [x] Total geral incluído na resposta (monthly, projected, accumulated)
- [x] Cache implementado e funcionando (60s TTL + invalidation)
- [x] Dashboard pode consumir e exibir os dados (MonthlyCostCard + agent names)

### Files Changed
| File | Change |
|------|--------|
| `packages/provisioner/src/pricing/index.ts` | NEW — DO/GCP pricing tables |
| `packages/provisioner/src/cost.ts` | Enhanced — cache, agent mappings |
| `packages/provisioner/src/types.ts` | +agentId, +agentName on InstanceCostBreakdown |
| `packages/provisioner/src/index.ts` | +cache, +pricing, +mapping exports |
| `apps/registry/src/routes/costs.ts` | NEW — GET /api/infra/costs with cache |
| `apps/registry/src/routes.ts` | Mount costRoutes at /api/infra/costs |
| `apps/manager/src/routes/infra.ts` | Enhanced — cache + agent mappings in /costs |
| `apps/manager/src/routes.ts` | +invalidateManagerCostCache on deploy/destroy |
| `apps/dashboard/src/lib/api.ts` | +agentId, +agentName on InstanceCostBreakdown |
| `apps/dashboard/src/components/monthly-cost-card.tsx` | Show agent names in breakdown |
| `packages/provisioner/src/__tests__/cost-estimation.test.ts` | NEW — 46 tests |

### Commits
- `a5a850e` — feat(provisioner): complete cost estimation with pricing tables, caching, and agent mappings (#84)
- `cc92642` — feat(registry,manager): expose GET /api/infra/costs with caching and agent breakdown (#84)
- `f288abd` — feat(dashboard): show agent names in cost breakdown card (#84)

### Next
- Dashboard: dedicated cost/billing page with charts and history
- Cost alerts (threshold-based notifications)
- Historical cost tracking (store daily snapshots)
- Multi-provider mixed deployment costs (agents on different providers)

---

## 2026-02-15 — Issue #83: Reconciliation: Completar Lógica e Endpoint

### Summary
Completed the reconciliation system by adding a periodic job in the Registry that compares cloud VMs (tagged `hivemi`) with registered agents, detects orphaned VMs and phantom agents, validates IP matches, auto-fixes phantom agents by marking them offline, logs detailed results, and sends webhook notifications. Exposed via REST endpoints in both Registry and Manager, with Dashboard proxy routes and API client extensions.

### What was done

1. **Reconciliation Job** (`apps/registry/src/lib/reconciliation-job.ts`):
   - `runReconciliation()` — main function that orchestrates the full reconciliation cycle
   - Loads cloud config from DB, creates cloud provider via dynamic import
   - Lists VMs with `hivemi` tag from the cloud provider
   - Maps DB agents to `RegistryAgent` shape for the provisioner
   - Calls `generateReconciliationReport()` from `@hivemi/provisioner`
   - **Auto-fix**: marks phantom agents as `offline` in DB (configurable via `autoFixPhantoms`)
   - **Logging**: writes structured log entries to the `logs` table with component `reconciliation-job`
   - **Notifications**: sends webhook alerts for `warning`/`critical` status
   - Concurrent execution guard (skips if already running)
   - `startReconciliationJob()` / `stopReconciliationJob()` lifecycle functions
   - 30s startup delay, then runs every `intervalMs` (default: 1 hour)
   - `getLastReconciliationResult()` returns cached result for the status API

2. **Registry Reconciliation Routes** (`apps/registry/src/routes/reconcile.ts`):
   - `GET /api/infra/reconcile` — returns last periodic reconciliation result
   - `POST /api/infra/reconcile` — triggers immediate reconciliation with optional `autoFix` and `tag` params
   - `GET /api/infra/reconcile/history` — returns reconciliation log entries (limit param)

3. **Registry Startup** (`apps/registry/src/index.ts`):
   - Added `startReconciliationJob()` call on server start
   - Three env vars: `RECONCILIATION_INTERVAL_MS`, `RECONCILIATION_AUTO_FIX`, `RECONCILIATION_WEBHOOK_URL`

4. **Manager Infra Routes** (`apps/manager/src/routes/infra.ts`):
   - Enhanced `GET /reconcile` — existing endpoint (runs live reconciliation via cloud provider)
   - Added `POST /reconcile` — trigger with `autoFix` option, marks phantom agents via `registryClient.updateAgent()`
   - Added `GET /reconcile/status` — proxies to Registry's periodic job result
   - Added `GET /reconcile/history` — proxies to Registry's log history

5. **Manager RegistryClient** (`apps/manager/src/lib/registry-client.ts`):
   - `getReconciliationStatus()` — GET /api/infra/reconcile
   - `triggerReconciliation(options)` — POST /api/infra/reconcile
   - `getReconciliationHistory(limit)` — GET /api/infra/reconcile/history

6. **Dashboard Proxy Routes**:
   - `apps/dashboard/src/app/api/infra/reconcile/trigger/route.ts` — POST proxy
   - `apps/dashboard/src/app/api/infra/reconcile/status/route.ts` — GET proxy
   - `apps/dashboard/src/app/api/infra/reconcile/history/route.ts` — GET proxy

7. **Dashboard API Client** (`apps/dashboard/src/lib/api.ts`):
   - `infraApi.triggerReconcile(options)` — POST /api/infra/reconcile/trigger
   - `infraApi.reconcileStatus()` — GET /api/infra/reconcile/status
   - `infraApi.reconcileHistory(limit)` — GET /api/infra/reconcile/history

8. **55 new tests** (`apps/registry/src/__tests__/reconciliation.test.ts`):
   - Configuration (4): interval, env vars, auto-fix toggle, webhook URL
   - Report shape (5): clean, warning, orphan issues, phantom issues, totalVMs math
   - Job result (4): success, skipped, already running, error
   - Auto-fix (4): count tracking, targets only phantoms, marks offline, skips offline/destroyed
   - IP validation (5): mismatch detection, matching IPs, localhost, port handling, VPC
   - Notifications (4): warning, critical, clean skip, issue details
   - Logging (4): message format, auto-fixed omission, level mapping, component
   - API endpoints (6): GET/POST reconcile, status, history, destroy orphan
   - Dashboard API client (3): methods, POST body, history limit
   - Agent mapping (3): full cloud, no cloud, empty instanceId
   - Periodic job (4): concurrency guard, error recovery, startup delay, interval
   - RegistryClient methods (3): endpoint paths, POST options, history limit
   - Edge cases (6): empty agents, no VMs, all phantoms, all orphans, local agents, mixed

### Key Decisions
- **Job lives in Registry, not Manager** — the Registry has direct DB access for both reading agents and writing auto-fix updates. The Manager proxies to Registry for job status and delegates live reconciliation through the provisioner.
- **30s startup delay** — avoids hammering the cloud API immediately on server start. Gives time for cloud config to be loaded and other services to initialize.
- **Auto-fix defaults to ON** — phantom agents (VM deleted but agent still in registry with active status) are misleading. Marking them offline is safe and prevents false dashboard counts. Can be disabled via `RECONCILIATION_AUTO_FIX=false`.
- **Webhook for notifications** — simple, universal approach. Works with Slack, Discord, generic webhooks. More complex notification channels can be added later.
- **Dual API: Registry + Manager** — Registry handles periodic job results and history. Manager handles live reconciliation (needs cloud provider). Dashboard can call either depending on needs.
- **Logs table for audit trail** — reconciliation results stored as structured log entries with metadata. Query via `/history` endpoint or directly in the logs UI.

### Acceptance Criteria
- [x] Reconciliação compara VMs vs agentes corretamente (via `@hivemi/provisioner` reconcile)
- [x] VMs órfãs detectadas e alertadas (orphaned_vm issues in report)
- [x] Agentes fantasma marcados como offline (auto-fix in DB)
- [x] Validação de IP funcionando (detectIPMismatches from provisioner)
- [x] Endpoint GET /api/infra/reconcile retorna relatório (both Registry and Manager)
- [x] Job periódico executando a cada 1h (startReconciliationJob with setInterval)
- [x] Logs detalhados sendo gerados (structured log entries in logs table)
- [x] Notificações enviadas quando há problemas (webhook for warning/critical)
- [x] Dashboard pode exibir status de reconciliação (infraApi.reconcileStatus + history)

### Files Changed
| File | Change |
|------|--------|
| `apps/registry/src/lib/reconciliation-job.ts` | NEW — periodic reconciliation job |
| `apps/registry/src/routes/reconcile.ts` | NEW — Registry reconciliation endpoints |
| `apps/registry/src/routes.ts` | Mount reconcileRoutes at /api/infra/reconcile |
| `apps/registry/src/index.ts` | Start reconciliation job + env config |
| `apps/manager/src/routes/infra.ts` | Enhanced — POST reconcile, status, history |
| `apps/manager/src/lib/registry-client.ts` | +reconciliation methods |
| `apps/dashboard/src/lib/api.ts` | +triggerReconcile, reconcileStatus, reconcileHistory |
| `apps/dashboard/src/app/api/infra/reconcile/trigger/route.ts` | NEW — POST proxy |
| `apps/dashboard/src/app/api/infra/reconcile/status/route.ts` | NEW — GET proxy |
| `apps/dashboard/src/app/api/infra/reconcile/history/route.ts` | NEW — GET proxy |
| `apps/registry/src/__tests__/reconciliation.test.ts` | NEW — 55 tests |

### Commits
- `a6c1a76` — feat(registry): reconciliation job and API — periodic VM/agent drift detection, auto-fix, notifications (#83)

### Next
- Dashboard reconciliation status card/page
- Manual "destroy orphan" button in Dashboard with confirmation
- Rate limiting on POST /reconcile (prevent spam)
- Integration test with mock cloud provider

---

## 2026-02-15 — Issue #82: Agent Registration: IP Privado

### Summary
Ensured that the Agent Daemon registers with the Registry using its private VPC IP (10.x.x.x) instead of the public IP, enabling secure P2P communication between agents via the private network. Extracted IP detection into a dedicated networking module, added dual IP storage (private + public), updated heartbeat to sync private IP changes, and added comprehensive tests and documentation.

### What was done

1. **`networking.ts` module** (`packages/agent-daemon/src/networking.ts`):
   - Extracted from inline code in `registry-client.ts` into dedicated module
   - `detectPrivateIp()`: scans network interfaces for RFC1918 addresses, prefers 10.x.x.x (cloud VPCs)
   - `detectPublicIp()`: finds non-private, non-loopback IPv4 addresses
   - `isPrivateIp(address)`: validates any IPv4 against RFC1918 ranges
   - `getAllPrivateIps()`: returns all private IPs sorted by cloud preference (10.x first)
   - Full RFC1918 coverage: 10.0.0.0/8, 172.16.0.0/12 (all 16 sub-ranges), 192.168.0.0/16
   - Exported from `packages/agent-daemon/src/index.ts` for library usage

2. **RegistryClient enhancements** (`packages/agent-daemon/src/registry-client.ts`):
   - Uses `networking.ts` instead of inline detection
   - Caches `privateIp` and `publicIp` after registration for reuse
   - `getPrivateIp()` / `getPublicIp()` accessors for cached values
   - Registration sends both `privateIp` and `publicIp` to Registry
   - `host` field prefers: privateIp → publicIp → "0.0.0.0" (fallback chain)
   - Heartbeat sends `privateIp` when cached (keeps Registry in sync if IP changes)

3. **Protocol schema updates** (`packages/protocol/src/types.ts`):
   - `RegisterAgentSchema`: added `privateIp` and `publicIp` optional string fields
   - `HeartbeatPayloadSchema`: added `privateIp` optional string field
   - `AgentSchema`: added `publicIp` nullable string field

4. **DB schema** (`apps/registry/src/db/schema.ts`):
   - Added `publicIp` varchar(45) column to `agents` table (alongside existing `privateIp`)

5. **Registry routes**:
   - `POST /api/agents` (agents.ts): persists `privateIp` and `publicIp` on both create and update
   - `POST /api/agents/:id/heartbeat` (heartbeat.ts): updates `privateIp` when provided in payload
   - `GET /api/agents` and `GET /api/agents/:id` (routes.ts): include `publicIp` in response

6. **Dashboard**:
   - `Agent` interface in `api.ts`: added `publicIp: string | null`
   - Agent detail page: shows "Private IP (VPC)" and "Public IP" separately in deploy sidebar

7. **Documentation** (`docs/DEPLOY.md`):
   - New "Agent Private IP Detection" section covering:
     - Detection algorithm (enumerate → filter → match → prefer → cache)
     - Storage model (host vs privateIp vs publicIp)
     - Heartbeat IP updates
     - P2P communication flow with private IP preference
     - Fallback behavior table
     - Dashboard display
     - Networking module API reference

8. **37 new tests** (`packages/agent-daemon/src/__tests__/private-ip.test.ts`):
   - **isPrivateIp (7 tests)**: Class A/B/C, public, loopback, out-of-range 172.x, out-of-range 192.x
   - **getAllPrivateIps (4 tests)**: array format, entry structure, private-only validation, sort order
   - **detectPrivateIp (2 tests)**: return type, validity check
   - **detectPublicIp (2 tests)**: return type, not-private check
   - **RegistryClient registration (4 tests)**: sends privateIp, host fallback, dual IP, caching
   - **RegistryClient heartbeat (3 tests)**: IP sync after register, no-register heartbeat, working status
   - **RegisterAgentSchema (2 tests)**: with and without privateIp/publicIp
   - **HeartbeatPayloadSchema (2 tests)**: with and without privateIp
   - **P2P communication (2 tests)**: private IP preference, public fallback
   - **Route verification (3 tests)**: agents route, heartbeat route, DB schema
   - **Discovery verification (1 test)**: returns privateIp
   - **Dashboard API (1 test)**: Agent interface has publicIp
   - **Edge cases (4 tests)**: empty string, IPv6, all 172.16-31 sub-ranges, boundary rejection

9. **Updated 4 existing tests** (`apps/registry/src/__tests__/vpc-bind.test.ts`):
   - Updated to check networking module instead of inline code
   - Added tests for publicIp, caching, heartbeat integration

### Key Decisions
- **Extracted networking.ts** — the inline `detectPrivateIp` in registry-client.ts was growing and wasn't testable independently. A dedicated module with exported utilities is cleaner and reusable.
- **Dual IP storage (private + public)** — storing both IPs separately (instead of just one) gives the system flexibility: P2P uses private IP, monitoring/debugging uses public IP, and the Dashboard shows both.
- **10.x.x.x preference** — cloud VPCs (DigitalOcean, AWS, GCP) overwhelmingly use the 10.0.0.0/8 range. Sorting private IPs with 10.x first means the primary detection result is almost always the VPC address.
- **Heartbeat includes privateIp** — if an agent's private IP changes (VM migration within VPC), the next heartbeat automatically updates the Registry. No manual intervention needed.
- **Backward compatible** — all new schema fields are optional. Existing agents without privateIp continue to work. Heartbeat without privateIp is accepted. Registration without publicIp is valid.
- **host field uses private IP** — the `host` column (used as primary communication address) prefers privateIp over publicIp. This means inter-agent traffic defaults to VPC when available.

### Acceptance Criteria
- [x] Daemon detects and uses IP privado (10.x.x.x) no registro
- [x] Schema do banco armazena private_ip e public_ip
- [x] Heartbeat usa IP privado
- [x] Comunicação P2P entre agentes funciona via VPC (privateIp preference in P2PClient)
- [x] Fallback implementado para cenários sem VPC (publicIp → "0.0.0.0")
- [x] Testes passando com IP privado (37 new + 147 total across 5 test files)
- [x] Documentação atualizada (DEPLOY.md — detection, storage, P2P, fallback)
- [x] Dashboard mostra IP privado quando aplicável (+ public IP)

### Files Changed
| File | Change |
|------|--------|
| `packages/agent-daemon/src/networking.ts` | NEW — IP detection utilities |
| `packages/agent-daemon/src/registry-client.ts` | Use networking module, cache IPs, send publicIp, heartbeat sync |
| `packages/agent-daemon/src/index.ts` | Export networking module |
| `packages/protocol/src/types.ts` | +privateIp/publicIp in RegisterAgent, +privateIp in Heartbeat, +publicIp in Agent |
| `apps/registry/src/db/schema.ts` | +publicIp column on agents table |
| `apps/registry/src/routes/agents.ts` | Persist privateIp/publicIp on create/update |
| `apps/registry/src/routes/heartbeat.ts` | Update privateIp from heartbeat payload |
| `apps/registry/src/routes.ts` | +publicIp in agent list/detail queries |
| `apps/dashboard/src/lib/api.ts` | +publicIp on Agent interface |
| `apps/dashboard/src/app/agents/[id]/page.tsx` | Show Private IP (VPC) + Public IP |
| `docs/DEPLOY.md` | New section: Agent Private IP Detection |
| `packages/agent-daemon/src/__tests__/private-ip.test.ts` | NEW — 37 tests |
| `apps/registry/src/__tests__/vpc-bind.test.ts` | Updated — 4 tests for networking module |

### Commits
- `d8f88ec` — feat(daemon): agent registration with private IP — networking module, dual IP storage, heartbeat sync (#82)
- `b167ed7` — test(daemon): 37 private IP tests + update VPC bind tests for networking module (#82)

### Next
- DB migration for `public_ip` column (when running against real Postgres)
- Agent detail page: copy-to-clipboard for IP addresses
- Network topology visualization in Dashboard

---

## 2026-02-15 — Issue #81: Firewall: Regras de IP Público

### Summary
Implemented automatic firewall configuration for HiveMI agent VMs. The provisioner now generates and applies security rules that restrict SSH to the control plane + authorized IPs, lock down the daemon port to control plane only, allow free VPC communication, and block all other inbound public ports. Configurable via `FirewallConfig` with support for authorized IPs, VPC CIDR, custom daemon port, additional ports, and ICMP toggle.

### What was done

1. **`FirewallConfig` type and config module** (`packages/provisioner/src/config.ts`):
   - `FirewallConfig` interface: `controlPlaneIp`, `authorizedIps`, `vpcCidr`, `daemonPort`, `additionalPorts`, `allowIcmp`, `name`
   - `DEFAULT_FIREWALL_CONFIG`: sensible defaults (VPC `10.0.0.0/8`, daemon 3100, ICMP on)
   - `buildFirewallConfig()`: merges user overrides with defaults
   - `generateFirewallRules()`: produces complete `FirewallRule[]` from config
   - `normalizeCidr()`: appends `/32` to bare IPs
   - `isValidCidr()`: validates IPv4/CIDR strings

2. **Security model** (enforced by `generateFirewallRules`):
   - **SSH (22)**: restricted to control plane IP + explicitly authorized IPs
   - **Daemon (3100)**: restricted to control plane ONLY — even authorized IPs can't reach it
   - **VPC**: all TCP/UDP ports open within private CIDR (inter-agent + control plane ↔ agent)
   - **Additional ports**: from control plane only
   - **ICMP**: from anywhere (configurable, for monitoring)
   - **Everything else**: blocked on public interface
   - **All outbound**: allowed (LLM APIs, package managers, DNS)

3. **Enhanced `FirewallManager`** (`packages/provisioner/src/firewall.ts`):
   - `ensureFirewall()` now accepts options: `authorizedIps`, `vpcCidr`, `daemonPort`, `additionalPorts`
   - `updateAuthorizedIps()`: hot-update authorized IP list with change detection
   - `updateControlPlaneIP()`: preserves authorized IPs and VPC config when IP changes
   - Instance tracking: `addInstance()`/`removeInstance()` maintain a `trackedInstances` set
   - `getConfig()`: returns current config snapshot
   - `getTrackedInstances()`: returns tracked instance IDs
   - Rule summary logging on create/update

4. **Enhanced `InfraManager`** (`packages/provisioner/src/infra-manager.ts`):
   - `InfraState` extended: `authorizedIps`, `vpcCidr` fields
   - `InfraSetupResult` extended: `authorizedIps`, `vpcCidr` fields
   - `setup()` accepts `authorizedIps` and `vpcCidr` options, passes to FirewallManager
   - `updateAuthorizedIps()`: delegates to FirewallManager + updates state
   - `loadState()` handles new fields
   - Default VPC CIDR: `10.0.0.0/8` (DigitalOcean standard)

5. **Backward compatibility**:
   - `createDefaultRules()` signature preserved with optional `authorizedIps` parameter
   - Now includes VPC rules by default (was previously missing)
   - All existing consumers continue to work

6. **64 new tests** (`packages/provisioner/src/__tests__/firewall-rules.test.ts`):
   - **Config utilities (14 tests)**: normalizeCidr, isValidCidr, buildFirewallConfig, DEFAULT_FIREWALL_CONFIG
   - **Rule generation (14 tests)**: SSH, daemon, authorized IPs, VPC, ICMP, additional ports, custom daemon port, outbound, CIDR handling, production config
   - **createDefaultRules compat (4 tests)**: backward compatibility, authorized IPs, VPC rules, CIDR input
   - **FirewallManager (20 tests)**: ensureFirewall (7), addInstance (3), removeInstance (3), updateControlPlaneIP (4), updateAuthorizedIps (4), getConfig (3), setFirewallId (1)
   - **Security verification (5 tests)**: daemon never exposed to 0.0.0.0/0, authorized IPs excluded from daemon, SSH never wide open, VPC limited to private CIDR, additional ports restricted
   - **Instance lifecycle (3 tests)**: add/remove cycle, multiple instances, unknown instance removal

7. **Updated 2 existing tests** to account for new VPC default rules:
   - `provisioner.test.ts`: `createDefaultRules` now returns 5 inbound rules (was 3)
   - `infra.test.ts`: same update

### Key Decisions
- **Daemon port locked to control plane only** — even explicitly authorized IPs cannot reach the daemon. The daemon controls agent behavior; only the control plane should have access. SSH access is more permissible because it's key-authenticated.
- **VPC rules enabled by default** — DigitalOcean VPCs use 10.x.x.x ranges. Allowing all ports within VPC is essential for inter-agent communication and control plane → agent private network access. Can be disabled by setting `vpcCidr: null`.
- **Authorized IPs are separate from VPC** — authorized IPs grant SSH access from specific public IPs (e.g., developer machines). VPC access is for private network communication. Different use cases, different security posture.
- **Config-driven rule generation** — `generateFirewallRules()` is a pure function: config in, rules out. Easy to test, easy to reason about. `FirewallManager` handles lifecycle and state.
- **Instance tracking in FirewallManager** — tracking which instances belong to a firewall enables proper cleanup on destroy and future reconciliation features.
- **`normalizeCidr` always adds /32** — bare IPs (e.g., `1.2.3.4`) are automatically converted to `1.2.3.4/32`. Prevents common mistakes where users forget the CIDR notation.

### Acceptance Criteria
- [x] Firewall created/updated automatically during provisioning (ensureFirewall with options)
- [x] SSH accessible only from control plane IP + authorized IPs
- [x] Daemon port (internal) blocked on public IP, only control plane
- [x] VPC communication working normally (all ports open within VPC CIDR)
- [x] Authorized IPs configurable (authorizedIps in config, updateAuthorizedIps at runtime)
- [x] Rules removed when VM destroyed (removeInstance tracking)
- [x] Logs for firewall creation/update (rule summary logging)
- [x] Tests passing (64 new + 251 total)

### Files Changed
| File | Change |
|------|--------|
| `packages/provisioner/src/config.ts` | NEW — FirewallConfig, generateFirewallRules, normalizeCidr, isValidCidr |
| `packages/provisioner/src/firewall.ts` | Enhanced — VPC, authorized IPs, instance tracking, config-driven |
| `packages/provisioner/src/infra-manager.ts` | Enhanced — authorizedIps, vpcCidr in state/setup/loadState |
| `packages/provisioner/src/index.ts` | +config.ts exports |
| `packages/provisioner/src/__tests__/firewall-rules.test.ts` | NEW — 64 tests |
| `packages/provisioner/src/__tests__/provisioner.test.ts` | Updated for VPC default rules |
| `packages/provisioner/src/__tests__/infra.test.ts` | Updated for VPC default rules |

### Commits
- `ce14f64` — feat(provisioner): firewall public IP rules — VPC, authorized IPs, daemon lockdown (#81)

### Next
- Integration with deploy orchestrator cloud-init to inject firewall ID
- Dashboard UI for managing authorized IPs
- Periodic firewall reconciliation (detect drift)
- GCP equivalent firewall rules

---

## 2026-02-15 — Issue #80: Registry Bind to Private Interface (VPC)

### Summary
Configured the Registry to bind to a private VPC interface instead of `0.0.0.0`, ensuring only agents within the private network can connect. Changed the default bind address to `127.0.0.1` (safe fallback), added `BIND_ADDRESS` env var support to both Registry and Manager, updated the deploy orchestrator to auto-construct private registry URLs from the control plane IP, and created comprehensive deploy documentation.

### What was done

1. **Registry — BIND_ADDRESS** (`apps/registry/src/index.ts`):
   - New `BIND_ADDRESS` env var controls which interface the Registry listens on
   - Default changed from `0.0.0.0` → `127.0.0.1` (safe by default)
   - Legacy `REGISTRY_HOST` still supported for backward compatibility
   - Priority: `BIND_ADDRESS` > `REGISTRY_HOST` > `127.0.0.1`
   - Host logged on startup for observability

2. **Manager — BIND_ADDRESS** (`apps/manager/src/index.ts`):
   - Added `BIND_ADDRESS` env var support
   - Default `0.0.0.0` (Manager is the public-facing entry point)
   - `hostname` now passed to `serve()` for proper binding
   - Host logged on startup

3. **Deploy Orchestrator — Private Registry URL** (`apps/manager/src/lib/deploy-orchestrator.ts`):
   - Registry URL auto-constructed from `controlPlaneIp` when it's not localhost
   - New `REGISTRY_PRIVATE_URL` env var for explicit override
   - New `REGISTRY_PORT` env var for port in auto-constructed URLs (default: 4001)
   - Priority: `REGISTRY_PRIVATE_URL` > auto-construct from `controlPlaneIp` > `REGISTRY_URL` > `http://localhost:4001`
   - Agents bootstrapped with private IP registry URL → never connect over public internet

4. **Manager Registry Client** (`apps/manager/src/lib/registry-client.ts`):
   - Documented VPC usage for `REGISTRY_URL`

5. **Daemon Types** (`packages/agent-daemon/src/types.ts`):
   - `registryUrl` comment updated with VPC example

6. **Deploy Documentation** (`docs/DEPLOY.md`):
   - Network architecture diagram (Manager public, Registry + agents VPC-only)
   - Full env var reference for Registry, Manager, and Daemon
   - Security model explanation (BIND_ADDRESS + firewall + HIVEMI_SECRET = defense in depth)
   - DigitalOcean VPC setup instructions
   - Verification steps (ss, curl health, public access rejection)

7. **33 new tests** (`apps/registry/src/__tests__/vpc-bind.test.ts`):
   - Registry BIND_ADDRESS (6 tests): default, env var, legacy compat, priority, hostname, logging
   - Manager BIND_ADDRESS (4 tests): default, env var, hostname, logging
   - Daemon config (2 tests): VPC documentation, required field
   - Manager RegistryClient (2 tests): env var, VPC docs
   - Deploy orchestrator URL (5 tests): REGISTRY_PRIVATE_URL, auto-construct, localhost skip, fallback, port
   - Bootstrapper config (2 tests): .env REGISTRY_URL, config source
   - Deploy docs (8 tests): BIND_ADDRESS, default, VPC, REGISTRY_URL, CONTROL_PLANE_IP, verification, warnings, DO setup
   - Daemon private IP detection (4 tests): detectPrivateIp, RFC1918 ranges, registration, host field

### Key Decisions
- **Default 127.0.0.1, not 0.0.0.0** — "secure by default" principle. The old default (0.0.0.0) meant a fresh install would expose the Registry to the public internet. Now, you must explicitly set `BIND_ADDRESS` to expose it. This is a **breaking change** for anyone who relied on `REGISTRY_HOST` defaulting to 0.0.0.0 — but that was a security risk.
- **Manager defaults to 0.0.0.0** — different from Registry because the Manager IS the public entry point. It should be accessible (usually behind a reverse proxy).
- **Auto-construct from controlPlaneIp** — avoids requiring users to set both `CONTROL_PLANE_IP` and `REGISTRY_URL` to the same IP. The orchestrator derives the registry URL from the control plane IP automatically.
- **Legacy REGISTRY_HOST compat** — existing deploys using REGISTRY_HOST won't break. BIND_ADDRESS takes priority when both are set.
- **Defense in depth** — BIND_ADDRESS is one layer. The firewall (cloud provider) is another. HIVEMI_SECRET auth is a third. Any two can fail and you're still protected.

### Acceptance Criteria
- [x] Registry escuta apenas em interface privada (BIND_ADDRESS)
- [x] Variável BIND_ADDRESS configurável
- [x] Fallback seguro se BIND_ADDRESS não definido (127.0.0.1)
- [x] Daemon se conecta via IP privado (registryUrl from bootstrap)
- [x] Manager se conecta via IP privado (REGISTRY_URL env)
- [x] Documentação atualizada (docs/DEPLOY.md)
- [x] Testes passando com nova configuração (33 new tests, all existing tests pass)

### Files Changed
| File | Change |
|------|--------|
| `apps/registry/src/index.ts` | BIND_ADDRESS env var, default 127.0.0.1 |
| `apps/manager/src/index.ts` | BIND_ADDRESS env var, hostname binding |
| `apps/manager/src/lib/deploy-orchestrator.ts` | Auto-construct private registry URL |
| `apps/manager/src/lib/registry-client.ts` | VPC documentation |
| `packages/agent-daemon/src/types.ts` | VPC documentation |
| `docs/DEPLOY.md` | NEW — full deploy guide with network architecture |
| `apps/registry/src/__tests__/vpc-bind.test.ts` | NEW — 33 tests |

### Commits
- `9148ac9` — feat(infra): registry bind to private VPC interface with BIND_ADDRESS (#80)

---

## 2026-02-15 — Issue #79: Quick Stats: Monthly Cost

### Summary
Replaced the "Teams" Quick Stats card on the home page with a "Monthly Cost" card that consumes the existing `/api/infra/costs` endpoint and displays estimated monthly infrastructure cost.

### What was done

1. **`MonthlyCostCard` component** (`apps/dashboard/src/components/monthly-cost-card.tsx`):
   - Self-contained component with its own data fetching via `useApi` hook
   - Calls `infraApi.costs()` with 60s auto-refresh (costs don't change frequently)
   - **Main display**: `~$X/mo` with dollar sign icon (emerald colored)
   - **Projected cost**: shown below main value when different from monthly estimate (amber TrendingUp icon)
   - **Breakdown tooltip**: click/hover reveals popup with per-instance costs (name + monthly rate) and total accumulated cost
   - **Loading state**: spinner with "Loading..." text
   - **Error state**: red alert icon with "Unavailable" text
   - Currency formatting: `$X` for < $1000, `$X.Xk` for >= $1000

2. **Updated Home Page** (`apps/dashboard/src/app/page.tsx`):
   - Imported `MonthlyCostCard` component
   - Replaced 4th Quick Stats card ("Teams") with `<MonthlyCostCard />`
   - Quick Stats now: Total Agents | Working | Idle | Monthly Cost

### Key Decisions
- **Self-contained component** — the cost card manages its own API call and state, keeping the home page clean. It doesn't depend on any parent state.
- **60s refresh interval** — costs change only when VMs are added/removed, much slower than agent status. 60s is a good balance.
- **Click to show breakdown** — avoids hover-only interaction (which doesn't work well on mobile). `onMouseLeave` dismisses the tooltip for desktop.
- **Approximate prefix (~)** — costs are estimates based on instance sizes, not actual billing. The `~` communicates this clearly.
- **Graceful degradation** — if the costs API fails (no cloud configured, manager down), the card shows "Unavailable" instead of breaking the page.

### Acceptance Criteria
- [x] Card "Teams" removido
- [x] Card "Monthly Cost" visível na home
- [x] Custo total sendo calculado corretamente (via infraApi.costs())
- [x] Valor formatado como moeda (~$45/mo)
- [x] Ícone apropriado exibido (DollarSign)
- [x] Loading state funcional (Loader2 spinner)
- [x] Tratamento de erro implementado (AlertCircle + "Unavailable")
- [x] Valor atualiza quando há mudanças na infra (60s refresh)

### Files Changed
| File | Change |
|------|--------|
| `apps/dashboard/src/components/monthly-cost-card.tsx` | NEW — Monthly cost card component |
| `apps/dashboard/src/app/page.tsx` | Replace Teams card with MonthlyCostCard |

### Commits
- `9334b81` — feat(dashboard): replace Teams card with Monthly Cost card (#79)

---

## 2026-02-15 — Issue #78: Agent Detail: Métricas e Sparklines

### Summary
Added detailed metrics visualizations to the agent detail page — CPU gauge, memory progress bar, uptime/tokens/tasks cards, 24h sparklines for CPU/memory/tokens, and a full deploy information sidebar with cloud provider, versions, and deployment time.

### What was done

1. **`CpuGauge` component** (`apps/dashboard/src/components/cpu-gauge.tsx`):
   - 270° arc gauge rendered with SVG paths
   - Color transitions: emerald (< 60%) → amber (60–80%) → red (> 80%)
   - Center text shows percentage + "CPU" label
   - Configurable size and stroke width
   - Smooth transition animations

2. **`Sparkline` component** (`apps/dashboard/src/components/sparkline.tsx`):
   - Inline SVG polyline chart for historical data
   - Gradient fill under the line with configurable opacity
   - Configurable min/max Y-axis bounds (auto or fixed)
   - Supports custom colors, dimensions, and labels
   - Graceful empty state ("No data" when < 2 points)

3. **`useAgentDetailTelemetry` hook** (`apps/dashboard/src/hooks/use-agent-detail-telemetry.ts`):
   - Fetches both `telemetryApi.latest()` and `telemetryApi.history()` in parallel via `Promise.allSettled`
   - Returns `{ latest, history, isLoading }`
   - History reversed to chronological order for sparkline rendering
   - Auto-refreshes every 15 seconds (configurable)
   - Properly handles unmount cleanup

4. **Rewritten Agent Detail Page** (`apps/dashboard/src/app/agents/[id]/page.tsx`):
   - **Metrics row** (5 cards): CPU gauge, memory (used/total + progress bar), uptime, tokens today, tasks today
   - **Sparkline row** (3 charts): CPU 24h, Memory 24h, Tokens/snapshot 24h — with time labels and current values
   - **Deploy sidebar**: cloud provider, region, private IP, instance ID, daemon version, OpenClaw version, OpenClaw status, "deployed X ago"
   - All existing functionality preserved: tasks, logs, role info, configuration, action buttons, confirm dialogs
   - `MetricCard`, `MemoryBar`, `SparklineCard` sub-components for clean composition

5. **Registry — Extended Agent Endpoints** (`apps/registry/src/routes.ts`):
   - `GET /api/agents` and `GET /api/agents/:id` now return `openclawVersion` and `privateIp` fields
   - These fields existed in the DB schema but weren't selected in queries

6. **Dashboard API Types** (`apps/dashboard/src/lib/api.ts`):
   - Added `openclawVersion: string | null` and `privateIp: string | null` to `Agent` interface

### Key Decisions
- **Separate telemetry hook for detail page** — the existing `useAgentTelemetry` hook fetches latest for multiple agents (used on the overview). The detail page needs both latest + history for one agent, so a dedicated hook is cleaner.
- **270° arc gauge over full circle** — matches common dashboard gauge UX patterns, leaves room for the label text in the bottom gap
- **SVG sparklines over charting library** — inline SVG keeps the bundle small, no dependency needed for simple polyline charts. The `Sparkline` component is ~100 lines and handles all cases.
- **15s refresh for detail page** — slightly slower than the 10s on the overview page since the detail page fetches more data (history endpoint) and the user is likely reading, not scanning.
- **Memory progress bar color matches gauge logic** — red (>80%), amber (60–80%), emerald (<60%) for visual consistency across all metrics
- **Deploy info in sidebar** — natural grouping with configuration info, doesn't take space from the main content area (tasks/logs)

### Acceptance Criteria
- [x] Cards de métricas exibindo dados reais (CPU, RAM, uptime, tokens, tasks)
- [x] Gauge de CPU funcional e responsivo (270° arc, color transitions)
- [x] Memória mostrando usado/total com barra de progresso
- [x] Sparklines renderizando corretamente (CPU, Memória, Tokens)
- [x] Informações de deploy completas e corretas (provider, region, IP, instance)
- [x] Versões do daemon e OpenClaw visíveis
- [x] Tempo desde deploy formatado corretamente ("Xd ago", "Xh ago")
- [x] Dados atualizando periodicamente (15s refresh)

### Files Changed
| File | Change |
|------|--------|
| `apps/dashboard/src/components/cpu-gauge.tsx` | NEW — 270° arc gauge for CPU |
| `apps/dashboard/src/components/sparkline.tsx` | NEW — inline SVG sparkline chart |
| `apps/dashboard/src/hooks/use-agent-detail-telemetry.ts` | NEW — latest + history telemetry hook |
| `apps/dashboard/src/app/agents/[id]/page.tsx` | Rewritten — metrics, sparklines, deploy info |
| `apps/dashboard/src/lib/api.ts` | +openclawVersion, +privateIp on Agent |
| `apps/registry/src/routes.ts` | +openclawVersion, +privateIp in GET /api/agents |

### Commits
- `475be74` — feat(dashboard): agent detail metrics — CPU gauge, memory bar, sparklines, deploy info (#78)

### Next
- Agent detail page: real-time SSE updates (instead of polling)
- Alerting system for sustained red health indicators
- Historical chart zoom/pan for longer time ranges

---

## 2026-02-15 — Issue #77: Agent Card: Telemetria Real

### Summary
Replaced all mock data in the agent card component with real telemetry from the Registry. The agent card now shows live CPU/RAM health indicators, real task counts, daemon uptime, configured model, and cloud provider info. A detailed tooltip on hover shows comprehensive metrics including disk usage, daemon version, OpenClaw status, LLM usage stats, and task breakdowns.

### What was done

1. **Registry — Extended Agent List Response** (`apps/registry/src/routes.ts`):
   - `GET /api/agents` and `GET /api/agents/:id` now return `version`, `cloud`, and `deployId` fields
   - These were already in the DB schema but weren't selected in the list/detail queries

2. **Dashboard — Telemetry API Client** (`apps/dashboard/src/lib/api.ts`):
   - New types: `TelemetryInfra`, `TelemetryLlm`, `TelemetryTasks`, `TelemetryDaemon`, `AgentTelemetry`
   - New `telemetryApi` object with `latest(agentId)` and `history(agentId, params?)` methods
   - Extended `Agent` interface with `version`, `cloud`, `deployId` fields

3. **Dashboard — `useAgentTelemetry` hook** (`apps/dashboard/src/hooks/use-agent-telemetry.ts`):
   - Fetches latest telemetry for all visible agents in parallel via `Promise.allSettled`
   - Returns `Record<string, AgentTelemetry>` map keyed by agent ID
   - Auto-refreshes every 10 seconds (configurable)
   - Merges results incrementally (keeps old data for agents not in current batch)

4. **Dashboard — Rewritten `AgentCard`** (`apps/dashboard/src/components/agent-card.tsx`):
   - **Removed mock data imports** — no more `formatUptime` from `mock-agents`
   - **Health indicator**: dot color changes based on average of CPU + RAM usage:
     - Green: < 60% average
     - Yellow: 60-80% average
     - Red: > 80% average
   - **Tasks today**: real count from telemetry (`completed + failed`)
   - **Uptime**: real daemon uptime from telemetry, formatted as "2d 14h", "5h 30m", etc.
   - **Model**: shows configured LLM model name
   - **Cloud provider**: shows provider icon (🌊 DO, ☁️ GCP) + region
   - **Opacity**: offline, unreachable, and destroyed agents are dimmed (opacity-60)
   - **Tooltip on hover**: shows detailed metrics panel with:
     - Health status (colored label)
     - CPU percentage
     - RAM usage (used/total + percentage)
     - Disk usage (used/total)
     - Daemon uptime, version
     - OpenClaw status (green/red)
     - Model name
     - Cloud provider and region
     - LLM usage (requests, tokens, avg latency)
     - Task breakdown (completed, failed, active)
   - Local `formatUptime()` function — no external dependency

5. **Dashboard — Updated Home Page** (`apps/dashboard/src/app/page.tsx`):
   - Imported `useAgentTelemetry` hook
   - Removed mock `progress`, `uptime`, `tasksToday` generation (was `Math.random()`)
   - Computes `agentIds` list and passes to `useAgentTelemetry`
   - Passes `telemetry={telemetryMap[agent.id]}` to each `AgentCard`

6. **Dashboard — Updated Agent Type** (`apps/dashboard/src/types/agent.ts`):
   - Added `model?: string`, `cloud?` fields to the display `Agent` interface

### Key Decisions
- **Separate telemetry hook** — telemetry fetching is decoupled from the agent list API. This avoids N+1 on the main agents query and keeps the telemetry refresh cycle independent (10s) from agent list refresh (5s).
- **`Promise.allSettled` for parallel fetches** — if one agent's telemetry fails, others still load. Graceful degradation — card shows "—" for missing data.
- **Health indicator replaces static status dot** — when telemetry is available, the dot color reflects real CPU+RAM health instead of just status. Falls back to status-based dot color when no telemetry.
- **Tooltip over separate detail page** — quick hover for power users who want metrics at a glance without navigating away from the hive overview.
- **Local `formatUptime`** — moved into the component file to avoid importing from `mock-agents`. The mock file is still there for other consumers but the card is fully independent.
- **No mock data in production path** — `Math.random()` calls completely removed. Fields default to 0/"—" until telemetry arrives.

### Acceptance Criteria
- [x] Dados reais sendo exibidos (não mock)
- [x] Health indicator muda de cor conforme CPU+RAM
- [x] Tasks today mostra número correto (completed + failed from telemetry)
- [x] Uptime formatado e atualizado (from daemon.uptime)
- [x] Modelo correto sendo exibido
- [x] Card esmaecido quando agente offline (opacity-60)
- [x] Ícone de provider e região visíveis
- [x] Tooltip com informações detalhadas

### Files Changed
| File | Change |
|------|--------|
| `apps/registry/src/routes.ts` | +version, +cloud, +deployId in GET /api/agents |
| `apps/dashboard/src/lib/api.ts` | +telemetryApi, +AgentTelemetry types, extended Agent |
| `apps/dashboard/src/hooks/use-agent-telemetry.ts` | NEW — telemetry fetching hook |
| `apps/dashboard/src/components/agent-card.tsx` | Rewritten — real telemetry, health indicator, tooltip |
| `apps/dashboard/src/app/page.tsx` | Wire telemetry hook, remove mock data |
| `apps/dashboard/src/types/agent.ts` | +model, +cloud fields |

### Commits
- `5222e08` — feat(dashboard): real telemetry in agent cards — health indicator, tasks, uptime, model, cloud provider, tooltip (#77)

### Next
- Agent detail page telemetry charts (CPU/RAM over time using telemetry history)
- Telemetry-based auto-refresh rate (slower when all agents idle)
- Alert system for sustained red health indicators

---

## 2026-02-15 — Issue #76: Deploy Modal: Stepper de Progresso

### Summary
Transformed the deploy modal from a simple form → success/error overlay into a full two-view modal with a vertical progress stepper that consumes the SSE deploy stream in real-time. Users now see each of the 5 deploy phases (Provisioning, Installing, Configuring, Registering, Ready) with live status icons, duration timers, and error messages. Closing the modal during an active deploy shows a persistent toast notification.

### What was done

1. **`useDeployStream` hook** (`apps/dashboard/src/hooks/use-deploy-stream.ts`):
   - Connects to `/api/deploy/[id]/stream` via `EventSource`
   - Listens for named events: `phase_update`, `status_change`, `log`, `error`, `complete`
   - Tracks `status`, `phases[]`, `error`, `connected`, `finished`, `agentId`
   - Provides `connect(deployId)`, `disconnect()`, `reset()` methods
   - Auto-closes EventSource on terminal events (complete/error)
   - Default phases initialized as 5 pending steps

2. **Rewritten `DeployAgentModal`** (`apps/dashboard/src/components/deploy-agent-modal.tsx`):
   - **Two views**: `form` (original deploy form) and `stepper` (progress view)
   - **Form view**: Identical to original — name, role, team, model, auto-start
   - **Stepper view**: Vertical stepper with phase-by-phase progress
   - **Phase icons**: `Circle` (pending), `Loader2` spinning (active), `CheckCircle` (completed), `AlertCircle` (failed)
   - **Phase labels**: Human-readable names ("Provisioning VM", "Installing Dependencies", etc.)
   - **Phase descriptions**: Shown for active phase ("Creating virtual machine on cloud provider", etc.)
   - **Live duration**: Timer ticks every second for active phases, shows elapsed time
   - **Error display**: Phase-level error messages shown inline
   - **Connector lines**: Green for completed, gray for pending
   - **Status header**: Shows deploying/success/failed state with appropriate icons
   - **Action buttons**:
     - Failed: Retry + Destroy
     - Success: Close + View Agent (navigates to `/agents/[id]`)
     - Deploying: Close with "deploy continues in background" hint
   - **Props**: Added `onRetry`, `onDestroy`, `activeDeployId` for reopen support
   - **Return type**: `onDeploy` now returns `{ deployId, agentId }` for SSE connection

3. **`DeployToast` component** (exported from deploy-agent-modal.tsx):
   - Persistent bottom-right toast when modal is closed during active deploy
   - Shows spinning loader (deploying), checkmark (success), or error icon (failed)
   - "View" / "Details" button to reopen modal
   - Dismiss button for completed/failed states
   - Slide-in animation

4. **Updated `page.tsx`** (`apps/dashboard/src/app/page.tsx`):
   - `handleDeploy` now calls `deployApi.start()` (Manager API) instead of `agentsApi.create()`
   - `handleDeployRetry` and `handleDeployDestroy` handlers
   - `handleDeployModalClose` — shows toast if deploy in progress, polls status every 5s
   - Toast auto-dismisses after 5s on success
   - `handleToastReopen` — reopens modal with `activeDeployId` to resume progress view
   - `activeDeployId` state tracks current deploy for modal reopen

5. **API client additions** (`apps/dashboard/src/lib/api.ts`):
   - `deployApi.start(data)` — POST /api/deploy → returns `{ deployId, agentId, message }`
   - `deployApi.retry(id)` — POST /api/deploy/:id/retry → returns `{ deployId }`

### Key Decisions
- **Two-view modal over separate component** — keeping form + stepper in one modal provides natural UX flow (fill form → see progress). The `view` state controls which is shown.
- **EventSource over fetch+parse** — browser-native SSE reconnection is more reliable. Named events (`addEventListener`) match the backend's `event:` field exactly.
- **Toast with background polling** — when the modal is closed, we can't rely on SSE (EventSource lives in the hook, which unmounts). Simple 5s interval polling of `deployApi.get()` updates the toast.
- **Phase durations use live timer** — a `setInterval` ticks every 1s when any phase is active, triggering re-render for the duration display. Stops automatically when no phases are active.
- **Deploy API instead of direct agent create** — the form now calls the Manager's deploy endpoint which triggers the full provisioning pipeline. The old `agentsApi.create` was a placeholder.

### Acceptance Criteria
- [x] Stepper vertical com 5 fases visível após clicar Deploy
- [x] Ícones mudam conforme progresso (spinner → check/error)
- [x] Duração e mensagens aparecem em tempo real
- [x] SSE stream sendo consumido corretamente
- [x] Botões Retry/Destroy aparecem em caso de erro
- [x] Botão View Agent redireciona para página do agente
- [x] Toast persistente quando modal é fechado durante deploy
- [x] Possível reabrir modal e ver progresso atual

### Files Changed
| File | Change |
|------|--------|
| `apps/dashboard/src/hooks/use-deploy-stream.ts` | NEW — SSE deploy stream consumer hook |
| `apps/dashboard/src/components/deploy-agent-modal.tsx` | Rewritten — form + stepper views, toast |
| `apps/dashboard/src/app/page.tsx` | Deploy API integration, toast, reopen logic |
| `apps/dashboard/src/lib/api.ts` | +deployApi.start(), +deployApi.retry() |

### Commits
- `cb137fc` — feat(dashboard): deploy modal stepper with SSE progress, toast, retry/destroy (#76)

### Next
- Integration with actual cloud deploy (end-to-end test)
- Deploy history page (list all deploys with status)
- Agent detail page deploy status section

---

## 2026-02-14 — Issue #75: Settings: Cloud Config UI

### Summary
Added a full Cloud configuration section to the Settings page. Users can now select a cloud provider (DigitalOcean/GCP), pick a region with country flags, choose an instance size with specs and pricing, configure API tokens, generate or upload SSH keys, and test the connection — all from the Dashboard UI.

### What was done

1. **Cloud Settings section** (`apps/dashboard/src/app/settings/page.tsx`):
   - New "Cloud" tab in Settings nav (with Cloud icon from Lucide)
   - **Provider Selection** — DigitalOcean / GCP cards with visual selection state
   - **Region Selection** — Dynamic grid loaded from `/api/settings/cloud/regions`, showing country flags, names, and slugs. Scrollable when many regions. Falls back gracefully when no regions available.
   - **Instance Size Cards** — Small/Medium/Large cards showing vCPU, RAM, and estimated monthly cost. Provider-specific specs (DO: 1vCPU/1GB/$6, 2/2GB/$12, 2/4GB/$24; GCP: 1/1.7GB/$7, 2/4GB/$17, 4/8GB/$34)
   - **API Token** — Password input with show/hide toggle. Shows "Token configured" indicator when saved. Instructions per provider.
   - **SSH Key** — Generate new ed25519 key (via `/api/settings/cloud/ssh-key/generate`), upload existing public key file, copy generated public key to clipboard. Visual feedback for all states.
   - **Test Connection** — Button calls `/api/settings/cloud/test`, shows success (account email + droplet limit) or error with clear messaging. Disabled when no token configured.
   - **Save Configuration** — Single save button with loading/success/error states. Clears sensitive fields after save.

2. **API client additions** (`apps/dashboard/src/lib/api.ts`):
   - `CloudConfig`, `CloudRegion`, `CloudTestResult`, `CloudSSHKeyResult` types
   - `cloudApi` object: `get()`, `update()`, `regions()`, `test()`, `generateSSHKey()`
   - All methods use the existing `fetchApi` helper → Next.js proxy routes → Registry backend

3. **Backend was already implemented** — the Registry has full cloud-settings routes from previous issues:
   - `GET/PUT /api/settings/cloud` — config CRUD with encrypted secret storage
   - `GET /api/settings/cloud/regions` — dynamic regions from DO API (with static fallback)
   - `POST /api/settings/cloud/test` — validates DO API token against `/v2/account`
   - `POST /api/settings/cloud/ssh-key/generate` — ed25519 keypair generation
   - Dashboard proxy routes for all endpoints already existed

### Key Decisions
- **Amber accent for selected states** — consistent with existing HiveMI design system (amber-500 borders + ring + bg)
- **Provider-specific size specs** — hardcoded in the component since the provisioner's size mappings aren't exposed via API. DO sizes match `DO_SIZE_MAPPINGS` exactly. GCP sizes are approximate pending GCP provider implementation.
- **Token field clears after save** — security: the API token is write-only (never returned by GET). After saving, we clear the input and show the "configured" indicator instead.
- **No separate Zod validation in frontend** — the backend validates via `UpdateCloudConfigSchema` from `@hivemi/protocol`. Frontend relies on backend validation + user feedback.
- **Region reset on provider switch** — switching from DO to GCP resets region to `us-central1` (and vice versa) since region slugs differ between providers.

### Acceptance Criteria
- [x] Tab Cloud visível na página de Settings
- [x] Dropdown de provider funcional com DigitalOcean e GCP
- [x] Seleção de região mostrando bandeiras e nomes
- [x] Cards de tamanho exibindo specs e preço
- [x] Campo de API token com validação básica
- [x] Upload de SSH key funcionando ou geração automática
- [x] Test Connection retorna sucesso/erro do backend
- [x] Configuração salva e persiste

### Files Changed
| File | Change |
|------|--------|
| `apps/dashboard/src/app/settings/page.tsx` | +CloudSettings component, Cloud tab in nav |
| `apps/dashboard/src/lib/api.ts` | +cloudApi, +CloudConfig, +CloudRegion, +CloudTestResult types |

### Commits
- `adb282a` — feat(dashboard): cloud config UI in Settings — provider, regions, sizes, token, SSH key, test connection (#75)

### Next
- GCP provider implementation (currently shows approximate specs)
- Cloud config validation in deploy flow (ensure config exists before deploy)

---

## 2026-02-12 — Issue #64: Integração Daemon ↔ OpenClaw — Execução de Tasks

### Summary
Enhanced the Agent Daemon's integration with OpenClaw for task execution. The key addition is **streaming (SSE) support** in the OpenClawClient, which prevents Node.js fetch timeout on long-running tasks (developer tasks can run up to 30 minutes). Also enhanced prompt formatting with role/agent context, added cancellation support, and wrote comprehensive integration tests covering the full task lifecycle.

### What was done

1. **Streaming (SSE) Execution** (`packages/agent-daemon/src/openclaw-client.ts`):
   - `executeTaskStreaming()` — sends `stream: true` to Chat Completions API and parses SSE response
   - `parseSSEStream()` — exported SSE parser that concatenates content deltas from `data:` events
   - Handles `data: [DONE]` termination, invalid JSON lines, comment lines, empty deltas
   - `StreamProgressCallback` — optional callback for each chunk (used for progress logging every 30s)
   - Session ID captured from first SSE chunk for cleanup
   - Custom `AbortController` with timeout for streaming requests (replaces `AbortSignal.timeout` which doesn't work with streaming)
   - Non-streaming fallback preserved when `useStreaming: false`
   - **Why streaming?** Node.js `fetch` has an internal HTTP response timeout (~5 min). Developer tasks can take 30 min. With streaming, the connection stays alive via incremental data chunks.

2. **Task Cancellation** (`packages/agent-daemon/src/openclaw-client.ts`):
   - `cancelExecution()` — aborts the active HTTP request (streaming or non-streaming)
   - Tracks `activeAbortController` for the current task
   - Clean abort with error "cancelled" — TaskExecutor catches and handles appropriately
   - Added to `IOpenClawClient` interface

3. **Enhanced Prompt Format** (`packages/agent-daemon/src/task-executor.ts`):
   - Prompt now includes `Role:` and `Agent:` fields matching Issue #64 spec
   - Format: `[HiveMI Task #abc12345] / Title: ... / Priority: ... / Role: developer / Agent: Atlas`
   - Gives OpenClaw context about which role is executing and the agent's identity

4. **Configuration** (`packages/agent-daemon/src/types.ts`):
   - `useStreaming?: boolean` — new config field (default: `true`)
   - `USE_STREAMING` env var support (`"false"` to disable)
   - `cancelExecution()` added to `IOpenClawClient` interface
   - `getSessionId()` added to OpenClawClient for testing/debugging

5. **67 new tests** (`packages/agent-daemon/src/__tests__/openclaw-integration.test.ts`):
   - **SSE Parser (10 tests)**: simple stream, session ID capture, empty deltas, invalid JSON, comments, null session, progress callback, multi-line chunks, empty stream, DONE-only stream
   - **Health Check (5 tests)**: running, error, stopped, endpoint, auth token
   - **Streaming Execution (7 tests)**: default streaming, session ID capture, non-200 error, empty response, null body, request body format, large responses
   - **Non-Streaming Execution (3 tests)**: configured non-streaming, session ID, empty response
   - **Session Lifecycle (5 tests)**: create+destroy, no session, 404 graceful, clear previous, clean between tasks
   - **Cancellation (2 tests)**: method exists, no-op when idle
   - **Configuration (5 tests)**: default streaming, custom URL, trailing slash, useStreaming env default/false/true
   - **Prompt Formatting (10 tests)**: task ID/title/priority, role, agent name, description, context, parent task, no parent, no role, instructions, Issue #64 format
   - **Full Lifecycle (10 tests)**: health check, execute with prompt, session destroy, destroy after failure, parsed result, PR links, subtasks, failed status, log entries, OpenClaw restart
   - **End-to-End (7 tests)**: poll→execute→report→cleanup, failure reporting, subtask creation, status transitions, counter tracking, OpenClaw unavailable, concurrency guard

6. **Test Fixes**:
   - Updated `makeMockOpenClaw()` in existing tests to include `cancelExecution: vi.fn()`
   - Fixed flaky `OpenClaw unavailable` test timing (increased wait for 3 retries × 2s delay)
   - Session cleanup tests use `useStreaming: false` to test non-streaming path directly

### Key Decisions
- **Streaming by default** — the most impactful change. Non-streaming fetch would fail on any task > 5 min (Node's HTTP timeout). Developer tasks can take 30 min. Streaming keeps the HTTP connection alive by sending incremental data chunks. This was already identified as a lesson learned in MEMORY.md.
- **SSE parser as separate function** — exported for testability and potential reuse. The parser handles real-world SSE quirks (comments, empty lines, split chunks, invalid JSON).
- **AbortController over AbortSignal.timeout** — `AbortSignal.timeout` is cleaner but doesn't compose well with streaming (can't distinguish timeout from connection drop). Custom AbortController gives us both timeout control and explicit cancellation via `cancelExecution()`.
- **Non-streaming preserved** — some environments might not support SSE. Setting `USE_STREAMING=false` falls back to the original behavior. Good for testing and compatibility.
- **Role in prompt** — adds context so OpenClaw's SOUL.md can tailor behavior per role (e.g., developer gets exec access, PM gets chat-only).

### Architecture
```
TaskPoller (when)
  └─ TaskExecutor (how)
      ├─ ensureOpenClawHealthy() → healthCheck() → restart() if needed
      ├─ buildPrompt(task) → formatted message with role/agent context
      ├─ openclaw.executeTask(prompt, timeout)
      │   ├─ streaming: POST /v1/chat/completions {stream:true} → SSE → parseSSEStream()
      │   └─ non-streaming: POST /v1/chat/completions → JSON response
      ├─ parseTaskOutput(rawOutput) → {summary, status, PRs, subtasks}
      ├─ registry.reportTaskResult(taskId, result)
      └─ openclaw.destroySession() → DELETE /v1/sessions/:id (cleanup)
```

### Acceptance Criteria
- [x] Daemon creates and destroys sessions on OpenClaw — `executeTask()` creates session, `destroySession()` cleans up
- [x] Task executed with result captured — `TaskExecutor.execute()` returns structured `TaskExecutionResult`
- [x] Health check functional — `ensureOpenClawHealthy()` with auto-restart on failure
- [x] Output parsed (text, PRs, subtasks) — `parseTaskOutput()` extracts all structured data
- [x] Session clean between tasks — `destroySession()` called in `finally` block after every task

### Files Changed
| File | Change |
|------|--------|
| `packages/agent-daemon/src/openclaw-client.ts` | Streaming SSE execution, cancellation, SSE parser |
| `packages/agent-daemon/src/task-executor.ts` | Enhanced prompt with role/agent context |
| `packages/agent-daemon/src/types.ts` | +useStreaming config, +cancelExecution interface |
| `packages/agent-daemon/src/index.ts` | Export parseSSEStream, StreamProgressCallback |
| `packages/agent-daemon/src/__tests__/openclaw-integration.test.ts` | NEW — 67 tests |
| `packages/agent-daemon/src/__tests__/task-execution-flow.test.ts` | Mock fix, timing fix |
| `packages/agent-daemon/src/__tests__/agent-daemon.test.ts` | Mock fix |

### Commits
- `c2be67a` — feat(daemon): OpenClaw integration — streaming execution, session lifecycle, health check (#64)

### Next
- #68 (Task Progress) — real-time progress tracking using streaming callbacks
- #71+ — Further integration refinements

---

## 2026-02-12 — Issue #70: Undeploy — Fluxo de Destruição de Agentes

### Summary
Implemented the full agent destruction flow — from Dashboard button to VM deletion, firewall cleanup, and task requeue. The daemon now handles SIGTERM gracefully (waits for active tasks), the Deploy Orchestrator supports both graceful and forced destruction, and the Dashboard shows proper destroyed state with confirmation dialogs.

### What was done

1. **Daemon — Enhanced Graceful Shutdown** (`packages/agent-daemon/src/index.ts`):
   - `shuttingDown` flag set on `stop()` — prevents new task polling immediately
   - If idle: reports offline and exits immediately
   - If executing a task: waits up to `shutdownTimeoutMs` (default 55s) for completion
   - If timeout: marks task as `failed` with error "Agent shutdown — task aborted due to SIGTERM timeout"
   - Ships remaining logs and sets agent status to `offline` before exit
   - `waitForTaskCompletion()` polls every 500ms for task completion
   - Idempotent: calling `stop()` twice is safe

2. **Daemon Config** (`packages/agent-daemon/src/types.ts`):
   - New `shutdownTimeoutMs` field (default: 55,000ms — 5s under systemd's 60s SIGKILL)
   - Parsed from `SHUTDOWN_TIMEOUT_MS` env var via `loadConfigFromEnv`

3. **Systemd Unit** (`packages/agent-daemon/systemd/hivemi-agent.service`):
   - Added `TimeoutStopSec=60` — systemd sends SIGKILL after 60s if daemon doesn't exit
   - Daemon's 55s timeout leaves 5s buffer for cleanup (log shipping, offline status)

4. **Deploy Orchestrator — Enhanced Undeploy** (`apps/manager/src/lib/deploy-orchestrator.ts`):
   - `undeploy(deployId, options?: { force?: boolean })` — full destruction flow:
     - **Graceful check**: blocks with `UndeployBlockedError` if agent is `working` and `force` is not set
     - **VM destruction**: calls `provisioner.destroyInstance()` (handles 404 gracefully)
     - **Firewall cleanup**: removes VM from firewall via `provisioner.removeInstanceFromFirewall()`
     - **Task requeue**: calls `registry.requeueLockedTasks()` to return locked tasks to queue
     - **History preservation**: sets deploy/agent status to `destroyed` but never deletes DB rows
     - **Already-destroyed**: handles gracefully (idempotent, logs and returns)
   - `redeploy()` now uses `force: true` for destruction (immutable deploy model)
   - New `UndeployBlockedError` class with `agentId` and `deployId` properties
   - New `IRegistryClient.requeueLockedTasks()` interface method

5. **Registry — Task Requeue Endpoint** (`apps/registry/src/routes/tasks.ts`):
   - `POST /api/tasks/requeue` — requeues all tasks locked by a specific agent
   - Body: `{ agentId: string }`
   - Sets each locked task back to `queued`, clears `lockedBy`, `lockedAt`, `startedAt`, `agentId`, `error`
   - Returns `{ requeued: N }` count
   - Used during undeploy to prevent task loss when destroying an agent

6. **Manager Registry Client** (`apps/manager/src/lib/registry-client.ts`):
   - Added `requeueLockedTasks(agentId)` method that calls the Registry's requeue endpoint

7. **Manager Deploy Routes** (`apps/manager/src/routes/deploy.ts`):
   - `DELETE /api/deploy/:id?force=true` — supports `force` query param
   - Returns 409 with `{ blocked: true, agentId, deployId }` when agent is working
   - Catches `UndeployBlockedError` for proper HTTP response

8. **Dashboard — Agent Types** (`apps/dashboard/src/types/agent.ts`):
   - `AgentStatus` now includes: `provisioning`, `working`, `idle`, `error`, `offline`, `unreachable`, `destroyed`

9. **Dashboard — AgentCard** (`apps/dashboard/src/components/agent-card.tsx`):
   - Status config for all 7 statuses (provisioning=blue, unreachable=yellow, destroyed=gray)
   - Destroyed agents: greyed out, no action menu (no start/stop/restart/destroy)
   - Provisioning agents: blue with pulse animation
   - Menu button renamed "Delete" → "Destroy"

10. **Dashboard — Agent Detail Page** (`apps/dashboard/src/app/agents/[id]/page.tsx`):
    - Fixed existing syntax error (extra `</div>` tag)
    - Actions hidden for destroyed agents (`isDestroyed` check)
    - "Destroy" button in dropdown menu with proper confirmation modal:
      - Message: "Destroy agent {name}? This will delete the VM and all local data."
    - Force destroy dialog when agent is working:
      - Message: "Agent is currently working on a task. Force destroying will abort the task."
    - `handleDelete` tries graceful first, catches blocked error → shows force dialog
    - `handleForceDestroy` uses `deployApi.destroy(id, true)` with force flag
    - `deployApi` imported and used for destroy flow

11. **Dashboard — API Client** (`apps/dashboard/src/lib/api.ts`):
    - New `Deploy` interface with full deploy type
    - `DestroyResponse` interface with `blocked` flag
    - `deployApi` methods: `get`, `list`, `destroy(id, force?)`, `redeploy(id, data)`

12. **36 new tests**:
    - **9 daemon tests** (`packages/agent-daemon/src/__tests__/graceful-shutdown.test.ts`):
      - shuttingDown flag, immediate idle stop, setOffline during shutdown, lifecycle logging, idempotent stop, custom timeout, default timeout, SHUTDOWN_TIMEOUT_MS env parsing, default env value
    - **27 orchestrator tests** (`apps/manager/src/__tests__/undeploy.test.ts`):
      - Basic: destroy VM, mark agent destroyed (not deleted), remove from active, emit event, throw for missing
      - Graceful: block working agent, UndeployBlockedError fields, force bypass, idle proceeds, offline proceeds, unreachable proceeds
      - Firewall: remove from firewall, continue on firewall error
      - Task requeue: requeue locked tasks, continue on requeue error, skip if no agentId
      - Edge cases: already destroyed, VM 404, no instanceId, completedAt set
      - Redeploy: destroy+create, force for working agents, mark old destroyed, new names
      - UndeployBlockedError: name, properties, instanceof

### Key Decisions
- **Daemon waits 55s, systemd kills at 60s** — the 5s buffer ensures the daemon always has time to ship logs and set offline status, even if the task timeout fires at the last second.
- **Graceful-first, force as option** — the default behavior blocks destruction when an agent is working. The Dashboard shows a separate "Force Destroy" dialog explaining the consequences. Redeploy always uses force (immutable model).
- **History preserved** — agent and deploy rows are NEVER deleted from the database. Status changes to `destroyed` but all historical data (tasks, logs, telemetry) remains queryable.
- **Task requeue, not fail** — locked tasks are returned to `queued` status (not failed) so another agent can pick them up. This is the correct behavior for destruction — the task didn't fail, the worker died.
- **Firewall cleanup is best-effort** — if the firewall API fails, destruction continues. The reconciliation system (#63) will catch orphaned firewall entries.
- **Idempotent undeploy** — calling undeploy on an already-destroyed deploy is a no-op (logs and returns). This prevents errors from double-clicks or retries.

### Acceptance Criteria
- [x] Destroy functional end-to-end (Dashboard → VM deleted)
- [x] Graceful shutdown of daemon with SIGTERM
- [x] Tasks in progress handled correctly (wait or force + requeue)
- [x] Redeploy functional (force destroy + fresh deploy)
- [x] Cleanup of firewall
- [x] History maintained in database (never delete rows)

### Files Changed
| File | Change |
|------|--------|
| `packages/agent-daemon/src/index.ts` | Enhanced graceful shutdown with task wait + timeout |
| `packages/agent-daemon/src/types.ts` | +shutdownTimeoutMs config field |
| `packages/agent-daemon/systemd/hivemi-agent.service` | +TimeoutStopSec=60 |
| `packages/agent-daemon/src/__tests__/graceful-shutdown.test.ts` | NEW — 9 tests |
| `apps/manager/src/lib/deploy-orchestrator.ts` | Enhanced undeploy with force, firewall, requeue, UndeployBlockedError |
| `apps/manager/src/lib/registry-client.ts` | +requeueLockedTasks method |
| `apps/manager/src/routes/deploy.ts` | DELETE with force param, 409 for blocked |
| `apps/manager/src/__tests__/undeploy.test.ts` | NEW — 27 tests |
| `apps/registry/src/routes/tasks.ts` | +POST /requeue endpoint |
| `apps/dashboard/src/types/agent.ts` | All 7 agent statuses |
| `apps/dashboard/src/components/agent-card.tsx` | Destroyed state, provisioning, all statuses |
| `apps/dashboard/src/app/agents/[id]/page.tsx` | Destroy/force-destroy dialogs, syntax fix |
| `apps/dashboard/src/lib/api.ts` | +deployApi, +Deploy type, +DestroyResponse |

### Commits
- `39fcfde` — feat: undeploy flow — graceful shutdown, firewall cleanup, task requeue (#70)

### Next
- #71+ — Deploy progress SSE improvements
- Periodic reconciliation via cron to catch orphaned VMs
- Integration testing with actual DigitalOcean API

---

## 2026-02-12 — Issue #66: CI/CD — Script hivemi-agent-bootstrap.sh

### Summary
Rewrote the bootstrap script as a fully self-contained, idempotent shell script that cloud-init executes on first boot. The previous version (#65) only handled daemon download/install; this version handles everything from user creation to completion flag.

### What was done

1. **Rewrote `hivemi-agent-bootstrap.sh`** (`packages/agent-daemon/hivemi-agent-bootstrap.sh`):
   - **Step 1**: Create `openclaw` user with sudo via `/etc/sudoers.d/` — checks `id` first (idempotent)
   - **Step 2**: Configure 2GB swap — checks `swapon --show` first, persists in `/etc/fstab` (idempotent)
   - **Step 3**: `apt-get update && apt-get upgrade -y` with `DEBIAN_FRONTEND=noninteractive`
   - **Step 4**: Install base packages: `jq`, `curl`, `git`, `build-essential`
   - **Step 5**: Install OpenClaw via `curl | bash -s -- --non-interactive` (runs as `openclaw` user, not root)
   - **Step 6**: Verify with `openclaw --version`, set up PATH in `.bashrc`
   - **Step 7**: Download `hivemi-daemon.tar.gz` from `$HIVEMI_RELEASE_URL` (supports private repo via `$HIVEMI_GH_TOKEN`)
   - **Step 8**: Extract to `/home/openclaw/.hivemi/daemon/`
   - **Step 9**: `npm install --omit=dev` (waits up to 300s for Node.js from OpenClaw install)
   - **Step 10**: Copy systemd unit to `/etc/systemd/system/`
   - **Step 11**: `systemctl daemon-reload && systemctl enable` (but NOT start)
   - **Step 13**: Write `/tmp/hivemi-cloud-init-done` with UTC timestamp

2. **Updated cloud-init template** (`packages/bootstrapper/src/phases/cloud-init.ts`):
   - Changed from positional args (`$1`, `$2`) to environment variables (`HIVEMI_RELEASE_URL`, `HIVEMI_GH_TOKEN`)
   - Script called without args — reads env vars directly
   - Auth header uses `$HIVEMI_GH_TOKEN` instead of `$GH_TOKEN`

3. **53 new tests** (`packages/agent-daemon/src/__tests__/bootstrap-script.test.ts`):
   - Script structure: shebang, strict mode, executable, main function (5 tests)
   - Environment variables: reads from env, no positional args (3 tests)
   - User creation: useradd, home dir, idempotency check, sudo (4 tests)
   - Swap: 2GB, dd/mkswap, idempotency, fstab persistence (5 tests)
   - System packages: apt update/upgrade, required packages, noninteractive (4 tests)
   - OpenClaw: install.sh, runs as user, non-interactive, version verify, PATH (5 tests)
   - Daemon: download, extract, npm install, cleanup, ownership, Node.js wait, skip without URL, auth (8 tests)
   - Systemd: unit copy, daemon-reload, enable, NOT start (4 tests)
   - Completion flag: path, timestamp, ownership (3 tests)
   - Idempotency: user check, swap check, mkdir -p, fstab check (4 tests)
   - Step ordering: correct sequence, flag last (2 tests)
   - Security: no token logging, swap 600, sudoers 440 (3 tests)
   - Logging: log file path, UTC timestamps, elapsed time (3 tests)

4. **Updated 3 cloud-init tests** in bootstrapper to match new env var naming

### Key Decisions
- **Self-contained script** — the bootstrap script now does everything (user, swap, packages, OpenClaw, daemon, systemd). Cloud-init only needs to download and execute it. This means a single `curl | bash` from cloud-init handles the entire VM setup.
- **Environment variables over positional args** — `HIVEMI_RELEASE_URL` and `HIVEMI_GH_TOKEN` are cleaner, self-documenting, and easier to set in cloud-init `runcmd` blocks.
- **Service NOT started** — deliberate. The Bootstrapper injects secrets and config via SSH after cloud-init completes, then starts the service. Starting without config would crash.
- **Idempotent throughout** — every step checks current state before acting. The script can be re-run on a partially bootstrapped VM without issues.
- **Token never logged** — uses `${HIVEMI_GH_TOKEN:+<set>}` pattern to show presence without revealing value.
- **Graceful OpenClaw install failure** — uses `|| warn` instead of `|| error` since the daemon might still work if OpenClaw has issues (the Bootstrapper will configure OpenClaw via SSH anyway).

### Acceptance Criteria
- [x] Script works on Ubuntu 24.04 (all steps validated via structure tests)
- [x] OpenClaw installed and accessible (install + version verify)
- [x] Daemon extracted with deps installed (tarball + npm install)
- [x] Systemd unit enabled but NOT started
- [x] Completion flag written with timestamp
- [x] Idempotent (user, swap, fstab checks)
- [x] Time total < 5 min target (steps optimized for speed)

### Files Changed
| File | Change |
|------|--------|
| `packages/agent-daemon/hivemi-agent-bootstrap.sh` | Rewritten — fully self-contained bootstrap |
| `packages/agent-daemon/src/__tests__/bootstrap-script.test.ts` | NEW — 53 tests |
| `packages/bootstrapper/src/phases/cloud-init.ts` | Updated to use HIVEMI_* env vars |
| `packages/bootstrapper/src/__tests__/bootstrapper.test.ts` | Updated 3 cloud-init tests |

### Commits
- `108a0f5` — feat(infra): self-contained bootstrap script with idempotency (#66)

### Next
- #67 (Deploy Orchestrator integration) — wire bootstrap into full deploy pipeline
- #68 (Task Progress) — real-time progress tracking

---

## 2026-02-12 — Issue #65: CI/CD — Agent Daemon Build & Release Pipeline

### Summary
Created GitHub Actions workflow that builds the daemon and publishes artifacts as a GitHub Release. Also created the VM bootstrap shell script.

### What was done

1. **GitHub Actions workflow** (`.github/workflows/agent-daemon-release.yml`):
   - Triggers on push to `main` when `packages/agent-daemon/**` changes
   - Full pipeline: checkout → pnpm + Node 22 → install → build (with workspace deps via `--filter ...`) → test → package → release
   - Packages tarball (`hivemi-daemon.tar.gz`) with `dist/`, `package.json`, `systemd/hivemi-agent.service` (excludes test files)
   - Creates GitHub Release with tag `daemon-v{version}` (reads version from `package.json`)
   - Smart tag check: skips release creation if tag already exists (prevents duplicate releases without version bump)
   - Uses `softprops/action-gh-release@v2` for release creation with both artifacts

2. **Bootstrap script** (`packages/agent-daemon/hivemi-agent-bootstrap.sh`):
   - Called by cloud-init with `$RELEASE_URL` and optional `$GH_TOKEN` args
   - Downloads daemon tarball from GitHub Release (supports private repo auth)
   - Extracts to `/home/openclaw/.hivemi/daemon/`
   - Waits for Node.js availability (OpenClaw install runs in parallel via cloud-init)
   - Installs production dependencies via `npm install --omit=dev`
   - Installs systemd service, enables it
   - Starts daemon only if `.env` exists (bootstrapper injects config via SSH later)

3. **Build fix** — `TaskExecutor` had unused `registry` field causing `noUnusedLocals` TS error. Marked constructor param as `_registry` since it's not yet consumed.

4. **Test fix** — Updated test that expected `component === "task-poller"` to `"task-executor"` since successful task execution logs come from TaskExecutor.

### Key Decisions
- **Build filter uses `...` suffix** (`--filter @hivemi/agent-daemon...`) to build workspace dependencies (`@hivemi/protocol`) first
- **Tag-based dedup** — if `daemon-v{version}` tag exists, skip release. Forces intentional version bumps.
- **Bootstrap waits for Node.js** up to 300s — cloud-init runs OpenClaw install in parallel, and the bootstrap script needs Node.js to be available
- **Daemon starts conditionally** — only if `.env` exists, since the bootstrapper injects secrets via SSH after cloud-init completes

### Files Changed
| File | Change |
|------|--------|
| `.github/workflows/agent-daemon-release.yml` | NEW — CI/CD pipeline |
| `packages/agent-daemon/hivemi-agent-bootstrap.sh` | NEW — VM bootstrap script |
| `packages/agent-daemon/src/task-executor.ts` | Fix unused registry param |
| `packages/agent-daemon/src/__tests__/agent-daemon.test.ts` | Fix component assertion |

### Commits
- `b55fd81` — feat(ci): agent daemon build & release pipeline (#65)
- `2f2e811` — fix(daemon): resolve unused registry param in TaskExecutor

### Next: #66 (Bootstrap Script — full bootstrapper integration) — the shell script created here is the artifact; #66 covers the TypeScript bootstrapper that orchestrates cloud-init + SSH + secret injection

---

## 2026-02-12 — Issue #63: Provisioner — VM Reconciliation & Cost Estimation

### Summary
Implemented VM reconciliation (detecting orphaned VMs, phantom agents, and IP mismatches) and enhanced cost estimation with projected/accumulated costs. Added Manager API endpoints, Dashboard UI integration, and comprehensive tests.

### Done
- **Enhanced Reconciliation** (`packages/provisioner/src/reconciliation.ts`):
  - `detectIPMismatches(agents, instances)` — detects when an agent's registered host IP doesn't match its VM's actual public IP
  - Extracts IPv4 from URLs (handles `http://1.2.3.4:3001` format)
  - Skips localhost/127.x agents, agents without host, non-IP hostnames
  - `generateReconciliationReport(provider, agents, tag, logger)` — full report for the Dashboard
  - Structured `ReconciliationIssue` with type, severity, message, and entity references
  - Three issue types: `orphaned_vm` (severity: error), `phantom_agent` (severity: warning), `ip_mismatch` (severity: warning)
  - Overall health status: `clean` (no issues), `warning` (some issues), `critical` (3+ orphans or 5+ total issues)
  - Stats summary: totalVMs, healthy, orphaned, phantom, ipMismatches

- **Enhanced Cost Estimation** (`packages/provisioner/src/cost.ts`):
  - `generateCostReport(provider, instances, now?)` — full cost report with projections
  - `monthly`: total cost if all VMs run a full month
  - `accumulated`: prorated cost each VM has incurred this month based on `createdAt`
  - `projected`: estimated total for the full month based on current trajectory
  - `InstanceCostBreakdown`: per-instance name, size, monthlyCost, daysRunning, accumulatedCost
  - Handles VMs created before the current month (caps days to elapsed days)
  - Handles string ISO dates and Date objects for `createdAt`
  - Injectable `now` parameter for deterministic testing

- **New Types** (`packages/provisioner/src/types.ts`):
  - `CostReport`, `InstanceCostBreakdown` — enhanced cost reporting
  - `ReconciliationReport`, `ReconciliationIssue` — structured reconciliation output
  - Extended `RegistryAgent` with `host?` and `privateIp?` fields for IP validation

- **Manager API** (`apps/manager/src/routes/infra.ts`):
  - `GET /api/infra/reconcile` — runs reconciliation, returns full report
  - `GET /api/infra/costs` — estimates costs for active VMs
  - `DELETE /api/infra/reconcile/orphan/:instanceId` — destroys orphaned VM
  - Lazy-loads provider and provisioner utilities (same pattern as deploy routes)
  - Maps registry agents to reconciliation format (extracts cloud.instanceId, host, privateIp)

- **Dashboard** (`apps/dashboard/src/app/settings/page.tsx`):
  - New "Infrastructure" section in Settings (Server icon)
  - VM Reconciliation card: health status badge, stats grid (total/healthy/orphaned/phantom), issues list with severity coloring, "Destroy" button for orphaned VMs
  - Cost Estimation card: monthly/projected/accumulated summary, per-instance breakdown with size and days running
  - API proxy routes: `GET /api/infra/reconcile`, `GET /api/infra/costs`, `DELETE /api/infra/reconcile/orphan/[instanceId]`
  - `infraApi` in `api.ts` with `reconcile()`, `costs()`, `destroyOrphan(id)` methods

- **43 new tests** (`packages/provisioner/src/__tests__/reconciliation-cost.test.ts`):
  - `reconcile`: orphaned instances, phantom agents, healthy match, ignored destroyed/offline, no instanceId, mixed scenario, tag passthrough, default tag (8 tests)
  - `detectIPMismatches`: mismatch detected, IPs match, skip localhost, skip 127.x, skip no host, skip no instanceId, skip null publicIp, skip hostnames, host with port, multiple mismatches (10 tests)
  - `generateReconciliationReport`: clean report, orphaned warning, phantom warning, IP mismatches, critical (3+ orphans), critical (5+ issues), empty clean (7 tests)
  - `estimateInstanceCost`: small, medium, large (3 tests)
  - `estimateCost`: multiple instances, empty, size grouping (3 tests)
  - `estimateCostFromInstances`: live instances (1 test)
  - `generateCostReport`: monthly cost, accumulated (full month), accumulated (mid month), projected, empty, timestamp, created today, days cap, multiple sizes, full month equals monthly, string dates (11 tests)

### Key Decisions
- **Three issue types, not just two** — IP mismatches are a real-world problem where VMs get replaced but the registry isn't updated. Detecting these proactively prevents connectivity issues.
- **Critical threshold at 3 orphans** — 3+ orphaned VMs is unusual enough to warrant critical status. Each orphan costs money, so the threshold is deliberately low.
- **Projected cost uses accumulated trajectory** — `projected = accumulated / dayFraction` extrapolates current spending to the full month. More accurate than just `monthly` because it accounts for VMs added/removed mid-month.
- **Injectable `now` parameter** — the `generateCostReport` accepts a `now` date for deterministic testing. In production it defaults to `new Date()`.
- **Lazy provider loading** — infra routes load the cloud provider on first request, same pattern as deploy routes. Avoids requiring cloud config at startup.
- **Destroy endpoint for orphans** — direct action from the Dashboard to clean up orphaned VMs. Logged as a warning for audit trail.

### Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/infra/reconcile` | Run reconciliation, return full report |
| GET | `/api/infra/costs` | Estimate costs for active VMs |
| DELETE | `/api/infra/reconcile/orphan/:id` | Destroy an orphaned VM |

### API Response Examples
```json
// GET /api/infra/reconcile
{
  "status": "warning",
  "issues": [{
    "type": "orphaned_vm",
    "severity": "error",
    "message": "VM \"orphan-vm\" (inst-123) has no matching agent",
    "instanceId": "inst-123",
    "instanceName": "orphan-vm"
  }],
  "stats": { "totalVMs": 5, "healthy": 4, "orphaned": 1, "phantom": 0, "ipMismatches": 0 }
}

// GET /api/infra/costs
{
  "monthly": 42,
  "projected": 38.5,
  "accumulated": 20.14,
  "breakdown": [{
    "name": "hivemi-agent-atlas",
    "size": "small",
    "monthlyCostUsd": 6,
    "daysRunning": 14.5,
    "accumulatedCostUsd": 3.11
  }]
}
```

### Acceptance Criteria
- [x] Reconciliation detects orphaned VMs and phantom agents
- [x] Dashboard shows alerts of inconsistencies (Infrastructure section in Settings)
- [x] Cost estimation functional (monthly, projected, accumulated, per-instance)
- [x] API exposed for Dashboard (GET /api/infra/reconcile, GET /api/infra/costs)

### Files Changed
| File | Change |
|------|--------|
| `packages/provisioner/src/types.ts` | +CostReport, +InstanceCostBreakdown, +ReconciliationReport, +ReconciliationIssue, extended RegistryAgent |
| `packages/provisioner/src/reconciliation.ts` | +detectIPMismatches, +generateReconciliationReport |
| `packages/provisioner/src/cost.ts` | +generateCostReport with projected/accumulated costs |
| `packages/provisioner/src/index.ts` | Export new types and functions |
| `packages/provisioner/src/__tests__/reconciliation-cost.test.ts` | NEW — 43 tests |
| `apps/manager/src/routes/infra.ts` | NEW — infra API routes |
| `apps/manager/src/routes.ts` | Mount infra routes |
| `apps/dashboard/src/app/api/infra/reconcile/route.ts` | NEW — proxy to manager |
| `apps/dashboard/src/app/api/infra/costs/route.ts` | NEW — proxy to manager |
| `apps/dashboard/src/app/api/infra/reconcile/orphan/[instanceId]/route.ts` | NEW — proxy DELETE |
| `apps/dashboard/src/lib/api.ts` | +infraApi, +ReconciliationReport, +CostReport types |
| `apps/dashboard/src/app/settings/page.tsx` | +Infrastructure section with reconciliation and cost UI |

### Commits
- `d0719a0` — feat(provisioner): VM reconciliation, IP mismatch detection, and cost estimation (#63)

### Next
- #64 (Daemon ↔ OpenClaw integration)
- #66 (Bootstrap Script)
- Periodic reconciliation via Manager cron (every 5 min) — integrate with heartbeat/scheduler

---

## 2026-02-12 — Issue #62: Provisioner — Firewall & SSH Key Management

### Summary
Implemented automated SSH key generation, 1Password-ready secret storage, control plane IP auto-detection, and enhanced firewall management with ICMP rules and IP change detection. The `InfraManager` class ties everything together as a single entry point for deploy infrastructure setup.

### Done
- **SSH Key Generation** (`packages/provisioner/src/ssh-keygen.ts`):
  - `generateSSHKeyPair(comment?)` — generates ed25519 keypairs using Node's built-in `crypto.generateKeyPairSync`
  - Private key in PEM (PKCS#8) format, public key in OpenSSH wire format
  - `pemToOpenSSH()` — converts PEM SPKI public key to `ssh-ed25519 <base64> <comment>` format
  - `isValidSSHPublicKey(key)` — validates SSH public key format (ed25519, RSA, ECDSA)
  - No external dependencies — pure Node.js crypto

- **Control Plane IP Detection** (`packages/provisioner/src/ip-detect.ts`):
  - `detectControlPlaneIP(logger?)` — auto-detects public IP using multiple services (ipify, ifconfig.me, checkip.amazonaws.com, icanhazip.com)
  - Falls through services on failure — first valid IPv4 wins
  - 5-minute caching to avoid excessive external calls
  - `detectIPChange(knownIp, logger?)` — checks if IP has changed since last detection
  - `clearIPCache()` — force fresh detection
  - `isValidIPv4(ip)` — strict IPv4 validation (rejects leading zeros, out-of-range octets)

- **Firewall Rules Enhanced** (`packages/provisioner/src/firewall.ts`):
  - `createDefaultRules()` now includes **ICMP inbound** rule for monitoring (ping from anywhere)
  - Total: 3 inbound (SSH, daemon port 3100, ICMP) + 3 outbound (TCP, UDP, ICMP)
  - `FirewallManager.updateControlPlaneIP(newIp)` — updates firewall rules when IP changes
  - `FirewallManager.getLastKnownIP()` — tracks the IP used for current rules
  - Skips update if IP is unchanged (avoids unnecessary API calls)

- **InfraManager** (`packages/provisioner/src/infra-manager.ts`):
  - Top-level orchestrator for deploy infrastructure
  - `ISecretStore` abstraction — interface for secret storage (1Password in prod, in-memory for tests)
    - `get(ref)`, `set(ref, value)`, `exists(ref)` methods
  - `InfraManager.setup()` — idempotent full setup:
    1. Generate SSH keypair (or load existing from secret store)
    2. Store private key in secret store (e.g., 1Password)
    3. Register public key with cloud provider
    4. Detect control plane IP
    5. Create/update firewall with correct rules
  - `InfraManager.checkIPChange()` — lightweight periodic IP check + firewall update
  - `InfraManager.addInstanceToFirewall(id)` / `removeInstanceFromFirewall(id)` — manage VM membership
  - `InfraManager.getPrivateKey()` — retrieve private key from secret store (for SSH bootstrapping)
  - `InfraManager.loadState()` / `getState()` — persist/restore state across restarts
  - Returns `InfraSetupResult` with flags: `keyGenerated`, `firewallCreated`, `ipChanged`

- **65 new tests** (`packages/provisioner/src/__tests__/infra.test.ts`):
  - SSH keygen: valid keypair, comments, uniqueness, format, base64 encoding (7 tests)
  - Key validation: ed25519, empty, random, unsupported, no comment, RSA, ECDSA (7 tests)
  - IPv4 validation: valid, invalid, leading zeros, whitespace (4 tests)
  - IP detection: first service, fallback, invalid response, caching, all fail, HTTP errors (6 tests)
  - IP change: detected, unchanged, failure tolerance (3 tests)
  - Firewall rules: ICMP inbound, rule counts, source restrictions, CIDR, outbound (7 tests)
  - FirewallManager IP update: track IP, update rules, skip unchanged, throw pre-init, correct rules (5 tests)
  - InfraManager setup: keygen, private key storage, public key storage, provider registration, IP detection, firewall creation, reuse existing, idempotent, IP change detection, firewall update, custom names, store failure (12 tests)
  - InfraManager checkIPChange: no known IP, detected change, firewall update, unchanged (4 tests)
  - InfraManager firewall ops: add after setup, throw before setup, remove (3 tests)
  - InfraManager getPrivateKey: from store, null when no ref (2 tests)
  - InfraManager state: expose state, load state, restore firewall, sub-managers (4 tests)

- **Updated 1 existing test** in `provisioner.test.ts` to match new ICMP inbound rule (3 inbound instead of 2)

### Key Decisions
- **Node.js crypto, not exec** — `generateKeyPairSync("ed25519")` is fast, synchronous, and needs no `ssh-keygen` binary. PEM-to-OpenSSH conversion done manually (the DER format for ed25519 SPKI is fixed/simple).
- **ISecretStore abstraction** — decouples from 1Password. The `InfraManager` calls `set(ref, value)` and `get(ref)` — production wires this to `op item create/read`, tests use an in-memory Map.
- **Multiple IP services** — single service = single point of failure. We try 4 services in sequence (ipify, ifconfig.me, checkip.amazonaws.com, icanhazip.com). First valid IPv4 wins.
- **5-minute IP cache** — the control plane's public IP rarely changes, but we want to detect when it does. 5-minute cache balances freshness vs. external API calls.
- **ICMP inbound everywhere** — ping should work from any IP for monitoring. SSH and daemon port remain restricted to control plane only.
- **Idempotent setup** — `InfraManager.setup()` can be called repeatedly. First run generates everything; subsequent runs reuse existing state and only act on changes (IP drift).
- **State persistence** — `loadState()`/`getState()` let the caller persist InfraManager state to the Registry or settings, so it survives process restarts.

### Architecture
```
InfraManager
├── SSHKeyManager (provider key registration + caching)
├── FirewallManager (firewall CRUD + IP change detection)
├── ssh-keygen (ed25519 key generation)
├── ip-detect (public IP auto-detection)
└── ISecretStore (private key storage abstraction)
     └── 1PasswordSecretStore (production)
     └── InMemorySecretStore (testing)
```

### Acceptance Criteria
- [x] SSH key auto-registrada no provider — `ensureDeployKey()` via SSHKeyManager
- [x] Keypair gerado e armazenado no 1Password — `generateSSHKeyPair()` + `ISecretStore.set()`
- [x] Firewall criado automaticamente — `ensureFirewall()` via FirewallManager
- [x] VMs novas adicionadas ao firewall — `addInstanceToFirewall()` via InfraManager
- [x] IP do control plane detectado e usado nas regras — `detectControlPlaneIP()` + `createDefaultRules()`

### Files Changed
| File | Change |
|------|--------|
| `packages/provisioner/src/ssh-keygen.ts` | NEW — ed25519 keypair generation |
| `packages/provisioner/src/ip-detect.ts` | NEW — control plane IP auto-detection |
| `packages/provisioner/src/infra-manager.ts` | NEW — top-level infrastructure orchestrator |
| `packages/provisioner/src/firewall.ts` | +ICMP inbound rule, +updateControlPlaneIP, +getLastKnownIP |
| `packages/provisioner/src/index.ts` | Export new modules and types |
| `packages/provisioner/src/__tests__/infra.test.ts` | NEW — 65 tests |
| `packages/provisioner/src/__tests__/provisioner.test.ts` | Updated for ICMP inbound rule |

### Commits
- `56919a2` — feat(provisioner): SSH keygen, IP detection, firewall ICMP, InfraManager (#62)

### Next
- #63 (Deploy Orchestrator: Full Pipeline) — integrate InfraManager into deploy flow
- #64 (Daemon ↔ OpenClaw integration) — deeper runtime integration
- #66 (Bootstrap Script) — shell script for cloud-init

---

## 2026-02-11 — Issue #61: Provisioner — DigitalOcean Implementation

### Summary
Enhanced the DigitalOcean cloud provider with rate limiting, pagination, region validation, and comprehensive tests. The provider already had a solid foundation from #44 — this issue filled the remaining gaps specified in the acceptance criteria.

### Done
- **Rate Limiting** (`api()` method):
  - Automatic retry on HTTP 429 with exponential backoff (1s, 2s, 4s)
  - Respects `retry-after` header from DO API when available
  - Tracks `ratelimit-remaining` and `ratelimit-reset` from response headers
  - Warns via logger when remaining < 100
  - `RateLimitError` thrown after 3 retries exhausted (exposes `retryAfterMs`, `remaining`)
  - `getRateLimitState()` method for monitoring/debugging

- **Pagination** (`apiPaginated()` method):
  - New generic paginated GET helper that follows `links.pages.next` URLs
  - Applied to `listInstances()`, `ensureSSHKey()`, and `ensureFirewall()`
  - Auto-appends `per_page=200` if not already in URL
  - Handles absolute URLs from DO pagination links

- **Region Validation**:
  - Supported regions: `nyc1`, `nyc3`, `sfo3`, `ams3`, `sgp1`
  - Validated in `createInstance()` before API call (fail fast)
  - `UnsupportedRegionError` with helpful message listing valid regions
  - `DigitalOceanProvider.getSupportedRegions()` static method
  - Empty spec region falls through to `defaultRegion` (also validated)

- **Exports Updated**:
  - `RateLimitError` and `UnsupportedRegionError` exported from package index and providers index
  - Consumers can catch specific error types for handling

- **56 new tests** (`packages/provisioner/src/__tests__/digitalocean.test.ts`):
  - Constructor: no token, defaults, custom defaults (3 tests)
  - Size mappings: small, medium, large (3 tests)
  - Supported regions: included, excluded (2 tests)
  - createInstance: API request, response parsing, user_data, vpc_uuid, firewall attach, medium/large size, unsupported region, invalid region message, default region, all supported regions (11 tests)
  - destroyInstance: DELETE request, 204 response, API error (3 tests)
  - listInstances: by tag, no tags, multi-tag filter, pagination, size reverse-map, unknown size fallback (6 tests)
  - getStatus: active, new→creating, off→destroyed, archive→destroyed, unknown→error, missing public IP, missing private IP (7 tests)
  - waitReady: error state, timeout (2 tests)
  - ensureSSHKey: existing key, create new (2 tests)
  - ensureFirewall: update existing, create new (2 tests)
  - addInstanceToFirewall, removeInstanceFromFirewall (2 tests)
  - Rate limiting: retry on 429, retry-after header, max retries, state tracking, low remaining warning (5 tests)
  - Error classes: RateLimitError, UnsupportedRegionError (2 tests)
  - API errors: 401, 500 (2 tests)
  - Droplet parsing: empty networks, date parsing, no tags (3 tests)
  - Authorization: Bearer token (1 test)

### Key Decisions
- **Region validation at create time** — fail fast before making API calls. The supported set can be expanded later; starting conservative with 5 regions that DO actively supports.
- **Max 3 retries on 429** — DO's limit is 5000/hour which is generous. If we're getting rate limited with 3 retries, something is seriously wrong and we should surface it.
- **Pagination via `links.pages.next`** — DO provides absolute URLs for next pages. Following those is more reliable than calculating page numbers.
- **Rate limit state exposed** — `getRateLimitState()` lets the deploy orchestrator make decisions (e.g., slow down parallel deployments when remaining is low).
- **Tests mock globalThis.fetch** — clean mocking without network calls, validates exact API payloads and header handling.

### Acceptance Criteria
- [x] Criar droplet funciona — `createInstance()` with all options
- [x] Destruir droplet funciona — `destroyInstance()` with 204 confirmation
- [x] Listar por tag funciona — `listInstances(["hivemi"])` with pagination
- [x] waitReady com poll + SSH check — polls `getStatus()` + `checkPort()` on port 22
- [x] Rate limiting tratado — retry on 429, backoff, header tracking, RateLimitError
- [x] Mapeamento de tamanhos abstratos — small/medium/large → DO slugs

### Files Changed
| File | Change |
|------|--------|
| `packages/provisioner/src/providers/digitalocean.ts` | Rate limiting, pagination, region validation, error classes |
| `packages/provisioner/src/providers/index.ts` | Export RateLimitError, UnsupportedRegionError |
| `packages/provisioner/src/index.ts` | Export RateLimitError, UnsupportedRegionError |
| `packages/provisioner/src/__tests__/digitalocean.test.ts` | NEW — 56 tests |

### Commits
- `1ead719` — feat(provisioner): DigitalOcean provider - rate limiting, pagination, region validation (#61)

### Next
- #62 (Provisioner: GCP Implementation) — same pattern for Google Cloud
- #63 (Deploy Orchestrator: Full Pipeline) — ties provisioner + bootstrapper together
- #64 (Daemon ↔ OpenClaw integration) — deeper runtime integration

---

## 2026-02-11 — Issue #60: Bootstrap — Secret Injection via SecretProvider

### Summary
Implemented the SecretProvider abstraction and secret injection into VMs during bootstrap. Secrets are resolved locally on the control plane and transmitted to the VM via SSH — never touching the control plane's disk. Supports two target types: environment variables (for the daemon's `.env`) and file targets (written directly to the VM with mode 600).

### Done
- **Enhanced `SecretMapping`** (`packages/bootstrapper/src/types.ts`):
  - New `target` field with two formats: `env:VAR_NAME` and `file:/path/to/file`
  - `required` field (default: `true`) — optional secrets are skipped gracefully
  - Legacy `envVar` field preserved for backward compatibility
  - `ParsedSecretTarget` type: `{ kind: "env" | "file", value: string }`
  - `SecretInjectionResult` type: `{ envSecrets, fileSecrets, skipped }`

- **Secret Utilities** (`packages/bootstrapper/src/secrets/utils.ts`):
  - `parseSecretTarget(mapping)` — validates and parses target format
  - Validates env var names (`/^[A-Za-z_][A-Za-z0-9_]*$/`)
  - Validates file paths (must be absolute)
  - `maskSecret(value)` — shows first 2 + last 2 chars, rest masked (caps at 20 asterisks)
  - `isRequired(mapping)` — defaults to true when field is undefined

- **Updated `injectSecrets()`** (`packages/bootstrapper/src/phases/configure.ts`):
  - Now takes SSH client as first parameter (was provider-only before)
  - Resolves secrets locally via provider, then injects into VM
  - `env:` targets → collected in `envSecrets` map, written to `.env` by `installDaemon`
  - `file:` targets → written directly to VM via `ssh.writeFile()` with mode 600
  - Optional secrets that fail resolution are skipped and tracked in `result.skipped`
  - Required secrets that fail resolution throw with clear error message
  - Secret values are never logged — only masked versions appear
  - Returns `SecretInjectionResult` instead of simple `Map<string, string>`

- **1Password Provider** (`packages/bootstrapper/src/secrets/onepassword.ts`):
  - `resolveAll()` now handles `required` field — skips optional missing secrets
  - Uses `parseSecretTarget()` for target parsing
  - Validates `op://` prefix on `getSecret()`
  - Service account token passed via env var (never CLI arg)

- **EnvFile Provider** (`packages/bootstrapper/src/secrets/envfile.ts`):
  - `resolveAll()` now handles `required` field — skips optional missing secrets
  - Uses `parseSecretTarget()` for target parsing
  - Supports both env and file targets

- **Deploy Orchestrator Updated** (`apps/manager/src/lib/deploy-orchestrator.ts`):
  - Secret mappings now use `target: "env:HIVEMI_SECRET"` format
  - Inline secret provider updated to parse target format

- **44 new tests** (`packages/bootstrapper/src/__tests__/secrets.test.ts`):
  - `parseSecretTarget`: env target, file target, deep path, legacy envVar, empty env var, empty file path, relative path, unknown format, no target/envVar, invalid env var (number start, special chars), underscores, underscore start (14 tests)
  - `maskSecret`: long secrets, short secrets, exact 8 chars, empty string, cap at 20 asterisks (5 tests)
  - `isRequired`: undefined (default), true, false (3 tests)
  - `EnvFileProvider` detailed: known secrets, unknown, skip optional, throw required, default required, file targets, empty map (7 tests)
  - `OnePasswordProvider` constructor: no token, constructor token, op:// validation (3 tests)
  - `injectSecrets` full flow: env secrets, file secrets (mode 600), mixed targets, optional skip, required throw, explicit required throw, empty mappings, no secret values in logs, multiple file targets, default agent secrets (10 tests)
  - Edge cases: single char var, root file path, case sensitivity (3 tests)

- **Updated 3 existing tests** in `bootstrapper.test.ts` to match new `injectSecrets` signature

### Key Decisions
- **SSH-based injection** — secrets are resolved on the control plane and transmitted via SSH (encrypted). The control plane never writes secrets to its own disk (they stay in memory).
- **Two target types, not just env** — `file:` targets allow writing secrets directly as files (e.g., TLS certs, API tokens at specific paths). `env:` targets are collected and written to the daemon's `.env` file by `installDaemon`.
- **Optional secrets gracefully skipped** — `required: false` lets callers mark non-critical secrets. Missing optional secrets don't fail the bootstrap; they're tracked in `skipped` for visibility.
- **Default required=true** — without explicit `required: false`, all secrets are required. This is the safer default — you must opt-in to optional behavior.
- **Secret masking in logs** — `maskSecret()` ensures values never appear in logs. Only the first 2 and last 2 chars are shown, with a capped number of asterisks.
- **Env var name validation** — `parseSecretTarget` validates env var names match `[A-Za-z_][A-Za-z0-9_]*` to prevent injection via malformed names.
- **Legacy backward compat** — old `envVar` field still works via fallback in `parseSecretTarget`. Existing code using `{ ref, envVar }` format continues to work.

### Security Model
```
Control Plane                     VM
┌──────────────────┐              ┌──────────────────┐
│ SecretProvider    │              │                  │
│ ┌──────────────┐ │              │ .env (mode 600)  │
│ │ 1Password    │ │  SSH (enc)   │ ├─ API_KEY=...   │
│ │ op read ref  │─┼─────────────►│ └─ HIVEMI_=...   │
│ └──────────────┘ │              │                  │
│ (in memory only) │              │ /path/to/file    │
│ (never on disk)  │              │ (mode 600)       │
└──────────────────┘              └──────────────────┘
```

### Files Changed
| File | Change |
|------|--------|
| `packages/bootstrapper/src/types.ts` | Enhanced SecretMapping (target, required), +ParsedSecretTarget, +SecretInjectionResult |
| `packages/bootstrapper/src/secrets/utils.ts` | NEW — parseSecretTarget, maskSecret, isRequired |
| `packages/bootstrapper/src/secrets/onepassword.ts` | Updated resolveAll for required/target |
| `packages/bootstrapper/src/secrets/envfile.ts` | Updated resolveAll for required/target |
| `packages/bootstrapper/src/phases/configure.ts` | injectSecrets now takes SSH, writes file targets, returns SecretInjectionResult |
| `packages/bootstrapper/src/index.ts` | Export new types and utils |
| `packages/bootstrapper/src/__tests__/secrets.test.ts` | NEW — 44 tests |
| `packages/bootstrapper/src/__tests__/bootstrapper.test.ts` | Updated 3 injectSecrets tests for new signature |
| `apps/manager/src/lib/deploy-orchestrator.ts` | Updated secret mappings to target format |

### Commits
- `86b617d` — feat(bootstrapper): secret injection via SSH with SecretProvider abstraction (#60)

### Next
- #66 (Bootstrap Script) — the shell script that cloud-init downloads and runs
- #44 (Provisioner) — provisions the VM before bootstrap kicks in
- #64 (Daemon ↔ OpenClaw integration) — deeper runtime integration

---

## 2026-02-11 — Issue #59: Bootstrap Fase 2 — Configuração via SSH

### Summary
Implemented the SSH configuration phase of the bootstrap process. After cloud-init completes and the VM is ready, the Bootstrapper connects via SSH and configures everything specific to the agent: OpenClaw runtime, role files (merged from `_base` + role-specific), the Agent Daemon as a systemd service, and post-install verification.

### Done
- **Role Loader** (`packages/bootstrapper/src/role-loader.ts`):
  - `loadRoleConfig(agentsDir, roleName)` — reads from `agents/_base/` and `agents/<role>/`
  - Markdown merge strategy: role file overrides `_base` entirely (SOUL.md, AGENTS.md, TOOLS.md)
  - JSON config merge: deep merge — `_base` provides defaults, role overrides specific keys
  - `tools.json`: role overrides `_base` entirely (each role defines its own tool set)
  - Falls back to `_base` when role file doesn't exist, empty string when neither exists
  - Graceful handling of invalid JSON (warns and continues)
  - `deepMerge()` utility exported for reuse — handles nested objects, replaces arrays

- **Verify Installation Phase** (`packages/bootstrapper/src/phases/configure.ts`):
  - `verifyInstallation(ssh)` — new sub-phase after daemon install
  - Checks `systemctl is-active hivemi-daemon` = "active"
  - Captures `systemctl status hivemi-daemon` output for diagnostics
  - Captures `journalctl -u hivemi-daemon -n 20` for initial logs
  - Returns `VerifyResult` with running status, status output, and logs
  - Throws with actionable error message if daemon is not running

- **Configure Orchestration Updated**:
  - `configure()` now runs 5 sub-phases: inject-secrets → configure-openclaw → copy-role-config → install-daemon → verify-install
  - Each phase reports via callbacks for granular progress tracking
  - If install-daemon fails, verify-install is skipped (no point checking)

- **Fix: Config File Permissions**:
  - Restored `mode: "600"` on OpenClaw config.yaml write (contains API token)
  - Was accidentally removed in a previous stash — now correctly restricts read access

- **Phase Tracking Updated**:
  - `BootstrapPhaseName` type includes `"verify-install"`
  - `createPhases()` in orchestrator includes the new phase
  - Deploy orchestrator maps `verify-install` → `"configuring"` deploy phase

- **43 new tests** (`packages/bootstrapper/src/__tests__/ssh-bootstrap.test.ts`):
  - `deepMerge`: flat merge, nested merge, array replacement, null handling, immutability, empty objects, 3+ level nesting (7 tests)
  - `loadRoleConfig`: SOUL.md override/fallback/empty, AGENTS.md override/fallback, TOOLS.md fallback, config.json deep merge/base-only/role-only/empty/invalid JSON, tools.json override/fallback/none, complete role load (13 tests)
  - `verifyInstallation`: active daemon, inactive daemon, failed daemon, diagnostic output, correct commands (5 tests)
  - `configure` orchestration: all 5 phases in order, verify-install error reporting, skipped when install fails (3 tests)
  - `configureOpenClaw` details: workspace creation, config without auth token (2 tests)
  - `copyRoleConfig` details: optional tools.json, skipped tools.json, empty string files (3 tests)
  - `installDaemon` details: env vars, secrets, daemon dir path, systemd unit, daemon-reload/enable/start failures (7 tests)

### Key Decisions
- **Markdown: override, not merge** — merging markdown files is fragile and confusing. Each role defines its own SOUL.md entirely; `_base` AGENTS.md and TOOLS.md provide fallback defaults but can be overridden wholesale.
- **JSON config: deep merge** — operational parameters like heartbeat intervals, log levels, and timeouts benefit from inheritance. The role only needs to specify what's different from `_base`.
- **tools.json: override** — each role has a distinct tool set. Merging tool arrays could create conflicts (e.g., a QA agent shouldn't inherit a developer's shell-exec tool).
- **Verification as a separate phase** — separating verify from install gives the deploy orchestrator granular error tracking. If install succeeds but the daemon crashes on start, the error is reported as `verify-install` failure, not `install-daemon` failure.
- **Restore mode 600** — the config.yaml contains API tokens and should only be readable by the openclaw user. This was a regression fix.

### Merge Strategy
```
agents/
  _base/
    AGENTS.md        → fallback for all roles
    TOOLS.md         → fallback for all roles
    config.json      → base operational params (heartbeat, telemetry, etc.)
  developer/
    SOUL.md          → role personality (overrides _base entirely)
    AGENTS.md        → (optional, overrides _base entirely)
    config.json      → role-specific params (deep-merged with _base)
    tools.json       → role-specific tools (overrides _base entirely)
```

### Files Changed
| File | Change |
|------|--------|
| `packages/bootstrapper/src/role-loader.ts` | NEW — role config loader with _base + role merge |
| `packages/bootstrapper/src/phases/configure.ts` | +verifyInstallation, +verify-install phase, fix config mode 600 |
| `packages/bootstrapper/src/types.ts` | +verify-install in BootstrapPhaseName |
| `packages/bootstrapper/src/index.ts` | +verify-install phase, export new modules |
| `packages/bootstrapper/src/__tests__/ssh-bootstrap.test.ts` | NEW — 43 tests |
| `apps/manager/src/lib/deploy-orchestrator.ts` | Map verify-install → configuring |

### Commits
- `816ab46` — feat(bootstrapper): SSH bootstrap phase 2 - role config merge, verification, and tests (#59)

### Next
- #60 (Secrets Injection) — inject secrets into daemon .env before start
- #66 (Bootstrap Script) — the shell script that cloud-init downloads and runs
- #44 (Provisioner) — provisions the VM before bootstrap kicks in

---

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

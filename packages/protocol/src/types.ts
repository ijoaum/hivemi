import { z } from "zod";

// =============================================================================
// AGENT
// =============================================================================

// Updated: +provisioning, +unreachable, +destroyed, -online
export const AgentStatusSchema = z.enum([
  "provisioning",
  "idle",
  "working",
  "offline",
  "unreachable",
  "error",
  "destroyed",
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentCloudSchema = z.object({
  provider: z.string(),
  region: z.string(),
  instanceId: z.string(),
}).nullable();
export type AgentCloud = z.infer<typeof AgentCloudSchema>;

export const AgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  roleId: z.string().uuid(),
  teamId: z.string().uuid(),
  status: AgentStatusSchema,
  model: z.string(),
  host: z.string().url(),
  port: z.number().int().min(1).max(65535),
  currentTaskId: z.string().uuid().nullable(),
  lastHeartbeat: z.coerce.date().nullable(),
  // New fields
  version: z.string().max(20).nullable(),
  openclawVersion: z.string().max(20).nullable(),
  cloud: AgentCloudSchema.optional(),
  capabilities: z.array(z.string()).default([]),
  privateIp: z.string().max(45).nullable(),
  publicIp: z.string().max(45).nullable(),
  deployId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const CreateAgentSchema = AgentSchema.pick({
  name: true,
  roleId: true,
  teamId: true,
  model: true,
  host: true,
  port: true,
});
export type CreateAgent = z.infer<typeof CreateAgentSchema>;

/**
 * Schema for POST /api/agents — daemon registration (upsert).
 * The daemon announces itself with full identity and capability info.
 * If the agent ID already exists, it updates instead of duplicating.
 */
export const RegisterAgentSchema = z.object({
  /** UUID generated at bootstrap — fixed for the agent's lifetime */
  id: z.string().uuid(),
  /** Human-readable agent name */
  name: z.string().min(1).max(100),
  /** Role binding */
  roleId: z.string().uuid(),
  /** Team binding */
  teamId: z.string().uuid(),
  /** LLM model in use */
  model: z.string().min(1),
  /** Public IP / hostname of the VM (prefers private IP when available) */
  host: z.string().min(1).max(255),
  /** Daemon port */
  port: z.number().int().min(1).max(65535),
  /** Daemon version */
  version: z.string().max(20).optional(),
  /** OpenClaw version installed on the VM */
  openclawVersion: z.string().max(20).optional(),
  /** Cloud provider info */
  cloud: z.object({
    provider: z.string(),
    region: z.string(),
    instanceId: z.string(),
  }).optional(),
  /** List of enabled skills/tools */
  capabilities: z.array(z.string()).default([]),
  /** Private VPC IP (10.x.x.x, 172.16-31.x.x, 192.168.x.x) for inter-agent communication */
  privateIp: z.string().max(45).optional(),
  /** Public IP for external access / fallback communication */
  publicIp: z.string().max(45).optional(),
});
export type RegisterAgent = z.infer<typeof RegisterAgentSchema>;

// =============================================================================
// ROLE
// =============================================================================

export const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50),
  description: z.string(),
  icon: z.string().max(10),
  color: z.string().max(20),
  capabilities: z.array(z.string()),
  systemPrompt: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Role = z.infer<typeof RoleSchema>;

export const CreateRoleSchema = RoleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateRole = z.infer<typeof CreateRoleSchema>;

// =============================================================================
// TEAM
// =============================================================================

export const TeamSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  emoji: z.string().max(10),
  color: z.string().max(20),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Team = z.infer<typeof TeamSchema>;

// =============================================================================
// TASK
// =============================================================================

// Updated: +locked, +cancelling, -running
export const TaskStatusSchema = z.enum([
  "queued",
  "locked",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["high", "medium", "low"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskArtifactSchema = z.object({
  type: z.string(),
  url: z.string(),
  description: z.string(),
});
export type TaskArtifact = z.infer<typeof TaskArtifactSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  agentId: z.string().uuid().nullable(),
  teamId: z.string().uuid(),
  input: z.string().nullable(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  estimatedMs: z.number().int().nullable(),
  elapsedMs: z.number().int().nullable(),
  // New fields
  roleTarget: z.string().uuid().nullable(),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.coerce.date().nullable(),
  parentTaskId: z.string().uuid().nullable(),
  artifacts: z.array(TaskArtifactSchema).default([]),
  timeoutAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  priority: TaskPrioritySchema.default("medium"),
  agentId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid(),
  input: z.string().nullable().optional(),
  roleTarget: z.string().uuid().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
});
export type CreateTask = z.infer<typeof CreateTaskSchema>;

// =============================================================================
// LOG
// =============================================================================

// Updated: +lifecycle
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error", "lifecycle"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  level: LogLevelSchema,
  source: z.string(),
  agentId: z.string().uuid().nullable(),
  taskId: z.string().uuid().nullable(),
  message: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  // New field
  component: z.string().max(50).nullable(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

// =============================================================================
// DEPLOY
// =============================================================================

export const DeployStatusSchema = z.enum([
  "provisioning",
  "installing",
  "configuring",
  "registering",
  "ready",
  "failed",
  "destroyed",
]);
export type DeployStatus = z.infer<typeof DeployStatusSchema>;

export const InstanceSizeSchema = z.enum(["small", "medium", "large"]);
export type InstanceSize = z.infer<typeof InstanceSizeSchema>;

export const CloudProviderSchema = z.enum(["digitalocean", "gcp"]);
export type CloudProvider = z.infer<typeof CloudProviderSchema>;

export const DeployPhaseSchema = z.object({
  name: z.string(),
  status: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type DeployPhase = z.infer<typeof DeployPhaseSchema>;

export const DeploySchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
  agentName: z.string().max(100),
  cloudProvider: CloudProviderSchema,
  region: z.string(),
  instanceSize: InstanceSizeSchema,
  instanceId: z.string().nullable(),
  status: DeployStatusSchema,
  phases: z.array(DeployPhaseSchema),
  error: z.string().nullable(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Deploy = z.infer<typeof DeploySchema>;

export const CreateDeploySchema = z.object({
  agentName: z.string().min(1).max(100),
  cloudProvider: CloudProviderSchema,
  region: z.string(),
  instanceSize: InstanceSizeSchema,
});
export type CreateDeploy = z.infer<typeof CreateDeploySchema>;

// =============================================================================
// AGENT TELEMETRY
// =============================================================================

/**
 * Infrastructure metrics — snapshot of VM resource usage.
 * `loadAvg` accepts either a single number (1-min average as per protocol spec)
 * or an array of 3 numbers ([1min, 5min, 15min]) for backward compat.
 */
export const TelemetryInfraSchema = z.object({
  cpu: z.number().min(0).max(100),
  memUsed: z.number().int().nonnegative(),
  memTotal: z.number().int().positive(),
  diskUsed: z.number().int().nonnegative(),
  diskTotal: z.number().int().nonnegative(),
  loadAvg: z.union([z.number().nonnegative(), z.array(z.number().nonnegative())]),
});
export type TelemetryInfra = z.infer<typeof TelemetryInfraSchema>;

/**
 * LLM usage metrics — deltas since last report.
 */
export const TelemetryLlmSchema = z.object({
  requests: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
});
export type TelemetryLlm = z.infer<typeof TelemetryLlmSchema>;

/**
 * Task execution metrics — current state snapshot.
 */
export const TelemetryTasksSchema = z.object({
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
});
export type TelemetryTasks = z.infer<typeof TelemetryTasksSchema>;

/**
 * Daemon health and version info.
 */
export const TelemetryDaemonSchema = z.object({
  uptime: z.number().int().nonnegative(),
  version: z.string(),
  openclawStatus: z.string(),
});
export type TelemetryDaemon = z.infer<typeof TelemetryDaemonSchema>;

export const AgentTelemetrySchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  timestamp: z.coerce.date(),
  infra: TelemetryInfraSchema.nullable(),
  llm: TelemetryLlmSchema.nullable(),
  tasks: TelemetryTasksSchema.nullable(),
  daemon: TelemetryDaemonSchema.nullable(),
});
export type AgentTelemetry = z.infer<typeof AgentTelemetrySchema>;

/**
 * Schema for POST /api/agents/:id/telemetry — daemon submits metrics.
 *
 * Protocol spec (Issue #54):
 * - `ts`: ISO 8601 timestamp from the daemon (optional, server uses now() as fallback)
 * - All metric groups are optional (daemon may send partial reports)
 * - Sent every 60 seconds
 * - `infra` values are snapshots, `llm` values are deltas since last report
 */
export const SubmitTelemetrySchema = z.object({
  /** ISO 8601 timestamp from the daemon */
  ts: z.string().datetime().optional(),
  infra: TelemetryInfraSchema.optional(),
  llm: TelemetryLlmSchema.optional(),
  tasks: TelemetryTasksSchema.optional(),
  daemon: TelemetryDaemonSchema.optional(),
});
export type SubmitTelemetry = z.infer<typeof SubmitTelemetrySchema>;

/**
 * Schema for PUT /api/deploys/:id — update deploy phase/status.
 */
export const UpdateDeploySchema = z.object({
  status: DeployStatusSchema.optional(),
  instanceId: z.string().max(255).optional(),
  agentId: z.string().uuid().optional(),
  error: z.string().optional(),
  phase: DeployPhaseSchema.optional(),
  completedAt: z.coerce.date().optional(),
});
export type UpdateDeploy = z.infer<typeof UpdateDeploySchema>;

// =============================================================================
// SETTINGS
// =============================================================================

export const SettingSchema = z.object({
  key: z.string().max(100),
  value: z.record(z.unknown()),
  updatedAt: z.coerce.date(),
});
export type Setting = z.infer<typeof SettingSchema>;

// =============================================================================
// CLOUD CONFIG (Settings)
// =============================================================================

/**
 * Schema for updating cloud configuration via PUT /api/settings/cloud.
 * Secrets (apiToken, sshPrivateKey) are write-only — never returned by GET.
 */
export const UpdateCloudConfigSchema = z.object({
  provider: CloudProviderSchema,
  region: z.string().min(1).max(50),
  instanceSize: InstanceSizeSchema,
  apiToken: z.string().min(1).optional(),
  sshKeyId: z.string().max(100).optional(),
  sshPublicKey: z.string().optional(),
  sshPrivateKey: z.string().optional(),
});
export type UpdateCloudConfig = z.infer<typeof UpdateCloudConfigSchema>;

/**
 * Response shape for GET /api/settings/cloud.
 * Secrets are redacted — only boolean flags indicate presence.
 */
export const CloudConfigResponseSchema = z.object({
  provider: CloudProviderSchema,
  region: z.string(),
  instanceSize: InstanceSizeSchema,
  hasApiToken: z.boolean(),
  hasSSHKey: z.boolean(),
  sshKeyId: z.string().nullable(),
});
export type CloudConfigResponse = z.infer<typeof CloudConfigResponseSchema>;

/**
 * Response shape for POST /api/settings/cloud/test.
 */
export const CloudTestResultSchema = z.object({
  valid: z.boolean(),
  account: z.string().optional(),
  dropletLimit: z.number().optional(),
  error: z.string().optional(),
});
export type CloudTestResult = z.infer<typeof CloudTestResultSchema>;

/**
 * A region option returned by GET /api/settings/cloud/regions.
 */
export const CloudRegionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  available: z.boolean(),
  flag: z.string().optional(),
});
export type CloudRegion = z.infer<typeof CloudRegionSchema>;

// =============================================================================
// TASK QUEUE — Issue #55: Pull Model
// =============================================================================

/**
 * Schema for PUT /api/tasks/:id/complete — agent reports task result.
 *
 * After claiming a task via GET /api/tasks/next, the agent executes it
 * and reports back with status, output, artifacts, and optional subtasks.
 */
export const CompleteTaskSchema = z.object({
  /** Final status: completed or failed */
  status: z.enum(["completed", "failed"]),
  /** Text describing what was done */
  output: z.string().nullable().optional(),
  /** Error message if failed */
  error: z.string().nullable().optional(),
  /** Artifacts produced (PRs, docs, files) */
  artifacts: z.array(TaskArtifactSchema).optional(),
  /** Subtasks to create for other roles */
  subtasks: z.array(z.object({
    title: z.string().min(1).max(500),
    description: z.string().nullable().optional(),
    roleTarget: z.string().uuid().nullable().optional(),
    priority: TaskPrioritySchema.optional(),
    input: z.string().nullable().optional(),
  })).optional(),
  /** Elapsed time in ms */
  duration: z.number().int().nonnegative().optional(),
  /** Token usage */
  tokensUsed: z.object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
  }).optional(),
});
export type CompleteTask = z.infer<typeof CompleteTaskSchema>;

/**
 * Schema for POST /api/tasks/:id/subtasks — create a subtask during execution.
 *
 * Agents can create subtasks while working on a parent task:
 * - PM analyzes demand → creates dev tasks + QA tasks
 * - Dev finishes code → creates QA review task
 * Dashboard shows the task tree: parent → subtasks → sub-subtasks
 */
export const CreateSubtaskSchema = z.object({
  /** Subtask title */
  title: z.string().min(1).max(500),
  /** Detailed description */
  description: z.string().nullable().optional(),
  /** Role that should pick this up */
  roleTarget: z.string().uuid().nullable().optional(),
  /** Priority: high, medium, low */
  priority: TaskPrioritySchema.optional(),
  /** Additional input/context */
  input: z.string().nullable().optional(),
});
export type CreateSubtask = z.infer<typeof CreateSubtaskSchema>;

// =============================================================================
// TASK PROGRESS
// =============================================================================

export const TaskProgressSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  step: z.string(),
  toolCall: z.string().max(50).nullable(),
  timestamp: z.coerce.date(),
});
export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/**
 * Schema for POST /api/tasks/:id/progress — add a progress step to a task.
 * The agent reports each step/checkpoint as the task executes.
 */
export const CreateTaskProgressSchema = z.object({
  /** Human-readable description of the step (e.g. "Cloning repository") */
  step: z.string().min(1).max(1000),
  /** ISO-8601 timestamp of when the step occurred */
  timestamp: z.coerce.date(),
  /** Optional tool/function call associated with this step */
  toolCall: z.string().max(50).optional(),
});
export type CreateTaskProgress = z.infer<typeof CreateTaskProgressSchema>;

// =============================================================================
// AGENT CONFIG — Base + Role + Instance Config Schemas
// =============================================================================

/**
 * Base config shared by all agents (agents/_base/config.json).
 * Defines operational parameters like heartbeat, telemetry, and task execution.
 */
export const AgentBaseConfigSchema = z.object({
  heartbeatInterval: z.number().int().min(1000).default(30000),
  telemetryInterval: z.number().int().min(1000).default(60000),
  logBatchInterval: z.number().int().min(1000).default(300000),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  taskTimeout: z.number().int().min(1000).default(600000),
  maxRetries: z.number().int().min(0).default(3),
});
export type AgentBaseConfig = z.infer<typeof AgentBaseConfigSchema>;

/**
 * Role-specific config (agents/<role>/config.json).
 * Overrides base config values and adds role-specific parameters.
 */
export const AgentRoleConfigSchema = z.object({
  model: z.string().min(1),
  maxTokens: z.number().int().min(1).default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
  timeout: z.number().int().min(1000).optional(),
});
export type AgentRoleConfig = z.infer<typeof AgentRoleConfigSchema>;

/**
 * Tool definition for a role (agents/<role>/tools.json).
 */
export const AgentToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  enabled: z.boolean().default(true),
});
export type AgentTool = z.infer<typeof AgentToolSchema>;

export const AgentToolsConfigSchema = z.object({
  tools: z.array(AgentToolSchema),
});
export type AgentToolsConfig = z.infer<typeof AgentToolsConfigSchema>;

/**
 * Instance overrides applied at deploy time (from Dashboard).
 * All fields optional — only provided values override role/base config.
 */
export const AgentInstanceOverridesSchema = z.object({
  model: z.string().min(1).optional(),
  maxTokens: z.number().int().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeout: z.number().int().min(1000).optional(),
  heartbeatInterval: z.number().int().min(1000).optional(),
  telemetryInterval: z.number().int().min(1000).optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  taskTimeout: z.number().int().min(1000).optional(),
  maxRetries: z.number().int().min(0).optional(),
});
export type AgentInstanceOverrides = z.infer<typeof AgentInstanceOverridesSchema>;

/**
 * Merged config — the final resolved configuration for an agent instance.
 * Result of: base + role + instance overrides.
 */
export const AgentMergedConfigSchema = z.object({
  // From base
  heartbeatInterval: z.number().int(),
  telemetryInterval: z.number().int(),
  logBatchInterval: z.number().int(),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  taskTimeout: z.number().int(),
  maxRetries: z.number().int(),
  // From role (+ possible instance override)
  model: z.string(),
  maxTokens: z.number().int(),
  temperature: z.number(),
  timeout: z.number().int().optional(),
});
export type AgentMergedConfig = z.infer<typeof AgentMergedConfigSchema>;

/**
 * Complete role file bundle — all files that define a role's behavior.
 * Used by the Bootstrapper to configure an agent VM.
 */
export const AgentRoleFilesSchema = z.object({
  /** SOUL.md content — personality and instructions */
  soulMd: z.string().min(1),
  /** AGENTS.md content — shared behavioral rules */
  agentsMd: z.string().min(1),
  /** TOOLS.md content — shared tool documentation */
  toolsMd: z.string().min(1),
  /** Merged config as JSON string */
  configJson: z.string().min(1),
  /** Role tools as JSON string */
  toolsJson: z.string().optional(),
});
export type AgentRoleFiles = z.infer<typeof AgentRoleFilesSchema>;

// =============================================================================
// HEARTBEAT
// =============================================================================

/**
 * Schema for POST /api/agents/:id/heartbeat — daemon sends heartbeat.
 * Sent every 30 seconds to prove liveness.
 */
export const HeartbeatPayloadSchema = z.object({
  /** Current agent status */
  status: z.enum(["idle", "working", "error"]),
  /** ID of the task currently being executed, or null */
  currentTaskId: z.string().uuid().nullable(),
  /** ISO 8601 timestamp from the daemon */
  timestamp: z.string().datetime(),
  /** Private VPC IP — sent on heartbeat so registry stays up-to-date if IP changes */
  privateIp: z.string().max(45).optional(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

/**
 * Response from POST /api/agents/:id/heartbeat.
 *
 * When a task assigned to this agent has been marked as "cancelling"
 * (via PUT /api/tasks/:id/cancel), the response includes `cancelTask`
 * with the task ID. The daemon should kill the running OpenClaw process
 * and report the task as cancelled.
 */
export const HeartbeatResponseSchema = z.object({
  ack: z.boolean(),
  /** Task ID to cancel — present when the agent's current task is marked as cancelling */
  cancelTask: z.string().uuid().nullable().optional(),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

// =============================================================================
// P2P MESSAGES — Issue #56: Agent-to-Agent Communication (Future)
//
// Direct messaging between agents for advanced scenarios like brainstorming,
// synchronous code review, and collaborative problem-solving. Primary
// communication still happens via the task queue (#55), but P2P enables
// low-latency agent interactions without registry round-trips.
//
// Discovery: GET /api/agents/:id/endpoint → { host, port, status }
// Messaging: POST http://<agent-host>:<port>/message
// Retry: Exponential backoff (1s, 3s, 9s) — 3 attempts max
// =============================================================================

/**
 * P2P message types:
 * - request/response: Synchronous request-response pattern (code review, questions)
 * - delegate: Fire-and-forget delegation of work
 * - ping/pong: Liveness check between agents (bypasses registry)
 */
export const P2PMessageTypeSchema = z.enum([
  "request",
  "response",
  "delegate",
  "ping",
  "pong",
]);
export type P2PMessageType = z.infer<typeof P2PMessageTypeSchema>;

/**
 * Schema for POST http://<agent>/message — the P2P message envelope.
 *
 * Every P2P message follows this structure. The `payload` field is
 * type-dependent (see P2PRequestPayloadSchema, etc.).
 */
export const P2PMessageSchema = z.object({
  /** Unique message ID (UUID v4) — used for correlation */
  id: z.string().uuid(),
  /** Message type */
  type: P2PMessageTypeSchema,
  /** Sender agent ID */
  from: z.string().uuid(),
  /** Recipient agent ID */
  to: z.string().uuid(),
  /** Type-specific payload */
  payload: z.unknown(),
  /** ISO 8601 timestamp from sender */
  timestamp: z.string().datetime(),
  /** Optional: correlation ID linking response to request */
  correlationId: z.string().uuid().optional(),
  /** Optional: TTL in milliseconds — receiver should discard if expired */
  ttlMs: z.number().int().positive().optional(),
});
export type P2PMessage = z.infer<typeof P2PMessageSchema>;

/**
 * Payload for "request" messages — synchronous request expecting a response.
 * Used for: code review requests, questions between agents, brainstorming prompts.
 */
export const P2PRequestPayloadSchema = z.object({
  /** What the requesting agent wants (e.g. "review this PR", "answer this question") */
  action: z.string().min(1).max(100),
  /** Context/content for the request */
  content: z.string(),
  /** Optional task ID this request relates to */
  taskId: z.string().uuid().optional(),
  /** Optional metadata */
  metadata: z.record(z.unknown()).optional(),
});
export type P2PRequestPayload = z.infer<typeof P2PRequestPayloadSchema>;

/**
 * Payload for "response" messages — reply to a request.
 * Always carries a correlationId linking to the original request.
 */
export const P2PResponsePayloadSchema = z.object({
  /** Whether the request was handled successfully */
  success: z.boolean(),
  /** Response content */
  content: z.string().optional(),
  /** Error message if success=false */
  error: z.string().optional(),
  /** Optional metadata */
  metadata: z.record(z.unknown()).optional(),
});
export type P2PResponsePayload = z.infer<typeof P2PResponsePayloadSchema>;

/**
 * Payload for "delegate" messages — fire-and-forget task delegation.
 * Unlike task queue subtasks, delegates are informal suggestions
 * that the receiving agent may or may not act on.
 */
export const P2PDelegatePayloadSchema = z.object({
  /** What should be done */
  action: z.string().min(1).max(100),
  /** Context/instructions */
  content: z.string(),
  /** Priority hint */
  priority: TaskPrioritySchema.optional(),
  /** Optional task ID this delegation relates to */
  taskId: z.string().uuid().optional(),
});
export type P2PDelegatePayload = z.infer<typeof P2PDelegatePayloadSchema>;

/**
 * Payload for "ping" messages — liveness probe.
 * The receiver should respond with a "pong" message.
 */
export const P2PPingPayloadSchema = z.object({
  /** Sender's current status */
  status: z.enum(["idle", "working", "error"]).optional(),
});
export type P2PPingPayload = z.infer<typeof P2PPingPayloadSchema>;

/**
 * Payload for "pong" messages — ping response.
 */
export const P2PPongPayloadSchema = z.object({
  /** Responder's current status */
  status: z.enum(["idle", "working", "error"]),
  /** Responder's uptime in ms */
  uptimeMs: z.number().int().nonnegative().optional(),
});
export type P2PPongPayload = z.infer<typeof P2PPongPayloadSchema>;

/**
 * Response from POST http://<agent>/message — acknowledgment.
 */
export const P2PMessageAckSchema = z.object({
  /** Whether the message was accepted for processing */
  accepted: z.boolean(),
  /** Error message if not accepted */
  error: z.string().optional(),
  /** Optional immediate response (for ping → pong) */
  response: P2PMessageSchema.optional(),
});
export type P2PMessageAck = z.infer<typeof P2PMessageAckSchema>;

/**
 * Agent endpoint info returned by GET /api/agents/:id/endpoint.
 * Used for P2P discovery — the sender resolves the target agent's
 * host and port via the registry before sending a direct message.
 */
export const AgentEndpointSchema = z.object({
  /** Agent UUID */
  id: z.string().uuid(),
  /** Agent name */
  name: z.string(),
  /** Public or private IP / hostname */
  host: z.string(),
  /** Daemon port */
  port: z.number().int().min(1).max(65535),
  /** Current agent status */
  status: z.enum(["idle", "working", "error", "offline", "unreachable", "provisioning", "destroyed"]),
  /** Private VPC IP (preferred for same-network communication) */
  privateIp: z.string().nullable().optional(),
});
export type AgentEndpoint = z.infer<typeof AgentEndpointSchema>;

/**
 * P2P retry configuration — exponential backoff with 3× multiplier.
 * Default delays: 1s, 3s, 9s.
 */
export const P2PRetryConfigSchema = z.object({
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: z.number().int().min(0).max(10).default(3),
  /** Initial delay in ms (default: 1000) */
  initialDelayMs: z.number().int().min(100).max(30000).default(1000),
  /** Backoff multiplier (default: 3) */
  multiplier: z.number().min(1).max(10).default(3),
  /** Maximum delay in ms (default: 30000) */
  maxDelayMs: z.number().int().min(1000).max(60000).default(30000),
});
export type P2PRetryConfig = z.infer<typeof P2PRetryConfigSchema>;

// Legacy aliases for backward compat
export const MessageTypeSchema = P2PMessageTypeSchema;
export type MessageType = P2PMessageType;

// =============================================================================
// LOG BATCH — Issue #57: Batch Log Shipping Protocol
//
// Daemons accumulate warn, error, and lifecycle logs locally and ship them
// to the Registry every 5 minutes in a single POST /api/logs request.
// Debug and info logs stay local (journalctl) and are NOT shipped.
// =============================================================================

/**
 * Log levels that should be shipped to the Registry.
 * - warn: Degraded but recoverable situations
 * - error: Failures requiring attention
 * - lifecycle: Structural events (task start/end, connection lost, restart)
 *
 * NOT shipped: debug, info (stay in local journalctl)
 */
export const ShippableLogLevelSchema = z.enum(["warn", "error", "lifecycle"]);
export type ShippableLogLevel = z.infer<typeof ShippableLogLevelSchema>;

/**
 * A single log entry in a batch submission.
 */
export const LogBatchEntrySchema = z.object({
  /** Log level — only warn, error, lifecycle are shipped */
  level: ShippableLogLevelSchema,
  /** Human-readable log message */
  message: z.string().min(1).max(10000),
  /** ISO 8601 timestamp from the daemon */
  timestamp: z.string().datetime(),
  /** Optional metadata for context */
  metadata: z.object({
    /** Task ID this log relates to */
    taskId: z.string().uuid().optional(),
    /** Component that generated the log (e.g. "task-executor", "daemon") */
    component: z.string().max(50).optional(),
  }).passthrough().optional(),
});
export type LogBatchEntry = z.infer<typeof LogBatchEntrySchema>;

/**
 * Schema for POST /api/logs — batch log submission from daemon.
 *
 * Protocol spec (Issue #57):
 * - Sent every 5 minutes
 * - Only warn, error, and lifecycle entries
 * - Entries are accumulated locally and shipped in batch
 * - Max 500 entries per batch to prevent abuse
 */
export const SubmitLogBatchSchema = z.object({
  /** Agent UUID — identifies the source daemon */
  agentId: z.string().uuid(),
  /** Array of log entries to persist */
  entries: z.array(LogBatchEntrySchema).min(1).max(500),
});
export type SubmitLogBatch = z.infer<typeof SubmitLogBatchSchema>;

// =============================================================================
// API RESPONSES
// =============================================================================

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    timestamp: z.coerce.date(),
  });

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    hasMore: z.boolean(),
  });

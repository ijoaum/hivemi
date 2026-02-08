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
  /** Public IP / hostname of the VM */
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

export const TelemetryInfraSchema = z.object({
  cpu: z.number(),
  memUsed: z.number(),
  memTotal: z.number(),
  diskUsed: z.number(),
  diskTotal: z.number(),
  loadAvg: z.array(z.number()),
});
export type TelemetryInfra = z.infer<typeof TelemetryInfraSchema>;

export const TelemetryLlmSchema = z.object({
  requests: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  errors: z.number(),
  avgLatencyMs: z.number(),
});
export type TelemetryLlm = z.infer<typeof TelemetryLlmSchema>;

export const TelemetryTasksSchema = z.object({
  completed: z.number(),
  failed: z.number(),
  active: z.number(),
});
export type TelemetryTasks = z.infer<typeof TelemetryTasksSchema>;

export const TelemetryDaemonSchema = z.object({
  uptime: z.number(),
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
 * All metric groups are optional (daemon may send partial reports).
 */
export const SubmitTelemetrySchema = z.object({
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
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

/**
 * Response from POST /api/agents/:id/heartbeat.
 */
export const HeartbeatResponseSchema = z.object({
  ack: z.boolean(),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

// =============================================================================
// P2P MESSAGES
// =============================================================================

export const MessageTypeSchema = z.enum([
  "task:assign",
  "task:progress",
  "task:complete",
  "task:failed",
  "agent:ping",
  "agent:pong",
  "agent:request",
  "agent:response",
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const P2PMessageSchema = z.object({
  id: z.string().uuid(),
  type: MessageTypeSchema,
  from: z.string().uuid(),
  to: z.string().uuid(),
  payload: z.unknown(),
  timestamp: z.coerce.date(),
});
export type P2PMessage = z.infer<typeof P2PMessageSchema>;

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

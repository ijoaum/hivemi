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

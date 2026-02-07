import { z } from "zod";

// =============================================================================
// AGENT
// =============================================================================

export const AgentStatusSchema = z.enum(["online", "offline", "working", "idle", "error"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

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
  lastHeartbeat: z.coerce.date(),
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

export const TaskStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["high", "medium", "low"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

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
});
export type CreateTask = z.infer<typeof CreateTaskSchema>;

// =============================================================================
// LOG
// =============================================================================

export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
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
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

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

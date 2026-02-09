import { pgTable, uuid, varchar, text, timestamp, integer, jsonb, pgEnum, index } from "drizzle-orm/pg-core";

// =============================================================================
// ENUMS
// =============================================================================

// Altered: +provisioning, +unreachable, +destroyed, -online
export const agentStatusEnum = pgEnum("agent_status", [
  "provisioning",
  "idle",
  "working",
  "offline",
  "unreachable",
  "error",
  "destroyed",
]);

// Altered: +locked, +cancelling, -running
export const taskStatusEnum = pgEnum("task_status", [
  "queued",
  "locked",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", ["high", "medium", "low"]);

// Altered: +lifecycle
export const logLevelEnum = pgEnum("log_level", ["debug", "info", "warn", "error", "lifecycle"]);

// New enums
export const deployStatusEnum = pgEnum("deploy_status", [
  "provisioning",
  "installing",
  "configuring",
  "registering",
  "ready",
  "failed",
  "destroyed",
]);

export const instanceSizeEnum = pgEnum("instance_size", ["small", "medium", "large"]);

export const cloudProviderEnum = pgEnum("cloud_provider", ["digitalocean", "gcp"]);

// =============================================================================
// TEAMS
// =============================================================================

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  emoji: varchar("emoji", { length: 50 }).notNull(),
  color: varchar("color", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// =============================================================================
// ROLES
// =============================================================================

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  description: text("description").notNull(),
  icon: varchar("icon", { length: 50 }).notNull(),
  color: varchar("color", { length: 20 }).notNull(),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  systemPrompt: text("system_prompt").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// =============================================================================
// DEPLOYS
// =============================================================================

export type DeployPhase = {
  name: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export const deploys = pgTable("deploys", {
  id: uuid("id").primaryKey().defaultRandom(),
  // FK to agents handled at DB level (SQL migration) to avoid circular reference with agents.deployId
  agentId: uuid("agent_id"),
  agentName: varchar("agent_name", { length: 100 }).notNull(),
  cloudProvider: cloudProviderEnum("cloud_provider").notNull(),
  region: varchar("region", { length: 50 }).notNull(),
  instanceSize: instanceSizeEnum("instance_size").notNull(),
  instanceId: varchar("instance_id", { length: 255 }),
  status: deployStatusEnum("status").notNull().default("provisioning"),
  phases: jsonb("phases").$type<DeployPhase[]>().notNull().default([]),
  error: text("error"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("deploys_agent_id_idx").on(table.agentId),
  index("deploys_status_idx").on(table.status),
]);

// =============================================================================
// AGENTS
// =============================================================================

export type AgentCloud = {
  provider: string;
  region: string;
  instanceId: string;
};

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  roleId: uuid("role_id").references(() => roles.id).notNull(),
  teamId: uuid("team_id").references(() => teams.id).notNull(),
  status: agentStatusEnum("status").notNull().default("offline"),
  model: varchar("model", { length: 100 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull(),
  currentTaskId: uuid("current_task_id"),
  lastHeartbeat: timestamp("last_heartbeat"),
  // New fields for deploy system
  version: varchar("version", { length: 20 }),
  openclawVersion: varchar("openclaw_version", { length: 20 }),
  cloud: jsonb("cloud").$type<AgentCloud | null>(),
  capabilities: jsonb("capabilities_list").$type<string[]>().notNull().default([]),
  privateIp: varchar("private_ip", { length: 45 }),
  deployId: uuid("deploy_id").references(() => deploys.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agents_team_id_idx").on(table.teamId),
  index("agents_role_id_idx").on(table.roleId),
]);

// =============================================================================
// TASKS
// =============================================================================

export type TaskArtifact = {
  type: string;
  url: string;
  description: string;
};

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("queued"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  agentId: uuid("agent_id").references(() => agents.id),
  teamId: uuid("team_id").references(() => teams.id).notNull(),
  input: text("input"),
  output: text("output"),
  error: text("error"),
  estimatedMs: integer("estimated_ms"),
  elapsedMs: integer("elapsed_ms"),
  // New fields for deploy system
  roleTarget: uuid("role_target").references(() => roles.id),
  lockedBy: uuid("locked_by").references(() => agents.id),
  lockedAt: timestamp("locked_at"),
  parentTaskId: uuid("parent_task_id").references((): any => tasks.id),
  artifacts: jsonb("artifacts").$type<TaskArtifact[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("tasks_team_id_idx").on(table.teamId),
  index("tasks_status_idx").on(table.status),
  index("tasks_role_target_status_idx").on(table.roleTarget, table.status),
  index("tasks_locked_by_idx").on(table.lockedBy),
  index("tasks_parent_task_id_idx").on(table.parentTaskId),
]);

// =============================================================================
// LOGS
// =============================================================================

export const logs = pgTable("logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  level: logLevelEnum("level").notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  agentId: uuid("agent_id").references(() => agents.id),
  taskId: uuid("task_id").references(() => tasks.id),
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  // New field
  component: varchar("component", { length: 50 }),
}, (table) => [
  index("logs_agent_id_timestamp_idx").on(table.agentId, table.timestamp),
]);

// =============================================================================
// AGENT TELEMETRY
// =============================================================================

export type TelemetryInfra = {
  cpu: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  /** Single number (1-min avg per protocol) or array [1m, 5m, 15m] */
  loadAvg: number | number[];
};

export type TelemetryLlm = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  errors: number;
  avgLatencyMs: number;
};

export type TelemetryTasks = {
  completed: number;
  failed: number;
  active: number;
};

export type TelemetryDaemon = {
  uptime: number;
  version: string;
  openclawStatus: string;
};

export const agentTelemetry = pgTable("agent_telemetry", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  infra: jsonb("infra").$type<TelemetryInfra>(),
  llm: jsonb("llm").$type<TelemetryLlm>(),
  tasks: jsonb("tasks").$type<TelemetryTasks>(),
  daemon: jsonb("daemon").$type<TelemetryDaemon>(),
}, (table) => [
  index("agent_telemetry_agent_id_timestamp_idx").on(table.agentId, table.timestamp),
]);

// =============================================================================
// SETTINGS
// =============================================================================

export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// =============================================================================
// TASK PROGRESS (schema ready, implementation in Phase 2 #68)
// =============================================================================

export const taskProgress = pgTable("task_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id).notNull(),
  step: text("step").notNull(),
  toolCall: varchar("tool_call", { length: 50 }),
  timestamp: timestamp("timestamp").notNull(),
}, (table) => [
  index("task_progress_task_id_idx").on(table.taskId),
]);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;

export type Deploy = typeof deploys.$inferSelect;
export type NewDeploy = typeof deploys.$inferInsert;

export type AgentTelemetryRecord = typeof agentTelemetry.$inferSelect;
export type NewAgentTelemetryRecord = typeof agentTelemetry.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export type TaskProgressRecord = typeof taskProgress.$inferSelect;
export type NewTaskProgressRecord = typeof taskProgress.$inferInsert;

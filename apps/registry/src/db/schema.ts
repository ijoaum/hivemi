import { pgTable, uuid, varchar, text, timestamp, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";

// Enums
export const agentStatusEnum = pgEnum("agent_status", ["online", "offline", "working", "idle", "error"]);
export const taskStatusEnum = pgEnum("task_status", ["queued", "running", "completed", "failed", "cancelled"]);
export const taskPriorityEnum = pgEnum("task_priority", ["high", "medium", "low"]);
export const logLevelEnum = pgEnum("log_level", ["debug", "info", "warn", "error"]);

// Teams
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  emoji: varchar("emoji", { length: 50 }).notNull(),
  color: varchar("color", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Roles
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

// Agents
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tasks
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// Logs
export const logs = pgTable("logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  level: logLevelEnum("level").notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  agentId: uuid("agent_id").references(() => agents.id),
  taskId: uuid("task_id").references(() => tasks.id),
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

// Type exports
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

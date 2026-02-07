export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: string;
  agentId?: string;
  agentName?: string;
  taskId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

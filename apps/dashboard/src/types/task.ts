export type TaskStatus = "queued" | "locked" | "completed" | "failed" | "cancelling" | "cancelled";
export type TaskPriority = "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  agentId: string;
  agentName: string;
  teamId: string;
  teamName: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedMs?: number;
  elapsedMs?: number;
  error?: string;
  input?: string;
  output?: string;
}

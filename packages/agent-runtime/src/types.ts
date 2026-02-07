import type { P2PMessage, Task } from "@hivemi/protocol";

export interface AgentConfig {
  id: string;
  name: string;
  roleId: string;
  teamId: string;
  model: string;
  port: number;
  registryUrl: string;
  secret?: string;
}

export interface TaskHandler {
  (task: Task): Promise<{ output?: string; error?: string }>;
}

export interface MessageHandler {
  (message: P2PMessage): Promise<unknown>;
}

export interface AgentRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(to: string, type: P2PMessage["type"], payload: unknown): Promise<unknown>;
  onTask(handler: TaskHandler): void;
  onMessage(handler: MessageHandler): void;
}

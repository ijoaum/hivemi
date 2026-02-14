export type AgentStatus = "provisioning" | "working" | "idle" | "error" | "offline" | "unreachable" | "destroyed";

export type TeamId = "hivemi" | "tests" | "pipeline";

export interface Team {
  id: TeamId;
  name: string;
  emoji: string;
  color: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  team: TeamId;
  status: AgentStatus;
  currentTask?: string;
  uptime: number; // in seconds — from telemetry
  tasksToday: number; // from telemetry
  cpuUsage: number; // 0-100 — from telemetry
  memoryUsage: number; // 0-100 — from telemetry
  model?: string; // LLM model configured
  cloud?: { provider: string; region: string; instanceId: string } | null;
  deployId?: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
  agentCount: number;
}

export const teams: Team[] = [
  { id: "hivemi", name: "HiveMI", emoji: "hexagon", color: "amber" },
  { id: "tests", name: "Tests", emoji: "🧪", color: "green" },
  { id: "pipeline", name: "Pipeline", emoji: "🚀", color: "purple" },
];

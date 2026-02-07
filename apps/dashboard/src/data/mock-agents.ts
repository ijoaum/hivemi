import { Agent, Role, TeamId } from "@/types/agent";

// Fun formal names for agents
const agentNames = [
  "Bartholomew", "Cornelius", "Gwendolyn", "Reginald",
  "Montgomery", "Percival", "Theodora", "Archibald",
  "Wellington", "Fitzgerald", "Penelope", "Maximilian",
];

export const mockAgents: Agent[] = [
  // HiveMI Team (5 agents)
  {
    id: "agent-001",
    name: "Bartholomew",
    role: "Tech Lead",
    team: "hivemi",
    status: "working",
    currentTask: "Reviewing PR #42 - Auth flow changes",
    uptime: 9240,
    tasksToday: 47,
    cpuUsage: 65,
    memoryUsage: 42,
  },
  {
    id: "agent-002",
    name: "Cornelius",
    role: "Developer",
    team: "hivemi",
    status: "working",
    currentTask: "Implementing agent registry",
    uptime: 4320,
    tasksToday: 23,
    cpuUsage: 78,
    memoryUsage: 55,
  },
  {
    id: "agent-003",
    name: "Reginald",
    role: "Developer",
    team: "hivemi",
    status: "working",
    currentTask: "Building protocol schemas",
    uptime: 7200,
    tasksToday: 19,
    cpuUsage: 58,
    memoryUsage: 32,
  },
  {
    id: "agent-004",
    name: "Penelope",
    role: "Developer",
    team: "hivemi",
    status: "idle",
    uptime: 10800,
    tasksToday: 34,
    cpuUsage: 12,
    memoryUsage: 38,
  },
  {
    id: "agent-005",
    name: "Theodora",
    role: "DevOps",
    team: "hivemi",
    status: "working",
    currentTask: "Setting up Docker compose",
    uptime: 5400,
    tasksToday: 28,
    cpuUsage: 52,
    memoryUsage: 44,
  },

  // Tests Team (2 agents)
  {
    id: "agent-009",
    name: "Wellington",
    role: "QA Engineer",
    team: "tests",
    status: "working",
    currentTask: "Running E2E test suite",
    uptime: 14460,
    tasksToday: 31,
    cpuUsage: 72,
    memoryUsage: 58,
  },
  {
    id: "agent-010",
    name: "Maximilian",
    role: "QA Engineer",
    team: "tests",
    status: "error",
    currentTask: "Test failed: timeout on login flow",
    uptime: 7800,
    tasksToday: 18,
    cpuUsage: 5,
    memoryUsage: 35,
  },

  // Pipeline Team (1 agent)
  {
    id: "agent-011",
    name: "Gwendolyn",
    role: "SRE",
    team: "pipeline",
    status: "working",
    currentTask: "Monitoring CI/CD pipeline",
    uptime: 28800,
    tasksToday: 42,
    cpuUsage: 34,
    memoryUsage: 41,
  },
];

export const mockRoles: Role[] = [
  {
    id: "role-001",
    name: "Tech Lead",
    description: "Reviews code, makes architecture decisions, mentors developers",
    model: "claude-opus-4",
    tools: ["git", "review", "deploy", "slack"],
    agentCount: 1,
  },
  {
    id: "role-002",
    name: "Developer",
    description: "Writes code, fixes bugs, implements features",
    model: "claude-sonnet-4",
    tools: ["git", "code", "test", "debug"],
    agentCount: 3,
  },
  {
    id: "role-003",
    name: "Mobile Dev",
    description: "Builds iOS and Android applications",
    model: "claude-sonnet-4",
    tools: ["xcode", "android-studio", "git"],
    agentCount: 2,
  },
  {
    id: "role-004",
    name: "Mobile Lead",
    description: "Coordinates mobile development efforts",
    model: "claude-opus-4",
    tools: ["xcode", "android-studio", "git", "review"],
    agentCount: 1,
  },
  {
    id: "role-005",
    name: "QA Engineer",
    description: "Writes tests, validates functionality, reports bugs",
    model: "claude-sonnet-4",
    tools: ["test", "report", "screenshot"],
    agentCount: 2,
  },
  {
    id: "role-006",
    name: "SRE",
    description: "Monitors systems, handles incidents, manages infrastructure",
    model: "claude-sonnet-4",
    tools: ["monitor", "deploy", "alert", "ssh"],
    agentCount: 1,
  },
  {
    id: "role-007",
    name: "DevOps",
    description: "Manages CI/CD pipelines, containers, and deployments",
    model: "claude-sonnet-4",
    tools: ["docker", "k8s", "ci", "deploy"],
    agentCount: 1,
  },
];

export function generateAgentName(): string {
  return agentNames[Math.floor(Math.random() * agentNames.length)];
}

export function formatUptime(seconds: number): string {
  if (seconds === 0) return "Offline";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function getAgentsByTeam(teamId: TeamId): Agent[] {
  return mockAgents.filter(a => a.team === teamId);
}

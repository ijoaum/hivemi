import { NextRequest, NextResponse } from "next/server";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";

// Team name to teamId mapping (will be resolved dynamically)
const teamNameMap: Record<string, string> = {
  "HiveMI": "team-hivemi",
  "Tests": "team-tests", 
  "Pipeline": "team-pipeline",
};

// Base mock agents (teamId will be resolved)
const baseMockAgents = [
  { id: "agent-001", name: "Bartholomew", roleId: "role-tech-lead", teamName: "HiveMI", status: "working", model: "gpt-4o", port: 5001, currentTaskId: "task-042" },
  { id: "agent-002", name: "Cornelius", roleId: "role-developer", teamName: "HiveMI", status: "working", model: "gpt-4o", port: 5002, currentTaskId: "task-043" },
  { id: "agent-003", name: "Reginald", roleId: "role-developer", teamName: "HiveMI", status: "working", model: "claude-3-5-sonnet", port: 5003, currentTaskId: "task-044" },
  { id: "agent-004", name: "Penelope", roleId: "role-developer", teamName: "HiveMI", status: "idle", model: "gpt-4o", port: 5004, currentTaskId: null },
  { id: "agent-005", name: "Theodora", roleId: "role-devops", teamName: "HiveMI", status: "working", model: "gpt-4o", port: 5005, currentTaskId: "task-045" },
  { id: "agent-006", name: "Wellington", roleId: "role-qa", teamName: "Tests", status: "working", model: "gpt-4o", port: 5006, currentTaskId: "task-046" },
  { id: "agent-007", name: "Maximilian", roleId: "role-qa", teamName: "Tests", status: "error", model: "gpt-4o", port: 5007, currentTaskId: null },
  { id: "agent-008", name: "Gwendolyn", roleId: "role-sre", teamName: "Pipeline", status: "working", model: "claude-3-5-sonnet", port: 5008, currentTaskId: "task-047" },
];

async function getTeamIdMap(): Promise<Record<string, string>> {
  try {
    const response = await fetch(`${REGISTRY_URL}/api/teams`, {
      headers: { "Content-Type": "application/json" },
    });
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data?.length > 0) {
        const map: Record<string, string> = {};
        for (const team of data.data) {
          map[team.name] = team.id;
        }
        return map;
      }
    }
  } catch {
    // Fall back to static map
  }
  return teamNameMap;
}

async function getMockAgents() {
  const teamIdMap = await getTeamIdMap();
  
  return baseMockAgents.map(agent => ({
    id: agent.id,
    name: agent.name,
    roleId: agent.roleId,
    teamId: teamIdMap[agent.teamName] || agent.teamName,
    status: agent.status,
    model: agent.model,
    host: "http://localhost",
    port: agent.port,
    currentTaskId: agent.currentTaskId,
    lastHeartbeat: new Date().toISOString(),
    createdAt: new Date(Date.now() - 86400000 * Math.floor(Math.random() * 7 + 1)).toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

export async function GET(request: NextRequest) {
  try {
    // Try to get agents from Registry
    const response = await fetch(`${REGISTRY_URL}/api/agents`, {
      headers: { "Content-Type": "application/json" },
    });
    
    if (response.ok) {
      const data = await response.json();
      // If Registry has agents, return them; otherwise return mocks
      if (data.success && data.data?.length > 0) {
        return NextResponse.json(data);
      }
    }
  } catch (error) {
    console.log("Registry unavailable, using mock agents");
  }
  
  // Return mock agents with resolved team IDs
  const mockAgents = await getMockAgents();
  return NextResponse.json({ success: true, data: mockAgents });
}

export async function POST(request: NextRequest) {
  try {
    const response = await fetch(`${REGISTRY_URL}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Registry unavailable" },
      { status: 502 }
    );
  }
}

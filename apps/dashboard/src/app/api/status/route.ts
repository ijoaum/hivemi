import { NextRequest, NextResponse } from "next/server";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";

export async function GET(request: NextRequest) {
  try {
    // Fetch data from registry
    const [agentsRes, rolesRes, teamsRes] = await Promise.all([
      fetch(`${REGISTRY_URL}/api/agents`),
      fetch(`${REGISTRY_URL}/api/roles`),
      fetch(`${REGISTRY_URL}/api/teams`),
    ]);

    const [agentsData, rolesData, teamsData] = await Promise.all([
      agentsRes.json(),
      rolesRes.json(),
      teamsRes.json(),
    ]);

    const agents = agentsData.data || [];
    const roles = rolesData.data || [];
    const teams = teamsData.data || [];

    // Calculate status counts
    const status = {
      agents: {
        total: agents.length,
        online: agents.filter((a: { status: string }) => a.status === "online").length,
        working: agents.filter((a: { status: string }) => a.status === "working").length,
        idle: agents.filter((a: { status: string }) => a.status === "idle").length,
        error: agents.filter((a: { status: string }) => a.status === "error").length,
      },
      roles: roles.length,
      teams: teams.length,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    console.error("Status fetch error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch status" },
      { status: 502 }
    );
  }
}

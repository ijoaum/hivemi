import { NextRequest, NextResponse } from "next/server";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";

// Mock teams for demo/development
const mockTeams = [
  {
    id: "team-hivemi",
    name: "HiveMI",
    emoji: "🐝",
    color: "amber",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "team-tests",
    name: "Tests",
    emoji: "🧪",
    color: "green",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "team-pipeline",
    name: "Pipeline",
    emoji: "🚀",
    color: "purple",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${REGISTRY_URL}/api/teams`, {
      headers: { "Content-Type": "application/json" },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data?.length > 0) {
        return NextResponse.json(data);
      }
    }
  } catch (error) {
    console.log("Registry unavailable, using mock teams");
  }
  
  return NextResponse.json({ success: true, data: mockTeams });
}

export async function POST(request: NextRequest) {
  try {
    const response = await fetch(`${REGISTRY_URL}/api/teams`, {
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

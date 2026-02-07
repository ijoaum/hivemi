import { NextRequest, NextResponse } from "next/server";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";

// Mock roles for demo/development
const mockRoles = [
  {
    id: "role-tech-lead",
    name: "Tech Lead",
    slug: "tech-lead",
    description: "Reviews code, makes architectural decisions, mentors developers",
    icon: "👨‍💻",
    color: "blue",
    capabilities: ["code-review", "architecture", "mentoring"],
    systemPrompt: "You are a senior tech lead...",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "role-developer",
    name: "Developer",
    slug: "developer",
    description: "Writes code, implements features, fixes bugs",
    icon: "💻",
    color: "green",
    capabilities: ["coding", "debugging", "testing"],
    systemPrompt: "You are a skilled software developer...",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "role-qa",
    name: "QA Engineer",
    slug: "qa",
    description: "Tests features, writes test cases, ensures quality",
    icon: "🧪",
    color: "purple",
    capabilities: ["testing", "automation", "bug-reporting"],
    systemPrompt: "You are a QA engineer focused on quality...",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "role-devops",
    name: "DevOps",
    slug: "devops",
    description: "Manages infrastructure, CI/CD, deployments",
    icon: "🔧",
    color: "orange",
    capabilities: ["infrastructure", "ci-cd", "monitoring"],
    systemPrompt: "You are a DevOps engineer...",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "role-sre",
    name: "SRE",
    slug: "sre",
    description: "Site reliability, monitoring, incident response",
    icon: "🚨",
    color: "red",
    capabilities: ["monitoring", "incident-response", "reliability"],
    systemPrompt: "You are a site reliability engineer...",
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${REGISTRY_URL}/api/roles`, {
      headers: { "Content-Type": "application/json" },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data?.length > 0) {
        return NextResponse.json(data);
      }
    }
  } catch (error) {
    console.log("Registry unavailable, using mock roles");
  }
  
  return NextResponse.json({ success: true, data: mockRoles });
}

export async function POST(request: NextRequest) {
  try {
    const response = await fetch(`${REGISTRY_URL}/api/roles`, {
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

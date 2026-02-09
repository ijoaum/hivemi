import { NextRequest, NextResponse } from "next/server";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${REGISTRY_URL}/api/roles`, {
      headers: { "Content-Type": "application/json" },
    });
    
    if (!response.ok) {
      throw new Error(`Registry returned ${response.status}`);
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch roles from Registry:", error);
    return NextResponse.json(
      { success: false, error: "Registry unavailable" },
      { status: 502 }
    );
  }
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

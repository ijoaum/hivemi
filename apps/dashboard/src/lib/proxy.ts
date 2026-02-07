import { NextRequest, NextResponse } from "next/server";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";
const MANAGER_URL = process.env.MANAGER_URL || "http://localhost:4000";

export async function proxyToRegistry(
  request: NextRequest,
  path: string
): Promise<NextResponse> {
  return proxyTo(REGISTRY_URL, request, path);
}

export async function proxyToManager(
  request: NextRequest,
  path: string
): Promise<NextResponse> {
  return proxyTo(MANAGER_URL, request, path);
}

async function proxyTo(
  baseUrl: string,
  request: NextRequest,
  path: string
): Promise<NextResponse> {
  const url = `${baseUrl}${path}`;
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  // Forward auth header if present
  const auth = request.headers.get("authorization");
  if (auth) {
    headers["Authorization"] = auth;
  }

  try {
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // Forward body for POST/PUT/PATCH
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      fetchOptions.body = await request.text();
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error(`Proxy error to ${url}:`, error);
    return NextResponse.json(
      { success: false, error: "Backend service unavailable" },
      { status: 502 }
    );
  }
}

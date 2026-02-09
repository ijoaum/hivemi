import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

// GET /api/tasks/next?role=<roleId>&agentId=<agentId>
// Proxies to Registry's atomic task claim endpoint (SELECT FOR UPDATE SKIP LOCKED)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const queryString = searchParams.toString();
  const path = queryString ? `/api/tasks/next?${queryString}` : "/api/tasks/next";
  return proxyToRegistry(request, path);
}

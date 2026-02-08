import { NextRequest } from "next/server";
import { proxyToRegistry, proxyToManager } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const queryString = searchParams.toString();
  const path = queryString ? `/api/tasks?${queryString}` : "/api/tasks";
  // GET goes to Manager which proxies to Registry with filtering
  return proxyToManager(request, path);
}

export async function POST(request: NextRequest) {
  // POST goes to Manager which handles task creation with orchestration
  return proxyToManager(request, "/api/tasks");
}

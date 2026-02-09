import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const queryString = searchParams.toString();
  const path = queryString ? `/api/logs?${queryString}` : "/api/logs";
  return proxyToRegistry(request, path);
}

export async function POST(request: NextRequest) {
  return proxyToRegistry(request, "/api/logs");
}

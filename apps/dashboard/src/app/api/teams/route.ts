import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToRegistry(request, "/api/teams");
}

export async function POST(request: NextRequest) {
  return proxyToRegistry(request, "/api/teams");
}

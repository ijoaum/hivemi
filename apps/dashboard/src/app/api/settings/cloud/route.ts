import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToRegistry(request, "/api/settings/cloud");
}

export async function PUT(request: NextRequest) {
  return proxyToRegistry(request, "/api/settings/cloud");
}

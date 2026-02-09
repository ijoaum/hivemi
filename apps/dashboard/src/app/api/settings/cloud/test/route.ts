import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function POST(request: NextRequest) {
  return proxyToRegistry(request, "/api/settings/cloud/test");
}

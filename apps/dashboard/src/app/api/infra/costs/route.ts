import { NextRequest } from "next/server";
import { proxyToManager } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToManager(request, "/api/infra/costs");
}

import { NextRequest } from "next/server";
import { proxyToManager } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  const limit = request.nextUrl.searchParams.get("limit") || "20";
  return proxyToManager(request, `/api/infra/reconcile/history?limit=${limit}`);
}

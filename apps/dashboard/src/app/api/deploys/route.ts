import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function POST(request: NextRequest) {
  return proxyToRegistry(request, "/api/deploys");
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit");
  const status = searchParams.get("status");

  const qs = new URLSearchParams();
  if (limit) qs.set("limit", limit);
  if (status) qs.set("status", status);

  const queryStr = qs.toString() ? `?${qs.toString()}` : "";
  return proxyToRegistry(request, `/api/deploys${queryStr}`);
}

import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToRegistry(request, `/api/agents/${id}/telemetry`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit");
  const qs = limit ? `?limit=${limit}` : "";
  return proxyToRegistry(request, `/api/agents/${id}/telemetry${qs}`);
}

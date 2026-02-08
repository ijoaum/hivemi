import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const limit = searchParams.get("limit");

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (limit) qs.set("limit", limit);

  const queryStr = qs.toString() ? `?${qs.toString()}` : "";
  return proxyToRegistry(request, `/api/agents/${id}/telemetry/history${queryStr}`);
}

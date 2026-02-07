import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToRegistry(request, `/api/teams/${id}`);
}

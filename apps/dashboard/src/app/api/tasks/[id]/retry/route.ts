import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToRegistry(request, `/api/tasks/${id}/retry`);
}

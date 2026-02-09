import { NextRequest } from "next/server";
import { proxyToManager } from "@/lib/proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToManager(request, `/api/deploy/${id}/retry`);
}

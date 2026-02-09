import { NextRequest } from "next/server";
import { proxyToManager } from "@/lib/proxy";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params;
  return proxyToManager(request, `/api/infra/reconcile/orphan/${instanceId}`);
}

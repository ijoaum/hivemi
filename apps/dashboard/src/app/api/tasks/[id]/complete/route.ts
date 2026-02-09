import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

// PUT /api/tasks/:id/complete — Complete or fail a task
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToRegistry(request, `/api/tasks/${id}/complete`);
}

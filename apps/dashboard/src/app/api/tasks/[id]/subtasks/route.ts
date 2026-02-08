import { NextRequest } from "next/server";
import { proxyToRegistry } from "@/lib/proxy";

// POST /api/tasks/:id/subtasks — Create subtasks for a parent task
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToRegistry(request, `/api/tasks/${id}/subtasks`);
}

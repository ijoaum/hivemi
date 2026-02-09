import { NextRequest } from "next/server";
import { proxyToManager } from "@/lib/proxy";

export async function POST(request: NextRequest) {
  return proxyToManager(request, "/api/deploy");
}

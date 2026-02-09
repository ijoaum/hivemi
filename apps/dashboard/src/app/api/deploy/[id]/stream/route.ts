import { NextRequest, NextResponse } from "next/server";

const MANAGER_URL = process.env.MANAGER_URL || "http://localhost:4000";

/**
 * SSE proxy: forwards the Manager's deploy event stream to the client.
 * This route passes the response through without JSON parsing.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = `${MANAGER_URL}/api/deploy/${id}/stream`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: "Stream unavailable" }));
      return NextResponse.json(
        { success: false, error: data.error || "Stream unavailable" },
        { status: response.status },
      );
    }

    // Forward the SSE stream directly
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error(`SSE proxy error to ${url}:`, error);
    return NextResponse.json(
      { success: false, error: "Backend service unavailable" },
      { status: 502 },
    );
  }
}

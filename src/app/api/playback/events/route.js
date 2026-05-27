import { NextResponse } from "next/server";
import { getControlSystemApiUrl } from "@/lib/control-system/client";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

/**
 * Same-origin proxy for Control System playback analytics.
 * Browser telemetry uses buildControlSystemUrl → /api/playback/events on storefront.
 */
export async function POST(request) {
  const apiBase = getControlSystemApiUrl();
  if (!apiBase) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const body = await request.text();
  const sessionId = request.headers.get("x-control-session-id");
  const cookie = request.headers.get("cookie");

  try {
    const upstream = await fetch(`${apiBase}/api/playback/events`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": request.headers.get("content-type") || "application/json",
        ...(sessionId ? { "x-control-session-id": sessionId } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body,
      cache: "no-store",
    });

    const responseBody = await upstream.text();
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "upstream_unavailable" }, { status: 502 });
  }
}

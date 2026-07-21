import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const STABLE_CONTROL_SYSTEM_ORIGIN = "https://2mrrw-control-system.vercel.app";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

/**
 * Same-origin proxy for Control System playback analytics.
 * Browser telemetry uses buildControlSystemUrl → /api/playback/events on storefront.
 */
export async function POST(request) {
  const rl = await checkRateLimit(request, { routeKey: "playback.events", limit: 120, windowSeconds: 60 });
  if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

  // Server-side proxy always targets the stable CS alias (env may be empty or a stale preview URL).
  const apiBase = STABLE_CONTROL_SYSTEM_ORIGIN;
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

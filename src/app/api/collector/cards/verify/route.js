import { NextResponse } from "next/server";
import {
  requestDeviceInfo,
  requestIpHash,
  verifyCollectorCardToken,
} from "@/lib/collector-cards";
import { getGuestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function POST(req) {
  try {
    const user = await getGuestUser();
    const body = await req.json();
    const token = body.token || body.hiddenSecureId || body.collectorToken;
    const limit = await checkRateLimit(req, {
      routeKey: "collector-card-verify",
      limit: 12,
      windowSeconds: 300,
      identifier: user?.id || requestIpHash(req) || "anonymous",
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const result = await verifyCollectorCardToken({
      token,
      userId: user?.id || null,
      deviceInfo: requestDeviceInfo(req),
      ipHash: requestIpHash(req),
    });

    if (!result.ok) {
      return NextResponse.json({
        verified: false,
        reason: result.reason,
        error: "Collector card could not be verified.",
      }, { status: result.status || 400 });
    }

    return NextResponse.json({
      verified: true,
      card: result.card,
    });
  } catch (err) {
    console.error("collector card verify error:", err);
    return NextResponse.json({ error: err.message || "Collector verification failed." }, { status: 500 });
  }
}

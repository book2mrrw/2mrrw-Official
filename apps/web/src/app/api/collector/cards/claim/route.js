import { NextResponse } from "next/server";
import {
  claimCollectorCard,
  requestDeviceInfo,
  requestIpHash,
} from "@/lib/collector-cards";
import { getRequestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { invalidateAccountStateCache } from "@/lib/server/account-state-cache";

export async function POST(req) {
  try {
    const user = await getRequestUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in to claim collector access." }, { status: 401 });
    }

    const body = await req.json();
    const token = body.token || body.hiddenSecureId || body.collectorToken;
    const limit = await checkRateLimit(req, {
      routeKey: "collector-card-claim",
      limit: 5,
      windowSeconds: 300,
      identifier: user.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const result = await claimCollectorCard({
      userId: user.id,
      token,
      deviceInfo: requestDeviceInfo(req),
      ipHash: requestIpHash(req),
    });

    if (!result.ok) {
      const messages = {
        invalid_token: "Collector card could not be verified.",
        not_found: "Collector card could not be verified.",
        revoked: "This collector card is no longer active.",
        already_claimed: "This collector card is already attached to another account.",
        claim_race: "This card was just claimed. Refresh and try again.",
        unavailable: "Collector card verification is temporarily unavailable. Try again later.",
      };
      return NextResponse.json({
        error: messages[result.reason] || "Collector claim failed.",
        reason: result.reason,
        visibleSerial: result.visibleSerial || null,
      }, { status: result.status || 400 });
    }

    invalidateAccountStateCache(user.id).catch(() => {});
    return NextResponse.json({
      claimed: true,
      card: result.card,
      access: result.access,
    });
  } catch (err) {
    console.error("collector card claim error:", err);
    return NextResponse.json({ error: err.message || "Collector claim failed." }, { status: 500 });
  }
}

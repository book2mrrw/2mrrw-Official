import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requestDeviceInfo,
  requestIpHash,
  verifyCollectorCardToken,
} from "@/lib/collector-cards";
import { verifyCardToken } from "@/lib/verifyCardToken";
import { getGuestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function POST(req) {
  try {
    const user = await getGuestUser();
    const body = await req.json();
    const jwt = body.jwt || body.cardJwt;
    const token = body.token || body.hiddenSecureId || body.collectorToken;
    const limit = await checkRateLimit(req, {
      routeKey: "collector-card-verify",
      limit: 12,
      windowSeconds: 300,
      identifier: user?.id || requestIpHash(req) || "anonymous",
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    let result;
    if (jwt) {
      // NFC scan path: verify JWT signature, then resolve card from DB.
      const verified = verifyCardToken(jwt);
      if (!verified.ok) {
        return NextResponse.json(
          { verified: false, reason: verified.reason, error: "Invalid collector card JWT." },
          { status: 401 }
        );
      }
      const admin = createAdminClient();
      const { data: card } = await admin
        .from("collector_cards")
        .select("id, visible_serial, release_title, access_tier, claimed, claimed_by_user_id, verification_status, revoked_at")
        .eq("id", verified.cardId)
        .maybeSingle();

      if (!card || card.verification_status === "revoked" || card.revoked_at) {
        return NextResponse.json({ verified: false, reason: "revoked" }, { status: 403 });
      }
      result = {
        ok: true,
        card: {
          visibleSerial: card.visible_serial,
          releaseName: card.release_title,
          accessTier: card.access_tier,
          claimed: card.claimed,
          ownedByCurrentUser: Boolean(user?.id && card.claimed_by_user_id === user.id),
          status: card.verification_status,
        },
      };
    } else {
      result = await verifyCollectorCardToken({
        token,
        userId: user?.id || null,
        deviceInfo: requestDeviceInfo(req),
        ipHash: requestIpHash(req),
      });
    }

    if (!result?.ok) {
      return NextResponse.json({
        verified: false,
        reason: result?.reason,
        error: "Collector card could not be verified.",
      }, { status: result?.status || 400 });
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

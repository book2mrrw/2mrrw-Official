import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  requestDeviceInfo,
  requestIpHash,
  verifyCollectorCardToken,
} from "@/lib/collector-cards";
import { getActiveCardBenefits } from "@/lib/entitlements";
import { verifyCardToken } from "@/lib/verifyCardToken";
import { getGuestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

const LOG_PREFIX = "[collector-card-verify]";

async function recordEventCheckin(admin, { userId, cardId, method, deviceInfo, ipHash, status, metadata }) {
  const { error } = await admin.from("event_checkins").insert({
    user_id: userId,
    collector_card_id: cardId,
    event_name: metadata?.eventName || "general",
    checkin_method: method,
    status,
    device_info: deviceInfo,
    ip_hash: ipHash,
    metadata,
  });
  if (error) {
    console.warn(`${LOG_PREFIX} checkin log failed`, error.message);
  }
}

export async function POST(req) {
  try {
    const user = await getGuestUser();
    const body = await req.json();
    const jwt = body.jwt || body.cardJwt;
    const token = body.token || body.hiddenSecureId || body.collectorToken;
    const eventName = body.eventName || body.event || "general";

    const limit = await checkRateLimit(req, {
      routeKey: "collector-card-verify",
      limit: 12,
      windowSeconds: 300,
      identifier: user?.id || requestIpHash(req) || "anonymous",
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const deviceInfo = requestDeviceInfo(req);
    const ipHash = requestIpHash(req);
    const admin = getAdminClient();

    let cardResult = null;
    let checkinMethod = "nfc";

    if (jwt) {
      const verified = verifyCardToken(jwt);
      if (!verified.ok) {
        return NextResponse.json({
          verified: false,
          reason: verified.reason,
          error: "Invalid collector card JWT.",
        }, { status: 401 });
      }
      checkinMethod = "jwt";
      const { data: card } = await admin
        .from("collector_cards")
        .select("id, visible_serial, release_title, access_tier, claimed, claimed_by_user_id, verification_status, revoked_at, digital_access_granted")
        .eq("id", verified.cardId)
        .maybeSingle();

      if (!card || card.verification_status === "revoked" || card.revoked_at) {
        await recordEventCheckin(admin, {
          userId: user?.id,
          cardId: verified.cardId,
          method: checkinMethod,
          deviceInfo,
          ipHash,
          status: "blocked",
          metadata: { reason: "revoked_or_missing", eventName },
        });
        return NextResponse.json({ verified: false, reason: "revoked" }, { status: 403 });
      }

      cardResult = {
        ok: true,
        card: {
          visibleSerial: card.visible_serial,
          releaseName: card.release_title,
          accessTier: card.access_tier,
          claimed: card.claimed,
          ownedByCurrentUser: Boolean(user?.id && card.claimed_by_user_id === user.id),
          status: card.verification_status,
          digitalAccessGranted: card.digital_access_granted,
        },
      };
    } else {
      cardResult = await verifyCollectorCardToken({
        token,
        userId: user?.id || null,
        deviceInfo,
        ipHash,
      });
    }

    if (!cardResult?.ok) {
      return NextResponse.json({
        verified: false,
        reason: cardResult?.reason,
        error: "Collector card could not be verified.",
      }, { status: cardResult?.status || 400 });
    }

    const benefits = await getActiveCardBenefits(admin, "collector_card");

    const { data: cardRow } = await admin
      .from("collector_cards")
      .select("id")
      .eq("visible_serial", cardResult.card.visibleSerial)
      .maybeSingle();

    await recordEventCheckin(admin, {
      userId: user?.id,
      cardId: cardRow?.id || null,
      method: checkinMethod,
      deviceInfo,
      ipHash,
      status: "checked_in",
      metadata: { eventName, serial: cardResult.card.visibleSerial },
    });

    console.log(`${LOG_PREFIX} verified`, {
      serial: cardResult.card.visibleSerial,
      userId: user?.id,
      method: checkinMethod,
    });

    return NextResponse.json({
      verified: true,
      card: cardResult.card,
      benefits: benefits.map((b) => ({
        key: b.benefit_key,
        label: b.label,
        type: b.benefit_type,
        value: b.value_numeric ?? b.value_text,
      })),
      checkin: { eventName, method: checkinMethod },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} error:`, err);
    return NextResponse.json({ error: err.message || "Collector verification failed." }, { status: 500 });
  }
}

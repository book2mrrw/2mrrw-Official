import { NextResponse } from "next/server";
import {
  activateCollectorCardBySerial,
  requestDeviceInfo,
  requestIpHash,
} from "@/lib/collector-cards";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { invalidateAccountStateCache } from "@/lib/server/account-state-cache";

const LOG_PREFIX = "[collector-card-activate]";

export async function POST(req) {
  try {
    const user = await getFanSessionUser();
    if (!user?.id || user.isGuest) {
      return NextResponse.json({ error: "Sign in to activate your collector card." }, { status: 401 });
    }

    const body = await req.json();
    const visibleSerial = body.visibleSerial || body.visible_serial || body.serial;
    const legalName = body.legalName || body.legal_name || body.fullLegalName;

    const limit = await checkRateLimit(req, {
      routeKey: "collector-card-activate",
      limit: 8,
      windowSeconds: 300,
      identifier: user.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    // The per-user limit above doesn't stop enumeration across many accounts
    // hitting from the same origin — visible serials are short, sequential,
    // and printed on a small edition, so that's a real path to guessing a
    // card someone else owns. A second, IP-scoped limit (default identifier
    // is the client IP — see checkRateLimit) closes that gap without needing
    // any change to already-printed physical cards.
    const ipLimit = await checkRateLimit(req, {
      routeKey: "collector-card-activate-ip",
      limit: 20,
      windowSeconds: 300,
    });
    if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterSeconds);

    const result = await activateCollectorCardBySerial({
      userId: user.id,
      visibleSerial,
      legalName,
      deviceInfo: requestDeviceInfo(req),
      ipHash: requestIpHash(req),
    });

    if (!result.ok) {
      const messages = {
        auth_required: "Sign in to activate your collector card.",
        invalid_serial: "Enter the serial printed on your collector card.",
        legal_name_required: "Full legal name is required.",
        not_found: "No collector card matches that serial.",
        revoked: "This collector card is no longer active.",
        assigned_to_other: "This card is reserved for another account. Contact support.",
        already_claimed: "This collector card is already linked to another account.",
        claim_race: "Activation in progress. Refresh and try again.",
        unavailable: "Activation is temporarily unavailable. Try again later.",
      };
      return NextResponse.json(
        {
          error: messages[result.reason] || "Collector activation failed.",
          reason: result.reason,
          visibleSerial: result.visibleSerial || null,
        },
        { status: result.status || 400 }
      );
    }

    console.log(`${LOG_PREFIX} ok`, { userId: user.id, serial: result.card?.visibleSerial });

    invalidateAccountStateCache(user.id).catch(() => {});
    return NextResponse.json({
      activated: true,
      alreadyActive: Boolean(result.alreadyActive),
      card: result.card,
      access: result.access,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} error:`, err);
    return NextResponse.json({ error: err.message || "Collector activation failed." }, { status: 500 });
  }
}

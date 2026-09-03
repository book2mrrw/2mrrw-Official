import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getBroadcastForProviderStart, scheduleBroadcast } from "@/lib/server/livestream";
import {
  getLiveRelayPublishUrl,
  issueLiveRelayPublishToken,
} from "@/lib/server/live-relay-token";
import {
  getAuthorizedTwitchStreamKey,
  TwitchAuthorizationRequiredError,
} from "@/lib/server/twitch-user-authorization";

export const dynamic = "force-dynamic";

const BROADCASTER_LOGIN = process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw";
const ALLOWED_AUDIENCES = new Set(["all", "subscriber", "collector", "purchaser"]);
const REUSE_SCHEDULE_WINDOW_MS = 6 * 60 * 60 * 1000;

function denialResponse(gate) {
  const denial = classifyAdminAuthorityDenial(gate.reason);
  return NextResponse.json(
    { error: denial.status === 401 ? "Unauthorized" : "Admin verification required", code: denial.code },
    { status: denial.status, headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}

export async function POST(req) {
  const gate = await requireAdminActor({ recentSeconds: 15 * 60 });
  if (!gate.ok) return denialResponse(gate);

  const limit = await checkRateLimit(req, {
    routeKey: "admin.livestream.studio.session",
    limit: 20,
    windowSeconds: 60,
    identifier: gate.user.id,
  });
  if (limit.limited || limit.allowed === false) return rateLimitResponse(limit.retryAfterSeconds);

  try {
    let body = {};
    try { body = await req.json(); } catch { /* The request body is optional. */ }

    const title = String(body.title || "2MRRW Live").trim().slice(0, 140) || "2MRRW Live";
    const audience = ALLOWED_AUDIENCES.has(body.audience) ? body.audience : "all";
    const publishUrl = getLiveRelayPublishUrl();
    const admin = getAdminClient();
    // Validate/refresh Twitch authority before creating a publisher session.
    // The returned key is deliberately discarded here; only the Fly relay's
    // service-authenticated endpoint can obtain an ingest destination.
    await getAuthorizedTwitchStreamKey();
    const current = await getBroadcastForProviderStart(admin);
    const scheduledAt = current?.goes_live_at ? Date.parse(current.goes_live_at) : NaN;
    const shouldReuse = Boolean(current?.is_live) || (
      Number.isFinite(scheduledAt) && Math.abs(scheduledAt - Date.now()) <= REUSE_SCHEDULE_WINDOW_MS
    );

    // Going live is not coupled to the scheduler. When there is no imminent
    // broadcast, create an on-demand record that EventSub can atomically promote
    // as soon as Twitch confirms ingest.
    const broadcast = shouldReuse
      ? current
      : await scheduleBroadcast(admin, {
          title,
          goesLiveAt: new Date().toISOString(),
          channel: BROADCASTER_LOGIN,
          audience,
        });

    const credential = issueLiveRelayPublishToken({ actorId: gate.user.id });
    return NextResponse.json({
      ok: true,
      publishUrl,
      publishToken: credential.token,
      expiresAt: credential.expiresAt,
      broadcast,
      broadcaster: BROADCASTER_LOGIN,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("[livestream/studio/session]", error?.message);
    if (error instanceof TwitchAuthorizationRequiredError) {
      return NextResponse.json(
        { error: "Authorize Twitch before going live", code: "TWITCH_AUTHORIZATION_REQUIRED" },
        { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } }
      );
    }
    const configurationError = /LIVE_RELAY_/.test(String(error?.message || ""));
    return NextResponse.json(
      { error: configurationError ? "The live relay is not configured yet" : "Could not start a live publishing session" },
      { status: configurationError ? 503 : 500, headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  }
}

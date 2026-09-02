import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  isTwitchConfigured,
  getTwitchConfiguration,
  getTwitchWebhookCallbackUrl,
  getBroadcasterUserId,
  getEventSubSubscriptions,
  deleteEventSubSubscription,
  ensureTwitchStreamEventSubscriptions,
} from "@/lib/server/twitch-eventsub";

export const dynamic = "force-dynamic";

const BROADCASTER_LOGIN   = process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw";
const WATCHED_EVENT_TYPES = ["stream.online", "stream.offline"];

async function guard(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return { user: null, err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const rl = await checkRateLimit(req, { routeKey: "admin.twitch", limit: 20, windowSeconds: 60, identifier: user.id });
  if (rl.limited) return { user: null, err: rateLimitResponse(rl.retryAfterSeconds) };
  return { user, err: null };
}

// GET — current EventSub subscription status (configured / active / pending).
export async function GET(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  if (!isTwitchConfigured()) {
    const config = getTwitchConfiguration();
    return NextResponse.json({
      configured:    false,
      subscriptions: [],
      missing:       config.missing,
      invalid:       config.invalid,
    });
  }

  try {
    const callbackUrl = getTwitchWebhookCallbackUrl();
    const broadcasterId = await getBroadcasterUserId(BROADCASTER_LOGIN);
    const subs     = await getEventSubSubscriptions();
    // Filter by BOTH event type AND broadcaster — stale subs for other accounts must not count.
    const relevant = subs.filter(s =>
      WATCHED_EVENT_TYPES.includes(s.type) &&
      s.condition?.broadcaster_user_id === broadcasterId
    );
    const allActive = WATCHED_EVENT_TYPES.every(t => relevant.some(s =>
      s.type === t &&
      s.status === "enabled" &&
      s.transport?.callback === callbackUrl
    ));
    return NextResponse.json({ configured: true, allActive, subscriptions: relevant, broadcasterId, broadcaster: BROADCASTER_LOGIN, callbackUrl });
  } catch (err) {
    console.error("[admin/twitch/register GET]", err?.message);
    return NextResponse.json({ configured: true, allActive: false, error: err.message, subscriptions: [] }, { status: 502 });
  }
}

// POST — register stream.online + stream.offline subscriptions.
export async function POST(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  if (!isTwitchConfigured()) {
    const config = getTwitchConfiguration();
    return NextResponse.json({
      error:   "Twitch configuration is missing or invalid.",
      missing: config.missing,
      invalid: config.invalid,
    }, { status: 503 });
  }

  try {
    const ensured = await ensureTwitchStreamEventSubscriptions(BROADCASTER_LOGIN);
    return NextResponse.json({ ok: true, broadcaster: BROADCASTER_LOGIN, ...ensured });
  } catch (err) {
    console.error("[admin/twitch/register POST]", err?.message);
    return NextResponse.json({ error: err.message || "Registration failed" }, { status: 500 });
  }
}

// DELETE — remove all EventSub subscriptions for this broadcaster.
export async function DELETE(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  if (!isTwitchConfigured()) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  try {
    const broadcasterId = await getBroadcasterUserId(BROADCASTER_LOGIN);
    const subs          = await getEventSubSubscriptions();
    const relevant      = subs.filter(s =>
      WATCHED_EVENT_TYPES.includes(s.type) &&
      s.condition?.broadcaster_user_id === broadcasterId
    );

    const settled = await Promise.allSettled(relevant.map(s => deleteEventSubSubscription(s.id)));
    return NextResponse.json({
      ok:      true,
      removed: relevant.length,
      results: settled.map((r, i) => ({ id: relevant[i].id, ok: r.status === "fulfilled" })),
    });
  } catch (err) {
    console.error("[admin/twitch/register DELETE]", err?.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

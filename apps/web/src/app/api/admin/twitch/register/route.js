import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  isTwitchConfigured,
  getBroadcasterUserId,
  getEventSubSubscriptions,
  registerEventSubSubscription,
  deleteEventSubSubscription,
} from "@/lib/server/twitch-eventsub";

export const dynamic = "force-dynamic";

const BROADCASTER_LOGIN   = process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw";
const WATCHED_EVENT_TYPES = ["stream.online", "stream.offline"];

async function guard(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return { user: null, err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const rl = await checkRateLimit(req, { routeKey: "admin.twitch", limit: 20, windowSeconds: 60, identifier: user.id });
  if (rl.limited) return { user: null, err: rateLimitResponse(rl.retryAfterSeconds) };
  return { user, err: null };
}

function siteBase() {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://www.2mrrw.com").replace(/\/+$/, "");
}

// GET — current EventSub subscription status (configured / active / pending).
export async function GET(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  if (!isTwitchConfigured()) {
    return NextResponse.json({
      configured:    false,
      subscriptions: [],
      missing:       ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_WEBHOOK_SECRET"].filter(k => !process.env[k]),
    });
  }

  try {
    const broadcasterId = await getBroadcasterUserId(BROADCASTER_LOGIN);
    const subs     = await getEventSubSubscriptions();
    // Filter by BOTH event type AND broadcaster — stale subs for other accounts must not count.
    const relevant = subs.filter(s =>
      WATCHED_EVENT_TYPES.includes(s.type) &&
      s.condition?.broadcaster_user_id === broadcasterId
    );
    const allActive = WATCHED_EVENT_TYPES.every(t => relevant.some(s => s.type === t && s.status === "enabled"));
    return NextResponse.json({ configured: true, allActive, subscriptions: relevant, broadcasterId, broadcaster: BROADCASTER_LOGIN });
  } catch (err) {
    console.error("[admin/twitch/register GET]", err?.message);
    return NextResponse.json({ configured: true, allActive: false, error: err.message, subscriptions: [] });
  }
}

// POST — register stream.online + stream.offline subscriptions.
export async function POST(req) {
  const { user, err } = await guard(req);
  if (err) return err;

  if (!isTwitchConfigured()) {
    return NextResponse.json({
      error:   "Missing environment variables. Add TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and TWITCH_WEBHOOK_SECRET to Vercel.",
      missing: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_WEBHOOK_SECRET"].filter(k => !process.env[k]),
    }, { status: 503 });
  }

  const callbackUrl   = `${siteBase()}/api/webhooks/twitch`;
  const webhookSecret = process.env.TWITCH_WEBHOOK_SECRET;

  try {
    const broadcasterId = await getBroadcasterUserId(BROADCASTER_LOGIN);
    const existingSubs  = await getEventSubSubscriptions();
    const results       = [];

    for (const eventType of WATCHED_EVENT_TYPES) {
      // Already enabled — skip.
      const active = existingSubs.find(
        s => s.type === eventType &&
             s.condition?.broadcaster_user_id === broadcasterId &&
             s.status === "enabled"
      );
      if (active) {
        results.push({ type: eventType, action: "already_active", id: active.id });
        continue;
      }

      // Remove stale/broken subscriptions for this event type first.
      const stale = existingSubs.filter(
        s => s.type === eventType &&
             s.condition?.broadcaster_user_id === broadcasterId &&
             s.status !== "enabled"
      );
      await Promise.allSettled(stale.map(s => deleteEventSubSubscription(s.id)));

      const created = await registerEventSubSubscription({
        type:        eventType,
        condition:   { broadcaster_user_id: broadcasterId },
        callbackUrl,
        secret:      webhookSecret,
      });

      const id = created?.data?.[0]?.id || null;
      results.push({ type: eventType, action: "registered", id });
    }

    return NextResponse.json({ ok: true, broadcasterId, broadcaster: BROADCASTER_LOGIN, callbackUrl, results });
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
    const relevant      = subs.filter(s => s.condition?.broadcaster_user_id === broadcasterId);

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

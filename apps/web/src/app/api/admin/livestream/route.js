import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getCurrentBroadcast, scheduleBroadcast } from "@/lib/server/livestream";
import { isTwitchConfigured, twitchRequest } from "@/lib/server/twitch-eventsub";
import { syncTwitchLiveState } from "@/lib/server/twitch-livestream-authority";

export const dynamic = "force-dynamic";

const BROADCASTER_LOGIN = process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw";

async function guardAdmin(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return { user: null, err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const rl = await checkRateLimit(req, { routeKey: "admin.livestream", limit: 60, windowSeconds: 60, identifier: user.id });
  if (rl.limited) return { user: null, err: rateLimitResponse(rl.retryAfterSeconds) };
  return { user, err: null };
}

export async function GET(req) {
  const { err } = await guardAdmin(req);
  if (err) return err;
  try {
    const admin = getAdminClient();
    const broadcast = await getCurrentBroadcast(admin);
    let providerStatus = "unconfigured";
    let stream = null;
    if (isTwitchConfigured()) {
      const response = await twitchRequest(`/streams?user_login=${encodeURIComponent(BROADCASTER_LOGIN)}`);
      stream = response?.data?.[0] || null;
      providerStatus = stream ? "live" : "offline";
    }
    return NextResponse.json({
      broadcast,
      providerStatus,
      providerStream: stream ? { id: stream.id, title: stream.title, startedAt: stream.started_at } : null,
      broadcaster: BROADCASTER_LOGIN,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("[admin/livestream GET]", error?.message);
    return NextResponse.json({ error: error?.message || "Live status unavailable" }, { status: 502 });
  }
}

export async function POST(req) {
  const { err } = await guardAdmin(req);
  if (err) return err;
  try {
    const body = await req.json();
    if (!body.goesLiveAt) {
      return NextResponse.json({ error: "goesLiveAt is required" }, { status: 400 });
    }
    const broadcast = await scheduleBroadcast(getAdminClient(), {
      title: body.title,
      goesLiveAt: body.goesLiveAt,
      channel: BROADCASTER_LOGIN,
      audience: body.audience || "all",
    });
    return NextResponse.json({ ok: true, broadcast });
  } catch (error) {
    console.error("[admin/livestream POST]", error?.message);
    return NextResponse.json({ error: error?.message || "Schedule failed" }, { status: 500 });
  }
}

// Compatibility accepts the historic action names, but provider truth is
// authoritative: a database button can never claim Twitch is live or offline.
export async function PATCH(req) {
  const { err } = await guardAdmin(req);
  if (err) return err;
  try {
    const body = await req.json();
    if (!["sync", "go_live", "end_live"].includes(body.action)) {
      return NextResponse.json({ error: "action must be sync, go_live, or end_live" }, { status: 400 });
    }
    if (!isTwitchConfigured()) {
      return NextResponse.json({ error: "Twitch is not configured" }, { status: 503 });
    }

    const result = await syncTwitchLiveState(getAdminClient(), { notifyOnTransition: true });
    if (body.action === "go_live" && result.providerStatus !== "live") {
      return NextResponse.json({
        error: "Twitch is still offline. Start your encoder, then sync again.",
        providerStatus: result.providerStatus,
      }, { status: 409 });
    }
    if (body.action === "end_live" && result.providerStatus === "live") {
      return NextResponse.json({
        error: "Twitch is still broadcasting. End the encoder before clearing the platform state.",
        providerStatus: result.providerStatus,
      }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[admin/livestream PATCH]", error?.message);
    return NextResponse.json({ error: error?.message || "Twitch sync failed" }, { status: 500 });
  }
}

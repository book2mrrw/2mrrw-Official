import { NextResponse, after } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  getCurrentBroadcast,
  scheduleBroadcast,
  setLive,
  sendLivestreamNotifications,
} from "@/lib/server/livestream";
import { isTwitchConfigured, twitchRequest } from "@/lib/server/twitch-eventsub";

export const dynamic = "force-dynamic";

const BROADCASTER_LOGIN = process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw";

// Module-level cooldown — prevents hammering Twitch API from warm instances.
let _lastTwitchSyncMs = 0;
const TWITCH_SYNC_COOLDOWN_MS = 55_000;

async function guardAdmin(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return { user: null, err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const rl = await checkRateLimit(req, { routeKey: "admin.livestream", limit: 60, windowSeconds: 60, identifier: user.id });
  if (rl.limited) return { user: null, err: rateLimitResponse(rl.retryAfterSeconds) };
  return { user, err: null };
}

// Admin read. Public clients use /api/public/livestream.
export async function GET(req) {
  const { err } = await guardAdmin(req);
  if (err) return err;
  try {
    const admin = getAdminClient();
    const broadcast = await getCurrentBroadcast(admin);

    // Resilience: if EventSub missed an event (bad secret, cold start, revoked sub),
    // sync DB against the Twitch API directly. Runs after response is sent so it
    // never blocks the client poll. Rate-limited to once per ~55s per warm instance.
    if (isTwitchConfigured() && Date.now() - _lastTwitchSyncMs > TWITCH_SYNC_COOLDOWN_MS) {
      _lastTwitchSyncMs = Date.now();
      after(async () => {
        try {
          const streams = await twitchRequest(`/streams?user_login=${encodeURIComponent(BROADCASTER_LOGIN)}`);
          const twitchIsLive = Array.isArray(streams?.data) && streams.data.length > 0;
          if (twitchIsLive === Boolean(broadcast?.is_live)) return; // already in sync

          const a = getAdminClient();
          const current = await getCurrentBroadcast(a);
          if (twitchIsLive && !current?.is_live) {
            let targetId = current?.id;
            if (!targetId) {
              const created = await scheduleBroadcast(a, {
                title:      streams.data[0]?.title || "2MRRW Live",
                goesLiveAt: new Date().toISOString(),
                channel:    BROADCASTER_LOGIN,
                audience:   "all",
              });
              targetId = created.id;
            }
            await setLive(a, targetId, true);
            console.log("[livestream GET] Twitch sync: set live (EventSub had missed the event)");
          } else if (!twitchIsLive && current?.is_live) {
            await setLive(a, current.id, false);
            console.log("[livestream GET] Twitch sync: cleared live (EventSub had missed stream.offline)");
          }
        } catch (syncErr) {
          _lastTwitchSyncMs = 0; // allow retry sooner on transient failure
          console.warn("[livestream GET] Twitch sync failed:", syncErr?.message);
        }
      });
    }

    return NextResponse.json({ broadcast }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[admin/livestream GET]", err?.message);
    return NextResponse.json({ broadcast: null });
  }
}

// Admin — schedule a future broadcast.
// Body: { title, goesLiveAt (ISO string), channel?, audience? }
export async function POST(req) {
  const { user, err } = await guardAdmin(req);
  if (err) return err;

  try {
    const body = await req.json();
    if (!body.goesLiveAt) {
      return NextResponse.json({ error: "goesLiveAt is required" }, { status: 400 });
    }
    const admin = getAdminClient();
    const broadcast = await scheduleBroadcast(admin, {
      title:      body.title,
      goesLiveAt: body.goesLiveAt,
      channel:    body.channel || "callme2mrrw",
      audience:   body.audience || "all",
    });
    return NextResponse.json({ ok: true, broadcast });
  } catch (err) {
    console.error("[admin/livestream POST]", err?.message);
    return NextResponse.json({ error: err.message || "Schedule failed" }, { status: 500 });
  }
}

// Admin — go live, end live.
// Body: { action: "go_live" | "end_live", broadcastId? }
export async function PATCH(req) {
  const { user, err } = await guardAdmin(req);
  if (err) return err;

  try {
    const body = await req.json();
    const { action, broadcastId } = body;

    if (!action || !["go_live", "end_live"].includes(action)) {
      return NextResponse.json({ error: "action must be go_live or end_live" }, { status: 400 });
    }

    const admin = getAdminClient();

    let targetId = broadcastId;

    if (action === "go_live") {
      if (!targetId) {
        // No existing session — create an on-demand one.
        const created = await scheduleBroadcast(admin, {
          title:      body.title || "2MRRW Live",
          goesLiveAt: new Date().toISOString(),
          channel:    body.channel || "callme2mrrw",
          audience:   body.audience || "all",
        });
        targetId = created.id;
      }

      const broadcast = await setLive(admin, targetId, true);

      // Fire all fan-out channels in background — route returns immediately.
      after(async () => {
        try {
          await sendLivestreamNotifications(admin, broadcast, "live");
        } catch (fanoutErr) {
          console.warn("[admin/livestream go_live] fan-out failed", fanoutErr?.message);
        }
      });

      return NextResponse.json({ ok: true, broadcast });
    }

    if (action === "end_live") {
      if (!targetId) {
        // Find the current live session.
        const current = await getCurrentBroadcast(admin);
        if (!current?.is_live) {
          return NextResponse.json({ ok: true, broadcast: current, note: "no active session" });
        }
        targetId = current.id;
      }
      const broadcast = await setLive(admin, targetId, false);
      return NextResponse.json({ ok: true, broadcast });
    }
  } catch (err) {
    console.error("[admin/livestream PATCH]", err?.message);
    return NextResponse.json({ error: err.message || "Update failed" }, { status: 500 });
  }
}

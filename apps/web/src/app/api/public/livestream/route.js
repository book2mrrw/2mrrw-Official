import { NextResponse, after } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getCurrentBroadcast,
  scheduleBroadcast,
  setLive,
} from "@/lib/server/livestream";
import { isTwitchConfigured, twitchRequest } from "@/lib/server/twitch-eventsub";

export const dynamic = "force-dynamic";

const BROADCASTER_LOGIN = process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw";
let lastTwitchSyncMs = 0;
const TWITCH_SYNC_COOLDOWN_MS = 55_000;

/** Public, read-only broadcast state. Background reconciliation is provider-scoped. */
export async function GET() {
  try {
    const admin = getAdminClient();
    const broadcast = await getCurrentBroadcast(admin);

    if (isTwitchConfigured() && Date.now() - lastTwitchSyncMs > TWITCH_SYNC_COOLDOWN_MS) {
      lastTwitchSyncMs = Date.now();
      after(async () => {
        try {
          const streams = await twitchRequest(`/streams?user_login=${encodeURIComponent(BROADCASTER_LOGIN)}`);
          const twitchIsLive = Array.isArray(streams?.data) && streams.data.length > 0;
          if (twitchIsLive === Boolean(broadcast?.is_live)) return;
          const reconciler = getAdminClient();
          const current = await getCurrentBroadcast(reconciler);
          if (twitchIsLive && !current?.is_live) {
            let targetId = current?.id;
            if (!targetId) {
              const created = await scheduleBroadcast(reconciler, {
                title: streams.data[0]?.title || "2MRRW Live",
                goesLiveAt: new Date().toISOString(),
                channel: BROADCASTER_LOGIN,
                audience: "all",
              });
              targetId = created.id;
            }
            await setLive(reconciler, targetId, true);
          } else if (!twitchIsLive && current?.is_live) {
            await setLive(reconciler, current.id, false);
          }
        } catch (error) {
          lastTwitchSyncMs = 0;
          console.warn("[public/livestream] Twitch reconciliation failed", error?.message);
        }
      });
    }

    return NextResponse.json({ broadcast }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[public/livestream] read failed", error?.message);
    return NextResponse.json({ broadcast: null });
  }
}

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureTwitchStreamEventSubscriptions, isTwitchConfigured } from "@/lib/server/twitch-eventsub";
import {
  processPendingTwitchReceipts,
  syncTwitchLiveState,
} from "@/lib/server/twitch-livestream-authority";
import { reconcileMissingVods } from "@/lib/server/live-vod";

export const dynamic = "force-dynamic";

function authorizeCron(req) {
  const secret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(process.env.CRON_SECRET && secret === process.env.CRON_SECRET);
}

export async function GET(req) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isTwitchConfigured()) {
    return NextResponse.json({ error: "Twitch is not configured" }, { status: 503 });
  }

  try {
    const admin = getAdminClient();
    const receipts = await processPendingTwitchReceipts(admin, { limit: 25 });
    const subscriptions = await ensureTwitchStreamEventSubscriptions(process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw", admin);
    const sync = await syncTwitchLiveState(admin, { notifyOnTransition: true });
    // VOD capture never blocks or fails the core live-state reconciliation —
    // a Twitch API hiccup here just means the next tick tries again.
    const vod = await reconcileMissingVods(admin).catch((vodError) => {
      console.error("[cron/twitch-live-reconcile] vod capture failed", vodError?.message);
      return { captured: 0 };
    });
    return NextResponse.json({
      ok: true,
      processedReceipts: receipts.length,
      failedReceipts: receipts.filter((item) => !item.processed).length,
      subscriptions: subscriptions.results,
      providerStatus: sync.providerStatus,
      changed: sync.changed,
      vodCaptured: vod.captured,
    });
  } catch (error) {
    console.error("[cron/twitch-live-reconcile]", error?.message);
    return NextResponse.json({ error: error?.message || "Twitch reconciliation failed" }, { status: 500 });
  }
}

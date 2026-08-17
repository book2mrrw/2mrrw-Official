import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendLivestreamNotifications } from "@/lib/server/livestream";

export const dynamic = "force-dynamic";

function authorizeCron(req) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  return Boolean(process.env.CRON_SECRET && secret === process.env.CRON_SECRET);
}

export async function GET(req) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = getAdminClient();
    const now   = new Date();

    const window24hStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23h from now
    const window24hEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25h from now
    const windowPreStart = new Date(now.getTime() +  8 * 60 * 1000);       //  8 min from now
    const windowPreEnd   = new Date(now.getTime() + 20 * 60 * 1000);       // 20 min from now

    const { data: broadcasts } = await admin
      .from("live_broadcasts")
      .select("id, title, channel, audience, goes_live_at, notification_24h_sent_at, notification_prelive_sent_at, is_live")
      .eq("is_live", false)
      .not("goes_live_at", "is", null)
      .gt("goes_live_at", now.toISOString());

    if (!broadcasts?.length) {
      return NextResponse.json({ ok: true, fired: [] });
    }

    const fired = [];

    for (const b of broadcasts) {
      const goesLiveAt = new Date(b.goes_live_at);

      // 24h pre-notification
      if (
        !b.notification_24h_sent_at &&
        goesLiveAt >= window24hStart &&
        goesLiveAt <= window24hEnd
      ) {
        try {
          await sendLivestreamNotifications(admin, b, "24h");
          fired.push({ id: b.id, type: "24h" });
        } catch (err) {
          console.warn("[cron/livestream] 24h send failed", b.id, err?.message);
        }
      }

      // Pre-live notification (~15 min)
      if (
        !b.notification_prelive_sent_at &&
        goesLiveAt >= windowPreStart &&
        goesLiveAt <= windowPreEnd
      ) {
        try {
          await sendLivestreamNotifications(admin, b, "prelive");
          fired.push({ id: b.id, type: "prelive" });
        } catch (err) {
          console.warn("[cron/livestream] prelive send failed", b.id, err?.message);
        }
      }
    }

    return NextResponse.json({ ok: true, fired });
  } catch (err) {
    console.error("[cron/livestream-notifications]", err?.message);
    return NextResponse.json({ error: err.message || "Cron failed" }, { status: 500 });
  }
}

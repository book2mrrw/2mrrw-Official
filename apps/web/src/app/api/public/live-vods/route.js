import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { resolveLiveBroadcastAccess } from "@/lib/server/live-access";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 30;

export async function GET(req) {
  try {
    const rl = await checkRateLimit(req, {
      routeKey: "public.live-vods",
      limit: 30,
      windowSeconds: 60,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const user = await getRequestUser();
    const admin = getAdminClient();

    const { data, error } = await admin
      .from("live_broadcast_vods")
      .select("id, broadcast_id, twitch_video_id, title, duration_seconds, thumbnail_url, published, created_at")
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (error) throw error;

    // Replay access follows the exact same rule as watching it live —
    // a viewer who couldn't watch the broadcast can't watch its replay
    // either, resolved per-VOD via the same function the paywall uses.
    const vods = await Promise.all(
      (data || []).map(async (vod) => {
        const access = await resolveLiveBroadcastAccess({
          admin,
          user,
          broadcast: { id: vod.broadcast_id },
        });
        const canView = access.access === "free";
        return {
          id: vod.id,
          title: vod.title,
          durationSeconds: vod.duration_seconds,
          thumbnailUrl: vod.thumbnail_url,
          createdAt: vod.created_at,
          access: access.access,
          twitchVideoId: canView ? vod.twitch_video_id : null,
        };
      })
    );

    return NextResponse.json({ vods });
  } catch (err) {
    console.error("[public/live-vods] error:", err);
    return NextResponse.json({ error: "Failed to load replays" }, { status: 500 });
  }
}

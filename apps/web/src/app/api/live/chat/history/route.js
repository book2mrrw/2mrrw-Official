import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getCurrentBroadcast } from "@/lib/server/livestream";
import { resolveLiveBroadcastAccess } from "@/lib/server/live-access";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 100;

export async function GET(req) {
  try {
    const rl = await checkRateLimit(req, {
      routeKey: "live.chat.history",
      limit: 20,
      windowSeconds: 60,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const user = await getRequestUser();
    const admin = getAdminClient();
    const broadcast = await getCurrentBroadcast(admin);
    if (!broadcast) return NextResponse.json({ messages: [] });

    const access = await resolveLiveBroadcastAccess({ admin, user, broadcast });
    if (access.access !== "free") {
      return NextResponse.json({ messages: [], access: access.access });
    }

    const { data, error } = await admin
      .from("live_chat_messages")
      .select("id, display_name, badge, is_creator, body, created_at")
      .eq("broadcast_id", broadcast.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;

    return NextResponse.json({ messages: (data || []).reverse(), broadcastId: broadcast.id });
  } catch (err) {
    console.error("[live/chat/history] error:", err);
    return NextResponse.json({ error: "Failed to load chat history" }, { status: 500 });
  }
}

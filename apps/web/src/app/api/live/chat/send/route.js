import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getCurrentBroadcast } from "@/lib/server/livestream";
import { resolveLiveBroadcastAccess } from "@/lib/server/live-access";
import { getCommunityIdentitySnapshot } from "@/lib/community/identity";
import { liveChatChannelName } from "@/lib/live/chat-channel";

export const dynamic = "force-dynamic";

function cleanBody(value) {
  return String(value || "").trim().slice(0, 500);
}

export async function POST(req) {
  try {
    const user = await getRequestUser();
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "signup_required" }, { status: 401 });
    }

    const rl = await checkRateLimit(req, {
      routeKey: "live.chat.send",
      limit: 10,
      windowSeconds: 10,
      identifier: user.id,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const body = cleanBody((await req.json())?.body);
    if (!body) {
      return NextResponse.json({ error: "Message is empty" }, { status: 400 });
    }

    const admin = getAdminClient();
    const broadcast = await getCurrentBroadcast(admin);
    if (!broadcast) {
      return NextResponse.json({ error: "No live event is available right now" }, { status: 404 });
    }

    // Same source of truth as the paywall itself — chat is a privilege of
    // actually being able to watch, not a separate free surface.
    const access = await resolveLiveBroadcastAccess({ admin, user, broadcast });
    if (access.access !== "free") {
      return NextResponse.json({ error: access.access }, { status: 403 });
    }

    const identity = await getCommunityIdentitySnapshot(admin, user);
    const { data: row, error: insertError } = await admin
      .from("live_chat_messages")
      .insert({
        broadcast_id: broadcast.id,
        user_id: user.id,
        display_name: identity.displayName,
        badge: identity.badge,
        is_creator: identity.creator,
        body,
      })
      .select("id, display_name, badge, is_creator, body, created_at")
      .single();
    if (insertError) throw insertError;

    // Push to every connected viewer. This is a server-initiated broadcast
    // (no client ever subscribes to the table directly), so access control
    // never has to be duplicated into an RLS policy.
    await admin.channel(liveChatChannelName(broadcast.id)).send({
      type: "broadcast",
      event: "message",
      payload: row,
    });

    return NextResponse.json({ ok: true, message: row });
  } catch (err) {
    console.error("[live/chat/send] error:", err);
    return NextResponse.json({ error: err.message || "Failed to send message" }, { status: 500 });
  }
}

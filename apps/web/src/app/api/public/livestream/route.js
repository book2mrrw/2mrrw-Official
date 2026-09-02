import { NextResponse } from "next/server";
import { requireConsumerPrincipal } from "@/lib/auth/consumer-authority";
import { isAdminUser } from "@/lib/auth/constants";
import { getUserEntitlements } from "@/lib/entitlements";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentBroadcast } from "@/lib/server/livestream";

export const dynamic = "force-dynamic";

async function resolveLivestreamAccess(admin, user, broadcast) {
  if (!broadcast || broadcast.audience === "all" || isAdminUser(user)) return true;
  if (broadcast.audience === "purchaser") {
    const { data, error } = await admin
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  const entitlements = await getUserEntitlements(user.id, admin);
  if (broadcast.audience === "subscriber") return Boolean(entitlements?.subscriber);
  if (broadcast.audience === "collector") return Boolean(entitlements?.collector_card);
  return false;
}

export async function GET() {
  const user = await requireConsumerPrincipal();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const admin = getAdminClient();
    const broadcast = await getCurrentBroadcast(admin);
    const canView = await resolveLivestreamAccess(admin, user, broadcast);
    const safeBroadcast = !broadcast || canView
      ? broadcast
      : { ...broadcast, channel: null, twitch_stream_id: null };

    return NextResponse.json({
      broadcast: safeBroadcast,
      canView,
      providerStatus: broadcast?.provider_status || "offline",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("[public/livestream] read failed", error?.message);
    return NextResponse.json({ error: "Live status is temporarily unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}

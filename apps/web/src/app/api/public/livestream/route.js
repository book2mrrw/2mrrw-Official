import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/guest-session";
import { isAdminUser } from "@/lib/auth/constants";
import { getUserEntitlements } from "@/lib/entitlements";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentBroadcast } from "@/lib/server/livestream";
import { resolveLiveBroadcastAccess } from "@/lib/server/live-access";

export const dynamic = "force-dynamic";

// A broadcast explicitly scheduled with a restricted audience (subscriber-
// only / collector-only / purchaser-only) is a hard wall with no
// pay-per-view bypass — a deliberate admin choice, distinct from the
// default "all" policy handled by resolveLiveBroadcastAccess below.
async function resolveRestrictedAudienceAccess(admin, user, broadcast) {
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
  const user = await getRequestUser();
  const hasAccount = Boolean(user && !user.isGuest);

  try {
    const admin = getAdminClient();
    const broadcast = await getCurrentBroadcast(admin);

    if (!broadcast) {
      return NextResponse.json(
        { broadcast: null, canView: false, access: "none", providerStatus: "offline" },
        { headers: { "Cache-Control": "private, no-store, max-age=0" } }
      );
    }

    let access;
    if (broadcast.audience !== "all") {
      if (!hasAccount) {
        access = { access: "signup_required", reason: "no_account" };
      } else if (isAdminUser(user)) {
        access = { access: "free", reason: "admin" };
      } else {
        const allowed = await resolveRestrictedAudienceAccess(admin, user, broadcast);
        access = allowed
          ? { access: "free", reason: "restricted_tier" }
          : { access: "none", reason: "restricted_tier_denied" };
      }
    } else {
      access = await resolveLiveBroadcastAccess({ admin, user, broadcast });
    }

    const canView = access.access === "free";
    const safeBroadcast = canView
      ? broadcast
      : { ...broadcast, channel: null, twitch_stream_id: null };

    return NextResponse.json({
      broadcast: safeBroadcast,
      canView,
      access: access.access,
      providerStatus: broadcast.provider_status || "offline",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("[public/livestream] read failed", error?.message);
    return NextResponse.json({ error: "Live status is temporarily unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}

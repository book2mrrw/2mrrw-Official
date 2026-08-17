import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGuestUser } from "@/lib/guest-session";
import { getDeliverableSignal, isMissingSignalTable } from "@/lib/signals";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const user = await getGuestUser();

    const rl = await checkRateLimit(req, {
      routeKey: "signal.active",
      limit: 30,
      windowSeconds: 60,
      identifier: user?.id,
    });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

    if (!user) {
      return NextResponse.json({ signal: null, reason: "no_user", syncedAt: new Date().toISOString() });
    }

    const admin = getAdminClient();
    const signal = await getDeliverableSignal(admin, user.id);
    return NextResponse.json({ signal, syncedAt: new Date().toISOString() });
  } catch (err) {
    if (isMissingSignalTable(err)) {
      return NextResponse.json({ signal: null, reason: "signal_tables_missing", syncedAt: new Date().toISOString() });
    }
    console.error("signal active error:", err);
    return NextResponse.json({ error: err.message || "Signal lookup failed" }, { status: 500 });
  }
}

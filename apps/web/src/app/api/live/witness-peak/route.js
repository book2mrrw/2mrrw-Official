import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// A sanity ceiling, not a real capacity limit — just enough to reject an
// obviously garbage/malicious report before it touches the database.
const MAX_REASONABLE_WITNESS_COUNT = 50_000_000;

export async function POST(req) {
  try {
    const rl = await checkRateLimit(req, {
      routeKey: "live.witness-peak",
      limit: 30,
      windowSeconds: 60,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const { broadcastId, count } = await req.json();
    const parsedCount = Number(count);
    if (
      typeof broadcastId !== "string" || !broadcastId ||
      !Number.isFinite(parsedCount) || parsedCount <= 0 || parsedCount > MAX_REASONABLE_WITNESS_COUNT
    ) {
      return NextResponse.json({ error: "Invalid witness report" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: broadcast, error: readError } = await admin
      .from("live_broadcasts")
      .select("peak_witnesses")
      .eq("id", broadcastId)
      .maybeSingle();
    if (readError) throw readError;
    if (!broadcast) return NextResponse.json({ ok: true });

    // Only ever raises the high-water mark. The .lt() guard means a
    // concurrent higher report landing between the read above and this
    // write can never be clobbered back down.
    if ((broadcast.peak_witnesses || 0) < parsedCount) {
      const { error: updateError } = await admin
        .from("live_broadcasts")
        .update({ peak_witnesses: parsedCount })
        .eq("id", broadcastId)
        .lt("peak_witnesses", parsedCount);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[live/witness-peak] error:", err);
    return NextResponse.json({ error: "Failed to report witness count" }, { status: 500 });
  }
}

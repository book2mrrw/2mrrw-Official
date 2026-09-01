import { NextResponse } from "next/server";
import { getCollectorAccessRecords } from "@/lib/collector-cards";
import { getRequestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function GET(req) {
  try {
    const user = await getRequestUser();

    const rl = await checkRateLimit(req, {
      routeKey: "collector.cards.get",
      limit: 60,
      windowSeconds: 60,
      identifier: user?.id,
    });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);
    if (!user) {
      return NextResponse.json({ collectorCards: [], collectorStatus: null, access: null });
    }

    const admin = getAdminClient();
    const records = await getCollectorAccessRecords(admin, user.id);
    const hasCollector = records.length > 0;

    return NextResponse.json({
      collectorCards: records,
      collectorStatus: hasCollector ? records[0].collectorStatus : null,
      access: {
        streaming: records.some((record) => record.streamingAccess),
        vault: records.some((record) => record.vaultAccess),
        livestream: records.some((record) => record.livestreamAccess),
      },
    });
  } catch (err) {
    console.error("collector cards portal error:", err);
    return NextResponse.json({ error: err.message || "Collector portal failed." }, { status: 500 });
  }
}

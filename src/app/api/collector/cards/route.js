import { NextResponse } from "next/server";
import { getCollectorAccessRecords } from "@/lib/collector-cards";
import { getGuestUser } from "@/lib/guest-session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ collectorCards: [], collectorStatus: null, access: null });
    }

    const admin = createAdminClient();
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

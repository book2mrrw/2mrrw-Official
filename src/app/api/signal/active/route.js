import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGuestUser } from "@/lib/guest-session";
import { getDeliverableSignal, isMissingSignalTable } from "@/lib/signals";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ signal: null, reason: "no_user", syncedAt: new Date().toISOString() });
    }

    const admin = createAdminClient();
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

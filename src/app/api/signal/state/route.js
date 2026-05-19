import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGuestUser } from "@/lib/guest-session";
import { isMissingSignalTable, recordSignalAction } from "@/lib/signals";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ error: "Enter email and phone before updating signal state" }, { status: 401 });
    }

    const body = await req.json();
    const signalId = String(body.signalId || "").trim();
    const action = String(body.action || "").trim();
    if (!signalId || !action) {
      return NextResponse.json({ error: "signalId and action are required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const result = await recordSignalAction(admin, user.id, {
      signalId,
      action,
      interactionDurationMs: body.interactionDurationMs,
      metadata: {
        source: "platform_signal",
        phase: body.phase || null,
        clientRecordedAt: body.clientRecordedAt || null,
      },
    });

    return NextResponse.json({
      ok: true,
      lootAccepted: result.lootAccepted,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (isMissingSignalTable(err)) {
      return NextResponse.json({ error: "Signal tables are not installed yet" }, { status: 503 });
    }
    console.error("signal state error:", err);
    return NextResponse.json({ error: err.message || "Signal update failed" }, { status: err.status || 500 });
  }
}

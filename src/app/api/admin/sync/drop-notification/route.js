import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function authorize(req) {
  const secret = req.headers.get("x-seed-secret");
  return Boolean(process.env.ADMIN_SEED_SECRET && secret === process.env.ADMIN_SEED_SECRET);
}

export async function POST(req) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const admin = createAdminClient();

    const { data: event, error: eventError } = await admin
      .from("notification_events")
      .insert({
        event_type: "vault_drop",
        title: body.title || "Something new appeared in the Vault",
        body: body.body || "A limited surprise is available for eligible members.",
        audience: body.audience || "inner_circle",
        priority: "normal",
        status: "sent",
        sent_at: new Date().toISOString(),
        metadata: {
          ...(body.metadata || {}),
          vaultItemId: body.vaultItemId || null,
          vague: true,
        },
      })
      .select("id")
      .single();

    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, eventId: event?.id || null });
  } catch (err) {
    console.error("drop notification error:", err);
    return NextResponse.json({ error: err.message || "Drop notification failed" }, { status: 500 });
  }
}

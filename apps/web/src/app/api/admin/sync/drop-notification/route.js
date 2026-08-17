import { NextResponse, after } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendPushToSubscribers } from "@/lib/server/web-push";

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
    const admin = getAdminClient();

    const title = body.title || "Something new appeared in the Vault";
    const notifBody = body.body || "A limited surprise is available for eligible members.";
    const actionUrl = body.url || "/";
    const audience = body.audience || "inner_circle";

    const { data: event, error: eventError } = await admin
      .from("notification_events")
      .insert({
        event_type: "vault_drop",
        title,
        body: notifBody,
        audience,
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

    // Fan out after response — non-blocking so the admin trigger returns immediately.
    const eventId = event?.id || null;
    const pushPayload = { title, body: notifBody, url: actionUrl, tag: `drop-${eventId || Date.now()}` };
    after(async () => {
      // Web push fan-out.
      try {
        await sendPushToSubscribers(admin, pushPayload);
      } catch (pushErr) {
        console.warn("[drop-notification] push fan-out failed", pushErr?.message);
      }

      // In-app inbox fan-out — primary delivery path for users without web push permission.
      try {
        // Resolve which users are eligible for this audience tier.
        let eligibleUserIds = null;
        if (audience !== "all") {
          const entitlementCol = audience === "subscriber" ? "subscriber" : "vault_access";
          const { data: entitled } = await admin
            .from("user_entitlements")
            .select("user_id")
            .eq(entitlementCol, true);
          eligibleUserIds = (entitled || []).map((r) => r.user_id);
          if (eligibleUserIds.length === 0) {
            console.info(`[drop-notification] no users match audience="${audience}" — skipping in-app fan-out`);
            return;
          }
        }

        let prefQuery = admin
          .from("notification_preferences")
          .select("user_id")
          .eq("vault_alerts", true)
          .eq("in_app_enabled", true);

        if (eligibleUserIds !== null) {
          prefQuery = prefQuery.in("user_id", eligibleUserIds);
        }

        const { data: targets } = await prefQuery;
        if (!targets?.length) return;

        const rows = targets.map(({ user_id }) => ({
          user_id,
          notification_type: "vault",
          title,
          body: notifBody,
          action_url: actionUrl,
          priority: "normal",
          metadata: { event_id: eventId },
        }));

        // Chunk inserts to avoid PostgREST row limits.
        const INBOX_CHUNK = 500;
        for (let i = 0; i < rows.length; i += INBOX_CHUNK) {
          await admin.from("notification_inbox").insert(rows.slice(i, i + INBOX_CHUNK));
        }
      } catch (inAppErr) {
        console.warn("[drop-notification] in-app fan-out failed", inAppErr?.message);
      }
    });

    return NextResponse.json({
      ok: true,
      eventId: event?.id || null,
    });
  } catch (err) {
    console.error("drop notification error:", err);
    return NextResponse.json({ error: err.message || "Drop notification failed" }, { status: 500 });
  }
}

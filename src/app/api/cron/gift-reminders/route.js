import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendGiftReminderEmail } from "@/lib/gifts/email";
import { buildSignedGiftReminderLink } from "@/lib/gifts/reminder-link";

function authorizeCron(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = request.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret") === secret;
}

export async function GET(request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const now = new Date();
    const inFiveDays = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const { data: gifts, error } = await admin
      .from("gifts")
      .select("id, recipient_email, item_title, gift_link_token, gift_link_token_hash, expires_at")
      .eq("status", "pending")
      .eq("reminder_sent", false)
      .gte("expires_at", nowIso)
      .lte("expires_at", inFiveDays);

    if (error) throw error;

    let reminders_sent = 0;
    let skipped_no_link = 0;
    for (const gift of gifts || []) {
      let giftLink = null;
      if (gift.gift_link_token) {
        const { buildGiftLink } = await import("@/lib/gifts/email");
        giftLink = buildGiftLink(gift.gift_link_token);
      } else if (gift.gift_link_token_hash) {
        try {
          giftLink = await buildSignedGiftReminderLink(gift.id, gift.expires_at);
        } catch (linkErr) {
          console.warn("gift-reminders: signed link skipped", gift.id, linkErr.message);
          skipped_no_link += 1;
          continue;
        }
      } else {
        skipped_no_link += 1;
        continue;
      }

      await sendGiftReminderEmail({
        to: gift.recipient_email,
        itemTitle: gift.item_title || "your gift",
        giftLink,
        expiresAt: gift.expires_at,
      });

      const { error: updateError } = await admin
        .from("gifts")
        .update({ reminder_sent: true, updated_at: nowIso })
        .eq("id", gift.id);
      if (!updateError) reminders_sent += 1;
    }

    return NextResponse.json({ reminders_sent, skipped_no_link });
  } catch (err) {
    console.error("gift-reminders cron:", err);
    return NextResponse.json({ error: err.message || "Cron failed" }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}

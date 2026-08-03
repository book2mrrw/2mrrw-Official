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

    // Hoist import out of loop — re-evaluating import() per iteration is wasteful.
    const { buildGiftLink } = await import("@/lib/gifts/email");
    let skipped_no_link = 0;

    // Process all gifts concurrently — one email failure should not block the rest.
    const outcomes = await Promise.allSettled(
      (gifts || []).map(async (gift) => {
        let giftLink = null;
        if (gift.gift_link_token) {
          giftLink = buildGiftLink(gift.gift_link_token);
        } else if (gift.gift_link_token_hash) {
          giftLink = await buildSignedGiftReminderLink(gift.id, gift.expires_at);
        } else {
          return { skipped: true };
        }
        await sendGiftReminderEmail({
          to: gift.recipient_email,
          itemTitle: gift.item_title || "your gift",
          giftLink,
          expiresAt: gift.expires_at,
        });
        return { id: gift.id };
      })
    );

    const sentIds = [];
    let failedCount = 0;
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        if (outcome.value?.skipped) skipped_no_link++;
        else if (outcome.value?.id) sentIds.push(outcome.value.id);
      } else {
        failedCount++;
        console.error("gift-reminders: send failed", outcome.reason?.message);
      }
    }

    // One batch UPDATE instead of N individual ones.
    if (sentIds.length > 0) {
      await admin
        .from("gifts")
        .update({ reminder_sent: true, updated_at: nowIso })
        .in("id", sentIds);
    }

    const status = failedCount > 0 && sentIds.length === 0 ? 500 : 200;
    return NextResponse.json(
      { reminders_sent: sentIds.length, failed: failedCount, skipped_no_link },
      { status }
    );
  } catch (err) {
    console.error("gift-reminders cron:", err);
    return NextResponse.json({ error: err.message || "Cron failed" }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}

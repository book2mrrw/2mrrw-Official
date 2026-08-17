import { sendPushToSubscribers } from "@/lib/server/web-push";
import { sendSMS } from "@/lib/server/twilio";
import { sendTransactionalEmail } from "@/lib/server/email";
import { buildLivestreamEmail } from "@/lib/server/email";

const INBOX_CHUNK = 500;
const PAGE_SIZE   = 500;
const SMS_BATCH   = 50;
const EMAIL_BATCH = 50;

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function getCurrentBroadcast(admin) {
  const { data } = await admin
    .from("live_broadcasts")
    .select("id, title, platform, channel, is_live, goes_live_at, ended_at, audience, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function scheduleBroadcast(admin, { title, goesLiveAt, channel = "callme2mrrw", audience = "all" }) {
  const { data, error } = await admin
    .from("live_broadcasts")
    .insert({
      title:        title || "2MRRW Live",
      platform:     "twitch",
      channel,
      goes_live_at: goesLiveAt || null,
      is_live:      false,
      audience,
      updated_at:   new Date().toISOString(),
    })
    .select("id, title, goes_live_at, channel, audience")
    .single();
  if (error) throw error;
  return data;
}

export async function setLive(admin, broadcastId, isLive) {
  const patch = {
    is_live:    isLive,
    updated_at: new Date().toISOString(),
  };
  if (!isLive) patch.ended_at = new Date().toISOString();

  const { data, error } = await admin
    .from("live_broadcasts")
    .update(patch)
    .eq("id", broadcastId)
    .select("id, title, channel, is_live, goes_live_at, ended_at")
    .single();
  if (error) throw error;
  return data;
}

export async function markNotificationSent(admin, broadcastId, type) {
  // type: "24h" | "prelive" | "live"
  const col = {
    "24h":     "notification_24h_sent_at",
    prelive:   "notification_prelive_sent_at",
    live:      "notification_live_sent_at",
  }[type];
  if (!col) return;
  await admin
    .from("live_broadcasts")
    .update({ [col]: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", broadcastId);
}

// ── Fan-out ────────────────────────────────────────────────────────────────────

/**
 * Send livestream notifications through all enabled channels.
 * type: "24h" | "prelive" | "live"
 * Runs as a non-blocking after() call from the route — never awaited in-request.
 */
export async function sendLivestreamNotifications(admin, broadcast, type) {
  const { id: broadcastId, title, channel, audience } = broadcast;

  const msgMap = {
    "24h":   { push: `${title} — 24 hours away`, sms: `2MRRW drops live on Twitch in 24 hours. 🎙 twitch.tv/${channel}`, emailSubject: `${title} — Tomorrow on Twitch` },
    prelive: { push: `${title} — starting in 15 minutes`, sms: `2MRRW is going live in ~15 mins on Twitch. 🎙 twitch.tv/${channel}`, emailSubject: `${title} — Live in 15 minutes` },
    live:    { push: `${title} — live now`, sms: `2MRRW is LIVE right now on Twitch. Watch: twitch.tv/${channel}`, emailSubject: `${title} — LIVE NOW` },
  }[type];

  if (!msgMap) return;

  const pushPayload = {
    title: "2MRRW",
    body:  msgMap.push,
    url:   "/#live",
    tag:   `livestream-${broadcastId}-${type}`,
  };

  // 1. Web push — existing fan-out handles all subscribers
  try {
    await sendPushToSubscribers(admin, pushPayload);
  } catch (err) {
    console.warn("[livestream] web-push fan-out failed", err?.message);
  }

  // 2. In-app notification inbox
  try {
    let eligibleIds = null;
    if (audience !== "all") {
      const col = audience === "subscriber" ? "subscriber" : audience === "collector" ? "vault_access" : null;
      if (col) {
        const { data } = await admin.from("user_entitlements").select("user_id").eq(col, true);
        eligibleIds = (data || []).map((r) => r.user_id);
      }
    }

    let prefQuery = admin
      .from("notification_preferences")
      .select("user_id")
      .eq("livestream_alerts", true)
      .eq("in_app_enabled", true);
    if (eligibleIds !== null) prefQuery = prefQuery.in("user_id", eligibleIds);

    const { data: targets } = await prefQuery;
    if (targets?.length) {
      const rows = targets.map(({ user_id }) => ({
        user_id,
        notification_type: "livestream",
        title:             "2MRRW",
        body:              msgMap.push,
        action_url:        "/#live",
        priority:          type === "live" ? "high" : "normal",
        metadata:          { broadcast_id: broadcastId, notification_type: type },
      }));
      for (let i = 0; i < rows.length; i += INBOX_CHUNK) {
        await admin.from("notification_inbox").insert(rows.slice(i, i + INBOX_CHUNK));
      }
    }
  } catch (err) {
    console.warn("[livestream] in-app fan-out failed", err?.message);
  }

  // 3. SMS fan-out — users with sms_enabled + livestream_alerts + phone
  try {
    let offset = 0;
    while (true) {
      let q = admin
        .from("notification_preferences")
        .select("user_id")
        .eq("sms_enabled", true)
        .eq("livestream_alerts", true)
        .range(offset, offset + PAGE_SIZE - 1);
      const { data: smsPrefs } = await q;
      if (!smsPrefs?.length) break;

      const userIds = smsPrefs.map((r) => r.user_id);
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, phone")
        .in("id", userIds)
        .not("phone", "is", null);

      if (profiles?.length) {
        for (let i = 0; i < profiles.length; i += SMS_BATCH) {
          await Promise.all(
            profiles.slice(i, i + SMS_BATCH).map((p) =>
              sendSMS({ to: p.phone, body: msgMap.sms }).catch(() => {})
            )
          );
        }
      }

      offset += smsPrefs.length;
      if (smsPrefs.length < PAGE_SIZE) break;
    }
  } catch (err) {
    console.warn("[livestream] SMS fan-out failed", err?.message);
  }

  // 4. Email fan-out — users with email_enabled + livestream_alerts + email
  try {
    let offset = 0;
    while (true) {
      const { data: emailPrefs } = await admin
        .from("notification_preferences")
        .select("user_id")
        .eq("email_enabled", true)
        .eq("livestream_alerts", true)
        .range(offset, offset + PAGE_SIZE - 1);
      if (!emailPrefs?.length) break;

      const userIds = emailPrefs.map((r) => r.user_id);
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds)
        .not("email", "is", null);

      if (profiles?.length) {
        const { html, text } = buildLivestreamEmail({ title, channel, type });
        for (let i = 0; i < profiles.length; i += EMAIL_BATCH) {
          await Promise.all(
            profiles.slice(i, i + EMAIL_BATCH).map((p) =>
              sendTransactionalEmail({
                to:      p.email,
                subject: msgMap.emailSubject,
                html,
                text,
              }).catch(() => {})
            )
          );
        }
      }

      offset += emailPrefs.length;
      if (emailPrefs.length < PAGE_SIZE) break;
    }
  } catch (err) {
    console.warn("[livestream] email fan-out failed", err?.message);
  }

  // Mark this notification type as sent so crons don't double-fire.
  await markNotificationSent(admin, broadcastId, type).catch(() => {});
}

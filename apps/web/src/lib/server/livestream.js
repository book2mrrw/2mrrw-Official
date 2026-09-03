import { sendPushToSubscribers } from "@/lib/server/web-push";
import { sendSMS } from "@/lib/server/twilio";
import { sendTransactionalEmail } from "@/lib/server/email";
import { buildLivestreamEmail } from "@/lib/server/email";

const INBOX_CHUNK = 500;
const PAGE_SIZE   = 500;
const SMS_BATCH   = 50;
const EMAIL_BATCH = 50;
const BROADCAST_COLUMNS = "id, title, platform, channel, is_live, goes_live_at, started_at, ended_at, audience, twitch_stream_id, provider_status, last_provider_event_at, notification_24h_sent_at, notification_prelive_sent_at, notification_live_sent_at, peak_witnesses, created_at, updated_at";
const ALLOWED_AUDIENCES = new Set(["all", "subscriber", "collector", "purchaser"]);
const TWITCH_LOGIN = /^[a-zA-Z0-9_]{1,25}$/;

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function getCurrentBroadcast(admin) {
  const { data: active, error: activeError } = await admin
    .from("live_broadcasts")
    .select(BROADCAST_COLUMNS)
    .eq("is_live", true)
    .limit(1)
    .maybeSingle();
  if (activeError) throw activeError;
  if (active) return active;

  const { data: upcoming, error: upcomingError } = await admin
    .from("live_broadcasts")
    .select(BROADCAST_COLUMNS)
    .eq("is_live", false)
    .is("ended_at", null)
    .gte("goes_live_at", new Date().toISOString())
    .order("goes_live_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (upcomingError) throw upcomingError;
  return upcoming || null;
}

export async function getBroadcastForProviderStart(admin) {
  const current = await getCurrentBroadcast(admin);
  if (current?.is_live) return current;

  const { data: recent, error } = await admin
    .from("live_broadcasts")
    .select(BROADCAST_COLUMNS)
    .eq("is_live", false)
    .is("ended_at", null)
    .lte("goes_live_at", new Date().toISOString())
    .order("goes_live_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return recent || current || null;
}

export async function scheduleBroadcast(admin, { title, goesLiveAt, channel = "callme2mrrw", audience = "all" }) {
  const normalizedTitle = String(title || "2MRRW Live").trim().slice(0, 140) || "2MRRW Live";
  const normalizedChannel = String(channel || "callme2mrrw").trim();
  if (!TWITCH_LOGIN.test(normalizedChannel)) throw new Error("Invalid Twitch channel login");
  if (!ALLOWED_AUDIENCES.has(audience)) throw new Error("Invalid livestream audience");
  const normalizedDate = goesLiveAt ? new Date(goesLiveAt) : null;
  if (normalizedDate && !Number.isFinite(normalizedDate.getTime())) throw new Error("Invalid livestream date");

  const { data, error } = await admin
    .from("live_broadcasts")
    .insert({
      title:        normalizedTitle,
      platform:     "twitch",
      channel:      normalizedChannel,
      goes_live_at: normalizedDate?.toISOString() || null,
      is_live:      false,
      audience,
      updated_at:   new Date().toISOString(),
    })
    .select(BROADCAST_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function setLive(admin, broadcastId, isLive, {
  twitchStreamId = null,
  startedAt = null,
  providerEventAt = null,
} = {}) {
  const eventAt = providerEventAt || new Date().toISOString();
  const rpcName = isLive ? "promote_live_broadcast" : "demote_live_broadcast";
  const args = isLive
    ? {
        p_broadcast_id: broadcastId,
        p_twitch_stream_id: twitchStreamId,
        p_started_at: startedAt || eventAt,
        p_provider_event_at: eventAt,
      }
    : { p_broadcast_id: broadcastId, p_provider_event_at: eventAt };
  const { data, error } = await admin.rpc(rpcName, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
}

export async function updateBroadcastMetadata(admin, broadcastId, { title, channel } = {}) {
  const patch = { updated_at: new Date().toISOString() };
  if (title) patch.title = String(title).trim().slice(0, 140) || "2MRRW Live";
  if (channel) {
    const normalizedChannel = String(channel).trim();
    if (!TWITCH_LOGIN.test(normalizedChannel)) throw new Error("Invalid Twitch channel login");
    patch.channel = normalizedChannel;
  }
  const { data, error } = await admin
    .from("live_broadcasts")
    .update(patch)
    .eq("id", broadcastId)
    .select(BROADCAST_COLUMNS)
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
  const { error } = await admin
    .from("live_broadcasts")
    .update({ [col]: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", broadcastId);
  if (error) throw error;
}

async function loadEligibleAudienceIds(admin, audience) {
  if (!audience || audience === "all") return null;
  const ids = new Set();
  let offset = 0;
  while (true) {
    let query;
    if (audience === "purchaser") {
      query = admin.from("purchases").select("user_id").eq("status", "completed");
    } else {
      const column = audience === "subscriber" ? "subscriber" : audience === "collector" ? "collector_card" : null;
      if (!column) return new Set();
      query = admin.from("user_entitlements").select("user_id").eq(column, true);
    }
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data || []) if (row.user_id) ids.add(row.user_id);
    if (!data || data.length < PAGE_SIZE) break;
    offset += data.length;
  }
  return ids;
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

  const { data: claimed, error: claimError } = await admin.rpc("claim_livestream_notification_dispatch", {
    p_broadcast_id: broadcastId,
    p_notification_type: type,
  });
  if (claimError) throw claimError;
  if (!claimed) return { skipped: true, reason: "already_dispatched" };

  const eligibleIds = await loadEligibleAudienceIds(admin, audience);
  const deliveryErrors = [];

  const pushPayload = {
    title: "2MRRW",
    body:  msgMap.push,
    url:   "/?tab=live",
    tag:   `livestream-${broadcastId}-${type}`,
  };

  // 1. Web push — existing fan-out handles all subscribers
  try {
    const pushResult = await sendPushToSubscribers(admin, pushPayload, { eligibleUserIds: eligibleIds });
    if (pushResult.failed > 0) deliveryErrors.push({ channel: "web_push", failed: pushResult.failed });
  } catch (err) {
    console.warn("[livestream] web-push fan-out failed", err?.message);
    deliveryErrors.push({ channel: "web_push", error: err?.message || "failed" });
  }

  // 2. In-app notification inbox
  try {
    let offset = 0;
    while (true) {
      const { data: targets, error } = await admin
        .from("notification_preferences")
        .select("user_id")
        .eq("livestream_alerts", true)
        .eq("in_app_enabled", true)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (!targets?.length) break;

      const rows = targets
        .filter(({ user_id }) => eligibleIds === null || eligibleIds.has(user_id))
        .map(({ user_id }) => ({
        user_id,
        notification_type: "livestream",
        title:             "2MRRW",
        body:              msgMap.push,
        action_url:        "/?tab=live",
        priority:          type === "live" ? "high" : "normal",
        dedupe_key:        `livestream:${broadcastId}:${type}:${user_id}:in_app`,
        metadata:          { broadcast_id: broadcastId, notification_type: type },
        }));
      for (let i = 0; i < rows.length; i += INBOX_CHUNK) {
        const { error } = await admin.from("notification_inbox").upsert(rows.slice(i, i + INBOX_CHUNK), {
          onConflict: "dedupe_key",
          ignoreDuplicates: true,
        });
        if (error) throw error;
      }

      offset += targets.length;
      if (targets.length < PAGE_SIZE) break;
    }
  } catch (err) {
    console.warn("[livestream] in-app fan-out failed", err?.message);
    deliveryErrors.push({ channel: "in_app", error: err?.message || "failed" });
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
      const { data: smsPrefs, error: smsPrefsError } = await q;
      if (smsPrefsError) throw smsPrefsError;
      if (!smsPrefs?.length) break;

      const userIds = smsPrefs.map((r) => r.user_id).filter((id) => eligibleIds === null || eligibleIds.has(id));
      if (userIds.length === 0) {
        offset += smsPrefs.length;
        if (smsPrefs.length < PAGE_SIZE) break;
        continue;
      }
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, phone")
        .in("id", userIds)
        .not("phone", "is", null);
      if (profilesError) throw profilesError;

      if (profiles?.length) {
        for (let i = 0; i < profiles.length; i += SMS_BATCH) {
          const results = await Promise.all(
            profiles.slice(i, i + SMS_BATCH).map((p) =>
              sendSMS({ to: p.phone, body: msgMap.sms }).catch(() => ({ ok: false }))
            )
          );
          const failed = results.filter((result) => !result?.ok).length;
          if (failed) deliveryErrors.push({ channel: "sms", failed });
        }
      }

      offset += smsPrefs.length;
      if (smsPrefs.length < PAGE_SIZE) break;
    }
  } catch (err) {
    console.warn("[livestream] SMS fan-out failed", err?.message);
    deliveryErrors.push({ channel: "sms", error: err?.message || "failed" });
  }

  // 4. Email fan-out — users with email_enabled + livestream_alerts + email
  try {
    let offset = 0;
    while (true) {
      const { data: emailPrefs, error: emailPrefsError } = await admin
        .from("notification_preferences")
        .select("user_id")
        .eq("email_enabled", true)
        .eq("livestream_alerts", true)
        .range(offset, offset + PAGE_SIZE - 1);
      if (emailPrefsError) throw emailPrefsError;
      if (!emailPrefs?.length) break;

      const userIds = emailPrefs.map((r) => r.user_id).filter((id) => eligibleIds === null || eligibleIds.has(id));
      if (userIds.length === 0) {
        offset += emailPrefs.length;
        if (emailPrefs.length < PAGE_SIZE) break;
        continue;
      }
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds)
        .not("email", "is", null);
      if (profilesError) throw profilesError;

      if (profiles?.length) {
        const { html, text } = buildLivestreamEmail({ title, channel, type });
        for (let i = 0; i < profiles.length; i += EMAIL_BATCH) {
          const results = await Promise.all(
            profiles.slice(i, i + EMAIL_BATCH).map((p) =>
              sendTransactionalEmail({
                to:      p.email,
                subject: msgMap.emailSubject,
                html,
                text,
              }).catch(() => ({ sent: false }))
            )
          );
          const failed = results.filter((result) => !result?.sent).length;
          if (failed) deliveryErrors.push({ channel: "email", failed });
        }
      }

      offset += emailPrefs.length;
      if (emailPrefs.length < PAGE_SIZE) break;
    }
  } catch (err) {
    console.warn("[livestream] email fan-out failed", err?.message);
    deliveryErrors.push({ channel: "email", error: err?.message || "failed" });
  }

  const completedAt = new Date().toISOString();
  const { error: dispatchUpdateError } = await admin
    .from("livestream_notification_dispatches")
    .update({
      status: deliveryErrors.length ? "partial" : "completed",
      error_details: deliveryErrors,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("broadcast_id", broadcastId)
    .eq("notification_type", type);
  if (dispatchUpdateError) throw dispatchUpdateError;

  await markNotificationSent(admin, broadcastId, type);
  return { skipped: false, status: deliveryErrors.length ? "partial" : "completed", deliveryErrors };
}

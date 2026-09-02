import {
  getBroadcastForProviderStart,
  getCurrentBroadcast,
  scheduleBroadcast,
  sendLivestreamNotifications,
  setLive,
  updateBroadcastMetadata,
} from "@/lib/server/livestream";
import { twitchRequest } from "@/lib/server/twitch-eventsub";

const BROADCASTER_LOGIN = (process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw").toLowerCase();
const MAX_ATTEMPTS = 8;

function retryDelaySeconds(attemptCount) {
  return Math.min(15 * 60, Math.max(15, 2 ** Math.max(0, attemptCount - 1) * 15));
}

async function markProcessed(admin, messageId) {
  const { error } = await admin
    .from("twitch_eventsub_receipts")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      processing_started_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("message_id", messageId);
  if (error) throw error;
}

async function markFailed(admin, receipt, error) {
  const terminal = receipt.attempt_count >= MAX_ATTEMPTS;
  const nextAttemptAt = new Date(Date.now() + retryDelaySeconds(receipt.attempt_count) * 1000).toISOString();
  const { error: updateError } = await admin
    .from("twitch_eventsub_receipts")
    .update({
      status: terminal ? "dead_letter" : "pending",
      next_attempt_at: nextAttemptAt,
      processing_started_at: null,
      last_error: String(error?.message || error || "Unknown processing failure").slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("message_id", receipt.message_id);
  if (updateError) throw updateError;
}

export async function persistTwitchEventNotification(admin, headers, body) {
  const messageId = headers.get("twitch-eventsub-message-id") || "";
  const messageTimestamp = headers.get("twitch-eventsub-message-timestamp") || "";
  if (!messageId || !messageTimestamp) throw new Error("Missing Twitch EventSub message identity");

  const row = {
    message_id: messageId,
    message_timestamp: messageTimestamp,
    message_type: headers.get("twitch-eventsub-message-type") || "notification",
    event_type: body.subscription?.type || null,
    subscription_id: body.subscription?.id || null,
    broadcaster_user_id: body.event?.broadcaster_user_id || body.subscription?.condition?.broadcaster_user_id || null,
    broadcaster_user_login: body.event?.broadcaster_user_login || null,
    payload: body,
  };

  const { error } = await admin.from("twitch_eventsub_receipts").insert(row);
  if (!error) return { messageId, duplicate: false };
  if (error.code === "23505") return { messageId, duplicate: true };
  throw error;
}

export async function processTwitchEventReceipt(admin, messageId) {
  const { data, error } = await admin.rpc("claim_twitch_eventsub_receipt", { p_message_id: messageId });
  if (error) throw error;
  const receipt = Array.isArray(data) ? data[0] : data;
  if (!receipt) return { processed: false, reason: "not_claimable" };

  try {
    if (receipt.message_type !== "notification") {
      await markProcessed(admin, messageId);
      return { processed: true, ignored: true, reason: receipt.message_type };
    }
    const body = receipt.payload || {};
    const event = body.event || {};
    const eventType = receipt.event_type;
    const eventAt = event.started_at || receipt.message_timestamp;
    const eventLogin = String(event.broadcaster_user_login || "").toLowerCase();

    if (eventLogin && eventLogin !== BROADCASTER_LOGIN) {
      await markProcessed(admin, messageId);
      return { processed: true, ignored: true, reason: "broadcaster_mismatch" };
    }

    if (eventType === "stream.online") {
      let broadcast = await getBroadcastForProviderStart(admin);
      if (!broadcast) {
        broadcast = await scheduleBroadcast(admin, {
          title: "2MRRW Live",
          goesLiveAt: event.started_at || receipt.message_timestamp,
          channel: BROADCASTER_LOGIN,
          audience: "all",
        });
      }
      broadcast = await updateBroadcastMetadata(admin, broadcast.id, { channel: BROADCASTER_LOGIN });
      const wasLive = Boolean(broadcast.is_live);
      const live = await setLive(admin, broadcast.id, true, {
        twitchStreamId: event.id || null,
        startedAt: event.started_at || receipt.message_timestamp,
        providerEventAt: eventAt,
      });
      if (!wasLive && live) await sendLivestreamNotifications(admin, live, "live");
    } else if (eventType === "stream.offline") {
      const broadcast = await getCurrentBroadcast(admin);
      if (broadcast?.is_live) {
        await setLive(admin, broadcast.id, false, { providerEventAt: eventAt });
      }
    }

    await markProcessed(admin, messageId);
    return { processed: true };
  } catch (processingError) {
    await markFailed(admin, receipt, processingError);
    throw processingError;
  }
}

export async function syncTwitchLiveState(admin, { notifyOnTransition = true } = {}) {
  const streams = await twitchRequest(`/streams?user_login=${encodeURIComponent(BROADCASTER_LOGIN)}`);
  const stream = Array.isArray(streams?.data) ? streams.data[0] || null : null;
  let broadcast = await getCurrentBroadcast(admin);

  if (stream) {
    broadcast = await getBroadcastForProviderStart(admin);
    if (!broadcast) {
      broadcast = await scheduleBroadcast(admin, {
        title: stream.title || "2MRRW Live",
        goesLiveAt: stream.started_at || new Date().toISOString(),
        channel: BROADCASTER_LOGIN,
        audience: "all",
      });
    }
    broadcast = await updateBroadcastMetadata(admin, broadcast.id, {
      title: stream.title || broadcast.title,
      channel: BROADCASTER_LOGIN,
    });
    const wasLive = Boolean(broadcast.is_live);
    if (!wasLive || broadcast.twitch_stream_id !== stream.id || broadcast.provider_status !== "live") {
      broadcast = await setLive(admin, broadcast.id, true, {
        twitchStreamId: stream.id,
        startedAt: stream.started_at || new Date().toISOString(),
        providerEventAt: new Date().toISOString(),
      });
      if (!wasLive && broadcast && notifyOnTransition) {
        await sendLivestreamNotifications(admin, broadcast, "live");
      }
    }
    return { broadcast, providerStatus: "live", changed: !wasLive };
  }

  if (broadcast?.is_live) {
    broadcast = await setLive(admin, broadcast.id, false, { providerEventAt: new Date().toISOString() });
    return { broadcast: null, providerStatus: "offline", changed: true };
  }
  return { broadcast, providerStatus: "offline", changed: false };
}

export async function processPendingTwitchReceipts(admin, { limit = 25 } = {}) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { error: recoveryError } = await admin
    .from("twitch_eventsub_receipts")
    .update({ status: "pending", processing_started_at: null, updated_at: new Date().toISOString() })
    .eq("status", "processing")
    .lt("processing_started_at", staleBefore);
  if (recoveryError) throw recoveryError;

  const { data: pending, error } = await admin
    .from("twitch_eventsub_receipts")
    .select("message_id")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results = [];
  for (const row of pending || []) {
    try {
      results.push({ messageId: row.message_id, ...(await processTwitchEventReceipt(admin, row.message_id)) });
    } catch (error) {
      results.push({ messageId: row.message_id, processed: false, error: error?.message || "failed" });
    }
  }
  return results;
}

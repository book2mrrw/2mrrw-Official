import { createHash, createHmac, timingSafeEqual } from "crypto";

const TWITCH_HELIX    = "https://api.twitch.tv/helix";
const TWITCH_TOKEN_EP = "https://id.twitch.tv/oauth2/token";
export const TWITCH_STREAM_EVENT_TYPES = Object.freeze(["stream.online", "stream.offline"]);

export function getTwitchWebhookCallbackUrl() {
  const configured = process.env.TWITCH_WEBHOOK_BASE_URL || "https://www.2mrrw.com";
  const url = new URL(configured);
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("TWITCH_WEBHOOK_BASE_URL must use HTTPS on port 443");
  }
  if (url.hostname === "2mrrw.com") url.hostname = "www.2mrrw.com";
  url.pathname = "/api/webhooks/twitch";
  url.search = "";
  url.hash = "";
  return url.toString();
}

// Module-level cache — survives within a warm Vercel function instance.
let _token      = null;
let _tokenExpAt = 0;

export function isTwitchConfigured() {
  return getTwitchConfiguration().configured;
}

export function getTwitchConfiguration() {
  const required = ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_WEBHOOK_SECRET"];
  const missing = required.filter((key) => !String(process.env[key] || "").trim());
  const webhookSecret = String(process.env.TWITCH_WEBHOOK_SECRET || "");
  const invalid = [];
  if (webhookSecret && (!/^[\x00-\x7F]+$/.test(webhookSecret) || webhookSecret.length < 10 || webhookSecret.length > 100)) {
    invalid.push("TWITCH_WEBHOOK_SECRET");
  }
  if (process.env.TWITCH_BROADCASTER_LOGIN && !/^[a-zA-Z0-9_]{1,25}$/.test(process.env.TWITCH_BROADCASTER_LOGIN)) {
    invalid.push("TWITCH_BROADCASTER_LOGIN");
  }
  return { configured: missing.length === 0 && invalid.length === 0, missing, invalid };
}

// ── App-access token (client credentials) ────────────────────────────────────

export async function getTwitchAppToken() {
  if (_token && Date.now() < _tokenExpAt) return _token;

  const res = await fetch(TWITCH_TOKEN_EP, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      client_id:     process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type:    "client_credentials",
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Twitch token: ${res.status} ${txt.slice(0, 200)}`);
  }

  const data   = await res.json();
  _token       = data.access_token;
  // Refresh 5 min before actual expiry to avoid edge-case race.
  _tokenExpAt  = Date.now() + Math.max(0, (data.expires_in - 300)) * 1000;
  return _token;
}

function clearCachedToken() {
  _token = null;
  _tokenExpAt = 0;
}

// ── Helix helper ──────────────────────────────────────────────────────────────

export async function twitchRequest(path, { method = "GET", body } = {}, attempt = 0) {
  const token    = await getTwitchAppToken();
  const clientId = process.env.TWITCH_CLIENT_ID;

  const res = await fetch(`${TWITCH_HELIX}${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      "Client-Id":    clientId,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return null;

  if (res.status === 401 && attempt === 0) {
    clearCachedToken();
    return twitchRequest(path, { method, body }, 1);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Twitch ${method} ${path}: ${res.status} ${txt.slice(0, 300)}`);
  }

  return res.json();
}

// ── User lookup ───────────────────────────────────────────────────────────────

export async function getBroadcasterUserId(login) {
  const data = await twitchRequest(`/users?login=${encodeURIComponent(login)}`);
  const user = data?.data?.[0];
  if (!user) throw new Error(`Twitch user not found: ${login}`);
  return user.id;
}

// ── EventSub subscription management ─────────────────────────────────────────

export async function getEventSubSubscriptions() {
  const subscriptions = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ first: "100" });
    if (cursor) query.set("after", cursor);
    const data = await twitchRequest(`/eventsub/subscriptions?${query.toString()}`);
    subscriptions.push(...(data?.data || []));
    cursor = data?.pagination?.cursor || null;
  } while (cursor);
  return subscriptions;
}

export async function registerEventSubSubscription({ type, condition, callbackUrl, secret }) {
  return twitchRequest("/eventsub/subscriptions", {
    method: "POST",
    body: {
      type,
      version:   "1",
      condition,
      transport: { method: "webhook", callback: callbackUrl, secret },
    },
  });
}

export async function deleteEventSubSubscription(id) {
  return twitchRequest(`/eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function ensureTwitchStreamEventSubscriptions(login, admin = null) {
  const callbackUrl = getTwitchWebhookCallbackUrl();
  const broadcasterId = await getBroadcasterUserId(login);
  const existing = await getEventSubSubscriptions();
  const results = [];
  const secretFingerprint = createHash("sha256").update(process.env.TWITCH_WEBHOOK_SECRET || "").digest("hex");
  let configurationChanged = false;

  if (admin) {
    const { data: saved, error } = await admin
      .from("twitch_eventsub_runtime_config")
      .select("broadcaster_login, callback_url, secret_fingerprint")
      .eq("singleton", true)
      .maybeSingle();
    if (error) throw error;
    configurationChanged = !saved || Boolean(
      saved.broadcaster_login !== login ||
      saved.callback_url !== callbackUrl ||
      saved.secret_fingerprint !== secretFingerprint
    );
  }

  for (const type of TWITCH_STREAM_EVENT_TYPES) {
    const active = existing.find((subscription) =>
      subscription.type === type &&
      subscription.condition?.broadcaster_user_id === broadcasterId &&
      ["enabled", "webhook_callback_verification_pending"].includes(subscription.status) &&
      subscription.transport?.callback === callbackUrl
    );
    if (active && !configurationChanged) {
      results.push({ type, action: active.status === "enabled" ? "already_active" : "verification_pending", id: active.id, status: active.status });
      continue;
    }

    const stale = existing.filter((subscription) =>
      subscription.type === type &&
      subscription.condition?.broadcaster_user_id === broadcasterId &&
      (configurationChanged || !["enabled", "webhook_callback_verification_pending"].includes(subscription.status) || subscription.transport?.callback !== callbackUrl)
    );
    await Promise.allSettled(stale.map((subscription) => deleteEventSubSubscription(subscription.id)));
    const created = await registerEventSubSubscription({
      type,
      condition: { broadcaster_user_id: broadcasterId },
      callbackUrl,
      secret: process.env.TWITCH_WEBHOOK_SECRET,
    });
    const subscription = created?.data?.[0] || null;
    results.push({ type, action: "registered", id: subscription?.id || null, status: subscription?.status || "pending" });
  }

  if (admin) {
    const allEnabled = results.every((result) => result.action === "already_active" && result.status === "enabled");
    const { error } = await admin.from("twitch_eventsub_runtime_config").upsert({
      singleton: true,
      broadcaster_login: login,
      callback_url: callbackUrl,
      secret_fingerprint: secretFingerprint,
      verified_at: allEnabled ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "singleton" });
    if (error) throw error;
  }

  return { broadcasterId, callbackUrl, results };
}

// ── Webhook signature verification ────────────────────────────────────────────

const HDR_ID        = "twitch-eventsub-message-id";
const HDR_TIMESTAMP = "twitch-eventsub-message-timestamp";
const HDR_SIGNATURE = "twitch-eventsub-message-signature";

export function verifyTwitchSignature(headers, rawBody) {
  const secret = process.env.TWITCH_WEBHOOK_SECRET;
  if (!secret) return false;

  const msgId     = headers.get(HDR_ID)        || "";
  const timestamp = headers.get(HDR_TIMESTAMP) || "";
  const received  = headers.get(HDR_SIGNATURE) || "";

  const expected = "sha256=" + createHmac("sha256", secret)
    .update(msgId + timestamp + rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function isFreshTwitchMessage(headers, nowMs = Date.now(), maxAgeMs = 10 * 60 * 1000) {
  const timestamp = headers.get(HDR_TIMESTAMP) || "";
  const sentAt = Date.parse(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  const age = nowMs - sentAt;
  return age >= -60_000 && age <= maxAgeMs;
}

import { createHmac } from "crypto";

const TWITCH_HELIX    = "https://api.twitch.tv/helix";
const TWITCH_TOKEN_EP = "https://id.twitch.tv/oauth2/token";

// Module-level cache — survives within a warm Vercel function instance.
let _token      = null;
let _tokenExpAt = 0;

export function isTwitchConfigured() {
  return Boolean(
    process.env.TWITCH_CLIENT_ID &&
    process.env.TWITCH_CLIENT_SECRET &&
    process.env.TWITCH_WEBHOOK_SECRET
  );
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

// ── Helix helper ──────────────────────────────────────────────────────────────

export async function twitchRequest(path, { method = "GET", body } = {}) {
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
  const data = await twitchRequest("/eventsub/subscriptions");
  return data?.data || [];
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

  // Constant-time compare to prevent timing attacks.
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

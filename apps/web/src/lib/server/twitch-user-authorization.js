import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TWITCH_TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
const TWITCH_DEVICE_ENDPOINT = "https://id.twitch.tv/oauth2/device";
const TWITCH_VALIDATE_ENDPOINT = "https://id.twitch.tv/oauth2/validate";
const TWITCH_STREAM_KEY_ENDPOINT = "https://api.twitch.tv/helix/streams/key";
const REQUIRED_SCOPE = "channel:read:stream_key";
const AUTHORIZATION_ID = "primary";
const CIPHER_VERSION = "v1";

export class TwitchAuthorizationPendingError extends Error {
  constructor(message = "authorization_pending") {
    super(message);
    this.name = "TwitchAuthorizationPendingError";
    this.code = message;
  }
}

export class TwitchAuthorizationRequiredError extends Error {
  constructor(message = "Twitch authorization is required") {
    super(message);
    this.name = "TwitchAuthorizationRequiredError";
  }
}

function twitchConfig() {
  const clientId = String(process.env.TWITCH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.TWITCH_CLIENT_SECRET || "").trim();
  const broadcasterLogin = String(process.env.TWITCH_BROADCASTER_LOGIN || "callme2mrrw").trim().toLowerCase();
  if (!clientId || !clientSecret) throw new Error("Twitch OAuth is not configured");
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(broadcasterLogin)) throw new Error("Twitch broadcaster login is invalid");
  return { clientId, clientSecret, broadcasterLogin };
}

function encryptionKey() {
  const configured = String(process.env.TWITCH_OAUTH_TOKEN_ENCRYPTION_KEY || "").trim();
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("TWITCH_OAUTH_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes");
  return key;
}

function seal(value, purpose) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CIPHER_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function unseal(value, purpose) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = String(value || "").split(".");
  if (version !== CIPHER_VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra !== undefined) {
    throw new Error("Twitch credential envelope is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAAD(Buffer.from(purpose, "utf8"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function twitchJson(url, options) {
  const response = await fetch(url, { ...options, cache: "no-store" });
  let data = null;
  try { data = await response.json(); } catch { /* Preserve status-only errors. */ }
  return { response, data };
}

async function validateUserToken(accessToken) {
  const { clientId, broadcasterLogin } = twitchConfig();
  const { response, data } = await twitchJson(TWITCH_VALIDATE_ENDPOINT, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!response.ok) throw new Error("Twitch rejected the authorization token");
  const scopes = Array.isArray(data?.scopes) ? data.scopes : [];
  if (data?.client_id !== clientId || String(data?.login || "").toLowerCase() !== broadcasterLogin) {
    throw new Error(`Authorize the ${broadcasterLogin} Twitch account, not another channel`);
  }
  if (!scopes.includes(REQUIRED_SCOPE)) throw new Error("Twitch stream-key permission was not granted");
  return { broadcasterId: data.user_id, broadcasterLogin, scopes };
}

async function persistAuthorization(admin, actorId, tokenResponse) {
  if (!tokenResponse?.access_token || !tokenResponse?.refresh_token) {
    throw new Error("Twitch returned an incomplete authorization");
  }
  const identity = await validateUserToken(tokenResponse.access_token);
  const expiresIn = Math.max(60, Number(tokenResponse.expires_in) || 3600);
  const now = new Date();
  const row = {
    id: AUTHORIZATION_ID,
    broadcaster_id: identity.broadcasterId,
    broadcaster_login: identity.broadcasterLogin,
    access_token_ciphertext: seal(tokenResponse.access_token, "twitch-access-token"),
    refresh_token_ciphertext: seal(tokenResponse.refresh_token, "twitch-refresh-token"),
    scopes: identity.scopes,
    expires_at: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    authorized_by: actorId,
    revoked_at: null,
    updated_at: now.toISOString(),
  };
  const { data, error } = await admin
    .from("twitch_user_authorizations")
    .upsert(row, { onConflict: "id" })
    .select("broadcaster_id, broadcaster_login, scopes, expires_at, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function startTwitchDeviceAuthorization({ actorId, nowMs = Date.now() }) {
  if (!actorId) throw new Error("Admin actor is required");
  const { clientId } = twitchConfig();
  const body = new URLSearchParams({ client_id: clientId, scopes: REQUIRED_SCOPE });
  const { response, data } = await twitchJson(TWITCH_DEVICE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok || !data?.device_code || !data?.verification_uri) {
    throw new Error(data?.message || "Twitch authorization could not start");
  }
  let verificationUri;
  try { verificationUri = new URL(data.verification_uri); } catch {
    throw new Error("Twitch returned an invalid authorization link");
  }
  if (verificationUri.protocol !== "https:" || verificationUri.hostname !== "www.twitch.tv") {
    throw new Error("Twitch returned an invalid authorization link");
  }
  const expiresIn = Math.max(60, Number(data.expires_in) || 600);
  const grant = {
    sub: actorId,
    deviceCode: data.device_code,
    exp: Math.floor(nowMs / 1000) + expiresIn,
  };
  return {
    grantToken: seal(JSON.stringify(grant), "twitch-device-grant"),
    userCode: data.user_code || null,
    verificationUri: verificationUri.toString(),
    expiresAt: new Date(grant.exp * 1000).toISOString(),
    intervalSeconds: Math.max(2, Number(data.interval) || 5),
  };
}

export async function pollTwitchDeviceAuthorization(admin, { actorId, grantToken, nowMs = Date.now() }) {
  let grant;
  try { grant = JSON.parse(unseal(grantToken, "twitch-device-grant")); } catch {
    throw new Error("Twitch authorization request is invalid");
  }
  if (grant?.sub !== actorId || !grant?.deviceCode || grant.exp <= Math.floor(nowMs / 1000)) {
    throw new Error("Twitch authorization request expired");
  }

  const { clientId } = twitchConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    scopes: REQUIRED_SCOPE,
    device_code: grant.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  const { response, data } = await twitchJson(TWITCH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const code = String(data?.message || "authorization_pending").toLowerCase().replace(/\s+/g, "_");
    if (code === "authorization_pending" || code === "slow_down") throw new TwitchAuthorizationPendingError(code);
    throw new Error(data?.message || "Twitch authorization failed");
  }
  if (!data?.access_token || !data?.refresh_token) throw new Error("Twitch returned an incomplete authorization");
  return persistAuthorization(admin, actorId, data);
}

export async function getTwitchAuthorizationStatus(admin) {
  const { data, error } = await admin
    .from("twitch_user_authorizations")
    .select("broadcaster_id, broadcaster_login, scopes, expires_at, updated_at, revoked_at")
    .eq("id", AUTHORIZATION_ID)
    .maybeSingle();
  if (error) throw error;
  const connected = Boolean(data && !data.revoked_at && data.scopes?.includes(REQUIRED_SCOPE));
  return {
    connected,
    broadcasterLogin: connected ? data.broadcaster_login : null,
    scopes: connected ? data.scopes : [],
    updatedAt: connected ? data.updated_at : null,
  };
}

async function loadAuthorization(admin) {
  const { data, error } = await admin
    .from("twitch_user_authorizations")
    .select("*")
    .eq("id", AUTHORIZATION_ID)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new TwitchAuthorizationRequiredError();
  return data;
}

async function refreshAuthorization(admin, row) {
  const { clientId, clientSecret } = twitchConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: unseal(row.refresh_token_ciphertext, "twitch-refresh-token"),
  });
  const { response, data } = await twitchJson(TWITCH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok || !data?.access_token || !data?.refresh_token) {
    await admin.from("twitch_user_authorizations").update({ revoked_at: new Date().toISOString() }).eq("id", AUTHORIZATION_ID);
    throw new TwitchAuthorizationRequiredError("Twitch authorization expired; authorize Twitch again");
  }
  await persistAuthorization(admin, row.authorized_by, data);
  return data.access_token;
}

async function requestStreamKey(row, accessToken) {
  const { clientId } = twitchConfig();
  return twitchJson(`${TWITCH_STREAM_KEY_ENDPOINT}?broadcaster_id=${encodeURIComponent(row.broadcaster_id)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
  });
}

export async function getAuthorizedTwitchStreamKey(admin) {
  const row = await loadAuthorization(admin);
  let accessToken = unseal(row.access_token_ciphertext, "twitch-access-token");
  const tokenNearExpiry = Date.parse(row.expires_at) <= Date.now() + 60_000;
  const validationDue = Date.parse(row.updated_at) <= Date.now() - 55 * 60_000;
  if (tokenNearExpiry) {
    accessToken = await refreshAuthorization(admin, row);
  } else if (validationDue) {
    try { await validateUserToken(accessToken); } catch {
      accessToken = await refreshAuthorization(admin, row);
    }
  }
  let result = await requestStreamKey(row, accessToken);
  if (result.response.status === 401) {
    accessToken = await refreshAuthorization(admin, row);
    result = await requestStreamKey(row, accessToken);
  }
  if (!result.response.ok) throw new Error(result.data?.message || "Twitch stream key is unavailable");
  const streamKey = result.data?.data?.[0]?.stream_key;
  if (!streamKey) throw new Error("Twitch did not return a stream key");
  return streamKey;
}

export async function revokeTwitchAuthorization(admin) {
  let row;
  try { row = await loadAuthorization(admin); } catch (error) {
    if (error?.message === "Twitch authorization is required") return;
    throw error;
  }
  const accessToken = unseal(row.access_token_ciphertext, "twitch-access-token");
  const { clientId } = twitchConfig();
  const body = new URLSearchParams({ client_id: clientId, token: accessToken });
  await fetch("https://id.twitch.tv/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  }).catch(() => {});
  const { error } = await admin
    .from("twitch_user_authorizations")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", AUTHORIZATION_ID);
  if (error) throw error;
}

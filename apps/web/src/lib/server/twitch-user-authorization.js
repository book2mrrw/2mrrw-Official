import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";

const TWITCH_TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
const TWITCH_DEVICE_ENDPOINT = "https://id.twitch.tv/oauth2/device";
const TWITCH_VALIDATE_ENDPOINT = "https://id.twitch.tv/oauth2/validate";
const TWITCH_STREAM_KEY_ENDPOINT = "https://api.twitch.tv/helix/streams/key";
const REQUIRED_SCOPE = "channel:read:stream_key";
const AUTHORIZATION_ID = "primary";
const CIPHER_VERSION = "v1";
let oauthSql = null;

function getOAuthSql() {
  if (oauthSql) return oauthSql;
  const connectionString = String(process.env.POSTGRES_URL || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new Error("POSTGRES_URL is not configured for Twitch authorization");
  }
  const target = new URL(connectionString);
  const projectReference = target.username.startsWith("postgres.")
    ? target.username.slice("postgres.".length)
    : target.hostname.match(/^db\.([^.]+)\.supabase\.co$/i)?.[1] || null;
  console.info("[twitch-authorization-db] initialized", {
    host: target.hostname,
    projectReference,
  });
  // The OAuth credential table is intentionally server-only. A single lazy,
  // short-idle connection through Supabase's transaction pooler avoids the
  // public Data API and its schema cache without creating a connection storm.
  oauthSql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 10 * 60,
  });
  return oauthSql;
}

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

async function persistAuthorization(actorId, tokenResponse) {
  if (!tokenResponse?.access_token || !tokenResponse?.refresh_token) {
    throw new Error("Twitch returned an incomplete authorization");
  }
  const identity = await validateUserToken(tokenResponse.access_token);
  const expiresIn = Math.max(60, Number(tokenResponse.expires_in) || 3600);
  const now = new Date();
  const sql = getOAuthSql();
  const [row] = await sql`
    insert into public.twitch_user_authorizations (
      id, broadcaster_id, broadcaster_login, access_token_ciphertext,
      refresh_token_ciphertext, scopes, expires_at, authorized_by,
      revoked_at, updated_at
    ) values (
      ${AUTHORIZATION_ID}, ${identity.broadcasterId}, ${identity.broadcasterLogin},
      ${seal(tokenResponse.access_token, "twitch-access-token")},
      ${seal(tokenResponse.refresh_token, "twitch-refresh-token")},
      ${sql.array(identity.scopes)},
      ${new Date(now.getTime() + expiresIn * 1000)}, ${actorId}, null, ${now}
    )
    on conflict (id) do update set
      broadcaster_id = excluded.broadcaster_id,
      broadcaster_login = excluded.broadcaster_login,
      access_token_ciphertext = excluded.access_token_ciphertext,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      scopes = excluded.scopes,
      expires_at = excluded.expires_at,
      authorized_by = excluded.authorized_by,
      revoked_at = null,
      updated_at = excluded.updated_at
    returning broadcaster_id, broadcaster_login, scopes, expires_at, updated_at
  `;
  return row;
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

export async function pollTwitchDeviceAuthorization({ actorId, grantToken, nowMs = Date.now() }) {
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
  return persistAuthorization(actorId, data);
}

export async function getTwitchAuthorizationStatus() {
  const sql = getOAuthSql();
  const [row] = await sql`
    select broadcaster_id, broadcaster_login, scopes, expires_at, updated_at, revoked_at
      from public.twitch_user_authorizations
     where id = ${AUTHORIZATION_ID}
  `;
  const connected = Boolean(row && !row.revoked_at && row.scopes?.includes(REQUIRED_SCOPE));
  return {
    connected,
    broadcasterLogin: connected ? row.broadcaster_login : null,
    scopes: connected ? row.scopes : [],
    updatedAt: connected ? row.updated_at : null,
  };
}

async function loadAuthorization() {
  const sql = getOAuthSql();
  const [row] = await sql`
    select *
      from public.twitch_user_authorizations
     where id = ${AUTHORIZATION_ID}
       and revoked_at is null
  `;
  if (!row) throw new TwitchAuthorizationRequiredError();
  return row;
}

async function refreshAuthorization(row) {
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
    const sql = getOAuthSql();
    await sql`
      update public.twitch_user_authorizations
         set revoked_at = now(), updated_at = now()
       where id = ${AUTHORIZATION_ID}
    `;
    throw new TwitchAuthorizationRequiredError("Twitch authorization expired; authorize Twitch again");
  }
  await persistAuthorization(row.authorized_by, data);
  return data.access_token;
}

async function requestStreamKey(row, accessToken) {
  const { clientId } = twitchConfig();
  return twitchJson(`${TWITCH_STREAM_KEY_ENDPOINT}?broadcaster_id=${encodeURIComponent(row.broadcaster_id)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
  });
}

export async function getAuthorizedTwitchStreamKey() {
  const row = await loadAuthorization();
  let accessToken = unseal(row.access_token_ciphertext, "twitch-access-token");
  const tokenNearExpiry = Date.parse(row.expires_at) <= Date.now() + 60_000;
  const validationDue = Date.parse(row.updated_at) <= Date.now() - 55 * 60_000;
  if (tokenNearExpiry) {
    accessToken = await refreshAuthorization(row);
  } else if (validationDue) {
    try { await validateUserToken(accessToken); } catch {
      accessToken = await refreshAuthorization(row);
    }
  }
  let result = await requestStreamKey(row, accessToken);
  if (result.response.status === 401) {
    accessToken = await refreshAuthorization(row);
    result = await requestStreamKey(row, accessToken);
  }
  if (!result.response.ok) throw new Error(result.data?.message || "Twitch stream key is unavailable");
  const streamKey = result.data?.data?.[0]?.stream_key;
  if (!streamKey) throw new Error("Twitch did not return a stream key");
  return streamKey;
}

export async function revokeTwitchAuthorization() {
  let row;
  try { row = await loadAuthorization(); } catch (error) {
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
  const sql = getOAuthSql();
  await sql`
    update public.twitch_user_authorizations
       set revoked_at = now(), updated_at = now()
     where id = ${AUTHORIZATION_ID}
  `;
}

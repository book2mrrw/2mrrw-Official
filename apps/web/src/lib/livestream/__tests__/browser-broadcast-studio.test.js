import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getLiveRelayPublishUrl,
  issueLiveRelayPublishToken,
  verifyLiveRelayPublishToken,
} from "../../server/live-relay-token.js";
import {
  pollTwitchDeviceAuthorization,
  startTwitchDeviceAuthorization,
  TwitchAuthorizationPendingError,
} from "../../server/twitch-user-authorization.js";
import { WhipPublisher } from "../whip-publisher.js";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function withRelayEnv(run) {
  const previousSecret = process.env.LIVE_RELAY_TOKEN_SECRET;
  const previousBase = process.env.LIVE_RELAY_PUBLISH_BASE_URL;
  process.env.LIVE_RELAY_TOKEN_SECRET = "test-only-secret-with-at-least-32-bytes";
  process.env.LIVE_RELAY_PUBLISH_BASE_URL = "https://relay.example.test";
  try { return run(); } finally {
    if (previousSecret === undefined) delete process.env.LIVE_RELAY_TOKEN_SECRET;
    else process.env.LIVE_RELAY_TOKEN_SECRET = previousSecret;
    if (previousBase === undefined) delete process.env.LIVE_RELAY_PUBLISH_BASE_URL;
    else process.env.LIVE_RELAY_PUBLISH_BASE_URL = previousBase;
  }
}

test("publish grants are short-lived, path-bound, and tamper evident", () => withRelayEnv(() => {
  const nowMs = Date.parse("2026-09-02T18:30:00.000Z");
  const issued = issueLiveRelayPublishToken({ actorId: "admin-1", nowMs, ttlSeconds: 90 });
  const valid = verifyLiveRelayPublishToken(issued.token, { nowMs: nowMs + 1000 });
  assert.equal(valid.ok, true);
  assert.equal(valid.payload.sub, "admin-1");
  assert.equal(valid.payload.path, "2mrrw-live");
  assert.equal(verifyLiveRelayPublishToken(issued.token, { nowMs: nowMs + 91_000 }).ok, false);
  assert.equal(verifyLiveRelayPublishToken(`${issued.token.slice(0, -1)}x`, { nowMs }).ok, false);
  assert.equal(verifyLiveRelayPublishToken(issued.token, { nowMs, path: "another-path" }).ok, false);
}));

test("publish URL is server-owned and includes the one WHIP path", () => withRelayEnv(() => {
  assert.equal(getLiveRelayPublishUrl(), "https://relay.example.test/2mrrw-live/whip");
}));

test("studio remains one mounted leaf and never invokes app navigation or music playback", () => {
  const home = source("../../../app/HomeClient.js");
  const studio = source("../../../components/admin/BrowserBroadcastStudio.js");
  const publisher = source("../whip-publisher.js");
  const combined = `${studio}\n${publisher}`;

  assert.equal((home.match(/<BrowserBroadcastStudio\b/g) || []).length, 1);
  assert.match(studio, /data-browser-broadcast-studio/);
  assert.equal((studio.match(/<video\b/g) || []).length, 1);
  assert.doesNotMatch(combined, /router\.refresh\s*\(/);
  assert.doesNotMatch(combined, /location\.reload\s*\(/);
  assert.doesNotMatch(combined, /window\.location\s*=/);
  assert.doesNotMatch(combined, /AudioProvider|playback-core|audio-engine-runtime|howler/i);
  assert.match(studio, /"Authorize Twitch"/);
  assert.match(studio, /href=\{twitchPrompt\.verificationUri\}/);
  assert.match(studio, /AdminVerificationOverlay/);
  assert.match(studio, /devicechange/);
  assert.match(studio, /publisher\.replaceTrack\("video", nextTrack\)/);
  assert.match(studio, /video: cameraConstraints\(deviceId\), audio: false/);
  assert.doesNotMatch(studio, /disabled=\{active\}[^>]*>\s*\{devices\.cameras/);
});

test("a live camera switch replaces only the video sender without reconnecting", async () => {
  const stopped = [];
  const removed = [];
  const added = [];
  const previousTrack = { kind: "video", stop: () => stopped.push("previous") };
  const nextTrack = { kind: "video", stop: () => stopped.push("next") };
  const sender = {
    track: previousTrack,
    replaceTrack: async (track) => { sender.track = track; },
  };
  const publisher = new WhipPublisher({
    url: "https://relay.example.test/live/whip",
    token: "test-token",
    stream: {
      removeTrack: (track) => removed.push(track),
      addTrack: (track) => added.push(track),
    },
  });
  publisher.peer = { getSenders: () => [sender] };

  await publisher.replaceTrack("video", nextTrack);

  assert.equal(sender.track, nextTrack);
  assert.deepEqual(removed, [previousTrack]);
  assert.deepEqual(added, [nextTrack]);
  assert.deepEqual(stopped, ["previous"]);
  assert.equal(publisher.closed, false);
});

test("relay is warm, single-publisher, authenticated, and forwards to Twitch without exposing RTSP", () => {
  const fly = source("../../../../workers/live-relay/fly.toml");
  const relay = source("../../../../workers/live-relay/mediamtx.yml");
  const forwarder = source("../../../../workers/live-relay/relay-to-twitch.sh");

  assert.match(fly, /auto_stop_machines = false/);
  assert.match(fly, /min_machines_running = 1/);
  assert.doesNotMatch(fly, /internal_port = 8554/);
  assert.match(relay, /authMethod: http/);
  assert.match(relay, /overridePublisher: false/);
  assert.match(relay, /runOnAvailable: \/relay-to-twitch\.sh/);
  assert.match(forwarder, /-tune zerolatency/);
  assert.match(forwarder, /-c:a aac/);
  assert.match(forwarder, /LIVE_RELAY_SERVICE_SECRET/);
  assert.match(forwarder, /\/api\/live\/twitch-ingest/);
  assert.doesNotMatch(forwarder, /TWITCH_STREAM_KEY/);
});

test("Twitch authorization is user-approved, encrypted, renewable, and server-only", () => {
  const oauth = source("../../server/twitch-user-authorization.js");
  const adminRoute = source("../../../app/api/admin/twitch/authorization/route.js");
  const ingestRoute = source("../../../app/api/live/twitch-ingest/route.js");
  const accessPolicy = source("../../auth/route-access-policy.js");
  const migration = source("../../../../supabase/migrations/20260902190000_twitch_user_authorization.sql");

  assert.match(oauth, /channel:read:stream_key/);
  assert.match(oauth, /oauth2\/device/);
  assert.match(oauth, /aes-256-gcm/);
  assert.match(oauth, /grant_type:\s*"refresh_token"/);
  assert.match(oauth, /TWITCH_VALIDATE_ENDPOINT/);
  assert.match(oauth, /postgres\(connectionString/);
  assert.match(oauth, /process\.env\.POSTGRES_URL/);
  assert.match(oauth, /insert into public\.twitch_user_authorizations/);
  assert.match(oauth, /sql\.array\(identity\.scopes\)\}::text\[\]/);
  assert.doesNotMatch(oauth, /\.from\("twitch_user_authorizations"\)/);
  assert.match(adminRoute, /startTwitchDeviceAuthorization/);
  assert.match(adminRoute, /pollTwitchDeviceAuthorization/);
  assert.match(ingestRoute, /ServiceCapability\.LIVE_TWITCH_INGEST/);
  assert.match(accessPolicy, /"\/api\/live\/twitch-ingest"/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all.*anon, authenticated/i);
  assert.doesNotMatch(`${adminRoute}\n${ingestRoute}`, /streamKey\s*:/);
});

test("device authorization grant is encrypted, actor-bound, and pending safely", async () => {
  const previous = {
    id: process.env.TWITCH_CLIENT_ID,
    secret: process.env.TWITCH_CLIENT_SECRET,
    login: process.env.TWITCH_BROADCASTER_LOGIN,
    encryption: process.env.TWITCH_OAUTH_TOKEN_ENCRYPTION_KEY,
    fetch: global.fetch,
  };
  process.env.TWITCH_CLIENT_ID = "test-client";
  process.env.TWITCH_CLIENT_SECRET = "test-secret";
  process.env.TWITCH_BROADCASTER_LOGIN = "callme2mrrw";
  process.env.TWITCH_OAUTH_TOKEN_ENCRYPTION_KEY = "7b".repeat(32);
  global.fetch = async (url) => {
    if (url === "https://id.twitch.tv/oauth2/device") {
      return Response.json({
        device_code: "device-code-secret",
        user_code: "ABCD1234",
        verification_uri: "https://www.twitch.tv/activate?device-code=ABCD1234",
        expires_in: 600,
        interval: 2,
      });
    }
    if (url === "https://id.twitch.tv/oauth2/token") {
      return Response.json({ message: "authorization_pending" }, { status: 400 });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };
  try {
    const prompt = await startTwitchDeviceAuthorization({ actorId: "admin-42", nowMs: 1_800_000_000_000 });
    assert.equal(prompt.verificationUri, "https://www.twitch.tv/activate?device-code=ABCD1234");
    assert.doesNotMatch(prompt.grantToken, /device-code-secret|admin-42/);
    await assert.rejects(
      pollTwitchDeviceAuthorization({ actorId: "another-admin", grantToken: prompt.grantToken, nowMs: 1_800_000_001_000 }),
      /expired/
    );
    await assert.rejects(
      pollTwitchDeviceAuthorization({ actorId: "admin-42", grantToken: prompt.grantToken, nowMs: 1_800_000_001_000 }),
      TwitchAuthorizationPendingError
    );
  } finally {
    global.fetch = previous.fetch;
    for (const [name, value] of [
      ["TWITCH_CLIENT_ID", previous.id],
      ["TWITCH_CLIENT_SECRET", previous.secret],
      ["TWITCH_BROADCASTER_LOGIN", previous.login],
      ["TWITCH_OAUTH_TOKEN_ENCRYPTION_KEY", previous.encryption],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("camera and microphone permission is scoped to the first-party document", () => {
  const nextConfig = source("../../../../next.config.mjs");
  assert.match(nextConfig, /camera=\(self\), microphone=\(self\)/);
  assert.doesNotMatch(nextConfig, /camera=\(\), microphone=\(\)/);
});

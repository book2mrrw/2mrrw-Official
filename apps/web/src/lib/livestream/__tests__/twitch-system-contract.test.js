import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getTwitchWebhookCallbackUrl,
  isFreshTwitchMessage,
  verifyTwitchSignature,
} from "../../server/twitch-eventsub.js";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function twitchHeaders({ id = "message-1", timestamp, signature }) {
  return new Headers({
    "twitch-eventsub-message-id": id,
    "twitch-eventsub-message-timestamp": timestamp,
    "twitch-eventsub-message-signature": signature,
  });
}

test("EventSub HMAC verification accepts the exact signed raw body", () => {
  const previous = process.env.TWITCH_WEBHOOK_SECRET;
  process.env.TWITCH_WEBHOOK_SECRET = "0123456789abcdef0123456789abcdef";
  try {
    const id = "evt-123";
    const timestamp = "2026-09-02T17:00:00.000Z";
    const body = '{"subscription":{"type":"stream.online"}}';
    const signature = "sha256=" + createHmac("sha256", process.env.TWITCH_WEBHOOK_SECRET)
      .update(id + timestamp + body)
      .digest("hex");
    assert.equal(verifyTwitchSignature(twitchHeaders({ id, timestamp, signature }), body), true);
    assert.equal(verifyTwitchSignature(twitchHeaders({ id, timestamp, signature }), body + " "), false);
  } finally {
    if (previous === undefined) delete process.env.TWITCH_WEBHOOK_SECRET;
    else process.env.TWITCH_WEBHOOK_SECRET = previous;
  }
});

test("EventSub freshness rejects replays older than ten minutes and future-skew abuse", () => {
  const now = Date.parse("2026-09-02T17:10:00.000Z");
  assert.equal(isFreshTwitchMessage(twitchHeaders({ timestamp: "2026-09-02T17:00:01.000Z", signature: "x" }), now), true);
  assert.equal(isFreshTwitchMessage(twitchHeaders({ timestamp: "2026-09-02T16:59:59.000Z", signature: "x" }), now), false);
  assert.equal(isFreshTwitchMessage(twitchHeaders({ timestamp: "2026-09-02T17:11:01.000Z", signature: "x" }), now), false);
});

test("EventSub callback authority canonicalizes the production host", () => {
  const previous = process.env.TWITCH_WEBHOOK_BASE_URL;
  process.env.TWITCH_WEBHOOK_BASE_URL = "https://2mrrw.com";
  try {
    assert.equal(getTwitchWebhookCallbackUrl(), "https://www.2mrrw.com/api/webhooks/twitch");
  } finally {
    if (previous === undefined) delete process.env.TWITCH_WEBHOOK_BASE_URL;
    else process.env.TWITCH_WEBHOOK_BASE_URL = previous;
  }
});

test("Live player is persistent, canonical, and isolated from countdown ticks", () => {
  const homeClient = source("../../../app/HomeClient.js");
  const displays = source("../../../components/home/LiveCountdownDisplays.js");
  const context = source("../../../components/home/LiveCountdownContext.js");
  const homeStorefront = source("../../../components/home/HomeStorefront.js");

  assert.match(homeClient, /data-live-storefront/);
  assert.doesNotMatch(homeClient, /activeTab\s*===\s*["']live["']\s*&&\s*\(/);
  assert.match(homeClient, /display:\s*activeTab\s*===\s*["']live["']/);
  assert.equal((homeClient.match(/<LiveCountdownProvider\b/g) || []).length, 1);
  assert.doesNotMatch(homeStorefront, /LiveCountdownProvider/);
  assert.match(context, /LiveBroadcastContext/);
  assert.match(context, /LiveClockContext/);
  assert.match(displays, /const PersistentTwitchPlayer = memo/);
  assert.match(displays, /muted:\s*["']true["']/);
  assert.doesNotMatch(displays, /liveIsLive\s*&&[^\n]*<iframe/);
  assert.doesNotMatch(displays, /window\.location\.hostname/);
});

test("Twitch control paths never reload, refresh, or touch audio authority", () => {
  const files = [
    source("../../../components/home/LiveCountdownDisplays.js"),
    source("../../../components/home/LiveCountdownContext.js"),
    source("../../server/twitch-eventsub.js"),
    source("../../server/twitch-livestream-authority.js"),
    source("../../../app/api/webhooks/twitch/route.js"),
  ].join("\n");
  assert.doesNotMatch(files, /router\.refresh\s*\(/);
  assert.doesNotMatch(files, /location\.reload\s*\(/);
  assert.doesNotMatch(files, /window\.location\s*=/);
  assert.doesNotMatch(files, /AudioProvider|AudioContext|playback-core|audio-engine-runtime/);
});

test("EventSub is durably persisted before background processing", () => {
  const webhook = source("../../../app/api/webhooks/twitch/route.js");
  const migration = source("../../../../supabase/migrations/20260902180000_twitch_live_authority.sql");
  assert.ok(webhook.indexOf("persistTwitchEventNotification") < webhook.indexOf("after(async"));
  assert.match(webhook, /isFreshTwitchMessage/);
  assert.match(migration, /twitch_eventsub_receipts/);
  assert.match(migration, /claim_twitch_eventsub_receipt/);
  assert.match(migration, /promote_live_broadcast/);
  assert.match(migration, /notification_inbox_dedupe_idx/);
});

test("All livestream notification links resolve through the supported tab route", () => {
  const livestream = source("../../server/livestream.js");
  const email = source("../../server/email.js");
  assert.doesNotMatch(livestream, /\/#live/);
  assert.doesNotMatch(email, /\/#live/);
  assert.match(livestream, /\/?tab=live/);
  assert.match(email, /\/?tab=live/);
});

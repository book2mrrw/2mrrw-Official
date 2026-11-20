import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// Minimal browser: storage, online flag, events, fetch.
const store = new Map();
const listeners = {};
let online = true;
let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
let touchPoints = 5;
let responses = [];
const posts = [];
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
};
globalThis.document = { visibilityState: "visible", addEventListener: () => {} };
Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ onLine: online, userAgent, maxTouchPoints: touchPoints }) });
globalThis.fetch = async (url, init) => {
  posts.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive });
  const status = responses.length ? responses.shift() : 200;
  if (status === "network") throw new TypeError("Failed to fetch");
  return { status, ok: status >= 200 && status < 300 };
};

const client = await import("@/lib/analytics/playback-event-client");
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  store.clear();
  posts.length = 0;
  responses = [];
  online = true;
  delete globalThis.__2MRRW_APP_SHELL__;
  delete globalThis.window.__2MRRW_NATIVE_AUDIO__;
  userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
  touchPoints = 5;
});

const single = { slug: "w2d", title: "W2D", source: "home_single_card" };
const albumSong = { slug: "love-hz-vol-1", trackSlug: "08-knock-on-wood", title: "Knock On Wood", metadata: { albumSlug: "love-hz-vol-1" } };

test("an album song is identified by release + song, a single by its own slug", () => {
  assert.deepEqual(client.recordingIdentity(albumSong), { releaseSlug: "love-hz-vol-1", trackSlug: "08-knock-on-wood", albumSlug: "love-hz-vol-1" });
  assert.deepEqual(client.recordingIdentity(single), { releaseSlug: "w2d", trackSlug: null, albumSlug: null });
  assert.notEqual(client.listenKey(albumSong), client.listenKey({ ...albumSong, trackSlug: "01-intro" }));
});

test("each event carries a fresh event id and a stable device id", () => {
  const a = client.buildClientEvent(single, "play");
  const b = client.buildClientEvent(single, "progress");
  assert.match(a.eventId, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.eventId, b.eventId);
  assert.equal(a.deviceId, b.deviceId);
  assert.equal(a.schemaVersion, 1);
});

test("platform: website is web; the app shell reports ios/android", () => {
  assert.equal(client.analyticsPlatform(), "web");
  globalThis.__2MRRW_APP_SHELL__ = true;
  assert.equal(client.analyticsPlatform(), "ios");
});

test("preview and admin tracks are labelled so they never count as fan plays", () => {
  assert.equal(client.accessTierForTrack({ metadata: { access: { previewOnly: true } } }), "preview");
  assert.equal(client.isNonCountingTrack({ metadata: { access: { admin: true } } }), true);
  assert.equal(client.isNonCountingTrack(single), false);
});

test("offline: the event waits on the device instead of being lost", async () => {
  online = false;
  client.sendPlaybackEvent(client.buildClientEvent(single, "play"));
  await tick();
  assert.equal(posts.length, 0);
  assert.equal(client.readOutbox().length, 1);
  assert.equal(client.readOutbox()[0].offline, true, "marked as recorded offline");
});

test("back online: queued events are delivered in one batch and leave the outbox", async () => {
  online = false;
  const e1 = client.buildClientEvent(single, "play");
  const e2 = client.buildClientEvent(single, "qualified");
  client.sendPlaybackEvent(e1);
  client.sendPlaybackEvent(e2);
  online = true;
  await client.flushOutbox();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body.events.map((e) => e.eventId), [e1.eventId, e2.eventId], "original events and ids, so the server stores each once");
  assert.equal(client.readOutbox().length, 0);
});

test("a dropped connection or server error keeps the event for later; a rejected event is dropped", async () => {
  responses = ["network"];
  client.sendPlaybackEvent(client.buildClientEvent(single, "play"));
  await tick(); await tick();
  assert.equal(client.readOutbox().length, 1);
  responses = [503];
  await client.flushOutbox();
  assert.equal(client.readOutbox().length, 1, "5xx keeps it");
  responses = [400];
  await client.flushOutbox();
  assert.equal(client.readOutbox().length, 0, "4xx drops it (it will never be accepted)");
});

test("an event queued while a flush is in flight is delivered too, exactly once", async () => {
  online = false;
  client.sendPlaybackEvent(client.buildClientEvent(single, "play"));
  online = true;
  let release;
  const gate = new Promise((r) => { release = r; });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { await gate; return realFetch(url, init); };
  const flushing = client.flushOutbox();
  const late = client.buildClientEvent(single, "complete");
  client.enqueueEvent(late);
  release();
  await flushing;
  globalThis.fetch = realFetch;
  const delivered = posts.flatMap((p) => p.body.events || [p.body]).map((e) => e.eventType);
  assert.deepEqual(delivered, ["play", "complete"]);
  assert.equal(client.readOutbox().length, 0);
});

test("a failed flush keeps the whole queue in order", async () => {
  online = false;
  const a = client.buildClientEvent(single, "play");
  const b = client.buildClientEvent(single, "complete");
  client.sendPlaybackEvent(a);
  client.sendPlaybackEvent(b);
  online = true;
  responses = [503];
  await client.flushOutbox();
  assert.deepEqual(client.readOutbox().map((e) => e.eventId), [a.eventId, b.eventId]);
});

test("device class splits mobile web from desktop (and tablets, including iPadOS posing as a Mac)", () => {
  const cases = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148", 5, "phone"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36", 5, "phone"],
    ["Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36", 5, "tablet"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5, "tablet"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15", 5, "tablet"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15", 0, "desktop"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0", 0, "desktop"],
  ];
  for (const [ua, touch, expected] of cases) {
    userAgent = ua; touchPoints = touch;
    assert.equal(client.analyticsDeviceClass(), expected, ua);
  }
  userAgent = cases[0][0];
  assert.equal(client.buildClientEvent(single, "play").deviceClass, "phone");
});

test("in the app, when native records listening, the web sends no playback events (no double counting) — downloads still go", async () => {
  globalThis.window.__2MRRW_NATIVE_AUDIO__ = { recordsPlaybackAnalytics: true, analyticsDeviceId: "native-install-1" };
  for (const type of ["play", "qualified", "progress", "pause", "seek", "skip", "complete"]) {
    client.sendPlaybackEvent(client.buildClientEvent(single, type));
  }
  client.sendPlaybackEvent(client.buildClientEvent(single, "download"));
  await tick(); await tick();
  assert.deepEqual(posts.map((p) => p.body.eventType), ["download"]);
  assert.equal(posts[0].body.deviceId, "native-install-1", "web and native share the install id: one listener");
});

test("an app build without the native recorder keeps sending web playback events", async () => {
  globalThis.window.__2MRRW_NATIVE_AUDIO__ = { createElement() {} };
  client.sendPlaybackEvent(client.buildClientEvent(single, "play"));
  await tick(); await tick();
  assert.equal(posts.length, 1);
});

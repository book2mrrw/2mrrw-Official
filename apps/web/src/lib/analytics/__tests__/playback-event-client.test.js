import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// Minimal browser: storage, online flag, events, fetch.
const store = new Map();
const listeners = {};
let online = true;
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
Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ onLine: online, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }) });
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

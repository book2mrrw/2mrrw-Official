import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { beforeEach } from "node:test";

import {
  fetchQueueFromServer,
  loadPlaybackSession,
  restoreTrackCoverIdentity,
  savePlaybackSession,
} from "../session-memory.js";

const VISUAL = "/api/media/visual?releaseType=singles&slug=w2d&legacyImage=images%2Fsingles%2Fw2d.jpg";
let store;

beforeEach(() => {
  store = new Map();
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
});

test("saving a session keeps the whole cover identity, not just the overloaded `cover`", () => {
  savePlaybackSession("u1", {
    queue: [{
      slug: "w2d", src: "/api/library/stream?slug=w2d", title: "W.2.D",
      cover: VISUAL, baseCover: "/images/singles/w2d.jpg", coverArtType: "video",
      video: "https://cdn.example/w2d.mp4", csCover: null, csCoverType: null,
    }],
    queueIndex: 0, shuffle: false, repeatMode: "off",
  });
  const saved = JSON.parse(store.get("2mrrw_sess_u1")).queue[0];
  assert.equal(saved.baseCover, "/images/singles/w2d.jpg");
  assert.equal(saved.coverArtType, "video");
  assert.equal(saved.video, "https://cdn.example/w2d.mp4");
});

test("tracks saved before identity was stored come back animated, with their still as the fallback", () => {
  const restored = restoreTrackCoverIdentity({ slug: "w2d", cover: VISUAL });
  assert.equal(restored.coverArtType, "video");
  assert.equal(restored.baseCover, "/images/singles/w2d.jpg");
  assert.equal(restored.cover, VISUAL, "the animated source is kept");
});

test("restoration never overrides a stored identity or guesses for non-visual covers", () => {
  const stored = { slug: "a", cover: VISUAL, coverArtType: "image", baseCover: "/images/a.jpg" };
  assert.equal(restoreTrackCoverIdentity(stored), stored);
  const plain = { slug: "b", cover: "/images/singles/b.jpg" };
  assert.equal(restoreTrackCoverIdentity(plain), plain);
  assert.equal(restoreTrackCoverIdentity(null), null);
  const noStill = restoreTrackCoverIdentity({ slug: "c", cover: "/api/media/visual?releaseType=singles&slug=c" });
  assert.equal(noStill.coverArtType, "video");
  assert.equal(noStill.baseCover, null);
});

test("both restore paths (this device and cross-device) repair older sessions", async () => {
  store.set("2mrrw_sess_u2", JSON.stringify({ v: 1, savedAt: Date.now(), queue: [{ slug: "w2d", cover: VISUAL }], queueIndex: 0 }));
  assert.equal(loadPlaybackSession("u2").queue[0].coverArtType, "video");

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ queue: [{ slug: "w2d", cover: VISUAL }], queueIndex: 0, savedAt: new Date().toISOString() }) });
  const server = await fetchQueueFromServer();
  assert.equal(server.queue[0].coverArtType, "video");
  assert.equal(server.queue[0].baseCover, "/images/singles/w2d.jpg");
});

test("the player bar attaches the animated cover at once and keeps it playing — no delay, no still first", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../../components/audio/GlobalAudioPlayerBar.js"), "utf8").replace(/\r\n/g, "\n");
  const mini = src.slice(src.indexOf("const MiniCoverHit = memo("), src.indexOf("const PlayerReleaseMeta = memo("));
  assert.ok(mini.length > 500 && mini.length < 12000, "sliced exactly the MiniCoverHit component");
  assert.doesNotMatch(mini, /setTimeout\(/, "no artificial delay before the animation");
  assert.doesNotMatch(mini, /removeAttribute\("src"\)/, "the animated cover is never unloaded for audio");
  assert.match(mini, /if \(el\.getAttribute\("src"\) !== animatedCoverUrl\) \{\s*el\.src = animatedCoverUrl;/);
  assert.match(mini, /autoPlay\s+preload="auto"/);
});

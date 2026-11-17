import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { beforeEach } from "node:test";

import {
  MASTER_TTL_MS,
  WARM_STARTS_PER_MINUTE,
  createWarmLoaderClasses,
  hlsMasterPath,
  hlsStartWarmIdle,
  resetHlsStartWarm,
  takeWarmKey,
  takeWarmPlaylist,
  warmHlsStart,
} from "../hls-start-warm.js";
import { hasSegment } from "../hls-segment-cache.js";

const ORIGIN = "https://www.2mrrw.com";
const CDN = "https://pub-test.r2.dev";
let requests = [];
let storage = {};

function masterFor(slug) {
  return [
    "#EXTM3U",
    `#EXT-X-STREAM-INF:BANDWIDTH=96000\n${ORIGIN}/api/library/hls/variant?slug=${slug}&bitrate=96k&token=t96`,
    `#EXT-X-STREAM-INF:BANDWIDTH=320000\n${ORIGIN}/api/library/hls/variant?slug=${slug}&bitrate=320k&token=t320`,
    `#EXT-X-STREAM-INF:BANDWIDTH=160000\n${ORIGIN}/api/library/hls/variant?slug=${slug}&bitrate=160k&token=t160`,
  ].join("\n");
}

function variantFor(slug, bitrate) {
  return [
    "#EXTM3U",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-KEY:METHOD=AES-128,URI="${ORIGIN}/api/library/hls/key?token=k-${slug}",IV=0x00`,
    "#EXTINF:6.0,",
    `${CDN}/hls/${slug}/${bitrate}/seg_00001.ts?v=1`,
    "#EXTINF:6.0,",
    `${CDN}/hls/${slug}/${bitrate}/seg_00002.ts?v=1`,
    "#EXT-X-ENDLIST",
  ].join("\n");
}

beforeEach(() => {
  resetHlsStartWarm();
  requests = [];
  storage = {};
  globalThis.window = {};
  globalThis.location = { href: `${ORIGIN}/` };
  globalThis.localStorage = { getItem: (k) => storage[k] ?? null };
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  globalThis.fetch = async (url) => {
    const href = new URL(url, `${ORIGIN}/`).href;
    requests.push(href);
    const u = new URL(href);
    const slug = u.searchParams.get("slug") || u.pathname.split("/")[2];
    let body;
    if (u.pathname === "/api/library/hls") body = masterFor(slug);
    else if (u.pathname === "/api/library/hls/variant") body = variantFor(slug, u.searchParams.get("bitrate"));
    else if (u.pathname === "/api/library/hls/key") body = new Uint8Array(16).fill(7).buffer;
    else body = new Uint8Array(1024).fill(1).buffer;
    return {
      ok: true,
      url: href,
      text: async () => body,
      arrayBuffer: async () => body,
    };
  };
});

test("warms master -> startup (highest) variant -> key -> opening segment, in order", async () => {
  warmHlsStart("hour-glass");
  await hlsStartWarmIdle();
  assert.deepEqual(requests.map((r) => new URL(r).pathname + (new URL(r).searchParams.get("bitrate") ? `@${new URL(r).searchParams.get("bitrate")}` : "")), [
    "/api/library/hls",
    "/api/library/hls/variant@320k",
    "/api/library/hls/key",
    "/hls/hour-glass/320k/seg_00001.ts",
  ]);
  assert.ok(hasSegment(`${CDN}/hls/hour-glass/320k/seg_00001.ts?v=1`));
  assert.equal(hasSegment(`${CDN}/hls/hour-glass/320k/seg_00002.ts?v=1`), false, "only the opening segment");
});

test("warm responses are served once, under any origin, for exactly the URLs played", async () => {
  warmHlsStart("w2d");
  await hlsStartWarmIdle();
  // hls.js resolves the master against the page origin (the iOS app's is capacitor://).
  assert.equal(takeWarmPlaylist(`capacitor://www.2mrrw.com${hlsMasterPath("w2d")}`), masterFor("w2d"));
  assert.equal(takeWarmPlaylist(`${ORIGIN}${hlsMasterPath("w2d")}`), null, "a master authorizes one play start");
  assert.equal(takeWarmPlaylist(`${ORIGIN}/api/library/hls/variant?slug=w2d&bitrate=320k&token=t320`), variantFor("w2d", "320k"));
  const key = takeWarmKey(`${ORIGIN}/api/library/hls/key?token=k-w2d`);
  assert.equal(key.byteLength, 16);
  assert.equal(takeWarmKey(`${ORIGIN}/api/library/hls/key?token=k-w2d`), null);
});

test("the warm master path is the one the play path requests", () => {
  assert.equal(hlsMasterPath("album", "track-2"), "/api/library/hls?slug=album&trackSlug=track-2");
  assert.equal(hlsMasterPath("single", "single"), "/api/library/hls?slug=single");
  assert.equal(hlsMasterPath("single", null), "/api/library/hls?slug=single");
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../playback/PlaybackStreamCommands.js"), "utf8");
  assert.match(src, /const hlsManifestUrl = hlsMasterPath\(streamSlug, hlsTrackSlug\);/);
});

test("a pinned quality warms that rendition, matching HLSEngine's startup choice", async () => {
  storage["2mrrw-hls-quality-level"] = "2";
  warmHlsStart("all-yourz");
  await hlsStartWarmIdle();
  assert.ok(requests.some((r) => r.includes("bitrate=96k")));
  assert.ok(!requests.some((r) => r.includes("bitrate=320k")));
});

test("save-data and 2g connections are never warmed", async () => {
  globalThis.navigator.connection = { saveData: true };
  warmHlsStart("hour-glass");
  globalThis.navigator.connection = { effectiveType: "2g" };
  warmHlsStart("w2d");
  await hlsStartWarmIdle();
  assert.equal(requests.length, 0);
});

test("expired warm responses are never served", async () => {
  warmHlsStart("hour-glass");
  await hlsStartWarmIdle();
  const realNow = Date.now;
  Date.now = () => realNow() + MASTER_TTL_MS + 1;
  try {
    assert.equal(takeWarmPlaylist(hlsMasterPath("hour-glass")), null);
  } finally {
    Date.now = realNow;
  }
});

const mastersRequested = () => requests
  .filter((r) => new URL(r).pathname === "/api/library/hls")
  .map((r) => new URL(r).searchParams.get("slug"));

test("intent (hover, touch, sheet open) jumps ahead of visibility warms", async () => {
  warmHlsStart("visible-a");
  warmHlsStart("visible-b");
  warmHlsStart("intent-c", null, { intent: true });
  await hlsStartWarmIdle();
  assert.deepEqual(mastersRequested(), ["intent-c", "visible-a", "visible-b"]);
});

test("a failed warm is retried once, later — never more", async () => {
  resetHlsStartWarm({ retryDelay: 20 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (new URL(url, `${ORIGIN}/`).pathname === "/api/library/hls") {
      requests.push(new URL(url, `${ORIGIN}/`).href);
      throw new TypeError("network congested");
    }
    return realFetch(url, init);
  };
  warmHlsStart("flaky");
  await hlsStartWarmIdle();
  assert.deepEqual(mastersRequested(), ["flaky"]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await hlsStartWarmIdle();
  assert.deepEqual(mastersRequested(), ["flaky", "flaky"], "one retry");
  await new Promise((resolve) => setTimeout(resolve, 60));
  await hlsStartWarmIdle();
  assert.deepEqual(mastersRequested(), ["flaky", "flaky"], "and no more");
});

test("a burst of warms is bounded: one in flight plus at most 6 queued", async () => {
  for (let i = 0; i < 40; i += 1) warmHlsStart(`burst-${i}`, null, { intent: i % 2 === 0 });
  await hlsStartWarmIdle();
  assert.equal(mastersRequested().length, 7);
});

test("at most WARM_STARTS_PER_MINUTE new tracks are warmed per minute", async () => {
  for (let i = 0; i < WARM_STARTS_PER_MINUTE + 8; i += 1) {
    warmHlsStart(`track-${i}`);
    await hlsStartWarmIdle();
  }
  assert.equal(mastersRequested().length, WARM_STARTS_PER_MINUTE);
  resetHlsStartWarm(); // drop the deferred retry
});

test("loaders serve warm responses asynchronously and defer everything else to the default loader", async () => {
  warmHlsStart("w2d");
  await hlsStartWarmIdle();
  class DefaultLoader {
    constructor() {
      this.stats = { aborted: false, loading: { start: 0, first: 0, end: 0 }, parsing: {}, buffering: {} };
      this.network = [];
    }
    load(context) { this.network.push(context.url); }
    abort() { this.stats.aborted = true; }
    destroy() {}
  }
  const { pLoader: PLoader, loader: KeyLoader } = createWarmLoaderClasses(DefaultLoader);

  const hits = [];
  const playlist = new PLoader({});
  playlist.load({ url: `${ORIGIN}${hlsMasterPath("w2d")}`, responseType: "text" }, {}, { onSuccess: (res) => hits.push(res) });
  assert.equal(hits.length, 0, "delivery is asynchronous, like the network");
  await Promise.resolve();
  assert.equal(hits[0].data, masterFor("w2d"));
  assert.equal(playlist.network.length, 0);

  const miss = new PLoader({});
  miss.load({ url: `${ORIGIN}${hlsMasterPath("not-warm")}`, responseType: "text" }, {}, { onSuccess: () => assert.fail() });
  assert.equal(miss.network.length, 1);

  const aborted = new KeyLoader({});
  aborted.load({ url: `${ORIGIN}/api/library/hls/key?token=k-w2d`, responseType: "arraybuffer" }, {}, { onSuccess: () => assert.fail("aborted load must not deliver") });
  aborted.abort();
  await Promise.resolve();

  const textViaKeyLoader = new KeyLoader({});
  textViaKeyLoader.load({ url: `${ORIGIN}/api/library/hls/variant?slug=w2d&bitrate=320k&token=t320`, responseType: "text" }, {}, { onSuccess: () => assert.fail() });
  assert.equal(textViaKeyLoader.network.length, 1, "the key loader only serves keys");
});

test("the warmed routes authorize and sign only: no play session, stream event or bookkeeping", () => {
  const dir = path.resolve(import.meta.dirname, "../../../app/api/library/hls");
  for (const file of ["route.js", "variant/route.js", "key/route.js"]) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(src, /createStreamSession|insertStreamEvent|clearStreamSession|endStreamEvent|after\(/, file);
  }
});

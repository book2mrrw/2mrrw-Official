import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test, { beforeEach, mock } from "node:test";

// next/server has no ESM entry; resolve it like the ticket route tests do.
register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'), import.meta.url);

// Real delivery and route against a fake database and bucket.
const CDN = "https://media.example";
let etags = {};
let db;
const after = [];

function fakeDb(rows) {
  const queued = [];
  return {
    queued,
    rows,
    rpc: async (name, args) => {
      queued.push({ name, ...args });
      return { data: "new-id", error: null };
    },
    from: () => {
      const filters = {};
      const query = {
        select: () => query,
        eq: (col, val) => { filters[col] = val; return query; },
        neq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          if (rows === "broken") return { data: null, error: { message: "relation does not exist" } };
          return { data: rows.find((row) => row.source_key === filters.source_key) ?? null, error: null };
        },
      };
      return query;
    },
  };
}

mock.module("next/server", { namedExports: {
  NextResponse: {
    json: (body, init) => Response.json(body, init),
    redirect: (url, init) => new Response(null, { status: init?.status ?? 302, headers: { location: String(url), ...(init?.headers || {}) } }),
  },
  after: (task) => { after.push(task); },
} });
mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => db } });
mock.module("@/lib/storage/r2", { namedExports: {
  getPublicR2Url: (key) => `${CDN}/${key}`,
  getR2ObjectMetadata: async (key) => (etags[key] ? { key, etag: `"${etags[key]}"` } : null),
} });
mock.module("@/lib/media/entity-resolver", { namedExports: {
  isConcreteMediaKey: (path) => /\.(jpg|jpeg|png|webp|mp4|webm|mov)$/i.test(String(path || "")),
  resolveVisualMedia: async (releaseType, slug) => (slug === "still"
    ? { type: "image", key: "images/singles/still/still.jpeg", url: `${CDN}/images/singles/still/still.jpeg`, source: "canonical_direct" }
    : { type: "video", key: `videos/singles/${slug}/${slug}.mp4`, url: `${CDN}/videos/singles/${slug}/${slug}.mp4`, source: "canonical_direct" }),
} });

const { coverArtUrl, pickRendition, queueCoverArt, resetCoverArtDelivery } = await import("../delivery.js");
const { GET } = await import("../../../app/api/media/visual/route.js");

const LADDER = [
  { id: "square-1080", key: "cover-art/singles/w2d/v1/square-1080.mp4", width: 1080, height: 1080 },
  { id: "square-720", key: "cover-art/singles/w2d/v1/square-720.mp4", width: 720, height: 720 },
  { id: "square-480", key: "cover-art/singles/w2d/v1/square-480.mp4", width: 480, height: 480 },
  { id: "tall", key: "cover-art/singles/w2d/v1/tall.mp4", width: 810, height: 1080 },
];
const ready = (slug, etag = "e1:r2", renditions = LADDER) => ({ id: `${slug}-v`, source_key: `videos/singles/${slug}/${slug}.mp4`, source_etag: etag, status: "ready", renditions });
const visual = (query) => GET({ nextUrl: new URL(`https://www.2mrrw.com/api/media/visual?${query}`), headers: new Headers() });
const drainAfter = async () => { while (after.length) await after.shift()(); };

beforeEach(() => {
  resetCoverArtDelivery();
  after.length = 0;
  etags = {};
});

test("each request gets the largest square by default, the size it asks for, or the 3:4 tall", () => {
  assert.equal(pickRendition(LADDER).id, "square-1080");
  assert.equal(pickRendition(LADDER, "720").id, "square-720");
  assert.equal(pickRendition(LADDER, "600").id, "square-480");
  assert.equal(pickRendition(LADDER, "tall").id, "tall");
  const small = LADDER.slice(1);
  assert.equal(pickRendition(small).id, "square-720", "a 720 cover is never upscaled");
  assert.equal(pickRendition(small, "1080").id, "square-720");
  assert.equal(pickRendition(small.filter((r) => r.id !== "tall"), "tall"), null);
});

test("the visual route serves a cover's silent rendition when ready, and its original until then", async () => {
  db = fakeDb([ready("w2d")]);
  let res = await visual("releaseType=singles&slug=w2d");
  assert.equal(res.headers.get("location"), `${CDN}/cover-art/singles/w2d/v1/square-1080.mp4`);
  res = await visual("releaseType=singles&slug=w2d&variant=tall");
  assert.equal(res.headers.get("location"), `${CDN}/cover-art/singles/w2d/v1/tall.mp4`);

  res = await visual("releaseType=singles&slug=all-yourz");
  assert.equal(res.headers.get("location"), `${CDN}/videos/singles/all-yourz/all-yourz.mp4`);
  res = await visual("releaseType=singles&slug=still");
  assert.equal(res.headers.get("location"), `${CDN}/images/singles/still/still.jpeg`, "still covers are untouched");
});

test("a cover video with no version is queued with its fingerprint after the response, once", async () => {
  db = fakeDb([]);
  etags["videos/singles/all-yourz/all-yourz.mp4"] = "abc123";
  await visual("releaseType=singles&slug=all-yourz");
  assert.deepEqual(db.queued, [], "nothing runs before the response");
  await drainAfter();
  assert.deepEqual(db.queued, [{ name: "queue_cover_art", p_source_key: "videos/singles/all-yourz/all-yourz.mp4", p_source_etag: "abc123:r2" }]);
  db.rows.push({ id: "q", source_key: "videos/singles/all-yourz/all-yourz.mp4", source_etag: "abc123:r2", status: "queued" });
  await visual("releaseType=singles&slug=all-yourz");
  await drainAfter();
  assert.equal(db.queued.length, 1, "a queued cover is not queued again");
});

test("a replaced original is queued as a new version on the next fingerprint check", async () => {
  db = fakeDb([ready("w2d", "e1:r2")]);
  etags["videos/singles/w2d/w2d.mp4"] = "e1";
  const start = Date.now();
  assert.match(await coverArtUrl("videos/singles/w2d/w2d.mp4", { db, now: start, schedule: (t) => after.push(t) }), /square-1080/);
  await drainAfter();
  assert.deepEqual(db.queued, [], "unchanged");
  etags["videos/singles/w2d/w2d.mp4"] = "e2";
  await coverArtUrl("videos/singles/w2d/w2d.mp4", { db, now: start + 11 * 60 * 1000, schedule: (t) => after.push(t) });
  await drainAfter();
  assert.deepEqual(db.queued.map((q) => q.p_source_etag), ["e2:r2"]);
});

test("covers made by an older recipe are made again (and served from their originals meanwhile)", async () => {
  db = fakeDb([ready("w2d", "e1")]);
  etags["videos/singles/w2d/w2d.mp4"] = "e1";
  assert.match(await coverArtUrl("videos/singles/w2d/w2d.mp4", { db, schedule: (t) => after.push(t) }), /square-1080/);
  await drainAfter();
  assert.deepEqual(db.queued.map((q) => q.p_source_etag), ["e1:r2"]);
});

test("a database failure serves the original instead of failing the cover", async (t) => {
  db = fakeDb("broken");
  t.mock.method(console, "warn", () => {});
  const res = await visual("releaseType=singles&slug=w2d");
  assert.equal(res.headers.get("location"), `${CDN}/videos/singles/w2d/w2d.mp4`);
});

test("an admin upload, replacement or publish queues its cover at once; a current version is left alone", async () => {
  db = fakeDb([ready("w2d", "e1:r2")]);
  etags["videos/singles/w2d/w2d.mp4"] = "e1";
  etags["videos/singles/new-drop/new-drop.mp4"] = "n1";
  assert.equal(await queueCoverArt("videos/singles/new-drop/new-drop.mp4", { db }), true);
  assert.equal(await queueCoverArt("videos/singles/w2d/w2d.mp4", { db }), true);
  assert.equal(await queueCoverArt("images/singles/w2d/w2d.jpeg", { db }), false, "still covers are not this lane's");
  assert.deepEqual(db.queued.map((q) => [q.p_source_key, q.p_source_etag]), [["videos/singles/new-drop/new-drop.mp4", "n1:r2"]]);
  etags["videos/singles/w2d/w2d.mp4"] = "e2";
  await queueCoverArt("videos/singles/w2d/w2d.mp4", { db });
  assert.deepEqual(db.queued.at(-1), { name: "queue_cover_art", p_source_key: "videos/singles/w2d/w2d.mp4", p_source_etag: "e2:r2" }, "a replaced cover is queued");
});

test("the admin upload and publish paths queue cover videos after their response", () => {
  const read = (file) => readFileSync(new URL(`../../../app/api/admin/${file}`, import.meta.url), "utf8");
  const upload = read("upload/complete/route.js");
  const branch = upload.slice(upload.indexOf('if (assetType === "cover-video")'));
  assert.match(branch.slice(0, 900), /after\(\(\) => queueCoverArt\(key\)/);
  assert.match(read("releases/[id]/publish/route.js"), /after\(\(\) => queueCoverArt\(publishedVideoKey\)/);
});

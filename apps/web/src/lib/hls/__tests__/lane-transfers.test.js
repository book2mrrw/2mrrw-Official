import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { register } from "node:module";
import test, { mock } from "node:test";

// next/server has no ESM entry; resolve it like the ticket route tests do.
register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'), import.meta.url);

const SECRET = "lane-transfer-test-secret-0123456789abcdef";
process.env.HLS_MASTER_SECRET = SECRET;
delete process.env.TRACK_VISUAL_MASTER_SECRET;

const JOB = "11111111-2222-4333-8444-555555555555";
const LEASE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VERSION = "66666666-7777-4888-9999-000000000000";
const VIDEO = "12121212-3434-4565-8787-909090909090";
const TRACK = "abababab-cdcd-4efe-8a8a-bcbcbcbcbcbc";

// The website's own tables, as rows keyed by id; queries filter on .eq("id").
let tables;
const signed = [];
const refreshed = [];

mock.module("next/server", { namedExports: { NextResponse: { json: (body, init) => Response.json(body, init) } } });
mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => ({
  from: (table) => {
    let id;
    const query = {
      select: () => query,
      eq: (column, value) => { if (column === "id") id = value; return query; },
      maybeSingle: async () => ({ data: (tables[table] || []).find((row) => row.id === id) ?? null, error: null }),
    };
    return query;
  },
}) } });
mock.module("@/lib/storage/r2", { namedExports: {
  createR2SignedGetUrl: async (key, ttl) => { signed.push({ get: key, ttl }); return `https://r2.example/${encodeURI(key)}?get`; },
  createR2SignedPutUrl: async (key, type, ttl, options) => { signed.push({ put: key, type, ttl, cacheControl: options?.cacheControl }); return `https://r2.example/${encodeURI(key)}?put`; },
} });
mock.module("@/lib/server/hls-manifest-cache", { namedExports: {
  invalidateManifestCache: async (slug, trackSlug) => { refreshed.push([slug, trackSlug]); },
} });

const { laneTransfers, lanePublished } = await import("../lane-transfers.js");
const { audioVisualR2FolderPath } = await import("../../audio-visual/r2-paths.js");
const { POST } = await import("../../../app/api/hls/lane-transfers/route.js");
const { classifyRouteAccess, RouteAccessClass } = await import("../../auth/route-access-policy.js");

// What the workers derived themselves (Node crypto) before they went keyless.
const hmac16 = (input) => createHmac("sha256", SECRET).update(input).digest().subarray(0, 16).toString("hex");

function musicVideoTables(overrides = {}) {
  return {
    hls_transcode_jobs: [{
      id: JOB, job_type: "video", status: "processing", worker_id: "video-host-1", claim_token: LEASE, generation: 2,
      slug: `audio-visual/${VERSION}`, source_key: "2MRRW Studios/Music Videos/late-night/master-1.mov",
      hls_prefix: `hls/audio-visual/${VERSION}/versions/g2/`, asset_version_id: VERSION, ...overrides,
    }],
    audio_visual_asset_versions: [{ id: VERSION, audio_visual_id: VIDEO }],
    audio_visuals: [{ id: VIDEO, slug: "late-night", video_type: "music_video", seriez_id: null, peek_start_seconds: 12, peek_duration_seconds: 8 }],
  };
}
const ask = (overrides = {}) => ({ lane: "video", job_id: JOB, worker_id: "video-host-1", lease_token: LEASE, generation: 2, ...overrides });
const reset = (rows) => { tables = rows; signed.length = 0; refreshed.length = 0; };

test("a music video's lease gets its master, write links inside its own attempt folder, its content key and its folder details", async () => {
  reset(musicVideoTables());
  const folder = `${audioVisualR2FolderPath({ videoType: "music_video", slug: "late-night" })}renditions/${VERSION}/g2/`;
  const { status, body } = await laneTransfers(ask({ uploads: [
    { key: `${folder}avc-1080p/seg_00001.m4s`, content_type: "video/mp4" },
    { key: `${folder}avc-1080p/playlist.m3u8`, content_type: "application/x-mpegURL" },
  ] }));
  assert.equal(status, 200);
  assert.equal(body.prefix, folder);
  assert.equal(body.source.url, "https://r2.example/2MRRW%20Studios/Music%20Videos/late-night/master-1.mov?get");
  assert.deepEqual(body.uploads.map((u) => [u.key.slice(folder.length), u.content_type]), [["avc-1080p/seg_00001.m4s", "video/mp4"], ["avc-1080p/playlist.m3u8", "application/x-mpegURL"]]);
  assert.ok(signed.filter((s) => s.put).every((s) => s.cacheControl === "public, max-age=31536000, immutable" && s.ttl <= 900));
  // The key every viewer's player is served for this version, as the worker used to derive it.
  assert.deepEqual(body.encryption, { key: hmac16(`2mrrw:av-hls:${VIDEO}:${VERSION}:key`), iv: hmac16(`2mrrw:av-hls:${VIDEO}:${VERSION}:iv`) });
  assert.deepEqual(body.context, { audio_visual_id: VIDEO, asset_version_id: VERSION, peek_start_seconds: 12, peek_duration_seconds: 8 });
});

test("a stale, foreign or finished lease gets nothing, and nothing is signed", async () => {
  for (const [label, rows, request] of [
    ["another token", musicVideoTables(), ask({ lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
    ["an older generation", musicVideoTables(), ask({ generation: 1 })],
    ["another worker", musicVideoTables(), ask({ worker_id: "video-host-2" })],
    ["a finished job", musicVideoTables({ status: "complete" }), ask()],
    ["another lane's job", musicVideoTables(), ask({ lane: "vault_video" })],
    ["no job", { hls_transcode_jobs: [] }, ask()],
  ]) {
    reset(rows);
    assert.equal((await laneTransfers(request)).status, 403, label);
    assert.deepEqual(signed, [], `${label}: nothing signed`);
  }
  reset(musicVideoTables());
  for (const bad of [ask({ lane: "podcast" }), ask({ job_id: "x" }), ask({ lease_token: undefined }), ask({ worker_id: " " }), ask({ generation: undefined })]) {
    assert.equal((await laneTransfers(bad)).status, 400);
  }
  assert.deepEqual(signed, []);
});

test("uploads outside the attempt's folder, or of an unknown type, are refused whole", async () => {
  const folder = `${audioVisualR2FolderPath({ videoType: "music_video", slug: "late-night" })}renditions/${VERSION}/g2/`;
  const outside = `${audioVisualR2FolderPath({ videoType: "music_video", slug: "late-night" })}renditions/${VERSION}/g1/avc-1080p/seg_00001.m4s`;
  for (const uploads of [
    [{ key: outside, content_type: "video/mp4" }],
    [{ key: `${folder}../g1/x.m4s`, content_type: "video/mp4" }],
    [{ key: `${folder}avc-1080p/index.html`, content_type: "text/html" }],
    [{ key: folder, content_type: "video/mp4" }],
    [{ key: `${folder}a.ts`, content_type: "video/mp2t" }, { key: `${folder}a.ts`, content_type: "video/mp2t" }],
    Array.from({ length: 501 }, (_, i) => ({ key: `${folder}seg_${i}.ts`, content_type: "video/mp2t" })),
  ]) {
    reset(musicVideoTables());
    assert.equal((await laneTransfers(ask({ uploads }))).status, 400);
    assert.deepEqual(signed, []);
  }
});

test("a vault video writes under its versioned prefix and gets the slug key the vault key route serves", async () => {
  reset({ hls_transcode_jobs: [{
    id: JOB, job_type: "vault_video", status: "processing", worker_id: "vault-host", claim_token: LEASE, generation: 3, slug: "studio-session",
    source_key: "vault/raw/studio-session.mov", hls_prefix: "hls/vault/sessions/studio-session/versions/g3/",
  }] });
  const { status, body } = await laneTransfers({ lane: "vault_video", job_id: JOB, worker_id: "vault-host", lease_token: LEASE, generation: 3,
    uploads: [{ key: "hls/vault/sessions/studio-session/versions/g3/1080p/seg_00001.ts", content_type: "video/mp2t" }] });
  assert.equal(status, 200);
  assert.equal(body.prefix, "hls/vault/sessions/studio-session/versions/g3/");
  assert.deepEqual(body.encryption, { key: hmac16("2mrrw:hls:studio-session:key"), iv: hmac16("2mrrw:hls:studio-session:iv") });
  assert.deepEqual(body.context, { slug: "studio-session" });

  reset({ hls_transcode_jobs: [{ ...tables.hls_transcode_jobs[0], hls_prefix: "hls/singles/w2d/versions/g3/" }] });
  assert.equal((await laneTransfers({ lane: "vault_video", job_id: JOB, worker_id: "vault-host", lease_token: LEASE, generation: 3 })).status, 403,
    "a vault job never writes outside hls/vault/");
});

test("a track visual writes under its lease's own folder and gets the visual's key", async () => {
  reset({
    track_visual_jobs: [{ id: JOB, version_id: VERSION, status: "processing", lease_token: LEASE, worker_id: "visual-host" }],
    track_visual_versions: [{ id: VERSION, track_id: TRACK, source_key: "track-visuals/sources/loop.mov" }],
  });
  const { status, body } = await laneTransfers({ lane: "track_visual", job_id: JOB, worker_id: "visual-host", lease_token: LEASE });
  assert.equal(status, 200);
  assert.equal(body.prefix, `track-visuals/renditions/${TRACK}/${VERSION}/${LEASE}/`);
  assert.deepEqual(body.encryption, { key: hmac16(`2mrrw:track-visual:${VERSION}:key`), iv: hmac16(`2mrrw:track-visual:${VERSION}:iv`) });
  assert.equal((await laneTransfers({ lane: "track_visual", job_id: JOB, worker_id: "visual-host", lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).status, 403);
});

test("a published vault video refreshes its manifest cache, only for the worker that just completed it", async () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const done = (overrides = {}) => ({ hls_transcode_jobs: [{ id: JOB, job_type: "vault_video", status: "complete", worker_id: "vault-host", generation: 3, slug: "studio-session", completed_at: "2026-11-19T11:58:00Z", ...overrides }] });
  const publish = (overrides = {}) => lanePublished({ lane: "vault_video", job_id: JOB, worker_id: "vault-host", generation: 3, ...overrides }, { now });
  reset(done());
  assert.equal((await publish()).status, 200);
  assert.deepEqual(refreshed, [["studio-session", null]]);
  for (const [rows, request] of [[done({ completed_at: "2026-11-19T11:40:00Z" }), {}], [done(), { worker_id: "someone" }], [done(), { generation: 2 }], [done({ status: "processing" }), {}]]) {
    reset(rows);
    assert.equal((await publish(request)).status, 403);
  }
  assert.equal((await publish({ lane: "video" })).status, 400);
  assert.deepEqual(refreshed, []);
});

test("the route answers the worker, and is a machine route outside the consumer sign-in gate", async () => {
  reset(musicVideoTables());
  const post = (body) => POST(new Request("https://www.2mrrw.com/api/hls/lane-transfers", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  assert.equal((await post(ask())).status, 200);
  assert.equal((await post(ask({ lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }))).status, 403);
  assert.equal((await post("not json")).status, 400);
  assert.equal(classifyRouteAccess("/api/hls/lane-transfers", "POST"), RouteAccessClass.SERVICE_INTERNAL);
  assert.notEqual(classifyRouteAccess("/api/hls/lane-transfers", "GET"), RouteAccessClass.SERVICE_INTERNAL);
});

test("a song's lease writes under its own versioned prefix and gets the key its listeners are served", async () => {
  for (const [track, canonical] of [[null, "w2d"], ["intro", "w2d:intro"]]) {
    reset({ hls_transcode_jobs: [{
      id: JOB, job_type: "audio", status: "processing", worker_id: "audio-host", claim_token: LEASE, generation: 4, slug: "w2d", track_slug: track,
      source_key: "audio/masters/w2d.wav", hls_prefix: `hls/singles/w2d/${track ? `${track}/` : ""}versions/g4/`,
    }] });
    const prefix = `hls/singles/w2d/${track ? `${track}/` : ""}versions/g4/`;
    const { status, body } = await laneTransfers({ lane: "audio", job_id: JOB, worker_id: "audio-host", lease_token: LEASE, generation: 4,
      uploads: [{ key: `${prefix}320k/seg_00001.ts`, content_type: "video/mp2t" }] });
    assert.equal(status, 200);
    assert.equal(body.prefix, prefix);
    assert.deepEqual(body.encryption, { key: hmac16(`2mrrw:hls:${canonical}:key`), iv: hmac16(`2mrrw:hls:${canonical}:iv`) });
    assert.deepEqual(body.context, { slug: "w2d", track_slug: track });
  }
  reset({ hls_transcode_jobs: [{ id: JOB, job_type: "audio", status: "processing", worker_id: "audio-host", claim_token: null, generation: 4, slug: "w2d", hls_prefix: "hls/singles/w2d/versions/g4/" }] });
  assert.equal((await laneTransfers({ lane: "audio", job_id: JOB, worker_id: "audio-host", lease_token: LEASE, generation: 4 })).status, 403,
    "a legacy (token-less) claim gets nothing");
});

test("a published song refreshes its track's manifest cache", async () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  reset({ hls_transcode_jobs: [{ id: JOB, job_type: "audio", status: "complete", worker_id: "audio-host", generation: 4, slug: "love-hz", track_slug: "intro", completed_at: "2026-11-19T11:59:00Z" }] });
  assert.equal((await lanePublished({ lane: "audio", job_id: JOB, worker_id: "audio-host", generation: 4 }, { now })).status, 200);
  assert.deepEqual(refreshed, [["love-hz", "intro"]]);
  assert.equal((await lanePublished({ lane: "vault_video", job_id: JOB, worker_id: "audio-host", generation: 4 }, { now })).status, 403, "the lane must match the job");
});

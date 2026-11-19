import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
// PGlite is a pinned devDependency; PGLITE_MODULE can point at another build.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");
const sql = await Promise.all([
  read("./captured-production-schema.sql"),
  read("./captured-production-track-visuals.sql"),
  read("../../supabase/migrations/20261119120000_hls_media_lane_leases.sql"),
  read("../../supabase/migrations/20261119150000_hls_media_worker_role.sql"),
  read("../../supabase/migrations/20261119170000_hls_audio_media_lease.sql"),
]);

async function fresh() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
  for (const file of sql) await db.exec(file);
  const one = async (text, params = []) => (await db.query(text, params)).rows[0];
  return { db, one };
}

/** A song queued the way submit-audio-job.js queues it. */
const song = (one, slug = "w2d", track = null) => one(
  "insert into hls_transcode_jobs (slug, track_slug, release_type, source_key, hls_prefix) values ($1, $2, 'singles', 'audio/masters/' || $1 || '.wav', 'hls/singles/' || $1 || coalesce('/' || $2, '') || '/') returning id",
  [slug, track]);
const claim = (one, worker, type = "audio") => one("select * from public.hls_claim_media_job($1, $2)", [worker, type]);
const lease = (job) => [job.id, job.worker_id, job.claim_token, job.generation];

/** What the keyless audio worker publishes: transcoder.js's manifest, profile 3. */
const manifest = (job) => JSON.stringify({
  slug: job.slug, track_slug: job.track_slug, release_type: job.release_type, hls_prefix: job.hls_prefix,
  bitrates: ["320k", "160k"], segment_duration_secs: 6, duration_seconds: 187.4,
  segment_counts: { "320k": 32, "160k": 32 },
  segment_durations: { "320k": [6, 6, 1.4], "160k": [6, 6, 1.4] },
  rendition_metadata: { "320k": { bandwidth: 330000, headroom: { version: 1, gain_db: -1.2 } }, "160k": { bandwidth: 170000 } },
  source_metadata: { source_key: job.source_key, sha256: "ab".repeat(32) },
  transcode_profile_version: 3,
});
const commit = (one, job) => one("select public.hls_commit_transcode_job($1,$2,$3,$4,$5::jsonb) as r", [...lease(job), manifest(job)]);

test("a song is leased like a video: fresh token, counted attempt, its own generation prefix", async () => {
  const { one } = await fresh();
  const id = (await song(one)).id;
  const job = await claim(one, "audio-host-1");
  assert.equal(job.id, id);
  assert.equal(job.attempt_count, 1);
  assert.match(job.claim_token, /^[0-9a-f-]{36}$/);
  assert.equal(job.hls_prefix, "hls/singles/w2d/versions/g1/");
  assert.equal((await claim(one, "audio-host-2")).id, null, "never handed out twice");
  assert.equal((await one("select * from public.hls_claim_next_job('fly-audio', 'audio')")).id, null, "nor to the legacy claim");
});

test("the legacy claim and the lane claim split the queue; neither takes the other's job", async () => {
  const { one, db } = await fresh();
  await song(one, "a");
  await song(one, "b");
  const legacy = await one("select * from public.hls_claim_next_job('fly-audio', 'audio')");
  assert.equal(legacy.claim_token, null);
  const leased = await claim(one, "audio-host-1");
  assert.notEqual(leased.id, legacy.id);
  // A legacy job whose heartbeat went quiet is the website cron's to rescue, never the lane's.
  await db.query("update hls_transcode_jobs set heartbeat_at = now() - interval '20 minutes' where id = $1", [legacy.id]);
  assert.equal((await claim(one, "audio-host-2")).id, null);
  assert.deepEqual(await one("select status, worker_id from hls_transcode_jobs where id = $1", [legacy.id]), { status: "processing", worker_id: "fly-audio" });
});

test("the lane publishes a song through the fenced commit: profile 3, its generation active, metadata kept", async () => {
  const { one } = await fresh();
  await song(one, "all-yourz");
  const job = await claim(one, "audio-host-1");
  assert.equal((await commit(one, job)).r.committed, true);
  const row = await one("select hls_prefix, transcode_profile_version as v, active_generation as gen, media_kind, source_metadata, segment_durations from hls_manifests where slug = 'all-yourz'");
  assert.deepEqual({ ...row, source_metadata: Object.keys(row.source_metadata) }, {
    hls_prefix: "hls/singles/all-yourz/versions/g1/", v: 3, gen: 1, media_kind: "audio",
    source_metadata: ["sha256", "source_key"], segment_durations: { "320k": [6, 6, 1.4], "160k": [6, 6, 1.4] },
  });
  assert.equal((await one("select status from hls_transcode_jobs where id = $1", [job.id])).status, "complete");
  assert.deepEqual((await commit(one, job)).r, { committed: false, reason: "superseded" }, "a duplicate commit changes nothing");
});

test("a silent audio worker's song is retried under a new generation and its late commit refused", async () => {
  const { one, db } = await fresh();
  await song(one, "turnt", "intro");
  const first = await claim(one, "audio-host-1");
  await db.query("update hls_transcode_jobs set heartbeat_at = now() - interval '6 minutes' where id = $1", [first.id]);
  const second = await claim(one, "audio-host-2");
  assert.equal(second.id, first.id);
  assert.equal(second.generation, 2);
  assert.equal(second.hls_prefix, "hls/singles/turnt/intro/versions/g2/");
  assert.deepEqual((await commit(one, first)).r, { committed: false, reason: "superseded" });
  assert.equal((await one("select public.hls_heartbeat_media_job($1,$2,$3,$4) as ok", lease(first))).ok, false);
  assert.equal((await commit(one, second)).r.committed, true);
});

test("a song failing for good ends after three attempts; the lanes' login can run all of it", async () => {
  const { one, db } = await fresh();
  await song(one);
  await db.exec("SET ROLE hls_media_worker");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await claim(one, `audio-host-${attempt}`);
    const r = (await one("select public.hls_fail_media_job($1,$2,$3,$4,'decoder error','FFMPEG_FAILURE', true) as r", lease(job))).r;
    assert.equal(r.status, attempt < 3 ? "pending" : "failed");
  }
  assert.equal((await claim(one, "audio-host-4")).id, null);
  await db.exec("RESET ROLE");
});

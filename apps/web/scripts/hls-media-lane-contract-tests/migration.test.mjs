import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
// PGlite is a pinned devDependency; PGLITE_MODULE can point at another build.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");
const production = await read("./captured-production-schema.sql");
// The exact row the Audio Visualz upload route inserts (run with the @/ alias loader).
const { videoTranscodeJobRow } = await import("../../src/lib/audio-visual/video-job.js");
const migration = await read("../../supabase/migrations/20261119120000_hls_media_lane_leases.sql");

async function fresh() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  // Supabase grants every new public function to these roles by default; the
  // migration has to take that back itself.
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
  await db.exec(production);
  await db.exec(migration);
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  return { db, one };
}

function insertRow(one, table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => "$" + (i + 1));
  return one(`insert into ${table} (${columns.join(", ")}) values (${placeholders.join(", ")}) returning id`,
    columns.map((column) => row[column]));
}

/** A music video awaiting its first encode, queued exactly as the upload route queues it. */
async function musicVideo(one, slug = "late-night") {
  const video = (await one("insert into audio_visuals (slug) values ($1) returning id", [slug])).id;
  const version = (await one("insert into audio_visual_asset_versions (audio_visual_id, master_r2_key) values ($1, 'masters/m.mov') returning id", [video])).id;
  const job = (await insertRow(one, "hls_transcode_jobs", videoTranscodeJobRow({ assetVersionId: version, sourceKey: "masters/m.mov", queuedBy: "admin-1" }))).id;
  return { video, version, job };
}

async function vaultVideo(one, slug = "studio-session") {
  return (await one(
    `insert into hls_transcode_jobs (job_type, slug, release_type, source_key, hls_prefix, priority, bitrates)
     values ('vault_video', $1, 'vault', 'vault/raw/' || $1 || '.mov', 'hls/vault/sessions/' || $1 || '/', 7, '{1080p,720p}')
     returning id`, [slug])).id;
}

// FROM, not (f()).*: the latter calls the function once per column. PostgREST calls it once, like this.
const claim = async (one, worker, type = "video") => (await one("select * from public.hls_claim_media_job($1, $2)", [worker, type]));
const lease = (job) => [job.id, job.worker_id, job.claim_token, job.generation];
const renditions = (version, generation) => JSON.stringify([
  { codec_family: "avc", resolution_label: "1080p", hls_prefix: `2MRRW Studios/Music Videos/late-night/renditions/${version}/g${generation}/avc-1080p/`, vmaf_score: 95.2 },
  { codec_family: "av1", resolution_label: "720p", hls_prefix: `2MRRW Studios/Music Videos/late-night/renditions/${version}/g${generation}/av1-720p/` },
]);
const peek = (version, generation) => `2MRRW Studios/Music Videos/late-night/renditions/${version}/g${generation}/peek.mp4`;
const commitVideo = (one, job, version, generation = job.generation) => one(
  "select public.hls_commit_video_job($1,$2,$3,$4,$5::jsonb,$6) as r", [...lease(job), renditions(version, generation), peek(version, generation)]);

test("a claim leases one job of its own lane: a fresh token and a counted attempt", async () => {
  const { one } = await fresh();
  const { job: videoJob } = await musicVideo(one);
  const vaultJob = await vaultVideo(one);
  await one("insert into hls_transcode_jobs (slug, source_key, hls_prefix) values ('w2d', 'audio/w2d.wav', 'hls/singles/w2d/')");

  const video = await claim(one, "w1");
  assert.equal(video.id, videoJob);
  assert.equal(video.status, "processing");
  assert.equal(video.attempt_count, 1);
  assert.match(video.claim_token, /^[0-9a-f-]{36}$/);
  assert.equal(video.hls_prefix, `hls/audio-visual/${video.asset_version_id}/versions/g1/`);
  assert.equal((await claim(one, "w2")).id, null, "a leased job is not handed out twice");
  assert.equal((await claim(one, "w3", "vault_video")).id, vaultJob);
  await assert.rejects(claim(one, "w4", "audio"), /invalid media job_type/);
  await assert.rejects(claim(one, " ", "video"), /worker identity required/);

  const audio = await one("select status, attempt_count, claim_token from hls_transcode_jobs where slug = 'w2d'");
  assert.deepEqual(audio, { status: "pending", attempt_count: 0, claim_token: null }, "the audio lane is not touched");
  assert.equal((await one("select slug from public.hls_claim_next_job('a1', 'audio')")).slug, "w2d", "and its own claim still works");
});

test("the upload route's row is one production accepts; the row it used to insert never was", async () => {
  const { one } = await fresh();
  const video = (await one("insert into audio_visuals (slug) values ('v') returning id")).id;
  const version = (await one("insert into audio_visual_asset_versions (audio_visual_id, master_r2_key) values ($1, 'm') returning id", [video])).id;
  // Before: no slug (NOT NULL) and no hls/ prefix (the generation trigger refuses it).
  await assert.rejects(insertRow(one, "hls_transcode_jobs", {
    job_type: "video", asset_version_id: version, source_key: "m", status: "pending", queued_by: "admin-1",
  }), /invalid HLS prefix|null value in column "slug"/);
  const inserted = await insertRow(one, "hls_transcode_jobs", videoTranscodeJobRow({ assetVersionId: version, sourceKey: "m" }));
  const job = await one("select * from hls_transcode_jobs where id = $1", [inserted.id]);
  assert.equal(job.generation, 1);
  assert.equal(job.hls_prefix, `hls/audio-visual/${version}/versions/g1/`);
});

test("publishing a music video is one transaction: renditions, ready, promoted, complete", async () => {
  const { one, db } = await fresh();
  const { video, version } = await musicVideo(one);
  const job = await claim(one, "w1");
  const analysis = JSON.stringify({ source_analysis: { width: 3840 }, complexity_analysis: { score: 0.4 }, storage_preflight: { verdict: "ok" }, hdr_mode: "hdr10" });
  assert.equal((await one("select public.hls_video_job_encoding($1,$2,$3,$4,$5::jsonb) as ok", [...lease(job), analysis])).ok, true);
  assert.deepEqual(await one("select status, hdr_mode, source_analysis from audio_visual_asset_versions where id = $1", [version]),
    { status: "encoding", hdr_mode: "hdr10", source_analysis: { width: 3840 } });

  const { r } = await commitVideo(one, job, version);
  assert.equal(r.committed, true);
  assert.equal(r.generation, 1);
  const rows = (await db.query("select codec_family, resolution_label, hls_prefix from audio_visual_renditions where asset_version_id = $1 order by codec_family", [version])).rows;
  assert.deepEqual(rows.map((row) => `${row.codec_family}-${row.resolution_label}`), ["av1-720p", "avc-1080p"]);
  assert.deepEqual(await one("select status, peek_r2_key is not null as peek, promoted_at is not null as promoted from audio_visual_asset_versions where id = $1", [version]),
    { status: "ready", peek: true, promoted: true });
  assert.deepEqual(await one("select current_version_id, publication_state from audio_visuals where id = $1", [video]),
    { current_version_id: version, publication_state: "ready" });
  assert.deepEqual(await one("select status, claim_token, failure_category from hls_transcode_jobs where id = $1", [job.id]),
    { status: "complete", claim_token: null, failure_category: null });

  assert.deepEqual((await commitVideo(one, job, version)).r, { committed: false, reason: "superseded" }, "a duplicate completion changes nothing");
  assert.equal((await one("select count(*)::int as n from audio_visual_renditions where asset_version_id = $1", [version])).n, 2);
});

test("a publication outside this generation's folder is refused whole", async () => {
  const { one } = await fresh();
  const { version } = await musicVideo(one);
  const job = await claim(one, "w1");
  await assert.rejects(commitVideo(one, job, version, 7), /this generation's files/);
  await assert.rejects(one("select public.hls_commit_video_job($1,$2,$3,$4,'[]'::jsonb,null)", lease(job)), /1 to 16 renditions/);
  assert.deepEqual(await one("select status from hls_transcode_jobs where id = $1", [job.id]), { status: "processing" });
  assert.equal((await one("select count(*)::int as n from audio_visual_renditions")).n, 0);
});

test("a silent worker's job is retried under a new generation, and its late writes are refused", async () => {
  const { one, db } = await fresh();
  const { version } = await musicVideo(one);
  const first = await claim(one, "w1");
  await db.query("update hls_transcode_jobs set heartbeat_at = now() - interval '6 minutes' where id = $1", [first.id]);

  const second = await claim(one, "w2");
  assert.equal(second.id, first.id, "the next claim takes the abandoned job back");
  assert.notEqual(second.claim_token, first.claim_token);
  assert.equal(second.generation, 2);
  assert.equal(second.attempt_count, 2);
  assert.equal(second.hls_prefix, `hls/audio-visual/${version}/versions/g2/`);

  assert.equal((await one("select public.hls_heartbeat_media_job($1,$2,$3,$4) as ok", lease(first))).ok, false);
  assert.equal((await one("select public.hls_video_job_encoding($1,$2,$3,$4,'{}'::jsonb) as ok", lease(first))).ok, false);
  assert.deepEqual((await commitVideo(one, first, version)).r, { committed: false, reason: "superseded" });
  assert.deepEqual((await one("select public.hls_fail_media_job($1,$2,$3,$4,'late','FFMPEG_FAILURE') as r", lease(first))).r, { updated: false, reason: "superseded" });
  assert.equal((await one("select public.hls_release_media_job($1,$2,$3,$4) as ok", lease(first))).ok, false);

  assert.equal((await one("select public.hls_heartbeat_media_job($1,$2,$3,$4) as ok", lease(second))).ok, true);
  assert.equal((await commitVideo(one, second, version)).r.committed, true);
});

test("a healthy worker keeps its lease for as long as it renews it", async () => {
  const { one, db } = await fresh();
  await musicVideo(one);
  const job = await claim(one, "w1");
  await db.query("update hls_transcode_jobs set started_at = now() - interval '3 hours', heartbeat_at = now() - interval '30 seconds' where id = $1", [job.id]);
  assert.equal((await claim(one, "w2")).id, null);
  assert.deepEqual(await one("select worker_id, generation from hls_transcode_jobs where id = $1", [job.id]), { worker_id: "w1", generation: 1 });
});

test("attempts are bounded: the third lost lease fails the job and its music video version", async () => {
  const { one, db } = await fresh();
  const { version } = await musicVideo(one);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await claim(one, `w${attempt}`);
    assert.equal(job.attempt_count, attempt);
    await db.query("update hls_transcode_jobs set heartbeat_at = now() - interval '10 minutes' where id = $1", [job.id]);
  }
  assert.equal((await claim(one, "w4")).id, null, "nothing is left to claim");
  assert.deepEqual(await one("select status, failure_category, claim_token from hls_transcode_jobs"), { status: "failed", failure_category: "LEASE_LOST", claim_token: null });
  assert.equal((await one("select status from audio_visual_asset_versions where id = $1", [version])).status, "failed");
});

test("a retryable failure goes back under a new generation; a permanent one ends the job at once", async () => {
  const { one } = await fresh();
  await musicVideo(one, "a");
  await vaultVideo(one);
  const video = await claim(one, "w1");
  const retried = (await one("select public.hls_fail_media_job($1,$2,$3,$4,'encoder crashed','FFMPEG_FAILURE', true) as r", lease(video))).r;
  assert.deepEqual(retried, { updated: true, status: "pending", attempt_count: 1, generation: 2 });
  assert.equal((await claim(one, "w2")).attempt_count, 2);

  const vault = await claim(one, "w3", "vault_video");
  const ended = (await one("select public.hls_fail_media_job($1,$2,$3,$4,'not a video','VALIDATION_FAILURE', false) as r", lease(vault))).r;
  assert.equal(ended.status, "failed");
  assert.deepEqual(await one("select failure_category, completed_at is not null as done from hls_transcode_jobs where id = $1", [vault.id]),
    { failure_category: "VALIDATION_FAILURE", done: true });
});

test("a worker shutting down hands its job straight back without spending the attempt", async () => {
  const { one } = await fresh();
  await vaultVideo(one);
  const job = await claim(one, "old-host", "vault_video");
  assert.equal((await one("select public.hls_release_media_job($1,$2,$3,$4) as ok", lease(job))).ok, true);
  const again = await claim(one, "new-host", "vault_video");
  assert.equal(again.id, job.id);
  assert.equal(again.attempt_count, 1);
  assert.equal(again.generation, 2, "and its partial output stays in the old generation's folder");
});

test("the vault lane publishes through the existing fenced commit with its lease", async () => {
  const { one, db } = await fresh();
  await vaultVideo(one);
  const first = await claim(one, "w1", "vault_video");
  await db.query("update hls_transcode_jobs set heartbeat_at = now() - interval '6 minutes' where id = $1", [first.id]);
  const second = await claim(one, "w2", "vault_video");
  const manifest = (job) => JSON.stringify({
    slug: "studio-session", track_slug: null, hls_prefix: job.hls_prefix, bitrates: ["1080p", "720p"],
    segment_duration_secs: 6, duration_seconds: 1834.2, segment_counts: { "1080p": 306, "720p": 306 },
    media_kind: "video", transcode_profile_version: job.target_profile_version,
  });
  const commit = (job) => one("select public.hls_commit_transcode_job($1,$2,$3,$4,$5::jsonb) as r", [...lease(job), manifest(job)]);
  assert.deepEqual((await commit(first)).r, { committed: false, reason: "superseded" });
  assert.equal((await commit(second)).r.committed, true);
  assert.deepEqual(await one("select release_type, media_kind, hls_prefix, active_generation from hls_manifests"),
    { release_type: "vault", media_kind: "video", hls_prefix: "hls/vault/sessions/studio-session/versions/g2/", active_generation: 2 });
});

test("only the service role can call the lane functions", async () => {
  const { one } = await fresh();
  for (const fn of [
    "public.hls_claim_media_job(text,text)",
    "public.hls_heartbeat_media_job(uuid,text,uuid,bigint)",
    "public.hls_video_job_encoding(uuid,text,uuid,bigint,jsonb)",
    "public.hls_commit_video_job(uuid,text,uuid,bigint,jsonb,text)",
    "public.hls_fail_media_job(uuid,text,uuid,bigint,text,text,boolean)",
    "public.hls_release_media_job(uuid,text,uuid,bigint)",
  ]) {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await one(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok, false, `${role} cannot call ${fn}`);
    }
    assert.equal((await one(`select has_function_privilege('service_role', '${fn}', 'execute') as ok`)).ok, true, `the workers can call ${fn}`);
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal((await one(`select has_function_privilege('${role}', 'public.hls_held_media_job(uuid,text,uuid,bigint)', 'execute') as ok`)).ok, false);
  }
});

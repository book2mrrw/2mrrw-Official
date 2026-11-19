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
]);

async function fresh() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  // Supabase grants every new public function to these roles by default.
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
  for (const file of sql) await db.exec(file);
  const one = async (text, params = []) => (await db.query(text, params)).rows[0];
  return { db, one };
}

const LANE_FUNCTIONS = [
  "public.hls_claim_media_job(text,text)",
  "public.hls_heartbeat_media_job(uuid,text,uuid,bigint)",
  "public.hls_video_job_encoding(uuid,text,uuid,bigint,jsonb)",
  "public.hls_commit_video_job(uuid,text,uuid,bigint,jsonb,text)",
  "public.hls_fail_media_job(uuid,text,uuid,bigint,text,text,boolean)",
  "public.hls_release_media_job(uuid,text,uuid,bigint)",
  "public.hls_media_lease_live(uuid,uuid)",
  "public.hls_commit_transcode_job(uuid,text,uuid,bigint,jsonb)",
  "public.claim_track_visual_job(text)",
  "public.heartbeat_track_visual_job(uuid,text,uuid)",
  "public.complete_track_visual_job(uuid,uuid,jsonb,text)",
];

async function trackVisual(one) {
  const track = (await one("insert into track_visuals (track_id) values (gen_random_uuid()) returning track_id")).track_id;
  const version = (await one(
    "insert into track_visual_versions (track_id, source_key, source_bytes, source_content_type, status) values ($1, 'track-visuals/sources/' || gen_random_uuid() || '.mov', 1000, 'video/quicktime', 'pending') returning id",
    [track])).id;
  await one("insert into track_visual_jobs (version_id) values ($1) returning id", [version]);
  return { track, version };
}

test("the lanes' login can call the lane functions and nothing else: no table, no audio claim", async () => {
  const { one, db } = await fresh();
  for (const fn of LANE_FUNCTIONS) {
    assert.equal((await one(`select has_function_privilege('hls_media_worker', '${fn}', 'execute') as ok`)).ok, true, fn);
  }
  for (const table of ["hls_transcode_jobs", "hls_manifests", "audio_visual_renditions", "audio_visual_asset_versions", "track_visual_jobs", "track_visual_versions"]) {
    for (const privilege of ["select", "insert", "update", "delete"]) {
      assert.equal((await one(`select has_table_privilege('hls_media_worker', 'public.${table}', '${privilege}') as ok`)).ok, false, `${privilege} on ${table}`);
    }
  }
  await db.exec("insert into hls_transcode_jobs (slug, source_key, hls_prefix) values ('w2d', 'audio/w2d.wav', 'hls/singles/w2d/')");
  await db.exec("SET ROLE hls_media_worker");
  assert.equal((await one("select * from public.hls_claim_media_job('host-1', 'video')")).id, null, "it claims through its lane");
  await assert.rejects(one("select count(*) from public.hls_transcode_jobs"), /permission denied/);
  await assert.rejects(one("update public.audio_visual_asset_versions set status = 'ready'"), /permission denied/);
  await db.exec("RESET ROLE");
  assert.deepEqual(await one("select status, worker_id from hls_transcode_jobs where slug = 'w2d'"), { status: "pending", worker_id: null }, "audio untouched");
});

test("a track visual's lease renews only for its holder, and only while it runs", async () => {
  const { one, db } = await fresh();
  await trackVisual(one);
  await db.exec("SET ROLE hls_media_worker");
  const { j: job } = await one("select public.claim_track_visual_job('visual-host') as j");
  const beat = (worker, token) => one("select public.heartbeat_track_visual_job($1, $2, $3) as ok", [job.id, worker, token]);
  assert.equal((await beat("visual-host", job.lease_token)).ok, true);
  assert.equal((await beat("visual-host", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).ok, false);
  assert.equal((await beat("someone-else", job.lease_token)).ok, false);
  assert.equal((await one("select public.complete_track_visual_job($1, $2, null, 'source unreadable') as ok", [job.id, job.lease_token])).ok, true);
  assert.equal((await beat("visual-host", job.lease_token)).ok, false, "a finished job is renewed by nobody");
});

test("a booting host learns which video-lane leases are still held", async () => {
  const { one, db } = await fresh();
  const video = (await one("insert into audio_visuals (slug) values ('v') returning id")).id;
  const version = (await one("insert into audio_visual_asset_versions (audio_visual_id, master_r2_key) values ($1, 'm') returning id", [video])).id;
  await one(`insert into hls_transcode_jobs (job_type, slug, release_type, asset_version_id, source_key, hls_prefix)
             values ('video', 'audio-visual/' || $1::text, 'audio_visual', $1::uuid, 'm', 'hls/audio-visual/' || $1::text || '/') returning id`, [version]);
  await db.exec("SET ROLE hls_media_worker");
  const job = await one("select * from public.hls_claim_media_job('host-1', 'video')");
  const live = (token) => one("select public.hls_media_lease_live($1, $2) as ok", [job.id, token]);
  assert.equal((await live(job.claim_token)).ok, true);
  assert.equal((await live("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).ok, false);
  assert.equal((await one("select public.hls_release_media_job($1, $2, $3, $4) as ok", [job.id, job.worker_id, job.claim_token, job.generation])).ok, true);
  assert.equal((await live(job.claim_token)).ok, false, "a handed-back lease is dead");
});

test("anon and authenticated cannot call the new functions", async () => {
  const { one } = await fresh();
  for (const fn of ["public.heartbeat_track_visual_job(uuid,text,uuid)", "public.hls_media_lease_live(uuid,uuid)"]) {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await one(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok, false, `${role}: ${fn}`);
    }
  }
});

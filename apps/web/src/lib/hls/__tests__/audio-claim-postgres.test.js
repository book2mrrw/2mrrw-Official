import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const contract = JSON.parse(await fs.readFile(new URL('./fixtures/database-contract-20261027.json', import.meta.url), 'utf8'));
const migration = await fs.readFile(new URL('../../../../supabase/migrations/20261028030000_hls_audio_claim_contract.sql', import.meta.url), 'utf8');

async function database(t, migrated = true) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for (const table of ['hls_transcode_jobs', 'hls_manifests', 'hls_retired_prefixes']) {
    const columns = contract.columns.filter(c => c.table_name === table).map(c =>
      `"${c.column_name}" ${c.udt_name.startsWith('_') ? c.udt_name.slice(1) + '[]' : c.udt_name}${c.column_default ? ' DEFAULT ' + c.column_default : ''}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`);
    await db.exec(`CREATE TABLE public.${table} (${columns.join(',')});`);
  }
  await db.exec(`ALTER TABLE public.hls_transcode_jobs ADD PRIMARY KEY(id);
    ALTER TABLE public.hls_manifests ADD PRIMARY KEY(id);
    CREATE UNIQUE INDEX manifest_identity ON public.hls_manifests(slug,coalesce(track_slug,''));
    CREATE UNIQUE INDEX retired_identity ON public.hls_retired_prefixes(hls_prefix);`);
  for (const fn of contract.functions) await db.exec(fn.definition);
  await db.exec('CREATE TRIGGER prepare_generation BEFORE INSERT OR UPDATE ON public.hls_transcode_jobs FOR EACH ROW EXECUTE FUNCTION public.hls_prepare_job_generation();');
  if (migrated) await db.exec(migration);
  return db;
}
async function seed(db, kind = 'audio', slug = 'song') {
  return (await db.query(`INSERT INTO public.hls_transcode_jobs(slug,source_key,hls_prefix,release_type,job_type,status,target_profile_version)
    VALUES($1,'digital-assets/singles/song/master.wav',$2,'singles',$3,'pending',3) RETURNING *`, [slug, `hls/singles/${slug}/`, kind])).rows[0];
}
const claim = async (db, worker = 'worker', kind = 'audio') =>
  (await db.query('SELECT * FROM public.hls_claim_next_job($1,$2)', [worker, kind])).rows[0];
const fail = async (db, job) => (await db.query('SELECT public.hls_fail_transcode_job($1,$2,$3,$4,$5,3) AS result',
  [job.id, job.worker_id, job.claim_token, job.generation, 'fixture failure'])).rows[0].result;
const manifest = job => ({ slug: job.slug, track_slug: null, hls_prefix: job.hls_prefix, bitrates: ['320k'],
  segment_counts: { '320k': 2 }, segment_durations: { '320k': [6, 6] }, rendition_metadata: {},
  source_metadata: {}, media_kind: 'audio', transcode_profile_version: 3, segment_duration_secs: 6, duration_seconds: 12 });
const commit = async (db, job) => (await db.query('SELECT public.hls_commit_transcode_job($1,$2,$3,$4,$5::jsonb) AS result',
  [job.id, job.worker_id, job.claim_token, job.generation, JSON.stringify(manifest(job))])).rows[0].result;

test('captured live claim reproduces the missing token and uncounted attempt', async t => {
  const db = await database(t, false); await seed(db);
  const job = await claim(db);
  assert.equal(job.claim_token, null); assert.equal(job.attempt_count, 0);
});
test('migrated claim returns the exact stored lease, generation and counted attempt', async t => {
  const db = await database(t); await seed(db);
  const job = await claim(db);
  assert.match(job.claim_token, /^[a-f0-9-]{36}$/); assert.equal(job.attempt_count, 1);
  const stored = (await db.query('SELECT * FROM public.hls_transcode_jobs WHERE id=$1', [job.id])).rows[0];
  assert.equal(stored.claim_token, job.claim_token); assert.equal(stored.generation, job.generation);
  assert.equal((await claim(db)).id, null, 'one queued job cannot be claimed twice');
});
test('three real claim/fail transactions exhaust the audio retry budget', async t => {
  const db = await database(t); await seed(db);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await claim(db); assert.equal(job.attempt_count, attempt);
    const result = await fail(db, job);
    assert.equal(result.updated, true); assert.equal(result.status, attempt === 3 ? 'failed' : 'pending');
  }
  assert.equal((await claim(db)).id, null);
});
test('stale commit and failure cannot replace the successor; publication retains old bytes for 48 hours', async t => {
  const db = await database(t); await seed(db);
  await db.query(`INSERT INTO public.hls_manifests(slug,hls_prefix,segment_counts,duration_seconds)
    VALUES('song','hls/singles/song/versions/g0/','{"320k":2}',12)`);
  const old = await claim(db, 'old'); await fail(db, old);
  const next = await claim(db, 'next');
  assert.notEqual(next.claim_token, old.claim_token);
  assert.equal((await commit(db, old)).committed, false);
  assert.equal((await fail(db, old)).updated, false);
  assert.equal((await db.query('SELECT hls_prefix FROM public.hls_manifests')).rows[0].hls_prefix, 'hls/singles/song/versions/g0/');
  assert.equal((await commit(db, next)).committed, true);
  assert.equal((await db.query('SELECT hls_prefix FROM public.hls_manifests')).rows[0].hls_prefix, next.hls_prefix);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.hls_retired_prefixes WHERE hls_prefix='hls/singles/song/versions/g0/' AND delete_after>=retired_at+interval '48 hours'")).rows[0].n, 1);
});
test('audio claim changes preserve lane isolation and existing video retry ownership', async t => {
  const db = await database(t); await seed(db, 'video', 'video'); await seed(db, 'audio', 'audio'); await seed(db, 'vault_video', 'vault');
  for (const kind of ['video', 'vault_video']) {
    const job = await claim(db, kind, kind); assert.equal(job.job_type, kind);
    assert.equal(job.attempt_count, 0); assert.equal(job.claim_token, null);
  }
  assert.equal((await claim(db)).job_type, 'audio');
  await assert.rejects(claim(db, 'worker', 'invalid'), /invalid job_type/);
});
test('only the service role can invoke the worker claim contract', async t => {
  const db = await database(t); await seed(db);
  for (const role of ['anon', 'authenticated']) {
    await db.exec('SET ROLE ' + role);
    await assert.rejects(claim(db), /permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  assert.ok((await claim(db)).claim_token);
  await db.exec('RESET ROLE');
});

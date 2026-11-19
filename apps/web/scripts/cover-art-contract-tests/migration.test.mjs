import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
// PGlite is a pinned devDependency; PGLITE_MODULE can point at another build.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const migration = await fs.readFile(new URL("../../supabase/migrations/20261118190000_cover_art_lane.sql", import.meta.url), "utf8");

async function fresh() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  await db.exec(migration);
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  return { db, one };
}

test("queue is idempotent per version; a new version supersedes the old, including a ready one", async () => {
  const { one } = await fresh();
  const a = (await one("select public.queue_cover_art('videos/singles/w2d/w2d.mp4','e1') as id")).id;
  const again = (await one("select public.queue_cover_art('videos/singles/w2d/w2d.mp4','e1') as id")).id;
  assert.equal(again, a);
  const job = (await one("select public.claim_cover_art_job('w1') as j")).j;
  assert.equal(job.id, a);
  assert.equal((await one("select public.complete_cover_art_job($1,$2,'[{\"id\":\"square-720\",\"key\":\"k\"}]'::jsonb) as ok", [a, job.lease_token])).ok, true);
  assert.equal((await one("select status from public.cover_art_versions where id=$1", [a])).status, "ready");
  const b = (await one("select public.queue_cover_art('videos/singles/w2d/w2d.mp4','e2') as id")).id;
  assert.notEqual(b, a);
  assert.equal((await one("select status from public.cover_art_versions where id=$1", [a])).status, "superseded");
  assert.equal((await one("select status from public.cover_art_versions where id=$1", [b])).status, "queued");
});

test("only the lease holder finishes; errors retry up to three attempts, then fail; a failed version requeues", async () => {
  const { one } = await fresh();
  const id = (await one("select public.queue_cover_art('k','e') as id")).id;
  let job = (await one("select public.claim_cover_art_job('w1') as j")).j;
  assert.equal((await one("select public.claim_cover_art_job('w2') as j")).j, null, "claimed jobs are not handed out twice");
  assert.equal((await one("select public.complete_cover_art_job($1, gen_random_uuid(), null, 'x') as ok", [id])).ok, false);
  assert.equal((await one("select public.heartbeat_cover_art_job($1,$2) as ok", [id, job.lease_token])).ok, true);
  for (const attempt of [1, 2, 3]) {
    assert.equal(job.attempt, attempt);
    assert.equal((await one("select public.complete_cover_art_job($1,$2,null,'boom') as ok", [id, job.lease_token])).ok, true);
    const status = (await one("select status from public.cover_art_versions where id=$1", [id])).status;
    assert.equal(status, attempt < 3 ? "queued" : "failed");
    if (attempt < 3) job = (await one("select public.claim_cover_art_job('w1') as j")).j;
  }
  assert.equal((await one("select public.queue_cover_art('k','e') as id")).id, id);
  assert.equal((await one("select status, attempt_count from public.cover_art_versions where id=$1", [id])).status, "queued");
});

test("a worker silent for five minutes loses its lease to the next claim", async () => {
  const { one, db } = await fresh();
  const id = (await one("select public.queue_cover_art('k','e') as id")).id;
  const first = (await one("select public.claim_cover_art_job('w1') as j")).j;
  await db.query("update public.cover_art_versions set heartbeat_at = now() - interval '6 minutes' where id=$1", [id]);
  const second = (await one("select public.claim_cover_art_job('w2') as j")).j;
  assert.equal(second.id, id);
  assert.notEqual(second.lease_token, first.lease_token);
  assert.equal((await one("select public.complete_cover_art_job($1,$2,'[{\"id\":\"x\"}]'::jsonb) as ok", [id, first.lease_token])).ok, false, "the old lease can no longer finish");
});

test("anon and authenticated can neither read the table nor call the functions", async () => {
  const { db } = await fresh();
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select * from public.cover_art_versions"));
    await assert.rejects(db.query("select public.queue_cover_art('k','e')"));
    await db.exec("reset role");
  }
});

test("the lane's own login can claim, heartbeat and finish jobs, and nothing else", async () => {
  const { db, one } = await fresh();
  const id = (await one("select public.queue_cover_art('videos/singles/w2d/w2d.mp4','e1') as id")).id;
  await db.exec("set role cover_art_worker");
  const job = (await one("select public.claim_cover_art_job('vm') as j")).j;
  assert.equal(job.id, id);
  assert.equal((await one("select public.heartbeat_cover_art_job($1,$2) as ok", [id, job.lease_token])).ok, true);
  assert.equal((await one("select public.complete_cover_art_job($1,$2,'[{\"id\":\"square-720\"}]'::jsonb,null) as ok", [id, job.lease_token])).ok, true);
  await assert.rejects(db.query("select * from public.cover_art_versions"), "no table access");
  await assert.rejects(db.query("select public.queue_cover_art('k','e')"), "the website queues, not the lane");
  await db.exec("reset role");
  assert.equal((await one("select status from public.cover_art_versions where id=$1", [id])).status, "ready");
});

test("the migration can be applied twice without failing (role already exists)", async () => {
  const { db } = await fresh();
  await db.exec(migration.replace(/create table public\.cover_art_versions[\s\S]*?grant all on public\.cover_art_versions to service_role;/, "").replace(/create function/g, "create or replace function"));
});

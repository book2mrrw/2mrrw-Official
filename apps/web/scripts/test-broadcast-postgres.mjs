// Run with BROADCAST_PGLITE_MODULE pointing to an installed @electric-sql/pglite entry.
// Uses an isolated in-memory PostgreSQL engine. Never connects to production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { applySessionCommand } from "../src/lib/broadcast/session-model.js";

const modulePath = process.env.BROADCAST_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
const host = randomUUID();
const sessionId = randomUUID();
const initial = { id: sessionId, type: "interview", state: "DRAFT", sequence: 0, items: [],
  releaseId: null, productId: null, isPlaying: false, mediaPosition: 0, effectiveAt: Date.now() };
const commandSql = "select public.commit_broadcast_command($1,$2,$3,$4,$5,$6,$7::jsonb,$8) as result";
async function commit(prior, type, { actor = host, commandId = randomUUID(), fingerprint = commandId, payload = {} } = {}) {
  const at = Date.now();
  const snapshot = applySessionCommand(prior, { type, payload, expectedSequence: prior.sequence }, at);
  const args = [sessionId, actor, commandId, fingerprint, prior.sequence, type, JSON.stringify(snapshot), at];
  const { rows } = await db.query(commandSql, args);
  return { ...rows[0].result, args };
}
try {
  // Only referenced identities/roles are fixtures. The migration and function execute unchanged.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.releases(id uuid primary key); create table public.live_broadcasts(id uuid primary key);
    grant usage on schema public to anon,authenticated,service_role;`);
  await check("migration executes in PostgreSQL", async () => {
    await db.exec(await readFile(new URL("../supabase/migrations/20260909010000_broadcast_session_authority.sql", import.meta.url), "utf8"));
  });
  await db.query("insert into auth.users(id) values ($1)", [host]);
  await check("JSON null cannot bypass required session identity and state constraints", async () => {
    await assert.rejects(db.query("insert into public.broadcast_sessions(id,host_id,creation_fingerprint,snapshot) values($1,$2,'invalid',$3::jsonb)",
      [randomUUID(), host, JSON.stringify({ ...initial, id: null, state: null, sequence: null })]), { code: "23514" });
  });
  await db.query("insert into public.broadcast_sessions(id,host_id,creation_fingerprint,snapshot) values($1,$2,'fixture',$3::jsonb)", [sessionId, host, JSON.stringify(initial)]);
  await check("anonymous and authenticated roles cannot read tables or execute authority", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(db.query("select * from public.broadcast_sessions"), { code: "42501" });
        await assert.rejects(db.query("select * from public.broadcast_session_events"), { code: "42501" });
        await assert.rejects(db.query("select * from public.broadcast_session_grants"), { code: "42501" });
        await assert.rejects(db.query(commandSql, [sessionId, host, randomUUID(), "x", 0, "GO_LIVE", JSON.stringify(initial), Date.now()]), { code: "42501" });
      } finally { await db.exec("reset role"); }
    }
  });
  await check("RLS still hides sessions if a SELECT grant is accidentally added", async () => {
    await db.exec("grant select on public.broadcast_sessions to authenticated; set role authenticated");
    try { assert.equal((await db.query("select * from public.broadcast_sessions")).rows.length, 0); }
    finally { await db.exec("reset role; revoke select on public.broadcast_sessions from authenticated"); }
  });
  await db.exec("set role service_role");
  const started = await commit(initial, "GO_LIVE");
  await check("service transaction persists one ordered event and matching snapshot", async () => {
    assert.equal(started.session.sequence, 1);
    assert.equal(started.session.state, "LIVE_INTRO");
    const { rows } = await db.query("select s.snapshot = e.snapshot as matches from public.broadcast_sessions s join public.broadcast_session_events e on e.session_id=s.id where s.id=$1", [sessionId]);
    assert.equal(rows[0].matches, true);
  });
  await check("duplicate command creates no additional event", async () => {
    const retry = (await db.query(commandSql, started.args)).rows[0].result;
    assert.equal(retry.duplicate, true);
    assert.equal(retry.eventId, started.eventId);
    assert.equal(Number((await db.query("select count(*) as n from public.broadcast_session_events")).rows[0].n), 1);
  });
  await check("stale sequence and wrong host cannot mutate authority", async () => {
    assert.equal((await commit(initial, "PRE_SHOW")).error, "SEQUENCE_CONFLICT");
    assert.equal((await commit(started.session, "INTERMISSION", { actor: randomUUID() })).error, "FORBIDDEN");
  });
  const ended = await commit(started.session, "END_SESSION");
  await check("retry after termination returns current ended state", async () => {
    assert.equal(ended.session.authorizationEpoch, 1);
    const retry = (await db.query(commandSql, started.args)).rows[0].result;
    assert.equal(retry.session.state, "ENDED");
    assert.equal(retry.session.sequence, 2);
  });
  await check("events are append-only for the application role", async () => {
    await assert.rejects(db.query("delete from public.broadcast_session_events"), { code: "42501" });
    await assert.rejects(db.query("update public.broadcast_session_events set command_type='GO_LIVE'"), { code: "42501" });
  });
  await check("pause position uses database time even when application time is ahead", async () => {
    const id = randomUUID();
    const before = { ...initial, id, state: "TRACK_PLAYBACK", isPlaying: true, currentItemId: "track",
      mediaPosition: 30, effectiveAt: Date.now() - 1000, items: [{ id: "track", durationSeconds: 180 }] };
    await db.query("insert into public.broadcast_sessions(id,host_id,creation_fingerprint,snapshot) values($1,$2,'clock',$3::jsonb)", [id, host, JSON.stringify(before)]);
    const appTime = Date.now() + 4000;
    const next = applySessionCommand(before, { type: "PAUSE_TRACK", expectedSequence: 0 }, appTime);
    const result = (await db.query(commandSql, [id, host, randomUUID(), "clock", 0, "PAUSE_TRACK", JSON.stringify(next), appTime])).rows[0].result;
    assert.ok(result.session.mediaPosition >= 30.5 && result.session.mediaPosition < 33, `Unexpected position: ${result.session.mediaPosition}`);
  });
  await check("verified preparation persists without changing canonical track order or timeline", async () => {
    const id = randomUUID();
    const before = { ...initial, id, type: "listening_session", items: [
      { id: randomUUID(), trackId: randomUUID(), position: 0, prepared: false },
      { id: randomUUID(), trackId: randomUUID(), position: 1, prepared: false },
    ] };
    await db.query("insert into public.broadcast_sessions(id,host_id,creation_fingerprint,snapshot) values($1,$2,'prepare',$3::jsonb)", [id, host, JSON.stringify(before)]);
    const at = Date.now();
    const next = applySessionCommand(before, { type: "PREPARE_MEDIA", expectedSequence: 0, payload: {} }, at,
      { mediaReadiness: before.items.map(item => ({ id: item.id, prepared: true })) });
    const result = (await db.query(commandSql, [id, host, randomUUID(), "prepare", 0, "PREPARE_MEDIA", JSON.stringify(next), at])).rows[0].result;
    assert.equal(result.session.sequence, 1);
    assert.equal(result.session.state, "DRAFT");
    assert.equal(result.session.effectiveAt, before.effectiveAt);
    assert.deepEqual(result.session.items.map(item => [item.trackId, item.position]), before.items.map(item => [item.trackId, item.position]));
    assert.ok(result.session.items.every(item => item.prepared));
  });
  console.log(`${checks} PostgreSQL runtime checks passed. Multi-connection lock contention and hosted Supabase remain separate checks.`);
} finally { await db.close(); }

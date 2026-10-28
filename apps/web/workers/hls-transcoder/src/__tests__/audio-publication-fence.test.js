import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
let published, mutations, calls, filters, notifications, rpcError;
const current = { id: 'job', job_type: 'audio', worker_id: 'worker-new', claim_token: 'claim-new', generation: 3 };
const stale = { ...current, worker_id: 'worker-old', claim_token: 'claim-old', generation: 2 };
const client = {
  async rpc(name, args) {
    calls.push({ name, args });
    if (rpcError) return { error: { message: 'publication failed' } };
    const owns = args.p_generation === current.generation && args.p_claim_token === current.claim_token && args.p_worker_id === current.worker_id;
    if (name === 'hls_commit_transcode_job') {
      if (owns) published = args.p_manifest;
      return { data: { committed: owns }, error: null };
    }
    return { data: { updated: owns, status: 'pending', generation: 4 }, error: null };
  },
  from(table) {
    let value, operation;
    const q = { select: () => q, eq: (k, v) => { filters.push([k, v]); return q; }, is: () => q,
      insert: v => { value = v; operation = 'insert'; return q; },
      update: v => { value = v; operation = 'update'; return q; },
      single: async () => ({ data: { attempt_count: 1 }, error: null }),
      then: resolve => {
        mutations.push({ table, operation, value });
        if (table === 'hls_manifests') published = value;
        return Promise.resolve({ error: null }).then(resolve);
      } };
    return q;
  },
};
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => client } });
process.env.SUPABASE_URL = 'https://fixture.supabase.co'; process.env.SUPABASE_SECRET_KEY = 'fixture';
process.env.APP_URL = 'https://fixture.test'; process.env.HLS_WORKER_API_TOKEN = 'fixture';
mock.method(globalThis, 'fetch', async () => { notifications++; return new Response('{}'); });
const { markJobComplete, markJobFailed, touchHeartbeat } = await import('../db.js');
beforeEach(() => { published = { hls_prefix: 'new-generation/' }; mutations = []; calls = []; filters = []; notifications = 0; rpcError = false; });
test('a reclaimed worker cannot overwrite a successor or invalidate its playback cache', async () => {
  const result = await markJobComplete(stale, { hls_prefix: 'stale-generation/' });
  assert.equal(published.hls_prefix, 'new-generation/');
  assert.equal(result, false);
  assert.equal(mutations.length, 0);
  assert.equal(notifications, 0);
});
test('current audio publication uses one fenced transaction and then notifies the app', async () => {
  const manifest = { hls_prefix: 'new-generation/' };
  assert.equal(await markJobComplete(current, manifest), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'hls_commit_transcode_job');
  assert.equal(calls[0].args.p_generation, 3);
  assert.equal(notifications, 1);
  assert.equal(mutations.length, 0);
});
test('publication failure never notifies or writes a partial manifest', async () => {
  rpcError = true;
  await assert.rejects(markJobComplete(current, {}), /publication failed/);
  assert.equal(notifications, 0); assert.equal(mutations.length, 0);
});
test('missing audio lease fails before publication or mutation', async () => {
  await assert.rejects(markJobComplete({ ...current, claim_token: null }, {}), /claimed generation/);
  assert.equal(calls.length + mutations.length, 0);
});
test('stale worker failure and heartbeat carry the same claim fence', async () => {
  assert.equal((await markJobFailed(stale.id, 'late failure', 'ENCODE', stale)).updated, false);
  assert.equal(mutations.length, 0);
  await touchHeartbeat(stale.id, stale);
  assert.ok(filters.some(([k, v]) => k === 'claim_token' && v === stale.claim_token));
  assert.ok(filters.some(([k, v]) => k === 'generation' && v === stale.generation));
});
test('a current audio failure preserves its category and clears only the returned idle generation heartbeat', async () => {
  await markJobFailed(current.id, 'failed', 'ENCODE', current);
  assert.deepEqual(mutations[0].value, { failure_category: 'ENCODE', heartbeat_at: null });
  assert.ok(filters.some(([k, v]) => k === 'generation' && v === 4));
  assert.ok(filters.some(([k, v]) => k === 'status' && v === 'pending'));
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

describe("HLS zero-downtime generation cutover", () => {
  const migration = read("supabase/migrations/20260828000055_hls_generation_cutover.sql");
  const workerDb = read("workers/hls-transcoder/src/db.js");
  const refresh = read("src/app/api/admin/media/refresh-track/route.js");
  const gc = read("src/app/api/cron/hls-retired-prefixes/route.js");

  test("queue generations are serialized and written to immutable prefixes", () => {
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /'versions\/g' \|\| new\.generation::text/);
    assert.match(migration, /claim_token = gen_random_uuid\(\)/);
  });

  test("manifest promotion and job completion share one fenced RPC transaction", () => {
    assert.match(migration, /create or replace function public\.hls_commit_transcode_job/);
    assert.match(migration, /v_job\.claim_token is distinct from p_claim_token/);
    assert.match(migration, /v_job\.generation is distinct from p_generation/);
    assert.match(workerDb, /db\.rpc\("hls_commit_transcode_job"/);
    assert.doesNotMatch(workerDb, /from\("hls_manifests"\)\.insert/);
  });

  test("manual refresh preserves the active manifest throughout rebuild", () => {
    assert.match(refresh, /activeManifestPreserved: true/);
    assert.match(refresh, /enqueueHlsTranscodeJob/);
    assert.match(refresh, /force: true/);
    assert.doesNotMatch(refresh, /DeleteObjectCommand/);
    assert.doesNotMatch(refresh, /hls_manifests/);
  });

  test("retired generations receive grace and legacy cleanup protects versions", () => {
    assert.match(migration, /now\(\) \+ interval '48 hours'/);
    assert.match(migration, /for update skip locked/);
    assert.match(gc, /Number\(retired\.generation\) === 0/);
    assert.match(gc, /`\$\{prefix\}versions\/`/);
  });
});

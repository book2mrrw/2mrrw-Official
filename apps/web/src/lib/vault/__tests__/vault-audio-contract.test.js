/**
 * Vault audio pipeline contract.
 *
 * The cases that matter here are the separation guarantees, not the happy
 * path. Vault audio shares one table with the release pipeline, and the
 * UNIQUE index on (slug, COALESCE(track_slug,'')) is not scoped by job_type or
 * release_type -- so the guard in submitVaultAudioJob is the only thing
 * standing between a badly-named vault item and a published release's
 * manifest. These tests exist to keep that guard honest.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVaultAudioMasterKey,
  buildVaultAudioHlsPrefix,
  validateVaultAudioMaster,
  isAudioNativeCategory,
  VAULT_AUDIO_RENDITIONS,
  VAULT_AUDIO_RELEASE_TYPE,
} from "../vault-audio-contract.js";

import {
  submitVaultAudioJob,
  VaultAudioJobConflict,
  VaultAudioIdentityCollision,
} from "../submit-vault-audio-job.js";

const CATEGORY = "Audio Diariez";
const SLUG = "three-am-voice-note";
const SOURCE = "videos/vault/_audio-masters/audio-diariez/three-am-voice-note.wav";

/* ── storage keys ───────────────────────────────────────────────────────── */

test("the master lands in the never-public vault prefix", () => {
  const key = buildVaultAudioMasterKey({ category: CATEGORY, slug: SLUG, ext: "wav" });
  assert.equal(key, SOURCE);
  // videos/vault/ is in R2_NEVER_PUBLIC_PREFIXES. A master must never be
  // reachable, so this prefix is the whole point.
  assert.ok(key.startsWith("videos/vault/"));
});

test("the encrypted ladder lands outside every release tree", () => {
  const prefix = buildVaultAudioHlsPrefix({ category: CATEGORY, slug: SLUG });
  assert.equal(prefix, "hls/vault/audio-diariez/three-am-voice-note/");
  for (const releaseType of ["singles", "features", "albums", "mixtapes-and-eps"]) {
    assert.ok(!prefix.startsWith(`hls/${releaseType}/`));
  }
});

test("a traversal attempt in the slug produces no key at all", () => {
  for (const slug of ["../escape", "a/b", ".hidden", "UPPER", "", "trailing-"]) {
    assert.equal(buildVaultAudioMasterKey({ category: CATEGORY, slug, ext: "wav" }), null);
    assert.equal(buildVaultAudioHlsPrefix({ category: CATEGORY, slug }), null);
  }
});

test("an unknown section produces no key", () => {
  assert.equal(buildVaultAudioMasterKey({ category: "Not A Section", slug: SLUG, ext: "wav" }), null);
});

/* ── accepted formats ───────────────────────────────────────────────────── */

test("lossless masters are accepted and marked lossless", () => {
  for (const ext of ["wav", "flac", "aiff", "aif"]) {
    const r = validateVaultAudioMaster({
      category: CATEGORY, slug: SLUG, filename: `take.${ext}`, size: 40_000_000,
    });
    assert.equal(r.error, undefined, `${ext} should be accepted`);
    assert.equal(r.lossless, true, `${ext} should count as lossless`);
  }
});

test("lossy masters are accepted but not called lossless", () => {
  for (const ext of ["mp3", "m4a"]) {
    const r = validateVaultAudioMaster({
      category: CATEGORY, slug: SLUG, filename: `memo.${ext}`, size: 4_000_000,
    });
    assert.equal(r.error, undefined);
    assert.equal(r.lossless, false);
  }
});

test("formats that would fail later are refused now, with the fix in the message", () => {
  for (const ext of ["ogg", "opus", "wma", "aac", "mid"]) {
    const r = validateVaultAudioMaster({
      category: CATEGORY, slug: SLUG, filename: `x.${ext}`, size: 1_000_000,
    });
    assert.ok(r.error, `.${ext} must be refused`);
    // A refusal that does not say what to do instead just moves the problem.
    assert.match(r.error, /\.wav|\.flac|\.m4a/);
  }
});

test("size is bounded and a missing size is not treated as zero-and-fine", () => {
  assert.match(
    validateVaultAudioMaster({ category: CATEGORY, slug: SLUG, filename: "a.wav", size: 3e9 }).error,
    /Too large/
  );
  assert.match(
    validateVaultAudioMaster({ category: CATEGORY, slug: SLUG, filename: "a.wav", size: undefined }).error,
    /Missing file size/
  );
});

test("the audio sections the user named are the audio-native ones", () => {
  assert.ok(isAudioNativeCategory("Audio Diariez"));
  assert.ok(isAudioNativeCategory("UNMXD UNMSTRD"));
  assert.ok(isAudioNativeCategory("Private Releasez"));
  assert.ok(!isAudioNativeCategory("Behind the Scenez"));
});

/* ── the shared-table guard ─────────────────────────────────────────────── */

/**
 * Minimal stand-in for the PostgREST builder, recording every table touched so
 * a test can assert this pipeline never reaches for one it has no business in.
 */
function database(state = {}) {
  const writes = [];
  const tables = new Set();

  return {
    writes,
    tables,
    from(table) {
      tables.add(table);
      const q = { table, op: "select", filters: {}, payload: null };
      const api = {
        select: () => api,
        insert(p) { q.op = "insert"; q.payload = p; return api; },
        update(p) { q.op = "update"; q.payload = p; return api; },
        eq(col, val) { q.filters[col] = val; return api; },
        is(col, val) { q.filters[col] = val; return api; },
        async maybeSingle() {
          if (q.op !== "select") {
            writes.push(q);
            if (q.op === "insert") {
              return state.insertResult ?? {
                data: { id: "job-new", status: "pending", hls_prefix: q.payload.hls_prefix },
                error: null,
              };
            }
            return state.updateResult ?? {
              data: { id: q.filters.id, status: "pending", hls_prefix: q.payload.hls_prefix },
              error: null,
            };
          }
          if (q.table === "hls_manifests") return { data: state.manifest ?? null, error: null };
          if ("id" in q.filters) return { data: state.byId ?? null, error: null };
          return { data: state.job ?? null, error: null };
        },
      };
      return api;
    },
  };
}

const submit = (admin, extra = {}) =>
  submitVaultAudioJob({ admin, category: CATEGORY, slug: SLUG, sourceKey: SOURCE, ...extra });

test("a fresh item is queued as a vault-typed audio job", async () => {
  const db = database();
  const job = await submit(db);

  assert.equal(job.id, "job-new");
  assert.equal(db.writes.length, 1);

  const row = db.writes[0].payload;
  assert.equal(row.job_type, "audio", "the existing audio worker lane claims this");
  assert.equal(row.release_type, VAULT_AUDIO_RELEASE_TYPE, "this is what keeps it out of release trees");
  assert.equal(row.slug, SLUG);
  assert.equal(row.track_slug, null);
  assert.equal(row.source_key, SOURCE);
  assert.equal(row.hls_prefix, "hls/vault/audio-diariez/three-am-voice-note/");
  assert.deepEqual(row.bitrates, [...VAULT_AUDIO_RENDITIONS]);
  assert.ok(row.priority > 5, "a vault upload must not outrank a release drop");

  // Only the queue is touched. No release table, no vault_content, nothing else.
  assert.deepEqual([...db.tables].sort(), ["hls_manifests", "hls_transcode_jobs"]);
});

test("a release's job row at the same slug is refused, not overwritten", async () => {
  const db = database({ job: { id: "release-job", release_type: "singles", job_type: "audio" } });

  await assert.rejects(() => submit(db), VaultAudioIdentityCollision);
  assert.equal(db.writes.length, 0, "nothing may be written when the slug is not ours");
});

test("a release's published manifest at the same slug is refused", async () => {
  // The job row is absent -- an older release whose job was pruned. The
  // manifest is what playback reads, so this is the more dangerous of the two.
  const db = database({ job: null, manifest: { id: "m1", release_type: "albums" } });

  await assert.rejects(() => submit(db), VaultAudioIdentityCollision);
  assert.equal(db.writes.length, 0);
});

test("the collision message names the slug and says what to do", async () => {
  const db = database({ job: { id: "j", release_type: "singles" } });
  await assert.rejects(() => submit(db), (err) => {
    assert.match(err.message, new RegExp(SLUG));
    assert.match(err.message, /Rename/);
    assert.equal(err.status, 409);
    return true;
  });
});

test("our own vault row at this slug is re-queued rather than refused", async () => {
  const db = database({
    job: { id: "vault-job", release_type: "vault", job_type: "audio" },
    manifest: { id: "m", release_type: "vault" },
    byId: { id: "vault-job", status: "failed", source_key: SOURCE, bitrates: [...VAULT_AUDIO_RENDITIONS] },
  });

  const job = await submit(db);
  assert.equal(job.id, "vault-job");
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].op, "update");
  // Compare-and-set on the status we read: a worker claiming it mid-flight
  // must win instead of having the job yanked away.
  assert.equal(db.writes[0].filters.status, "failed");
  assert.equal(db.writes[0].payload.attempt_count, 0, "a re-queue starts the attempt count over");
});

test("an in-flight job is not disturbed", async () => {
  for (const status of ["pending", "processing"]) {
    const db = database({
      job: { id: "vault-job", release_type: "vault" },
      byId: { id: "vault-job", status, source_key: "videos/vault/_audio-masters/audio-diariez/older.wav", bitrates: [] },
    });
    await assert.rejects(() => submit(db), VaultAudioJobConflict);
    assert.equal(db.writes.length, 0);
  }
});

test("re-submitting identical work returns the existing job instead of duplicating it", async () => {
  const db = database({
    job: { id: "vault-job", release_type: "vault" },
    byId: { id: "vault-job", status: "pending", source_key: SOURCE, bitrates: [...VAULT_AUDIO_RENDITIONS] },
  });

  const job = await submit(db);
  assert.equal(job.reused, true);
  assert.equal(db.writes.length, 0);
});

test("a worker that claims the row between read and write causes a conflict, not a steal", async () => {
  const db = database({
    job: { id: "vault-job", release_type: "vault" },
    byId: { id: "vault-job", status: "failed", source_key: SOURCE, bitrates: [] },
    // Zero rows matched: the status moved on after we read it.
    updateResult: { data: null, error: null },
  });

  await assert.rejects(() => submit(db), VaultAudioJobConflict);
});

test("a unique-violation race on insert is a conflict, never a blind retry", async () => {
  const db = database({ insertResult: { data: null, error: { code: "23505" } } });
  await assert.rejects(() => submit(db), VaultAudioJobConflict);
});

test("a bad identity is rejected before any query runs", async () => {
  const db = database();
  await assert.rejects(
    () => submitVaultAudioJob({ admin: db, category: CATEGORY, slug: "../bad", sourceKey: SOURCE }),
    /Invalid vault audio identity/
  );
  await assert.rejects(
    () => submitVaultAudioJob({ admin: db, category: CATEGORY, slug: SLUG, sourceKey: "" }),
    /source key is required/
  );
  assert.equal(db.tables.size, 0, "no table should be touched for an invalid request");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createAssetVersion, promoteAssetVersion } from "../publication-authority.js";

// Minimal fake mirroring the shape of the real Supabase JS query builder
// (.from().insert().select().single() and .rpc()), both async, both
// resolving { data, error } — matches the exact shape db.js's real calls use.
function fakeDbClient({ insertResult = { data: { id: "version-1" }, error: null }, rpcResult = { data: null, error: null } } = {}) {
  const calls = { insert: null, rpc: null };
  return {
    calls,
    from(table) {
      return {
        insert(row) {
          calls.insert = { table, row };
          return {
            select() {
              return { single: async () => insertResult };
            },
          };
        },
      };
    },
    rpc(fnName, args) {
      calls.rpc = { fnName, args };
      return Promise.resolve(rpcResult);
    },
  };
}

// ── createAssetVersion ──

test("createAssetVersion requires a dbClient — never silently proceeds without one", async () => {
  await assert.rejects(
    () => createAssetVersion({ audioVisualId: "av-1", masterR2Key: "media/video/masters/av-1/v1/master.mov" }),
    /dbClient is required/
  );
});

test("createAssetVersion requires both audioVisualId and masterR2Key", async () => {
  const dbClient = fakeDbClient();
  await assert.rejects(() => createAssetVersion({ masterR2Key: "k", dbClient }), /both required/);
  await assert.rejects(() => createAssetVersion({ audioVisualId: "av-1", dbClient }), /both required/);
});

test("createAssetVersion inserts a new row with status 'uploaded' — never overwrites an existing version in place", async () => {
  const dbClient = fakeDbClient({ insertResult: { data: { id: "version-2", status: "uploaded" }, error: null } });
  const result = await createAssetVersion({
    audioVisualId: "av-1", masterR2Key: "media/video/masters/av-1/v2/master.mov", dbClient,
  });
  assert.equal(dbClient.calls.insert.table, "audio_visual_asset_versions");
  assert.equal(dbClient.calls.insert.row.audio_visual_id, "av-1");
  assert.equal(dbClient.calls.insert.row.master_r2_key, "media/video/masters/av-1/v2/master.mov");
  assert.equal(dbClient.calls.insert.row.status, "uploaded");
  assert.equal(result.id, "version-2");
});

test("createAssetVersion surfaces a DB error as VALIDATION_FAILURE rather than an opaque throw", async () => {
  const dbClient = fakeDbClient({ insertResult: { data: null, error: { message: "duplicate key" } } });
  await assert.rejects(
    () => createAssetVersion({ audioVisualId: "av-1", masterR2Key: "k", dbClient }),
    (err) => {
      assert.match(err.message, /duplicate key/);
      assert.equal(err.failureCategory, "VALIDATION_FAILURE");
      return true;
    }
  );
});

// ── promoteAssetVersion ──

test("promoteAssetVersion requires a dbClient", async () => {
  await assert.rejects(
    () => promoteAssetVersion({ audioVisualId: "av-1", assetVersionId: "version-1" }),
    /dbClient is required/
  );
});

test("promoteAssetVersion requires both audioVisualId and assetVersionId", async () => {
  const dbClient = fakeDbClient();
  await assert.rejects(() => promoteAssetVersion({ assetVersionId: "version-1", dbClient }), /both required/);
  await assert.rejects(() => promoteAssetVersion({ audioVisualId: "av-1", dbClient }), /both required/);
});

test("promoteAssetVersion delegates atomicity entirely to the promote_audio_visual_version RPC, passing both IDs through", async () => {
  const dbClient = fakeDbClient();
  await promoteAssetVersion({ audioVisualId: "av-1", assetVersionId: "version-2", dbClient });
  assert.equal(dbClient.calls.rpc.fnName, "promote_audio_visual_version");
  assert.deepEqual(dbClient.calls.rpc.args, { p_audio_visual_id: "av-1", p_asset_version_id: "version-2" });
});

test("promoteAssetVersion surfaces the RPC's own rejection (e.g. a version whose status isn't 'ready' yet) as VALIDATION_FAILURE, never silently promoting it", async () => {
  const dbClient = fakeDbClient({
    rpcResult: { data: null, error: { message: "asset version version-2 has status encoding — only a version with status 'ready' may be promoted" } },
  });
  await assert.rejects(
    () => promoteAssetVersion({ audioVisualId: "av-1", assetVersionId: "version-2", dbClient }),
    (err) => {
      assert.match(err.message, /only a version with status 'ready' may be promoted/);
      assert.equal(err.failureCategory, "VALIDATION_FAILURE");
      return true;
    }
  );
});

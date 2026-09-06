/**
 * PublicationAuthority — the only path by which an audio_visuals row's
 * current_version_id may change, and the only path by which a new asset
 * version's life begins.
 *
 * "Atomic Replace/version-pinning" (Part K, slice 11) is not a separate
 * mechanism from these two functions — it falls directly out of the
 * schema's own append-only design: replacing a video's master is never an
 * in-place update, it's createAssetVersion() making a brand-new row (the
 * existing current_version_id, and everything already serving it, is
 * completely untouched while the new version runs the full pipeline
 * independently) followed — only once that new version reaches status
 * 'ready' — by promoteAssetVersion() atomically swapping which version is
 * current. There is no code-level distinction between "first upload" and
 * "replace": both are just createAssetVersion() on an audio_visuals row
 * that may or may not already have a current_version_id.
 *
 * Actual atomicity for promotion lives in a single Postgres function
 * (promote_audio_visual_version — see the accompanying migration),
 * mirroring the existing hls_claim_next_job RPC pattern already used for
 * job claiming elsewhere in this worker: Supabase's REST client can't
 * safely perform a multi-table, lock-guarded update on its own, so the
 * guarantee lives in the database, not in this JS layer. The RPC itself
 * re-verifies the target version's status is 'ready' before promoting —
 * this module never trusts a caller's own bookkeeping alone.
 *
 * dbClient is a required parameter (never defaulted to the real Supabase
 * singleton) — importing workers/hls-transcoder/src/db.js throws at
 * *import time* if SUPABASE_URL/SUPABASE_SECRET_KEY aren't set, which
 * would make this module unsafe to even import in a test file. The real
 * pipeline orchestrator (video-transcoder.js) already imports the real
 * client and passes it in.
 */

export async function createAssetVersion({ audioVisualId, masterR2Key, dbClient }) {
  if (!dbClient) throw new Error("createAssetVersion: dbClient is required");
  if (!audioVisualId || !masterR2Key) {
    throw new Error("createAssetVersion: audioVisualId and masterR2Key are both required");
  }

  const { data, error } = await dbClient
    .from("audio_visual_asset_versions")
    .insert({ audio_visual_id: audioVisualId, master_r2_key: masterR2Key, status: "uploaded" })
    .select()
    .single();

  if (error) {
    const err = new Error(`createAssetVersion: ${error.message}`);
    err.failureCategory = "VALIDATION_FAILURE";
    throw err;
  }
  return data;
}

export async function promoteAssetVersion({ audioVisualId, assetVersionId, dbClient }) {
  if (!dbClient) throw new Error("promoteAssetVersion: dbClient is required");
  if (!audioVisualId || !assetVersionId) {
    throw new Error("promoteAssetVersion: audioVisualId and assetVersionId are both required");
  }

  const { error } = await dbClient.rpc("promote_audio_visual_version", {
    p_audio_visual_id: audioVisualId,
    p_asset_version_id: assetVersionId,
  });

  if (error) {
    const err = new Error(`promoteAssetVersion: ${error.message}`);
    err.failureCategory = "VALIDATION_FAILURE";
    throw err;
  }
}

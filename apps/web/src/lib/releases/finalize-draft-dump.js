import { deleteR2Object } from "@/lib/storage/r2";
import { emitServerEvent } from "@/lib/observability/server-events";

async function referencedElsewhere(admin, key, releaseId) {
  const checks = await Promise.all([
    admin.from("tracks").select("id").eq("audio_r2_key", key).neq("release_id", releaseId).limit(1),
    admin.from("tracks").select("id").eq("master_r2_key", key).neq("release_id", releaseId).limit(1),
    admin.from("releases").select("id").eq("cover_art_r2_key", key).neq("id", releaseId).limit(1),
    admin.from("releases").select("id").contains("metadata", { animated_cover_r2_key: key }).neq("id", releaseId).limit(1),
    admin.from("releases").select("id").contains("metadata", { preview_r2_key: key }).neq("id", releaseId).limit(1),
    admin.from("products").select("id").contains("metadata", { cover_art_r2_key: key }).limit(1),
  ]);
  return checks.some((result) => (result.data || []).length > 0);
}

export async function finalizeDraftDump(admin, job) {
  const { data: release } = await admin.from("releases").select("id,status,slug").eq("id", job.release_id).maybeSingle();
  if (!release) { await admin.from("draft_deletion_jobs").delete().eq("id", job.id); return; }
  if (release.status !== "draft") throw new Error("Only drafts may be dumped");
  let deletedAssets = 0;
  let retainedReferences = 0;
  for (const key of [...new Set(Array.isArray(job.asset_keys) ? job.asset_keys : [])]) {
    if (!key) continue;
    if (await referencedElsewhere(admin, key, release.id)) { retainedReferences += 1; continue; }
    try {
      await deleteR2Object(key);
      deletedAssets += 1;
    } catch (error) {
      emitServerEvent("error", "draft_dump_asset_cleanup_failed",
        { jobId: job.id, releaseId: release.id, objectKey: key }, error);
      throw error;
    }
  }
  await admin.from("hls_transcode_jobs").delete().in("source_key", Array.isArray(job.asset_keys) && job.asset_keys.length ? job.asset_keys : ["__none__"]);
  await admin.from("products").update({ active: false }).eq("release_id", release.id);
  const { error } = await admin.from("releases").delete().eq("id", release.id);
  if (error) throw error;
  emitServerEvent("info", "draft_dump_completed",
    { jobId: job.id, releaseId: release.id, releaseSlug: release.slug,
      deletedAssets, retainedReferences });
}

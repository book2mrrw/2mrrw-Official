import { emitServerEvent } from "@/lib/observability/server-events";

// Drain already-confirmed legacy jobs through the same logical lifecycle. Never
// let the retired asset-deletion loop race a retained release or shared media.
export async function finalizeDraftDump(admin, job) {
  const { data, error } = await admin.rpc("delete_release", {
    p_id: job.release_id,
    p_actor_id: job.requested_by,
    p_draft_only: true,
    p_source: "releases",
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.code || "Draft deletion could not be confirmed");
  emitServerEvent("info", "draft_dump_completed", {
    jobId: job.id, releaseId: job.release_id, releaseSlug: data.slug,
    semantics: "soft_delete", assetsRetained: true,
  });
}

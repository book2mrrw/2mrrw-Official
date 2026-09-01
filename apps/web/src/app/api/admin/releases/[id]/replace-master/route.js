import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { deleteR2Object, getR2ObjectMetadata } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const PUBLIC_STATUS = Object.freeze({
  uploading: "uploading",
  uploaded: "processing",
  processing: "processing",
  ready: "processing",
  promoting: "processing",
  active: "active",
  failed: "failed",
  cancelled: "cancelled",
  retired: "retired",
});

async function authorize(req, routeKey, limit = 60, recentSeconds = 15 * 60) {
  const user = await getAdminSessionUser({ recentSeconds });
  if (!user || !isAdminUser(user)) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const rl = await checkRateLimit(req, {
    routeKey,
    limit,
    windowSeconds: 300,
    identifier: user.id,
  });
  if (!rl.allowed) return { response: rateLimitResponse(rl.retryAfterSeconds) };
  return { user };
}

function revisionResponse(revision) {
  return {
    replacementId: revision.id,
    status: PUBLIC_STATUS[revision.status] || revision.status,
    internalStatus: revision.status,
    error: revision.error_message || null,
    uploadedAt: revision.uploaded_at || null,
    processingAt: revision.processing_at || null,
    promotedAt: revision.promoted_at || null,
  };
}

async function loadBoundRevision(admin, releaseRefId, revisionId) {
  if (!revisionId) return null;
  const { data } = await admin
    .from("audio_master_revisions")
    .select("id, release_ref_id, staged_master_key, content_type, byte_size, status, error_message, uploaded_at, processing_at, promoted_at, hls_job_id")
    .eq("id", revisionId)
    .eq("release_ref_id", releaseRefId)
    .maybeSingle();
  return data || null;
}

/** Read-only lifecycle endpoint used only while one admin replacement is open. */
export async function GET(req, { params }) {
  // Polling may outlive the 15-minute mutation window. Keep the administrator
  // identity/MFA boundary, but do not expire a read-only status stream midway.
  const auth = await authorize(req, "admin.releases.replace-master.status", 120, null);
  if (auth.response) return auth.response;
  const { id: releaseRefId } = await params;
  const replacementId = req.nextUrl.searchParams.get("replacementId");
  const revision = await loadBoundRevision(getAdminClient(), releaseRefId, replacementId);
  if (!revision) {
    return NextResponse.json({ error: "Replacement transaction not found" }, { status: 404 });
  }
  return NextResponse.json(revisionResponse(revision));
}

/**
 * Verify the staged object and queue its immutable HLS job. This endpoint does
 * not change a public master pointer and therefore cannot interrupt playback.
 */
export async function POST(req, { params }) {
  const auth = await authorize(req, "admin.releases.replace-master.commit", 10);
  if (auth.response) return auth.response;
  const { id: releaseRefId } = await params;

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const replacementId = String(body.replacementId || "");
  if (!replacementId) {
    return NextResponse.json({ error: "replacementId is required" }, { status: 400 });
  }

  const admin = getAdminClient();
  const revision = await loadBoundRevision(admin, releaseRefId, replacementId);
  if (!revision) {
    return NextResponse.json({ error: "Replacement transaction not found" }, { status: 404 });
  }
  if (revision.status === "active") return NextResponse.json(revisionResponse(revision));
  if (["processing", "ready", "promoting"].includes(revision.status)) {
    return NextResponse.json(revisionResponse(revision), { status: 202 });
  }
  if (revision.status !== "uploading" && revision.status !== "uploaded") {
    return NextResponse.json(
      { error: revision.error_message || `Replacement cannot continue from ${revision.status}` },
      { status: 409 }
    );
  }

  let object;
  try {
    object = await getR2ObjectMetadata(revision.staged_master_key);
  } catch (error) {
    console.error("[replace-master] staged object verification failed", error?.message);
    return NextResponse.json({ error: "Could not verify staged master in storage" }, { status: 502 });
  }
  if (!object) {
    return NextResponse.json(
      { error: "Staged master was not found; the active master is unchanged" },
      { status: 422 }
    );
  }
  if (object.contentLength !== Number(revision.byte_size)) {
    await admin.from("audio_master_revisions").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      error_message: "Uploaded byte length did not match the authorized file",
    }).eq("id", revision.id);
    return NextResponse.json({ error: "Uploaded master failed byte-length validation" }, { status: 422 });
  }
  if (object.contentType !== String(revision.content_type).toLowerCase()) {
    await admin.from("audio_master_revisions").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      error_message: "Uploaded Content-Type did not match the authorized file",
    }).eq("id", revision.id);
    return NextResponse.json({ error: "Uploaded master failed content-type validation" }, { status: 422 });
  }

  const { data: job, error: queueError } = await admin.rpc("queue_audio_master_revision", {
    p_revision_id: revision.id,
    p_queued_by: auth.user.id,
  });
  if (queueError || !job?.id) {
    console.error("[replace-master] revision queue failed", queueError?.message);
    return NextResponse.json(
      { error: "The staged master could not enter processing; the active master is unchanged" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    replacementId: revision.id,
    status: "processing",
    hlsJobId: job.id,
    activeMasterUnchanged: true,
  }, { status: 202 });
}

/** Cancel only an unqueued staged upload. Processing/active revisions are immutable. */
export async function DELETE(req, { params }) {
  const auth = await authorize(req, "admin.releases.replace-master.cancel", 20);
  if (auth.response) return auth.response;
  const { id: releaseRefId } = await params;
  const replacementId = req.nextUrl.searchParams.get("replacementId");
  const admin = getAdminClient();
  const revision = await loadBoundRevision(admin, releaseRefId, replacementId);
  if (!revision) return NextResponse.json({ error: "Replacement transaction not found" }, { status: 404 });
  if (revision.status !== "uploading") {
    return NextResponse.json({ error: "Only an unqueued staged upload can be cancelled" }, { status: 409 });
  }
  await deleteR2Object(revision.staged_master_key).catch(() => {});
  const { error } = await admin.from("audio_master_revisions").update({
    status: "cancelled",
    failed_at: new Date().toISOString(),
    error_message: "Staged upload was cancelled before processing",
  }).eq("id", revision.id).eq("status", "uploading");
  if (error) return NextResponse.json({ error: "Could not cancel staged upload" }, { status: 500 });
  return NextResponse.json({ replacementId: revision.id, status: "cancelled" });
}

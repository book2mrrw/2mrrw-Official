import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { createR2SignedPutUrl } from "@/lib/storage/r2";
import { ADMIN_UPLOAD_CONTRACTS, extensionForFilename } from "@/lib/media/admin-upload-contract";
import {
  buildMasterRevisionKeys,
  MasterRevisionTargetError,
  resolveMasterRevisionTarget,
} from "@/lib/media/master-revision-authority";

export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const user = await getAdminSessionUser({ recentSeconds: 15 * 60 });
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.replace-master.stage",
    limit: 10,
    windowSeconds: 300,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id: releaseRefId } = await params;
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filename = String(body.filename || "");
  const byteSize = Number(body.size);
  const extension = extensionForFilename(filename);
  const uploadContract = ADMIN_UPLOAD_CONTRACTS.audio;
  const contentType = uploadContract.extensions[extension];
  if (!contentType) {
    return NextResponse.json({ error: "Unsupported master format — use WAV, FLAC, AIFF, or AIF" }, { status: 400 });
  }
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > uploadContract.maxBytes) {
    return NextResponse.json({ error: "Invalid master file size" }, { status: 400 });
  }

  const admin = getAdminClient();
  try {
    const target = await resolveMasterRevisionTarget(admin, releaseRefId, body.trackId || null);
    if (!target.previousMasterKey) {
      return NextResponse.json(
        { error: "No authoritative existing master was found; use the normal upload flow" },
        { status: 409 }
      );
    }

    const { data: inflight } = await admin
      .from("audio_master_revisions")
      .select("id, status")
      .eq("entity_kind", target.entityKind)
      .eq("entity_id", target.entityId)
      .in("status", ["uploading", "uploaded", "processing", "ready", "promoting"])
      .maybeSingle();
    if (inflight) {
      return NextResponse.json(
        { error: "A master replacement is already in progress for this track", replacementId: inflight.id, status: inflight.status },
        { status: 409 }
      );
    }

    const revisionId = crypto.randomUUID();
    const { stagedMasterKey, hlsPrefix } = buildMasterRevisionKeys({
      folder: target.releaseType,
      releaseSlug: target.releaseSlug,
      trackSlug: target.trackSlug,
      revisionId,
      extension,
    });

    let manifestQuery = admin
      .from("hls_manifests")
      .select("hls_prefix")
      .eq("slug", target.releaseSlug);
    manifestQuery = target.trackSlug
      ? manifestQuery.eq("track_slug", target.trackSlug)
      : manifestQuery.is("track_slug", null);
    const { data: currentManifest } = await manifestQuery.maybeSingle();

    const { error: insertError } = await admin.from("audio_master_revisions").insert({
      id: revisionId,
      release_ref_id: target.releaseRefId,
      release_source: target.releaseSource,
      entity_kind: target.entityKind,
      entity_id: target.entityId,
      release_slug: target.releaseSlug,
      track_slug: target.trackSlug,
      release_type: target.releaseType,
      staged_master_key: stagedMasterKey,
      previous_master_key: target.previousMasterKey,
      previous_storage_path: target.previousStoragePath,
      hls_prefix: hlsPrefix,
      previous_hls_prefix: currentManifest?.hls_prefix || null,
      original_filename: filename.slice(0, 512),
      content_type: contentType,
      byte_size: byteSize,
      status: "uploading",
      requested_by: user.id,
    });
    if (insertError) {
      const conflict = insertError.code === "23505";
      return NextResponse.json(
        { error: conflict ? "A master replacement is already in progress for this track" : "Could not create replacement transaction" },
        { status: conflict ? 409 : 500 }
      );
    }

    try {
      const uploadUrl = await createR2SignedPutUrl(
        stagedMasterKey,
        contentType,
        uploadContract.expiresIn
      );
      return NextResponse.json({
        replacementId: revisionId,
        uploadUrl,
        key: stagedMasterKey,
        contentType,
        expiresAt: new Date(Date.now() + uploadContract.expiresIn * 1000).toISOString(),
      });
    } catch (error) {
      await admin.from("audio_master_revisions").update({
        status: "failed",
        failed_at: new Date().toISOString(),
        error_message: "Could not authorize staged upload",
      }).eq("id", revisionId);
      throw error;
    }
  } catch (error) {
    const status = error instanceof MasterRevisionTargetError ? error.status : 500;
    console.error("[replace-master/stage]", error?.message);
    return NextResponse.json(
      { error: status === 500 ? "Could not stage master replacement" : error.message },
      { status }
    );
  }
}


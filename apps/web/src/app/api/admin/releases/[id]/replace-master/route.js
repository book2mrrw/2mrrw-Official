import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { copyR2Object, deleteR2Object, getR2ObjectMetadata } from "@/lib/storage/r2";
import { ADMIN_UPLOAD_CONTRACTS } from "@/lib/media/admin-upload-contract";
import {
  buildMasterRevisionKeys,
  MasterRevisionTargetError,
  resolveMasterRevisionTarget,
} from "@/lib/media/master-revision-authority";
import { invalidateAudioCacheAndRequeueTranscode } from "@/lib/media/audio-cache-refresh";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";

export const dynamic = "force-dynamic";

/**
 * Commits a staged master replacement synchronously — no worker, no staging
 * table. This mirrors exactly what the working initial-upload path already
 * does in publish/route.js: copy the file to its canonical R2 key, update the
 * pointer column directly, done. The previous design staged into
 * audio_master_revisions and waited for an external transcoder worker to call
 * promote_audio_master_revision(); that table was never deployed to
 * production, so no replacement ever took effect. HLS regeneration still
 * happens in the background afterward (invalidateAudioCacheAndRequeueTranscode),
 * exactly like /api/admin/media/refresh-track — it is an enhancement, not a
 * precondition for the new audio being audible.
 */

async function authorize(req, routeKey, limit = 60) {
  const gate = await requireAdminActor({ recentSeconds: 15 * 60 });
  if (!gate.ok) {
    const denial = classifyAdminAuthorityDenial(gate.reason);
    return {
      response: NextResponse.json(
        { error: denial.status === 401 ? "Unauthorized" : "Forbidden", code: denial.code },
        { status: denial.status }
      ),
    };
  }
  const user = gate.user;
  const rl = await checkRateLimit(req, {
    routeKey,
    limit,
    windowSeconds: 300,
    identifier: user.id,
  });
  if (!rl.allowed) return { response: rateLimitResponse(rl.retryAfterSeconds) };
  return { user };
}

function extWithDotFromKey(key) {
  const i = String(key || "").lastIndexOf(".");
  return i >= 0 ? key.slice(i) : "";
}

function canonicalAudioKey({ folder, releaseSlug, trackSlug, extWithDot }) {
  return trackSlug
    ? `digital-assets/${folder}/${releaseSlug}/${trackSlug}/${trackSlug}${extWithDot}`
    : `digital-assets/${folder}/${releaseSlug}/${releaseSlug}${extWithDot}`;
}

async function mergeMetadataAudioKey(admin, table, matchColumn, matchValue, destKey) {
  const { data: row } = await admin.from(table).select("metadata").eq(matchColumn, matchValue).maybeSingle();
  const metadata = { ...(row?.metadata || {}), audio_key: destKey, audio_replaced_at: new Date().toISOString() };
  return admin.from(table).update({ metadata }).eq(matchColumn, matchValue);
}

/**
 * Commit a staged master replacement: verify the upload, copy it to the
 * canonical R2 key, flip the pointer, and kick off cache/transcode cleanup.
 * Synchronous — the response reflects the final state, no polling required.
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
  const key = String(body.key || "");
  const size = Number(body.size);
  if (!replacementId || !key) {
    return NextResponse.json({ error: "replacementId and key are required" }, { status: 400 });
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    return NextResponse.json({ error: "size is required" }, { status: 400 });
  }

  const admin = getAdminClient();
  let target;
  try {
    target = await resolveMasterRevisionTarget(admin, releaseRefId, body.trackId || null);
  } catch (error) {
    const status = error instanceof MasterRevisionTargetError ? error.status : 500;
    return NextResponse.json({ error: error.message || "Could not resolve replacement target" }, { status });
  }

  const extWithDot = extWithDotFromKey(key);
  const extension = extWithDot.replace(/^\./, "").toLowerCase();
  const expectedKey = buildMasterRevisionKeys({
    folder: target.releaseType,
    releaseSlug: target.releaseSlug,
    trackSlug: target.trackSlug,
    revisionId: replacementId,
    extension,
  }).stagedMasterKey;
  if (key !== expectedKey) {
    return NextResponse.json({ error: "Invalid staged file reference" }, { status: 400 });
  }

  const expectedContentType = ADMIN_UPLOAD_CONTRACTS.audio.extensions[extension];
  if (!expectedContentType) {
    return NextResponse.json({ error: "Unsupported master format" }, { status: 400 });
  }

  let object;
  try {
    object = await getR2ObjectMetadata(key);
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
  if (object.contentLength !== size) {
    await deleteR2Object(key).catch(() => {});
    return NextResponse.json({ error: "Uploaded master failed byte-length validation" }, { status: 422 });
  }
  if (String(object.contentType || "").toLowerCase() !== expectedContentType.toLowerCase()) {
    await deleteR2Object(key).catch(() => {});
    return NextResponse.json({ error: "Uploaded master failed content-type validation" }, { status: 422 });
  }

  const destKey = canonicalAudioKey({
    folder: target.releaseType,
    releaseSlug: target.releaseSlug,
    trackSlug: target.trackSlug,
    extWithDot,
  });

  try {
    await copyR2Object(key, destKey);
  } catch (error) {
    console.error("[replace-master] R2 copy to canonical key failed", error?.message);
    return NextResponse.json(
      { error: "Could not move the new master into canonical storage; the active master is unchanged" },
      { status: 500 }
    );
  }

  try {
    if (target.entityKind === "track") {
      const { error } = await admin
        .from("tracks")
        .update({ audio_r2_key: destKey, master_r2_key: destKey })
        .eq("id", target.entityId);
      if (error) throw error;
    } else if (target.entityKind === "catalog_track") {
      const { error } = await mergeMetadataAudioKey(admin, "catalog_tracks", "id", target.entityId, destKey);
      if (error) throw error;
    } else if (target.entityKind === "product") {
      const { error } = await mergeMetadataAudioKey(admin, "products", "id", target.entityId, destKey);
      if (error) throw error;
    }
  } catch (error) {
    console.error("[replace-master] pointer update failed", error?.message);
    return NextResponse.json(
      { error: "The new master is stored but could not be committed; please retry" },
      { status: 500 }
    );
  }

  // Best-effort cleanup — the pointer already moved, so a leftover file here
  // is unused storage, not a correctness problem.
  if (target.previousMasterKey && target.previousMasterKey !== destKey) {
    await deleteR2Object(target.previousMasterKey).catch(() => {});
  }
  await deleteR2Object(key).catch(() => {});

  await invalidateAudioCacheAndRequeueTranscode({
    admin,
    slug: target.releaseSlug,
    trackSlug: target.trackSlug,
    releaseType: target.releaseType,
    sourceKey: destKey,
    queuedBy: auth.user.id,
  });

  if (target.isPublic) {
    revalidateStorefront(target.releaseSlug);
  }

  return NextResponse.json({ replacementId, status: "active", key: destKey });
}

/** Cancel a staged upload that was never committed. */
export async function DELETE(req) {
  const auth = await authorize(req, "admin.releases.replace-master.cancel", 20);
  if (auth.response) return auth.response;
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  await deleteR2Object(key).catch(() => {});
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { completeMultipartUpload, abortMultipartUpload } from "@/lib/storage/r2-multipart";
import { headR2ObjectKey } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { folderForCategory, ACCESS_TIERS } from "@/lib/vault/vault-upload-contract";
import {
  validateVaultAudioMaster,
  audioExtensionForFilename,
} from "@/lib/vault/vault-audio-contract";
import {
  submitVaultAudioJob,
  VaultAudioJobConflict,
  VaultAudioIdentityCollision,
} from "@/lib/vault/submit-vault-audio-job";

export const dynamic = "force-dynamic";

/**
 * Seals the master upload, records the vault item, then queues the transcode.
 *
 * Order matters. The row is written before the job is queued so a worker can
 * never complete a manifest for a slug that has no item behind it. And the
 * item is a draft: an upload finishing is not the artist deciding it is ready,
 * and transcoding takes minutes anyway.
 *
 * duration_seconds is left to the worker's manifest rather than trusted from
 * the browser -- the client's number comes from a decoder that may have only
 * read part of the file, and the encoder measures the real thing.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.audio.complete",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    category,
    slug,
    filename,
    size,
    title,
    description = "",
    accessTier = "vault_pass",
    uploadId = null,
    parts = null,
  } = body || {};

  if (!folderForCategory(category)) {
    return NextResponse.json({ error: "Unknown vault section" }, { status: 400 });
  }
  if (!String(title || "").trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!ACCESS_TIERS.includes(accessTier)) {
    return NextResponse.json({ error: "Invalid accessTier" }, { status: 400 });
  }

  const checked = validateVaultAudioMaster({ category, slug, filename, size });
  if (checked.error) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const { key } = checked;

  // Seal first: an unsealed multipart upload is billable storage that no
  // object listing will ever show.
  if (uploadId) {
    if (!Array.isArray(parts) || !parts.length) {
      await abortMultipartUpload(key, uploadId).catch(() => {});
      return NextResponse.json({ error: "Missing parts for multipart upload" }, { status: 400 });
    }
    try {
      await completeMultipartUpload(key, uploadId, parts);
    } catch (err) {
      console.error("vault audio multipart complete failed:", err);
      await abortMultipartUpload(key, uploadId).catch(() => {});
      return NextResponse.json({ error: "Upload could not be finalised" }, { status: 500 });
    }
  }

  // Trust storage, not the client.
  let head;
  try {
    head = await headR2ObjectKey(key);
  } catch (err) {
    console.error("vault audio head failed:", err);
    return NextResponse.json({ error: "Could not verify upload" }, { status: 500 });
  }
  if (!head || !head.ContentLength) {
    return NextResponse.json({ error: "Upload not found in storage" }, { status: 409 });
  }

  const admin = getAdminClient();
  const { data: item, error } = await admin
    .from("vault_content")
    .upsert(
      {
        slug,
        category,
        title: String(title).trim(),
        description: String(description || ""),
        media_type: "audio",
        access_tier: accessTier,
        media_storage_path: key,
        visibility: "draft",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" }
    )
    .select("id, slug, category, title, visibility, media_storage_path")
    .maybeSingle();

  if (error) {
    console.error("vault_content audio upsert failed:", error);
    return NextResponse.json({ error: "Could not save the vault entry" }, { status: 500 });
  }

  // Queue the encode. The row already exists, so a failure here leaves a
  // playable-on-request draft rather than an orphan -- recoverable by
  // re-queueing, which is why this reports the reason instead of rolling back.
  let job;
  try {
    job = await submitVaultAudioJob({
      admin,
      category,
      slug,
      sourceKey: key,
      queuedBy: user.id,
    });
  } catch (err) {
    if (err instanceof VaultAudioIdentityCollision || err instanceof VaultAudioJobConflict) {
      return NextResponse.json(
        { error: err.message, item, queued: false },
        { status: err.status || 409 }
      );
    }
    console.error("vault audio job submit failed:", err);
    return NextResponse.json(
      { error: "Uploaded, but could not queue transcoding", item, queued: false },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    item,
    queued: true,
    job: { id: job.id, status: job.status, hlsPrefix: job.hls_prefix, reused: Boolean(job.reused) },
    bytes: head.ContentLength,
  });
}

import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { completeMultipartUpload, abortMultipartUpload } from "@/lib/storage/r2-multipart";
import { headR2ObjectKey } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  folderForCategory,
  buildVaultKey,
  extensionForFilename,
  VAULT_SLUG_RE,
  MEDIA_TYPES,
  ACCESS_TIERS,
} from "@/lib/vault/vault-upload-contract";

export const dynamic = "force-dynamic";

/**
 * Seals the multipart upload if there was one, confirms the object really
 * landed, then records the row.
 *
 * Rows are created as drafts. Publishing is a separate, deliberate act --
 * an upload finishing is not the same as an artist deciding the thing is
 * ready, and the Vault is the last place to surface something by accident.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.complete",
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
    title,
    description = "",
    mediaType = "video",
    accessTier = "vault_pass",
    durationSeconds = null,
    uploadId = null,
    parts = null,
  } = body || {};

  if (!folderForCategory(category)) {
    return NextResponse.json({ error: "Unknown vault section" }, { status: 400 });
  }
  if (!VAULT_SLUG_RE.test(String(slug || ""))) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }
  if (!String(title || "").trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!MEDIA_TYPES.includes(mediaType)) {
    return NextResponse.json({ error: "Invalid mediaType" }, { status: 400 });
  }
  if (!ACCESS_TIERS.includes(accessTier)) {
    return NextResponse.json({ error: "Invalid accessTier" }, { status: 400 });
  }

  const key = buildVaultKey({ category, slug, ext: extensionForFilename(filename) });
  if (!key) {
    return NextResponse.json({ error: "Could not build storage key" }, { status: 400 });
  }

  // Seal the multipart upload before anything else -- an unsealed upload is
  // billable storage that no object listing will ever show.
  if (uploadId) {
    if (!Array.isArray(parts) || !parts.length) {
      await abortMultipartUpload(key, uploadId).catch(() => {});
      return NextResponse.json({ error: "Missing parts for multipart upload" }, { status: 400 });
    }
    try {
      await completeMultipartUpload(key, uploadId, parts);
    } catch (err) {
      console.error("vault multipart complete failed:", err);
      await abortMultipartUpload(key, uploadId).catch(() => {});
      return NextResponse.json({ error: "Upload could not be finalised" }, { status: 500 });
    }
  }

  // Trust the storage, not the client: only record a row once the object is
  // actually there and has a non-zero size.
  let head;
  try {
    head = await headR2ObjectKey(key);
  } catch (err) {
    console.error("vault head failed:", err);
    return NextResponse.json({ error: "Could not verify upload" }, { status: 500 });
  }
  if (!head || !head.ContentLength) {
    return NextResponse.json({ error: "Upload not found in storage" }, { status: 409 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("vault_content")
    .upsert(
      {
        slug,
        category,
        title: String(title).trim(),
        description: String(description || ""),
        media_type: mediaType,
        access_tier: accessTier,
        media_storage_path: key,
        duration_seconds: durationSeconds ? Math.round(Number(durationSeconds)) : null,
        visibility: "draft",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" }
    )
    .select("id, slug, category, title, visibility, media_storage_path")
    .maybeSingle();

  if (error) {
    console.error("vault_content upsert failed:", error);
    return NextResponse.json({ error: "Could not save the vault entry" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data, bytes: head.ContentLength });
}

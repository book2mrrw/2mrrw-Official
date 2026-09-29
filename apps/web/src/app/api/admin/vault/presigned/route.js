import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { createR2SignedPutUrl } from "@/lib/storage/r2";
import { createMultipartUpload, getMultipartPartUploadUrl } from "@/lib/storage/r2-multipart";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  validateUploadRequest,
  MULTIPART_THRESHOLD_BYTES,
} from "@/lib/vault/vault-upload-contract";

export const dynamic = "force-dynamic";

const PART_SIZE = 16_000_000;

/**
 * Hands back a signed URL so the browser uploads straight to R2. The file
 * never passes through this server -- the release pipeline works the same
 * way, and it is the only shape that survives a multi-gigabyte phone video
 * without tying up a Next process for the duration.
 *
 * Entirely separate from /api/admin/upload/*: that route is keyed on release
 * types and writes to tracks/releases. This one only ever touches
 * videos/vault/** and vault_content.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.presigned",
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

  const { category, slug, filename, mimeType, size } = body || {};
  const checked = validateUploadRequest({ category, slug, filename, mimeType, size });
  if (checked.error) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  const { key, kind, bytes } = checked;
  const contentType = mimeType || "application/octet-stream";

  try {
    // Small enough for one PUT.
    if (bytes < MULTIPART_THRESHOLD_BYTES) {
      const url = await createR2SignedPutUrl(key, contentType, 900);
      return NextResponse.json({ mode: "single", key, kind, url });
    }

    // Large: hand back a part URL per chunk so the browser can upload in
    // pieces and retry an individual part instead of the whole file.
    const uploadId = await createMultipartUpload(key, contentType);
    const partCount = Math.ceil(bytes / PART_SIZE);
    const parts = [];
    for (let n = 1; n <= partCount; n += 1) {
      parts.push({ partNumber: n, url: await getMultipartPartUploadUrl(key, uploadId, n, 3600) });
    }
    return NextResponse.json({
      mode: "multipart",
      key,
      kind,
      uploadId,
      partSize: PART_SIZE,
      parts,
    });
  } catch (err) {
    console.error("vault presign error:", err);
    return NextResponse.json({ error: "Could not prepare upload" }, { status: 500 });
  }
}

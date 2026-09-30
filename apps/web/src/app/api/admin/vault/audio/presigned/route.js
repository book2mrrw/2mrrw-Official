import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { createR2SignedPutUrl } from "@/lib/storage/r2";
import { createMultipartUpload, getMultipartPartUploadUrl } from "@/lib/storage/r2-multipart";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  validateVaultAudioMaster,
  VAULT_AUDIO_MULTIPART_THRESHOLD_BYTES,
} from "@/lib/vault/vault-audio-contract";

export const dynamic = "force-dynamic";

const PART_SIZE = 16_000_000;

/**
 * Signed PUT (or multipart part URLs) for a vault audio master.
 *
 * The master goes browser -> R2 directly, never through this server: a
 * lossless hour of audio would otherwise occupy a Next process for the whole
 * upload. Same shape as the vault video path next door, and entirely separate
 * from /api/admin/upload/* -- nothing here can write a release key.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.audio.presigned",
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

  const { category, slug, filename, size } = body || {};
  const checked = validateVaultAudioMaster({ category, slug, filename, size });
  if (checked.error) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  const { key, bytes, contentType, lossless } = checked;

  try {
    if (bytes < VAULT_AUDIO_MULTIPART_THRESHOLD_BYTES) {
      const url = await createR2SignedPutUrl(key, contentType, 900);
      return NextResponse.json({ mode: "single", key, contentType, lossless, url });
    }

    const uploadId = await createMultipartUpload(key, contentType);
    const partCount = Math.ceil(bytes / PART_SIZE);
    const parts = [];
    for (let n = 1; n <= partCount; n += 1) {
      parts.push({ partNumber: n, url: await getMultipartPartUploadUrl(key, uploadId, n, 3600) });
    }
    return NextResponse.json({
      mode: "multipart",
      key,
      contentType,
      lossless,
      uploadId,
      partSize: PART_SIZE,
      parts,
    });
  } catch (err) {
    console.error("vault audio presign error:", err);
    return NextResponse.json({ error: "Could not prepare upload" }, { status: 500 });
  }
}

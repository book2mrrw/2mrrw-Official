import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
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
  const gate = await requireAdminActor({ recentSeconds: 15 * 60 });
  if (!gate.ok) {
    const denial = classifyAdminAuthorityDenial(gate.reason);
    return NextResponse.json(
      { error: denial.status === 401 ? "Unauthorized" : "Forbidden", code: denial.code },
      { status: denial.status }
    );
  }
  const user = gate.user;

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

    // No DB row for the staged upload — commit re-derives the target from
    // (releaseId, trackId) the same way this route just did, and verifies the
    // staged key against a freshly recomputed expected path (see route.js).
    // A stale/concurrent staged file left in R2 under a one-shot revisionId
    // is harmless: nothing ever reads a staging key unless a matching commit
    // request names it, and commit deletes it once consumed.
    const revisionId = crypto.randomUUID();
    const { stagedMasterKey } = buildMasterRevisionKeys({
      folder: target.releaseType,
      releaseSlug: target.releaseSlug,
      trackSlug: target.trackSlug,
      revisionId,
      extension,
    });

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
    const status = error instanceof MasterRevisionTargetError ? error.status : 500;
    console.error("[replace-master/stage]", error?.message);
    return NextResponse.json(
      { error: status === 500 ? "Could not stage master replacement" : error.message },
      { status }
    );
  }
}

import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { createR2SignedPutUrl } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { validateSectionCover } from "@/lib/vault/vault-upload-contract";

export const dynamic = "force-dynamic";

/**
 * Signed PUT for a section's cover. Covers are capped well below the
 * multipart threshold -- a pod cover is a still or a few seconds of loop, not
 * a feature -- so this is always a single PUT.
 *
 * Unsupported formats are refused here rather than accepted and left to fail
 * silently in the browser; the contract returns the reason and what to export
 * instead.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.section-cover.presigned",
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

  const { category, filename, size } = body || {};
  const checked = validateSectionCover({ category, filename, size });
  if (checked.error) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  try {
    const url = await createR2SignedPutUrl(checked.key, checked.contentType, 600);
    return NextResponse.json({ key: checked.key, kind: checked.kind, contentType: checked.contentType, url });
  } catch (err) {
    console.error("vault section cover presign error:", err);
    return NextResponse.json({ error: "Could not prepare upload" }, { status: 500 });
  }
}

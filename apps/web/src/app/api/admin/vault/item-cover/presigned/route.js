import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { createR2SignedPutUrl } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { validateItemCover } from "@/lib/vault/vault-upload-contract";

export const dynamic = "force-dynamic";

/**
 * Signed PUT for one item's card art.
 *
 * Always a single PUT: a still capped at 20MB never approaches the multipart
 * threshold, and a cover upload that needed chunking would mean something
 * went in that should not have.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.item-cover.presigned",
    limit: 40,
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
  const checked = validateItemCover({ category, slug, filename, size });
  if (checked.error) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  try {
    const url = await createR2SignedPutUrl(checked.key, checked.contentType, 600);
    return NextResponse.json({ key: checked.key, contentType: checked.contentType, url });
  } catch (err) {
    console.error("vault item cover presign error:", err);
    return NextResponse.json({ error: "Could not prepare upload" }, { status: 500 });
  }
}

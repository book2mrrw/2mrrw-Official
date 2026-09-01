import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { createR2SignedPutUrl } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { ADMIN_UPLOAD_CONTRACTS, extensionForFilename } from "@/lib/media/admin-upload-contract";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const RELEASE_TYPE_FOLDERS = {
  single:  "singles",
  feature: "features",
  album:   "albums",
  ep:      "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
};

const RELEASE_TYPE_ALIASES = {
  ...RELEASE_TYPE_FOLDERS,
  singles: "singles",
  features: "features",
  albums: "albums",
  "mixtapes-and-eps": "mixtapes-and-eps",
};

function buildR2Key(releaseType, slug, assetType, filename, trackSlug) {
  const folder = RELEASE_TYPE_ALIASES[releaseType];
  if (!folder) return null;

  const ext = (filename || "").split(".").pop().toLowerCase() || "wav";

  switch (assetType) {
    case "audio":
      if (trackSlug) return `digital-assets/${folder}/${slug}/${trackSlug}/${trackSlug}.${ext}`;
      return `digital-assets/${folder}/${slug}/${slug}.${ext}`;
    case "cover":
      return `images/${folder}/${slug}/${slug}.${ext}`;
    case "cover-video":
      return `videos/${folder}/${slug}/${slug}.${ext}`;
    case "preview":
      if (trackSlug) return `previews/${folder}/${slug}/${trackSlug}/${trackSlug}-preview.${ext}`;
      return `previews/${folder}/${slug}/${slug}-preview.${ext}`;
    default:
      return null;
  }
}

export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.upload.presigned",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { releaseType, slug, assetType, filename, size, trackSlug, releaseId, revisioned } = body;

  // Validate release type
  if (!RELEASE_TYPE_ALIASES[releaseType]) {
    return NextResponse.json({ error: "Invalid releaseType" }, { status: 400 });
  }

  // Validate slug (path traversal protection)
  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: "Invalid slug — must be lowercase alphanumeric with hyphens" }, { status: 400 });
  }
  if (trackSlug && !SLUG_RE.test(trackSlug)) {
    return NextResponse.json({ error: "Invalid trackSlug" }, { status: 400 });
  }

  // Validate asset type
  const assetConfig = ADMIN_UPLOAD_CONTRACTS[assetType];
  if (!assetConfig) {
    return NextResponse.json({ error: `Invalid assetType — must be one of: ${Object.keys(ADMIN_UPLOAD_CONTRACTS).join(", ")}` }, { status: 400 });
  }

  // Resolve the canonical Content-Type from the filename extension — this is the
  // single source of truth for what gets signed into the PUT URL and is echoed
  // back to the client below, so the header the browser sends can never drift
  // from what R2 verifies the signature against.
  const extMap = assetConfig.extensions;
  const fileExt = extensionForFilename(filename);
  const contentType = extMap[fileExt];
  if (!contentType) {
    const allowed = Object.keys(extMap).map((e) => `.${e}`).join(", ");
    return NextResponse.json({ error: `Unsupported file extension ".${fileExt}" for ${assetType} — expected one of: ${allowed}` }, { status: 400 });
  }

  // Validate file size
  if (!Number.isSafeInteger(size) || size <= 0) {
    return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
  }
  if (size > assetConfig.maxBytes) {
    const mb = Math.round(assetConfig.maxBytes / 1_000_000);
    return NextResponse.json({ error: `File too large — max ${mb}MB for ${assetType}` }, { status: 400 });
  }

  let key = buildR2Key(releaseType, slug, assetType, filename, trackSlug);
  if (revisioned === true) {
    if (!releaseId || !["cover", "cover-video"].includes(assetType)) {
      return NextResponse.json({ error: "Versioned replacement requires a release and visual asset" }, { status: 400 });
    }
    const admin = getAdminClient();
    const { data: release } = await admin
      .from("releases")
      .select("id, slug, release_type")
      .eq("id", releaseId)
      .maybeSingle();
    const { data: product } = release ? { data: null } : await admin
      .from("products")
      .select("id, slug, release_type, product_type")
      .eq("id", releaseId)
      .maybeSingle();
    const authoritativeSlug = release?.slug || product?.slug;
    const authoritativeType = release?.release_type || product?.release_type || product?.product_type;
    const folder = RELEASE_TYPE_ALIASES[authoritativeType];
    if (!authoritativeSlug || !folder) {
      return NextResponse.json({ error: "Release not found for versioned upload" }, { status: 404 });
    }
    const revisionId = crypto.randomUUID();
    const root = assetType === "cover" ? "images" : "videos";
    const stem = assetType === "cover" ? "cover" : "motion";
    key = `${root}/${folder}/${authoritativeSlug}/revisions/${revisionId}/${stem}.${fileExt}`;
  }
  if (!key) {
    return NextResponse.json({ error: "Could not build R2 key" }, { status: 400 });
  }

  try {
    const uploadUrl = await createR2SignedPutUrl(key, contentType, assetConfig.expiresIn);
    const expiresAt = new Date(Date.now() + assetConfig.expiresIn * 1000).toISOString();

    console.info(`[admin/upload/presigned] user=${user.id} key=${key} type=${assetType}`);

    return NextResponse.json({ uploadUrl, key, contentType, expiresAt });
  } catch (err) {
    console.error("[admin/upload/presigned] R2 presign error", err?.message);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}

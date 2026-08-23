import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { createR2SignedPutUrl } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const ASSET_CONFIGS = {
  audio:       { maxBytes: 2_000_000_000, expiresIn: 900 },
  cover:       { maxBytes:    20_000_000, expiresIn: 600 },
  "cover-mp4": { maxBytes:   500_000_000, expiresIn: 900 },
  preview:     { maxBytes:    50_000_000, expiresIn: 600 },
};

// Single source of truth for Content-Type: derived from the filename extension,
// never trusted from the client. R2 signs Content-Type into the presigned PUT URL,
// so whatever is resolved here MUST be exactly what the client sends back on the
// PUT — the presign response echoes it for that reason (see uploadUrl response).
const EXTENSION_CONTENT_TYPES = {
  audio: { wav: "audio/wav", wave: "audio/wav", flac: "audio/flac", aiff: "audio/aiff", aif: "audio/aiff" },
  cover: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" },
  "cover-mp4": { mp4: "video/mp4" },
  preview: { mp3: "audio/mpeg", wav: "audio/wav" },
};

const RELEASE_TYPE_FOLDERS = {
  single:  "singles",
  feature: "features",
  album:   "albums",
  ep:      "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
};

function buildR2Key(releaseType, slug, assetType, filename, trackSlug) {
  const folder = RELEASE_TYPE_FOLDERS[releaseType];
  if (!folder) return null;

  const ext = (filename || "").split(".").pop().toLowerCase() || "wav";

  switch (assetType) {
    case "audio":
      if (trackSlug) return `digital-assets/${folder}/${slug}/${trackSlug}/${trackSlug}.${ext}`;
      return `digital-assets/${folder}/${slug}/${slug}.${ext}`;
    case "cover":
      return `images/${folder}/${slug}/${slug}.${ext}`;
    case "cover-mp4":
      return `videos/${folder}/${slug}/${slug}.mp4`;
    case "preview":
      if (trackSlug) return `previews/${folder}/${slug}/${trackSlug}/${trackSlug}-preview.${ext}`;
      return `previews/${folder}/${slug}/${slug}-preview.${ext}`;
    default:
      return null;
  }
}

export async function POST(req) {
  const user = await getFanSessionUser();
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

  const { releaseType, slug, assetType, filename, size, trackSlug } = body;

  // Validate release type
  if (!RELEASE_TYPE_FOLDERS[releaseType]) {
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
  const assetConfig = ASSET_CONFIGS[assetType];
  if (!assetConfig) {
    return NextResponse.json({ error: `Invalid assetType — must be one of: ${Object.keys(ASSET_CONFIGS).join(", ")}` }, { status: 400 });
  }

  // Resolve the canonical Content-Type from the filename extension — this is the
  // single source of truth for what gets signed into the PUT URL and is echoed
  // back to the client below, so the header the browser sends can never drift
  // from what R2 verifies the signature against.
  const extMap = EXTENSION_CONTENT_TYPES[assetType] || {};
  const fileExt = (filename || "").split(".").pop()?.toLowerCase() || "";
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

  const key = buildR2Key(releaseType, slug, assetType, filename, trackSlug);
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

/**
 * POST /api/admin/audio-visual/upload/presigned
 *
 * Audio Visualz's own, fully separate presign route — deliberately NOT a
 * branch inside src/app/api/admin/upload/presigned/route.js. That route is
 * structurally release/track-shaped (releaseType/slug/trackSlug) and must
 * never be edited for this feature. Same isolation as derive-key.js/
 * video-token.js: a separate sibling implementation.
 *
 * The R2 path is derived authoritatively from the audio_visuals row itself
 * (slug, video_type, and its Seriez attachment if any) — never trusted from
 * the client — via src/lib/audio-visual/r2-paths.js's confirmed convention:
 * "2MRRW Studios/{Content-Type Folder}/{slug}/..." or, for an episode,
 * ".../Seriez/{seriezSlug}/{episodeSlug}/...".
 */
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { createR2SignedPutUrl } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { ADMIN_UPLOAD_CONTRACTS, extensionForFilename } from "@/lib/media/admin-upload-contract";
import { audioVisualR2FolderPath } from "@/lib/audio-visual/r2-paths";

export const dynamic = "force-dynamic";

const VIDEO_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ASSET_TYPES = new Set(["av-cover", "av-cover-video", "av-master"]);

const FILE_BASENAME = {
  "av-cover": "poster",
  "av-cover-video": "motion-cover",
};

export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.audio-visual.upload.presigned",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { videoId, assetType, filename, size } = body;

  if (!videoId || !VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ error: "Invalid videoId — must be a real audio_visuals UUID" }, { status: 400 });
  }
  if (!ASSET_TYPES.has(assetType)) {
    return NextResponse.json({ error: `Invalid assetType — must be one of: ${[...ASSET_TYPES].join(", ")}` }, { status: 400 });
  }

  const assetConfig = ADMIN_UPLOAD_CONTRACTS[assetType];
  const extMap = assetConfig.extensions;
  const fileExt = extensionForFilename(filename);
  const contentType = extMap[fileExt];
  if (!contentType) {
    const allowed = Object.keys(extMap).map((e) => `.${e}`).join(", ");
    return NextResponse.json({ error: `Unsupported file extension ".${fileExt}" for ${assetType} — expected one of: ${allowed}` }, { status: 400 });
  }

  if (!Number.isSafeInteger(size) || size <= 0) {
    return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
  }
  if (size > assetConfig.maxBytes) {
    const mb = Math.round(assetConfig.maxBytes / 1_000_000);
    return NextResponse.json({ error: `File too large — max ${mb}MB for ${assetType}` }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: video, error: videoErr } = await admin
    .from("audio_visuals")
    .select("slug, video_type, seriez_id")
    .eq("id", videoId)
    .maybeSingle();
  if (videoErr) {
    console.error("[admin/audio-visual/upload/presigned] video lookup error", videoErr.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!video) {
    return NextResponse.json({ error: "Video not found — create the draft first via /api/admin/audio-visual/draft" }, { status: 404 });
  }

  let seriezSlug = null;
  if (video.seriez_id) {
    const { data: seriez } = await admin.from("audio_visual_seriez").select("slug").eq("id", video.seriez_id).maybeSingle();
    seriezSlug = seriez?.slug || null;
  }

  let folder;
  try {
    folder = audioVisualR2FolderPath({
      videoType: video.video_type,
      slug: video.slug,
      seriezSlug,
      episodeSlug: seriezSlug ? video.slug : null,
    });
  } catch (err) {
    console.error("[admin/audio-visual/upload/presigned] path build error", err.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const ext = fileExt || "bin";
  const key = assetType === "av-master"
    // Timestamp-suffixed: createAssetVersion() always inserts a new row
    // rather than overwriting (see publication-authority.js), so a
    // "replace master" re-upload must never collide with the R2 object an
    // existing, currently-serving version still points at.
    ? `${folder}master-${Date.now()}.${ext}`
    : `${folder}${FILE_BASENAME[assetType]}.${ext}`;

  try {
    const uploadUrl = await createR2SignedPutUrl(key, contentType, assetConfig.expiresIn);
    const expiresAt = new Date(Date.now() + assetConfig.expiresIn * 1000).toISOString();

    console.info(`[admin/audio-visual/upload/presigned] user=${user.id} key=${key} type=${assetType}`);

    return NextResponse.json({ uploadUrl, key, contentType, expiresAt });
  } catch (err) {
    console.error("[admin/audio-visual/upload/presigned] R2 presign error", err?.message);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}

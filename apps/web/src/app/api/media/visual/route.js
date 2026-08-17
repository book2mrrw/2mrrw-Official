import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { resolveVisualMedia } from "@/lib/media/entity-resolver";
import { normalizeToEntityFolder, getArtworkPlaceholderUrl } from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { catalogCoverUrl } from "@/lib/media-urls";

export const dynamic = "force-dynamic";

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

/**
 * Resolve cover/loop visual: video entity folder first, then images/ fallback.
 * ?releaseType=single&slug=hour-glass
 * ?videoFolder=videos/singles/hour-glass/&imageFolder=images/singles/hour-glass/
 * ?meta=1 — JSON { type, url, key, source } instead of redirect
 */
export async function GET(req) {
  const { searchParams } = req.nextUrl;
  const releaseType = normalizeReleaseType(searchParams.get("releaseType") || "single");
  const slug = searchParams.get("slug") || "";
  const trackSlug = searchParams.get("trackSlug") || undefined;
  const albumSlug = searchParams.get("albumSlug") || undefined;
  const legacyVideo = searchParams.get("legacyVideo") || undefined;
  const legacyImage = searchParams.get("legacyImage") || undefined;
  const videoFolder = normalizeToEntityFolder(searchParams.get("videoFolder") || "");
  const imageFolder = normalizeToEntityFolder(searchParams.get("imageFolder") || "");
  const meta = searchParams.get("meta") === "1" || searchParams.get("format") === "json";

  if (!slug && !videoFolder && !imageFolder && !legacyVideo && !legacyImage) {
    return applyMediaCors(
      req,
      NextResponse.json(
        { error: "slug or videoFolder/imageFolder required" },
        { status: 400 }
      )
    );
  }

  let resolved = null;
  try {
    resolved = await resolveVisualMedia(releaseType, slug, trackSlug, {
      albumSlug,
      legacyVideo,
      legacyImage,
      videoFolder: videoFolder || undefined,
      imageFolder: imageFolder || undefined,
    });
  } catch (err) {
    console.error("[media/visual] discovery failed", {
      releaseType,
      slug,
      message: err?.message,
    });
  }

  if (!resolved?.url) {
    const placeholderUrl = catalogCoverUrl(
      getArtworkPlaceholderUrl(releaseType, slug || "placeholder").replace(/^\//, "")
    );
    resolved = { type: "image", key: null, url: placeholderUrl, source: "placeholder" };
  }

  if (meta) {
    // JSON meta response: directly cacheable by CDN (Cloudflare honors s-maxage on JSON 200s).
    // Prefer ?meta=1 over the 302 redirect path — 302s are not reliably cached by CDN proxies.
    return applyMediaCors(
      req,
      NextResponse.json(resolved, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400, max-age=300",
        },
      })
    );
  }

  return applyMediaCors(
    req,
    NextResponse.redirect(resolved.url, {
      status: 302,
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        "X-Media-Type": resolved.type,
      },
    })
  );
}

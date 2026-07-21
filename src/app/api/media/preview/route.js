import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { getPublicR2Url } from "@/lib/storage/r2";
import {
  resolveArtwork,
  resolvePreviewFile,
  resolveVideo,
  resolveWithLegacyFallback,
} from "@/lib/media/entity-resolver";
import { getCanonicalReleaseBySlug } from "@/lib/media/canonical-catalog";
import { extractSlugFromFlatPreviewKey, normalizeToEntityFolder } from "@/lib/media/canonical-paths";
import { resolveConcretePreviewR2Key } from "@/lib/media/resolve-concrete-preview-key";
import { createServerTiming } from "@/lib/server/server-timing";
import {
  getOrResolvePreviewMedia,
  previewCacheKey,
} from "@/lib/playback/preview-resolution-cache";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

function previewLegacyCandidates(entityFolder, legacy) {
  const candidates = [];
  if (legacy) candidates.push(String(legacy).replace(/^\//, ""));
  const folderSlug = String(entityFolder || "").match(
    /\/(singles|features|albums|mixtapes-and-eps)\/([^/]+)\/?$/
  )?.[2];
  const slug =
    folderSlug || extractSlugFromFlatPreviewKey(legacy) || extractSlugFromFlatPreviewKey(entityFolder);
  const canonical = slug ? getCanonicalReleaseBySlug(slug) : null;
  if (canonical?.preview_legacy) candidates.push(String(canonical.preview_legacy).replace(/^\//, ""));
  if (canonical?.legacy_preview_stem) {
    const ext = canonical.preview_ext || "wav";
    candidates.push(`previews/${canonical.legacy_preview_stem}-preview.${ext}`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

function tryCanonicalPreviewFastPath(entityFolder, legacyCandidates) {
  for (const legacy of legacyCandidates) {
    const key = resolveConcretePreviewR2Key({ entityFolder, legacyKey: legacy });
    if (key) return { key, source: "canonical_fast" };
  }
  const key = resolveConcretePreviewR2Key({ entityFolder });
  if (key) return { key, source: "canonical_fast" };
  return null;
}

function previewRedirectResponse(req, key, timing) {
  const publicUrl = getPublicR2Url(key);
  timing?.mark("redirect");
  return applyMediaCors(
    req,
    timing.apply(
      NextResponse.redirect(publicUrl, {
        status: 302,
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        },
      })
    )
  );
}

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

/**
 * Resolve public CDN media from entity folder (previews, artwork, video loops).
 * Supports legacy flat keys via ?legacy= during migration.
 */
export async function GET(req) {
  const rl = await checkRateLimit(req, {
    routeKey: "media.preview",
    limit: 60,
    windowSeconds: 60,
  });
  if (!rl.allowed) return applyMediaCors(req, rateLimitResponse(rl.retryAfterSeconds));

  const timing = createServerTiming("preview");
  const folder = req.nextUrl.searchParams.get("folder");
  const legacy = req.nextUrl.searchParams.get("legacy");
  const type = req.nextUrl.searchParams.get("type") || "preview";

  if (!folder && !legacy) {
    return applyMediaCors(
      req,
      timing.apply(NextResponse.json({ error: "folder or legacy required" }, { status: 400 }))
    );
  }

  const entityFolder = normalizeToEntityFolder(folder || "");
  const legacyCandidates =
    type === "preview" || type === "artwork"
      ? previewLegacyCandidates(entityFolder, legacy)
      : legacy
        ? [String(legacy).replace(/^\//, "")]
        : [];

  if (type === "preview") {
    const fastPath = tryCanonicalPreviewFastPath(entityFolder, legacyCandidates);
    timing.mark("fastpath");
    if (fastPath?.key) {
      return previewRedirectResponse(req, fastPath.key, timing);
    }
  }

  const cacheKey = previewCacheKey(entityFolder, type, legacyCandidates.join("|"));
  let resolved = null;

  try {
    resolved = await getOrResolvePreviewMedia(cacheKey, async () => {
      if (type === "video") {
        return resolveWithLegacyFallback(entityFolder, legacyCandidates, resolveVideo);
      }
      if (type === "artwork") {
        return resolveWithLegacyFallback(entityFolder, legacyCandidates, resolveArtwork);
      }
      return resolveWithLegacyFallback(entityFolder, legacyCandidates, resolvePreviewFile);
    });
  } catch (err) {
    console.error("[media/preview] discovery failed", {
      folder: entityFolder,
      legacy,
      type,
      message: err?.message,
    });
  }

  timing.mark("resolve", resolved?.cacheHit ? "cache_hit" : undefined);
  if (!resolved?.key) {
    return applyMediaCors(
      req,
      timing.apply(NextResponse.json({ error: "Media not found" }, { status: 404 }))
    );
  }

  return previewRedirectResponse(req, resolved.key, timing);
}

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

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

/**
 * Resolve public CDN media from entity folder (previews, artwork, video loops).
 * Supports legacy flat keys via ?legacy= during migration.
 */
export async function GET(req) {
  const folder = req.nextUrl.searchParams.get("folder");
  const legacy = req.nextUrl.searchParams.get("legacy");
  const type = req.nextUrl.searchParams.get("type") || "preview";

  if (!folder && !legacy) {
    return applyMediaCors(
      req,
      NextResponse.json({ error: "folder or legacy required" }, { status: 400 })
    );
  }

  const entityFolder = normalizeToEntityFolder(folder || "");
  const legacyCandidates =
    type === "preview" || type === "artwork"
      ? previewLegacyCandidates(entityFolder, legacy)
      : legacy
        ? [String(legacy).replace(/^\//, "")]
        : [];
  let resolved = null;

  try {
    if (type === "video") {
      resolved = await resolveWithLegacyFallback(entityFolder, legacyCandidates, resolveVideo);
    } else if (type === "artwork") {
      resolved = await resolveWithLegacyFallback(entityFolder, legacyCandidates, resolveArtwork);
    } else {
      resolved = await resolveWithLegacyFallback(entityFolder, legacyCandidates, resolvePreviewFile);
    }
  } catch (err) {
    console.error("[media/preview] discovery failed", {
      folder: entityFolder,
      legacy,
      type,
      message: err?.message,
    });
  }

  if (!resolved?.key) {
    return applyMediaCors(req, NextResponse.json({ error: "Media not found" }, { status: 404 }));
  }

  const publicUrl = getPublicR2Url(resolved.key);
  return applyMediaCors(
    req,
    NextResponse.redirect(publicUrl, {
      status: 302,
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      },
    })
  );
}

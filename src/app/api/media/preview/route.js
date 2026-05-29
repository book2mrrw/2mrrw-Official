import { NextResponse } from "next/server";
import { getPublicR2Url } from "@/lib/storage/r2";
import {
  resolveArtwork,
  resolvePreviewFile,
  resolveVideo,
  resolveWithLegacyFallback,
} from "@/lib/media/entity-resolver";
import { normalizeToEntityFolder } from "@/lib/media/canonical-paths";

export const dynamic = "force-dynamic";

/**
 * Resolve public CDN media from entity folder (previews, artwork, video loops).
 * Supports legacy flat keys via ?legacy= during migration.
 */
export async function GET(req) {
  const folder = req.nextUrl.searchParams.get("folder");
  const legacy = req.nextUrl.searchParams.get("legacy");
  const type = req.nextUrl.searchParams.get("type") || "preview";

  if (!folder && !legacy) {
    return NextResponse.json({ error: "folder or legacy required" }, { status: 400 });
  }

  const entityFolder = normalizeToEntityFolder(folder || "");
  let resolved = null;

  try {
    if (type === "video") {
      resolved = await resolveWithLegacyFallback(entityFolder, legacy, resolveVideo);
    } else if (type === "artwork") {
      resolved = await resolveWithLegacyFallback(entityFolder, legacy, resolveArtwork);
    } else {
      resolved = await resolveWithLegacyFallback(entityFolder, legacy, resolvePreviewFile);
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
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const publicUrl = getPublicR2Url(resolved.key);
  return NextResponse.redirect(publicUrl, {
    status: 302,
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}

import { NextResponse } from "next/server";
import { getLatestControlSystemSingles, getControlSystemAlbums } from "@/lib/control-system/releases";
import { logRestoredTitleSource } from "@/lib/diagnostics/playback-trace";
import { RECOVERY_PLACEHOLDER_TITLE } from "@/lib/playback/resolve-player-display-title";
function toPlaybackShape(item) {
  if (!item?.slug) return null;
  const src =
    item.preview ||
    item.audio ||
    item.src ||
    `/api/library/stream?slug=${encodeURIComponent(item.slug)}`;
  return {
    id: item.id || item.slug,
    slug: item.slug,
    title: item.title || item.slug,
    artist: item.artist || "2MRRW",
    cover: item.cover || item.coverArt || null,
    coverArtType: item.coverArtType || (item.video ? "video" : "image"),
    src,
    preview: item.preview,
    source: "recovery-hydration",
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("ids") || "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    return NextResponse.json({ tracks: [], hydratedCount: 0, failedIds: [] });
  }

  try {
    const [singles, albums] = await Promise.all([
      getLatestControlSystemSingles({ limit: 200 }),
      getControlSystemAlbums({ limit: 100 }),
    ]);

    const bySlug = new Map();
    [...singles, ...albums].forEach((item) => {
      if (item?.slug) bySlug.set(item.slug, item);
      (item?.tracks || []).forEach((t) => {
        const slug = t.slug || t.id;
        if (slug) bySlug.set(slug, { ...t, slug, cover: t.cover || item.cover });
      });
    });

    const tracks = [];
    const failedIds = [];
    ids.forEach((id) => {
      const hit = bySlug.get(id);
      const shaped = hit
        ? toPlaybackShape(hit)
        : (() => {
            logRestoredTitleSource({
              source: "catalog/hydrate",
              slug: id,
              trackId: id,
              title: RECOVERY_PLACEHOLDER_TITLE,
              extra: { path: "control-system-miss" },
            });
            return toPlaybackShape({ slug: id, title: RECOVERY_PLACEHOLDER_TITLE });
          })();
      if (shaped?.title && shaped?.src && shaped.title !== id) {
        tracks.push(shaped);
      } else if (shaped) {
        tracks.push(shaped);
        if (!hit) failedIds.push(id);
      } else {
        failedIds.push(id);
      }
    });

    const hydratedCount = tracks.filter(
      (t) => t.title && t.title !== RECOVERY_PLACEHOLDER_TITLE && t.cover
    ).length;

    return NextResponse.json({ tracks, hydratedCount, failedIds });
  } catch {
    const tracks = ids
      .map((id) => {
        logRestoredTitleSource({
          source: "catalog/hydrate",
          slug: id,
          trackId: id,
          title: RECOVERY_PLACEHOLDER_TITLE,
          extra: { path: "catch-fallback" },
        });
        return toPlaybackShape({ slug: id, title: RECOVERY_PLACEHOLDER_TITLE });
      })
      .filter(Boolean);
    return NextResponse.json({
      tracks,
      hydratedCount: 0,
      failedIds: ids,
      fallback: true,
    });
  }
}

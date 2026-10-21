import { NextResponse } from "next/server";
import { getStorefrontCatalogFromDB } from "@/lib/media/catalog-db";

const HEADERS = { "Cache-Control": "private, no-store" };
export const dynamic = "force-dynamic";

function toPlaybackShape(item) {
  if (!item?.slug) return null;
  return {
    ...item,
    id: item.id || item.slug,
    slug: item.slug,
    title: item.title || item.slug,
    artist: item.artist || "2MRRW",
    cover: item.baseCover || item.cover || item.coverArt || null,
    coverArtType: item.baseCover ? "image" : (item.coverArtType || "image"),
    src: item.preview || item.audio || item.src || `/api/library/stream?${new URLSearchParams({ slug: item.albumSlug || item.slug, ...(item.albumSlug ? { trackSlug: item.slug } : {}) })}`,
    source: "recovery-hydration",
  };
}

// Recovery is a catalog read, not permission to manufacture a release from a
// saved identifier. Unknown/deleted references remain missing; a failed database
// read cannot fall through to the independent Control System or a bundled row.
export async function GET(request) {
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") || "")
    .split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 200);
  if (!ids.length) return NextResponse.json({ tracks: [], hydratedCount: 0, failedIds: [] }, { headers: HEADERS });
  try {
    const catalog = await getStorefrontCatalogFromDB();
    if (!catalog) throw new Error("catalog_unavailable");
    const byId = new Map();
    for (const release of [...catalog.singles, ...catalog.features, ...catalog.albums, ...catalog.mixtapes]) {
      for (const id of [release.slug, release.id].filter(Boolean)) byId.set(id, release);
      for (const track of release.tracks || []) {
        const value = { ...track, albumSlug: release.slug, cover: track.cover || release.baseCover || release.cover };
        // Bare track slugs are not globally unique. Do not resolve an ambiguous
        // cached identifier to the wrong album's recording.
        for (const id of [track.slug, track.id].filter(Boolean)) {
          byId.set(id, byId.has(id) ? null : value);
        }
      }
    }
    const tracks = [], failedIds = [];
    for (const id of ids) {
      const value = toPlaybackShape(byId.get(id));
      if (value) tracks.push(value);
      else failedIds.push(id);
    }
    return NextResponse.json({ tracks, hydratedCount: tracks.length, failedIds }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "catalog_unavailable", tracks: [], hydratedCount: 0, failedIds: ids },
      { status: 503, headers: HEADERS });
  }
}

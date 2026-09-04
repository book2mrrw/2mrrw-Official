import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { visualDiscoveryUrl } from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";

const PRODUCT_COLS_FOR_COVER =
  "id, slug, title, product_type, cover_url, video_path, image_path, release_type, metadata";

/**
 * Resolves a product's real cover art.
 *
 * Traced against the actual publish route (api/admin/releases/[id]/publish):
 * cover art is verified to exist in R2 (a real HEAD check) before a release
 * can publish at all, then canonicalized to images/{typeFolder}/{slug}/{slug}.ext,
 * and products.cover_url is written as exactly visualDiscoveryUrl(typeFolder,
 * slug, {}) — i.e. cover_url IS ALREADY the correct, publish-time-verified
 * discovery URL for every release published through that flow.
 *
 * This function used to recompute that same URL itself instead of trusting
 * the stored value — same discovery endpoint, but a second, independent
 * computation with different inputs (it also threaded legacyVideo/legacyImage
 * params the publish route never used) is a real drift risk with no upside,
 * since the correct answer was already sitting in the row. Now: trust
 * cover_url directly whenever it's present, and only fall back to recomputing
 * via discovery for legacy rows published before that flow existed, where
 * cover_url was never populated at all.
 */
function resolveCoverUrl(row) {
  if (row.cover_url) return row.cover_url;

  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const releaseTypeFolder =
    row.release_type ||
    normalizeReleaseType(meta.release_type || meta.release_category || row.product_type) ||
    "singles";
  const legacyCover = row.image_path || meta.legacy_cover || null;
  const legacyVideo = meta.animated_cover_r2_key || (meta.legacy_video_stem
    ? `videos/${releaseTypeFolder}/${row.slug}/${meta.legacy_video_stem}.mp4`
    : null);
  return visualDiscoveryUrl(releaseTypeFolder, row.slug, {
    legacyVideo: legacyVideo || undefined,
    legacyImage: legacyCover || undefined,
  }) || null;
}

export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.analytics",
    limit: 10,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [playStatsResult, trackPlayStatsResult, libraryResult, purchasesResult, productsResult, profilesResult, playEventsResult] = await Promise.all([
    admin.rpc("get_play_stats", { since: ninetyDaysAgo }),
    admin.rpc("get_track_play_stats", { since: ninetyDaysAgo }),
    admin.from("library_items").select("product_id, source, products(slug, title, cover_url)").eq("source", "purchase").limit(10000),
    admin.from("purchases").select("items, status, amount_cents").eq("status", "completed").gte("created_at", ninetyDaysAgo).limit(5000),
    admin.from("products").select(PRODUCT_COLS_FOR_COVER).in("product_type", ["single", "feature", "album"]).limit(1000),
    admin.from("profiles").select("id, gender, age_range, city, state, country, created_at, role").limit(50000),
    admin.from("media_stream_events").select("user_id, created_at").eq("event_type", "play").not("user_id", "is", null).limit(100000),
  ]);

  // A "fan" is a registered profile who has streamed at least once — not
  // merely signed up. Every demographic/geography count below, and totalFans
  // itself, is scoped to this; previously every profile counted regardless
  // of activity, inflating every number here with accounts that never
  // listened to anything.
  const streamedUserIds = new Set((playEventsResult.data || []).map((e) => e.user_id));
  const firstPlayMonthByUser = new Map();
  for (const e of playEventsResult.data || []) {
    const existing = firstPlayMonthByUser.get(e.user_id);
    if (!existing || e.created_at < existing) firstPlayMonthByUser.set(e.user_id, e.created_at);
  }

  // ─── Play stats ───────────────────────────────────────────────────────────
  const playStats = {};
  for (const row of playStatsResult.data || []) {
    playStats[row.product_slug] = {
      plays: Number(row.plays) || 0,
      completionTotal: Number(row.avg_completion) || 0,
      completionCount: row.avg_completion != null ? 1 : 0,
    };
  }

  // ─── Purchase counts + revenue ────────────────────────────────────────────
  const purchaseCounts = {};
  let totalRevenueCents = 0;
  for (const p of purchasesResult.data || []) {
    totalRevenueCents += Number(p.amount_cents || 0);
    for (const item of Array.isArray(p.items) ? p.items : []) {
      const slug = item.slug || item.product_slug;
      if (slug) purchaseCounts[slug] = (purchaseCounts[slug] || 0) + 1;
    }
  }

  // ─── Listener counts ──────────────────────────────────────────────────────
  const listenerCounts = {};
  for (const row of libraryResult.data || []) {
    const slug = row.products?.slug;
    if (slug) listenerCounts[slug] = (listenerCounts[slug] || 0) + 1;
  }

  // ─── Tracks: one row per actual song, not per release ──────────────────────
  // Singles/features ARE their own song — one product row, one track row.
  // Albums/EPs/mixtapes are a tracklist: get_play_stats groups by product_slug,
  // which for these is each individual catalog_tracks.slug, not the album's own
  // slug — so an album's own product row always showed zero plays here before.
  // Each song now gets its own row instead, using get_track_play_stats (P1),
  // which groups by (product_id, track_slug) precisely for this reason, with
  // the parent release's own resolved cover art (resolveCoverUrl above —
  // real R2 discovery, not the raw cover_url column, which is frequently
  // unset for releases uploaded through the modern pipeline).
  const products = productsResult.data || [];
  const albumProducts = products.filter((p) => p.product_type === "album");
  const albumProductIds = albumProducts.map((p) => p.id);

  const catalogTracksResult = albumProductIds.length
    ? await admin
        .from("catalog_tracks")
        .select("product_id, slug, title, position")
        .in("product_id", albumProductIds)
        .order("position", { ascending: true })
    : { data: [] };
  const songsByProductId = new Map();
  for (const song of catalogTracksResult.data || []) {
    if (!songsByProductId.has(song.product_id)) songsByProductId.set(song.product_id, []);
    songsByProductId.get(song.product_id).push(song);
  }

  const trackPlayStats = {};
  for (const row of trackPlayStatsResult.data || []) {
    trackPlayStats[`${row.product_id}:${row.track_slug}`] = {
      plays: Number(row.plays) || 0,
      avgCompletion: row.avg_completion != null ? Number(row.avg_completion) : null,
    };
  }

  const tracks = [];
  for (const p of products) {
    if (p.product_type === "album") continue; // replaced by its individual songs below
    const stats = playStats[p.slug] || { plays: 0, completionTotal: 0, completionCount: 0 };
    tracks.push({
      slug: p.slug,
      title: p.title,
      coverUrl: resolveCoverUrl(p),
      plays: stats.plays,
      purchases: purchaseCounts[p.slug] || 0,
      listeners: listenerCounts[p.slug] || 0,
      completionRate: stats.completionCount > 0 ? Math.round(stats.completionTotal * 100) : null,
    });
  }
  for (const album of albumProducts) {
    const coverUrl = resolveCoverUrl(album);
    // Owning the album grants every song in it — purchases/listeners are the
    // album's own counts, shared across its songs, same as real access works.
    const purchases = purchaseCounts[album.slug] || 0;
    const listeners = listenerCounts[album.slug] || 0;
    for (const song of songsByProductId.get(album.id) || []) {
      const stat = trackPlayStats[`${album.id}:${song.slug}`];
      tracks.push({
        slug: `${album.slug}:${song.slug}`,
        title: song.title,
        coverUrl,
        plays: stat?.plays || 0,
        purchases,
        listeners,
        completionRate: stat?.avgCompletion != null ? Math.round(stat.avgCompletion * 100) : null,
      });
    }
  }
  tracks.sort((a, b) => b.plays - a.plays);

  const totals = tracks.reduce(
    (acc, t) => ({ plays: acc.plays + t.plays, purchases: acc.purchases + t.purchases }),
    { plays: 0, purchases: 0 }
  );

  // ─── Demographics + geography (streamed-at-least-once fans only) ──────────
  const profiles = (profilesResult.data || []).filter((p) => streamedUserIds.has(p.id));
  const gender = { male: 0, female: 0, unknown: 0 };
  const ageRange = { "18-25": 0, "25-40": 0, "40-65": 0, unknown: 0 };
  const stateCounts = {};
  const cityCounts = {};
  const countryCounts = {};
  const monthCounts = {};
  let fansWithDemographics = 0;

  for (const p of profiles) {
    if (p.gender === "male") gender.male++;
    else if (p.gender === "female") gender.female++;
    else gender.unknown++;

    if (["18-25", "25-40", "40-65"].includes(p.age_range)) ageRange[p.age_range]++;
    else ageRange.unknown++;

    if (p.gender && p.age_range) fansWithDemographics++;

    if (p.state) {
      const s = p.state.toUpperCase().trim();
      stateCounts[s] = (stateCounts[s] || 0) + 1;
    }
    if (p.city) {
      const s = (p.state || "").toUpperCase().trim();
      const key = `${p.city.trim()}|${s}`;
      cityCounts[key] = (cityCounts[key] || 0) + 1;
    }
    if (p.country) {
      const c = p.country.trim();
      countryCounts[c] = (countryCounts[c] || 0) + 1;
    }
  }

  // Fan growth by month is keyed by first-play month, not signup month —
  // consistent with "fan" meaning "streamed," not "signed up."
  for (const iso of firstPlayMonthByUser.values()) {
    const m = iso.slice(0, 7);
    monthCounts[m] = (monthCounts[m] || 0) + 1;
  }

  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([state, count]) => ({ state, count }));

  const topCities = Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([key, count]) => {
      const [city, state] = key.split("|");
      return { city, state, count };
    });

  const topCountries = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 50)
    .map(([country, count]) => ({ country, count }));

  // Rolling 12-month fan growth
  const now = new Date();
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { month: key, newFans: monthCounts[key] || 0 };
  });

  const totalFans = profiles.length;

  return NextResponse.json({
    tracks,
    totals,
    overview: {
      totalFans,
      totalPlays: totals.plays,
      totalPurchases: purchasesResult.data?.length || 0,
      totalRevenueCents,
      fansWithDemographics,
      demographicsCoverage: totalFans > 0 ? Math.round((fansWithDemographics / totalFans) * 100) : 0,
    },
    demographics: { gender, ageRange },
    geography: { topStates, topCities, topCountries },
    growth: { monthly },
  }, {
    // No caching — every KPI/track row here must reflect the current DB
    // state on every load, never a browser-cached snapshot.
    headers: { "Cache-Control": "private, no-store, must-revalidate" },
  });
}

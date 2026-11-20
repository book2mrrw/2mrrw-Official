import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { visualDiscoveryUrl } from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";
import { ARTIST_TIME_ZONE, analyticsRange, isMissingFunction } from "@/lib/analytics/range";
import { buildAnalyticsOverview } from "@/lib/analytics/overview-report";

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

/**
 * Account-panel analytics: Overview, Audience and Tracks tabs.
 *
 * Every listening number comes from the analytics_* SQL functions
 * (migration 20261119220000_analytics_metrics_v2), the single tested
 * definition shared with the other analytics routes. Lifetime by default;
 * ?range=7d|30d|90d|365d|all or ?since=&until= narrows it.
 */
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

  const range = analyticsRange(new URL(req.url).searchParams);
  const window = { p_from: range.from, p_to: range.to };
  const admin = getAdminClient();

  let purchasesQuery = admin.from("purchases")
    .select("items, status, amount_cents, purchase_type, purchased_at")
    // A refunded sale is still a sale in its own period; refunds are separate.
    .in("status", ["completed", "refunded"]);
  if (range.from) purchasesQuery = purchasesQuery.gte("purchased_at", range.from);
  if (range.to) purchasesQuery = purchasesQuery.lt("purchased_at", range.to);

  const [overviewRes, tracksRes, growthRes, demographicsRes, purchasesRes, productsRes, revenueRes, platformsRes] = await Promise.all([
    admin.rpc("analytics_overview", window).maybeSingle(),
    admin.rpc("analytics_track_stats", window),
    admin.rpc("analytics_listener_growth", { p_tz: ARTIST_TIME_ZONE }),
    admin.rpc("analytics_fan_demographics", window),
    purchasesQuery.limit(10000),
    admin.from("products").select(PRODUCT_COLS_FOR_COVER).in("product_type", ["single", "feature", "album"]).limit(1000),
    admin.rpc("analytics_revenue_summary", window).maybeSingle(),
    admin.rpc("analytics_platform_breakdown", window),
  ]);

  // The revenue ledger function arrives with migration 20261119230000; until
  // then revenue falls back to completed purchases instead of failing.
  const ledgerMissing = isMissingFunction(revenueRes.error);
  // Platform breakdown arrives with migration 20261119240000.
  const platformsMissing = isMissingFunction(platformsRes.error);
  const failed = [overviewRes, tracksRes, growthRes, demographicsRes, purchasesRes, productsRes, ledgerMissing ? {} : revenueRes, platformsMissing ? {} : platformsRes].find((r) => r.error);
  if (failed) {
    console.error("[admin/analytics] query failed:", failed.error?.message);
    return NextResponse.json({ error: "Analytics query failed" }, { status: 500 });
  }

  const products = productsRes.data || [];
  const albumIds = products.filter((p) => p.product_type === "album").map((p) => p.id);
  const songsRes = albumIds.length
    ? await admin.from("catalog_tracks").select("product_id, slug, title, position").in("product_id", albumIds).order("position", { ascending: true })
    : { data: [] };

  const report = buildAnalyticsOverview({
    overview: overviewRes.data,
    trackStats: tracksRes.data || [],
    growth: growthRes.data || [],
    demographics: demographicsRes.data || [],
    purchases: purchasesRes.data || [],
    revenue: ledgerMissing ? null : revenueRes.data,
    platforms: platformsMissing ? [] : platformsRes.data || [],
    products: products.map((p) => ({ ...p, coverUrl: resolveCoverUrl(p) })),
    songs: songsRes.data || [],
    range,
  });

  return NextResponse.json(report, {
    // No caching — every KPI/track row here must reflect the current DB
    // state on every load, never a browser-cached snapshot.
    headers: { "Cache-Control": "private, no-store, must-revalidate" },
  });
}

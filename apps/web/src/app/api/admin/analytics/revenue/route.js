import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { analyticsRange, sinceOrEpoch } from "@/lib/analytics/range";

export const dynamic = "force-dynamic";

/**
 * P1 revenue/subscription analytics. Deliberately a separate route from
 * /api/admin/analytics (which never touches purchase_items, catalog_tracks,
 * or memberships) rather than folding this into it, so the existing route's
 * response shape and callers are completely unaffected.
 */
export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.analytics.revenue",
    limit: 10,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();
  // Lifetime by default (?range= / ?since=&until= narrow it).
  const range = analyticsRange(new URL(req.url).searchParams);

  const [releaseRevenueResult, trackPlayResult, subscriptionResult] = await Promise.all([
    admin.rpc("get_release_revenue_stats", { since: sinceOrEpoch(range) }),
    admin.rpc("analytics_track_stats", { p_from: range.from, p_to: range.to }),
    admin.rpc("get_subscription_stats").maybeSingle(),
  ]);

  const releases = (releaseRevenueResult.data || []).map((row) => ({
    productId: row.product_id,
    slug: row.product_slug,
    title: row.title,
    releaseId: row.release_id,
    grossCents: Number(row.gross_cents) || 0,
    itemsSold: Number(row.items_sold) || 0,
  }));

  // Same song definition as the Tracks tab (analytics_track_stats):
  // completion = completes / plays, admins and previews excluded.
  const tracks = (trackPlayResult.data || []).map((row) => ({
    productId: row.product_id,
    slug: row.song_slug || row.release_slug,
    title: row.title,
    albumSlug: row.release_type === "album" ? row.release_slug : null,
    plays: Number(row.plays) || 0,
    qualifiedPlays: Number(row.qualified_plays) || 0,
    listeners: Number(row.listeners) || 0,
    completionRate: row.completion_rate != null ? Math.round(Number(row.completion_rate) * 100) : null,
  }));

  const subscriptionRow = subscriptionResult.data;

  const subscriptions = {
    activeCount: Number(subscriptionRow?.active_count) || 0,
    trialingCount: Number(subscriptionRow?.trialing_count) || 0,
    pastDueCount: Number(subscriptionRow?.past_due_count) || 0,
    canceledLast30d: Number(subscriptionRow?.canceled_last_30d) || 0,
    mrrCents: Number(subscriptionRow?.mrr_cents) || 0,
  };

  const totalGrossCents = releases.reduce((sum, r) => sum + r.grossCents, 0);

  return NextResponse.json({
    releases,
    tracks,
    subscriptions,
    overview: { totalGrossCents, releaseCount: releases.length },
  }, {
    headers: { "Cache-Control": "private, no-store, must-revalidate" },
  });
}

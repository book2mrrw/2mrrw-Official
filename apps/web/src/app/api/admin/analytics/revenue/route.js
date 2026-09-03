import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

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
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [releaseRevenueResult, trackPlayResult, subscriptionResult] = await Promise.all([
    admin.rpc("get_release_revenue_stats", { since: ninetyDaysAgo }),
    admin.rpc("get_track_play_stats", { since: ninetyDaysAgo }),
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

  const tracks = (trackPlayResult.data || []).map((row) => ({
    productId: row.product_id,
    slug: row.track_slug,
    title: row.display_title,
    albumSlug: row.album_slug,
    plays: Number(row.plays) || 0,
    completionRate: row.avg_completion != null ? Math.round(Number(row.avg_completion) * 100) : null,
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
    headers: { "Cache-Control": "private, max-age=120" },
  });
}

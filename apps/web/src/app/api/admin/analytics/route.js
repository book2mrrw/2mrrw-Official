import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await getFanSessionUser();
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

  // Bound purchase queries to the last 90 days so the payload stays manageable.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [playStatsResult, libraryResult, purchasesResult, productsResult] = await Promise.all([
    // DB-level GROUP BY via RPC — returns one row per slug instead of 10k individual events.
    admin.rpc("get_play_stats", { since: ninetyDaysAgo }),
    admin
      .from("library_items")
      .select("product_id, source, products(slug, title, cover_url)")
      .eq("source", "purchase")
      .limit(10000),
    admin
      .from("purchases")
      .select("items, status")
      .eq("status", "completed")
      .gte("created_at", ninetyDaysAgo)
      .limit(5000),
    admin
      .from("products")
      .select("slug, title, cover_url")
      .order("title")
      .limit(1000),
  ]);

  // RPC already aggregated — build the stats map directly from the grouped result.
  const playStats = {};
  for (const row of playStatsResult.data || []) {
    playStats[row.product_slug] = {
      plays: Number(row.plays) || 0,
      completionTotal: Number(row.avg_completion) || 0,
      completionCount: row.avg_completion != null ? 1 : 0,
    };
  }

  // Purchase counts from purchases.items JSON
  const purchaseCounts = {};
  for (const p of purchasesResult.data || []) {
    const items = Array.isArray(p.items) ? p.items : [];
    for (const item of items) {
      const slug = item.slug || item.product_slug;
      if (slug) purchaseCounts[slug] = (purchaseCounts[slug] || 0) + 1;
    }
  }

  // Unique listener counts from library_items (purchases only)
  const listenerCounts = {};
  for (const row of libraryResult.data || []) {
    const slug = row.products?.slug;
    if (slug) listenerCounts[slug] = (listenerCounts[slug] || 0) + 1;
  }

  // Build per-track stats using products as the source of truth
  const tracks = (productsResult.data || []).map((p) => {
    const stats = playStats[p.slug] || { plays: 0, completionTotal: 0, completionCount: 0 };
    return {
      slug: p.slug,
      title: p.title,
      coverUrl: p.cover_url || null,
      plays: stats.plays,
      purchases: purchaseCounts[p.slug] || 0,
      listeners: listenerCounts[p.slug] || 0,
      completionRate: stats.completionCount > 0
        ? Math.round(stats.completionTotal * 100)
        : null,
    };
  }).sort((a, b) => b.plays - a.plays);

  const totals = tracks.reduce(
    (acc, t) => ({ plays: acc.plays + t.plays, purchases: acc.purchases + t.purchases }),
    { plays: 0, purchases: 0 }
  );

  return NextResponse.json({ tracks, totals }, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}

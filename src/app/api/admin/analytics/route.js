import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const admin = createAdminClient();

  // Bound play-event and purchase queries to the last 90 days so the payload stays
  // manageable as the platform ages, while keeping analytics meaningful and current.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [playEventsResult, libraryResult, purchasesResult, productsResult] = await Promise.all([
    admin
      .from("media_stream_events")
      .select("product_slug, completion_rate")
      .eq("event_type", "play")
      .gte("created_at", ninetyDaysAgo)
      .limit(10000),
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

  // Aggregate play counts + avg completion per slug
  const playStats = {};
  for (const row of playEventsResult.data || []) {
    const s = row.product_slug;
    if (!s) continue;
    if (!playStats[s]) playStats[s] = { plays: 0, completionTotal: 0, completionCount: 0 };
    playStats[s].plays++;
    if (row.completion_rate != null) {
      playStats[s].completionTotal += Number(row.completion_rate);
      playStats[s].completionCount++;
    }
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
        ? Math.round((stats.completionTotal / stats.completionCount) * 100)
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

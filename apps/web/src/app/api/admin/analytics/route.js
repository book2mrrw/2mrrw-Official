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
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [playStatsResult, libraryResult, purchasesResult, productsResult, profilesResult] = await Promise.all([
    admin.rpc("get_play_stats", { since: ninetyDaysAgo }),
    admin.from("library_items").select("product_id, source, products(slug, title, cover_url)").eq("source", "purchase").limit(10000),
    admin.from("purchases").select("items, status, amount_cents").eq("status", "completed").gte("created_at", ninetyDaysAgo).limit(5000),
    admin.from("products").select("slug, title, cover_url").order("title").limit(1000),
    admin.from("profiles").select("gender, age_range, city, state, created_at, role").limit(50000),
  ]);

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

  // ─── Tracks ───────────────────────────────────────────────────────────────
  const tracks = (productsResult.data || []).map((p) => {
    const stats = playStats[p.slug] || { plays: 0, completionTotal: 0, completionCount: 0 };
    return {
      slug: p.slug, title: p.title, coverUrl: p.cover_url || null,
      plays: stats.plays, purchases: purchaseCounts[p.slug] || 0,
      listeners: listenerCounts[p.slug] || 0,
      completionRate: stats.completionCount > 0 ? Math.round(stats.completionTotal * 100) : null,
    };
  }).sort((a, b) => b.plays - a.plays);

  const totals = tracks.reduce(
    (acc, t) => ({ plays: acc.plays + t.plays, purchases: acc.purchases + t.purchases }),
    { plays: 0, purchases: 0 }
  );

  // ─── Demographics + geography ─────────────────────────────────────────────
  const profiles = profilesResult.data || [];
  const gender = { male: 0, female: 0, unknown: 0 };
  const ageRange = { "18-25": 0, "25-40": 0, "40-65": 0, unknown: 0 };
  const stateCounts = {};
  const cityCounts = {};
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
    if (p.created_at) {
      const m = p.created_at.slice(0, 7);
      monthCounts[m] = (monthCounts[m] || 0) + 1;
    }
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
    geography: { topStates, topCities },
    growth: { monthly },
  }, {
    headers: { "Cache-Control": "private, max-age=120" },
  });
}

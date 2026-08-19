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
    routeKey: "admin.analytics.global",
    limit: 10,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();

  const [profilesResult, streamsResult, purchasesResult] = await Promise.all([
    admin
      .from("profiles")
      .select("city, state, country, gender, age_range, created_at")
      .limit(100000),
    admin
      .from("media_stream_events")
      .select("country, city, event_type, created_at")
      .not("country", "is", null)
      .in("event_type", ["play", "complete"])
      .limit(100000),
    admin
      .from("purchases")
      .select("user_id, amount_cents, status, created_at")
      .eq("status", "completed")
      .limit(50000),
  ]);

  const profiles = profilesResult.data || [];
  const streams = streamsResult.data || [];
  const purchases = purchasesResult.data || [];

  // ─── Fan aggregation by country + city ────────────────────────────────────
  const fansByCountry = {};
  const fansByCity = {};
  const monthCounts = {};

  for (const p of profiles) {
    if (p.created_at) {
      const m = p.created_at.slice(0, 7);
      monthCounts[m] = (monthCounts[m] || 0) + 1;
    }

    if (!p.country) continue;
    const country = p.country.trim();

    if (!fansByCountry[country]) {
      fansByCountry[country] = { fans: 0, male: 0, female: 0, ages: {} };
    }
    fansByCountry[country].fans++;
    if (p.gender === "male") fansByCountry[country].male++;
    else if (p.gender === "female") fansByCountry[country].female++;
    if (p.age_range) {
      fansByCountry[country].ages[p.age_range] = (fansByCountry[country].ages[p.age_range] || 0) + 1;
    }

    if (!p.city) continue;
    const cityKey = `${p.city.trim()}|${(p.state || "").trim()}|${country}`;
    if (!fansByCity[cityKey]) {
      fansByCity[cityKey] = { city: p.city.trim(), state: (p.state || "").trim(), country, fans: 0 };
    }
    fansByCity[cityKey].fans++;
  }

  // ─── Stream aggregation by country (ISO alpha-2) ──────────────────────────
  const streamsByCode = {};
  const recentStreamsByCode = {};
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const s of streams) {
    if (!s.country) continue;
    streamsByCode[s.country] = (streamsByCode[s.country] || 0) + 1;
    if (s.created_at >= thirtyDaysAgo) {
      recentStreamsByCode[s.country] = (recentStreamsByCode[s.country] || 0) + 1;
    }
  }

  // ─── Monthly fan growth (12 months) ──────────────────────────────────────
  const now = new Date();
  const monthly_growth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { month: key, fans: monthCounts[key] || 0 };
  });

  // ─── Format output ────────────────────────────────────────────────────────
  const fans_by_country = Object.entries(fansByCountry)
    .sort((a, b) => b[1].fans - a[1].fans)
    .map(([country, d]) => ({
      country,
      fans: d.fans,
      male: d.male,
      female: d.female,
      ages: d.ages,
    }));

  const fans_by_city = Object.values(fansByCity)
    .sort((a, b) => b.fans - a.fans)
    .slice(0, 600);

  const uniqueCountries = Object.keys(fansByCountry).length;
  const uniqueCities = Object.keys(fansByCity).length;
  const totalFans = profiles.length;
  const totalStreams = streams.length;

  return NextResponse.json(
    {
      overview: { total_fans: totalFans, unique_countries: uniqueCountries, unique_cities: uniqueCities, total_streams: totalStreams },
      fans_by_country,
      fans_by_city,
      streams_by_code: streamsByCode,
      recent_streams_by_code: recentStreamsByCode,
      monthly_growth,
    },
    { headers: { "Cache-Control": "private, max-age=180" } }
  );
}

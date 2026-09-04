import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { NAME_TO_A2, A2_TO_NAME } from "@/lib/geo/country-codes";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const GROWTH_WINDOW_MS = 30 * DAY_MS;

function parseDateParam(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A country's stable identity across both data sources: its ISO alpha-2 code
 * when resolvable, else its raw display name (unmapped countries still get a
 * row, same as before this rewrite — they just never join with an a2 code). */
function countryIdentity(displayName) {
  return NAME_TO_A2[displayName] || displayName;
}

function cityKey(city, state, country) {
  return `${city}|${state || ""}|${country}`;
}

function emptyCountryBucket() {
  return { fans: 0, streams: 0, revenueCents: 0, male: 0, female: 0, ages: {} };
}

class Aggregator {
  constructor() {
    this.countries = new Map();
    this.cities = new Map();
  }
  country(identity, displayName, a2) {
    if (!this.countries.has(identity)) {
      this.countries.set(identity, { country: displayName, a2, ...emptyCountryBucket() });
    }
    return this.countries.get(identity);
  }
  city(key, meta) {
    if (!this.cities.has(key)) {
      this.cities.set(key, { ...meta, fans: 0, streams: 0, revenueCents: 0, latSum: 0, lngSum: 0, geoCount: 0 });
    }
    return this.cities.get(key);
  }
}

function finalizeCities(agg) {
  return [...agg.cities.values()]
    .map(({ latSum, lngSum, geoCount, ...rest }) => ({
      ...rest,
      lat: geoCount > 0 ? latSum / geoCount : null,
      lng: geoCount > 0 ? lngSum / geoCount : null,
    }))
    .sort((a, b) => b.fans - a.fans)
    .slice(0, 600);
}

function inRange(iso, start, end) {
  if (!iso) return false;
  if (start && iso < start.toISOString()) return false;
  if (end && iso > end.toISOString()) return false;
  return true;
}

/**
 * Global Analytics data source. Replaces the old fans_by_country (keyed by
 * country display name) + streams_by_code (keyed by ISO alpha-2) split — that
 * split existed only because fans came from profiles.country (free text) and
 * streams from media_stream_events.country (already an ISO code), forcing
 * every consumer to carry a NAME_TO_A2 translation table just to compare the
 * two. by_country here is one array, one row per country, every metric
 * present on it — fans, streams, and (newly) revenue, attributed via the
 * buyer's own profile since purchases carries no location of its own.
 *
 * since/until (optional, ISO date strings) scope the "current" totals used by
 * the DOTS/HEAT map views; omitted, behavior is exactly the previous all-time
 * default. GROWTH mode is intentionally independent of that range — it is
 * always the last 30 days vs. the 30 days before that, matching the map's
 * pre-existing "30-Day Growth" label.
 *
 * "Fan" = a registered profile who has streamed at least once — not merely
 * signed up. Every count here (by_country/by_city fans, overview.total_fans,
 * monthly_growth) is scoped to that, by WHEN the streaming happened (not
 * signup date), so since/until genuinely filters who counts as active.
 */
export async function GET(req) {
  const user = await getAdminSessionUser();
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

  const url = new URL(req.url);
  const since = parseDateParam(url.searchParams.get("since"));
  const until = parseDateParam(url.searchParams.get("until"));

  const now = new Date();
  const growthCurrentStart = new Date(now.getTime() - GROWTH_WINDOW_MS);
  const growthPrevStart = new Date(growthCurrentStart.getTime() - GROWTH_WINDOW_MS);

  const admin = getAdminClient();

  const [profilesResult, streamsResult, purchasesResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id, city, state, country, gender, age_range, created_at, geo_lat, geo_lng")
      .limit(100000),
    admin
      .from("media_stream_events")
      .select("user_id, country, region, city, event_type, created_at")
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
  const profileByUserId = new Map(profiles.map((p) => [p.id, p]));

  // A "fan" is a registered profile who has streamed at least once — not
  // merely signed up. Previously every profile counted as a fan regardless
  // of activity, inflating every number on this map with dead accounts.
  // Scoped by WHEN the streaming happened (not signup date), so the
  // since/until range answers "how many fans were active in this window,"
  // and growth reflects real 30d-vs-prior-30d activity (a user active in
  // both windows counts in both — that's a retained fan, not a contradiction).
  const playEvents = streams.filter((s) => s.event_type === "play" && s.user_id);
  const streamedInWindow = new Set(
    playEvents.filter((s) => (!since && !until) || inRange(s.created_at, since, until)).map((s) => s.user_id)
  );
  const streamedInGrowthCurrent = new Set(
    playEvents.filter((s) => inRange(s.created_at, growthCurrentStart, now)).map((s) => s.user_id)
  );
  const streamedInGrowthPrev = new Set(
    playEvents.filter((s) => inRange(s.created_at, growthPrevStart, growthCurrentStart)).map((s) => s.user_id)
  );
  const firstPlayMonthByUser = new Map();
  for (const s of playEvents) {
    const existing = firstPlayMonthByUser.get(s.user_id);
    if (!existing || s.created_at < existing) firstPlayMonthByUser.set(s.user_id, s.created_at);
  }

  const currentAgg = new Aggregator();
  const growthCurrentAgg = new Aggregator();
  const growthPrevAgg = new Aggregator();
  const monthCounts = {};

  // ─── Fans (streamed at least once) ─────────────────────────────────────
  for (const iso of firstPlayMonthByUser.values()) {
    const m = iso.slice(0, 7);
    monthCounts[m] = (monthCounts[m] || 0) + 1;
  }

  for (const p of profiles) {
    if (!p.country) continue;

    const displayName = p.country.trim();
    const identity = countryIdentity(displayName);
    const a2 = NAME_TO_A2[displayName] || null;
    const cKey = p.city ? cityKey(p.city.trim(), (p.state || "").trim(), displayName) : null;
    const cMeta = p.city ? { city: p.city.trim(), state: (p.state || "").trim(), country: displayName } : null;

    const apply = (agg) => {
      const c = agg.country(identity, displayName, a2);
      c.fans++;
      if (p.gender === "male") c.male++;
      else if (p.gender === "female") c.female++;
      if (p.age_range) c.ages[p.age_range] = (c.ages[p.age_range] || 0) + 1;
      if (cKey) {
        const cty = agg.city(cKey, cMeta);
        cty.fans++;
        if (p.geo_lat != null && p.geo_lng != null) {
          cty.latSum += Number(p.geo_lat);
          cty.lngSum += Number(p.geo_lng);
          cty.geoCount++;
        }
      }
    };

    if (streamedInWindow.has(p.id)) apply(currentAgg);
    if (streamedInGrowthCurrent.has(p.id)) apply(growthCurrentAgg);
    if (streamedInGrowthPrev.has(p.id)) apply(growthPrevAgg);
  }

  // ─── Streams (media_stream_events.country is already an ISO alpha-2 code) ──
  for (const s of streams) {
    if (!s.country) continue;
    const a2 = s.country;
    const displayName = A2_TO_NAME[a2] || a2;
    const cKey = s.city ? cityKey(s.city.trim(), (s.region || "").trim(), displayName) : null;
    const cMeta = s.city ? { city: s.city.trim(), state: (s.region || "").trim(), country: displayName } : null;

    const apply = (agg) => {
      const c = agg.country(a2, displayName, a2);
      c.streams++;
      if (cKey) agg.city(cKey, cMeta).streams++;
    };

    if (!since && !until) apply(currentAgg);
    else if (inRange(s.created_at, since, until)) apply(currentAgg);
    if (inRange(s.created_at, growthCurrentStart, now)) apply(growthCurrentAgg);
    else if (inRange(s.created_at, growthPrevStart, growthCurrentStart)) apply(growthPrevAgg);
  }

  // ─── Revenue (purchases has no location; attribute via the buyer's profile) ──
  for (const pu of purchases) {
    const buyer = profileByUserId.get(pu.user_id);
    if (!buyer?.country) continue;
    const displayName = buyer.country.trim();
    const identity = countryIdentity(displayName);
    const a2 = NAME_TO_A2[displayName] || null;
    const cKey = buyer.city ? cityKey(buyer.city.trim(), (buyer.state || "").trim(), displayName) : null;
    const cMeta = buyer.city ? { city: buyer.city.trim(), state: (buyer.state || "").trim(), country: displayName } : null;
    const cents = Number(pu.amount_cents) || 0;

    const apply = (agg) => {
      const c = agg.country(identity, displayName, a2);
      c.revenueCents += cents;
      if (cKey) agg.city(cKey, cMeta).revenueCents += cents;
    };

    if (!since && !until) apply(currentAgg);
    else if (inRange(pu.created_at, since, until)) apply(currentAgg);
    if (inRange(pu.created_at, growthCurrentStart, now)) apply(growthCurrentAgg);
    else if (inRange(pu.created_at, growthPrevStart, growthCurrentStart)) apply(growthPrevAgg);
  }

  // ─── Merge current totals with the fixed 30d/30d growth comparison ─────────
  const allIdentities = new Set([
    ...currentAgg.countries.keys(),
    ...growthCurrentAgg.countries.keys(),
    ...growthPrevAgg.countries.keys(),
  ]);

  const by_country = [...allIdentities]
    .map((identity) => {
      const cur = currentAgg.countries.get(identity);
      const gc = growthCurrentAgg.countries.get(identity);
      const gp = growthPrevAgg.countries.get(identity);
      const base = cur || gc || gp;
      return {
        country: base.country,
        a2: base.a2,
        fans: cur?.fans || 0,
        streams: cur?.streams || 0,
        revenueCents: cur?.revenueCents || 0,
        male: cur?.male || 0,
        female: cur?.female || 0,
        ages: cur?.ages || {},
        growth: {
          fans: gc?.fans || 0,
          prevFans: gp?.fans || 0,
          streams: gc?.streams || 0,
          prevStreams: gp?.streams || 0,
          revenueCents: gc?.revenueCents || 0,
          prevRevenueCents: gp?.revenueCents || 0,
        },
      };
    })
    .sort((a, b) => b.fans - a.fans);

  const by_city = finalizeCities(currentAgg);

  const monthly_growth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { month: key, fans: monthCounts[key] || 0 };
  });

  const totalStreams = by_country.reduce((sum, c) => sum + c.streams, 0);
  const totalRevenueCents = by_country.reduce((sum, c) => sum + c.revenueCents, 0);

  return NextResponse.json(
    {
      overview: {
        total_fans: streamedInWindow.size,
        unique_countries: by_country.filter((c) => c.fans > 0).length,
        unique_cities: by_city.length,
        total_streams: totalStreams,
        total_revenue_cents: totalRevenueCents,
      },
      range: { since: since?.toISOString() || null, until: until?.toISOString() || null },
      by_country,
      by_city,
      monthly_growth,
    },
    // Every KPI here is monitoring live fan activity — no caching, ever, so
    // Refresh (and every date-range change) always reflects the current DB
    // state, not a browser-cached snapshot up to 3 minutes stale.
    { headers: { "Cache-Control": "private, no-store, must-revalidate" } }
  );
}

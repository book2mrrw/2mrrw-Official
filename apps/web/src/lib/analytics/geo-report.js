/**
 * Shapes the Global Map response from analytics_geo results (pure, tested).
 *
 * Listening geography comes from where each play happened (edge IP location
 * at event time): plays are 'play' events only (a play and its completion are
 * one play), listeners are distinct per level as counted in SQL. Revenue is
 * still placed by the buyer's profile location until purchase-time location
 * is recorded. The response keeps the shape the map page already reads; the
 * page labels `fans` as Listeners and `streams` as Plays.
 */
import { A2_TO_NAME, NAME_TO_A2 } from "@/lib/geo/country-codes";

const num = (v) => Number(v) || 0;

function emptyGrowth() {
  return { fans: 0, prevFans: 0, streams: 0, prevStreams: 0, revenueCents: 0, prevRevenueCents: 0 };
}

function inWindow(iso, from, to) {
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso >= to) return false;
  return true;
}

export function buildGeoReport({
  overview = {}, current = [], growthCurrent = [], growthPrevious = [],
  purchases = [], buyerProfiles = [], listenerGrowth = [], range = {}, windows = {}, now = new Date(),
} = {}) {
  const countries = new Map(); // a2 (or raw name) → row
  const country = (identity, a2) => {
    if (!countries.has(identity)) {
      countries.set(identity, {
        country: (a2 && A2_TO_NAME[a2]) || identity, a2: a2 || null,
        fans: 0, streams: 0, qualifiedPlays: 0, revenueCents: 0, male: 0, female: 0, ages: {}, growth: emptyGrowth(),
      });
    }
    return countries.get(identity);
  };

  for (const g of current.filter((r) => r.level === "country")) {
    const c = country(g.country, g.country);
    c.fans = num(g.listeners);
    c.streams = num(g.plays);
    c.qualifiedPlays = num(g.qualified_plays);
  }
  for (const g of growthCurrent.filter((r) => r.level === "country")) {
    const c = country(g.country, g.country);
    c.growth.fans = num(g.listeners);
    c.growth.streams = num(g.plays);
  }
  for (const g of growthPrevious.filter((r) => r.level === "country")) {
    const c = country(g.country, g.country);
    c.growth.prevFans = num(g.listeners);
    c.growth.prevStreams = num(g.plays);
  }

  // Revenue by the buyer's profile location (free text → ISO code when known).
  const profileById = new Map(buyerProfiles.map((p) => [p.id, p]));
  const cityRevenue = new Map();
  for (const pu of purchases) {
    const buyer = profileById.get(pu.user_id);
    const name = buyer?.country?.trim();
    if (!name) continue;
    const a2 = NAME_TO_A2[name] || null;
    const c = country(a2 || name, a2);
    const cents = num(pu.amount_cents);
    if (inWindow(pu.purchased_at, range.from, range.to)) {
      c.revenueCents += cents;
      if (buyer.city) {
        const key = `${buyer.city.trim()}|${(buyer.state || "").trim().toUpperCase()}|${c.country}`;
        cityRevenue.set(key, (cityRevenue.get(key) || 0) + cents);
      }
    }
    if (inWindow(pu.purchased_at, windows.currentFrom, windows.currentTo)) c.growth.revenueCents += cents;
    if (inWindow(pu.purchased_at, windows.previousFrom, windows.previousTo)) c.growth.prevRevenueCents += cents;
  }

  const by_country = [...countries.values()]
    .filter((c) => c.fans || c.streams || c.revenueCents || c.growth.fans || c.growth.prevFans || c.growth.revenueCents || c.growth.prevRevenueCents)
    .sort((a, b) => b.fans - a.fans || b.streams - a.streams);

  const by_city = current
    .filter((g) => g.level === "city" && g.city)
    .map((g) => {
      const countryName = A2_TO_NAME[g.country] || g.country;
      const state = (g.region || "").trim();
      return {
        city: g.city, state, country: countryName,
        fans: num(g.listeners), streams: num(g.plays), qualifiedPlays: num(g.qualified_plays),
        revenueCents: cityRevenue.get(`${g.city}|${state.toUpperCase()}|${countryName}`) || 0,
        lat: null, lng: null, // the map places cities from its coordinate table
      };
    })
    .sort((a, b) => b.fans - a.fans || b.streams - a.streams)
    .slice(0, 600);

  const by_region = current
    .filter((g) => g.level === "region" && g.region)
    .map((g) => ({ country: A2_TO_NAME[g.country] || g.country, a2: g.country, region: g.region, fans: num(g.listeners), streams: num(g.plays), qualifiedPlays: num(g.qualified_plays) }))
    .sort((a, b) => b.fans - a.fans || b.streams - a.streams);

  const growthByMonth = new Map(listenerGrowth.map((g) => [g.month, g]));
  const monthly_growth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { month, fans: num(growthByMonth.get(month)?.new_listeners) };
  });

  return {
    overview: {
      total_fans: num(overview?.listeners),
      unique_countries: by_country.filter((c) => c.streams > 0).length,
      unique_cities: by_city.length,
      total_streams: by_country.reduce((s, c) => s + c.streams, 0),
      total_revenue_cents: by_country.reduce((s, c) => s + c.revenueCents, 0),
    },
    range: { since: range.from || null, until: range.to || null },
    by_country,
    by_region,
    by_city,
    monthly_growth,
  };
}

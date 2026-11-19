/**
 * Shapes the account-panel analytics response from the SQL results.
 * Pure (no I/O) so every number on the Overview / Audience / Tracks tabs is
 * unit-tested. Definitions live in SQL (analytics_metrics_v2); this only
 * joins them to the catalog and labels them.
 */

const num = (v) => Number(v) || 0;
const statKey = (productId, songSlug) => `${productId}:${songSlug ?? ""}`;

function trackRow(base, s) {
  return {
    ...base,
    plays: num(s?.plays),
    qualifiedPlays: num(s?.qualified_plays),
    completes: num(s?.completes),
    skips: num(s?.skips),
    listeners: num(s?.listeners),
    repeatListeners: num(s?.repeat_listeners),
    listenSeconds: num(s?.listen_seconds),
    downloads: num(s?.downloads),
    // Completes per play, as a whole percent. Null when the song has no plays.
    completionRate: s?.completion_rate != null ? Math.round(Number(s.completion_rate) * 100) : null,
    skipRate: s?.skip_rate != null ? Math.round(Number(s.skip_rate) * 100) : null,
  };
}

function lastMonths(count, now) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function buildAnalyticsOverview({
  overview = {}, trackStats = [], growth = [], demographics = [], purchases = [],
  products = [], songs = [], range = { key: "all" }, now = new Date(),
} = {}) {
  // ── Purchases in range ────────────────────────────────────────────────────
  const purchaseCounts = {};
  let revenueCents = 0;
  let paidOrders = 0;
  let giftsClaimed = 0;
  let freeClaims = 0;
  for (const p of purchases) {
    const cents = num(p.amount_cents);
    revenueCents += cents;
    if (p.purchase_type === "gift") giftsClaimed += 1;
    else if (cents > 0) paidOrders += 1;
    else freeClaims += 1;
    for (const item of Array.isArray(p.items) ? p.items : []) {
      const slug = item?.slug || item?.product_slug;
      if (slug) purchaseCounts[slug] = (purchaseCounts[slug] || 0) + 1;
    }
  }

  // ── Tracks: one row per song; album purchases on the album row only ───────
  const stats = new Map(trackStats.map((s) => [statKey(s.product_id, s.song_slug), s]));
  const used = new Set();
  const take = (productId, songSlug) => {
    const key = statKey(productId, songSlug);
    used.add(key);
    return stats.get(key);
  };
  const songsByAlbum = new Map();
  for (const song of songs) {
    if (!songsByAlbum.has(song.product_id)) songsByAlbum.set(song.product_id, []);
    songsByAlbum.get(song.product_id).push(song);
  }
  const productById = new Map(products.map((p) => [p.id, p]));

  const tracks = [];
  for (const p of products) {
    if (p.product_type !== "album") {
      tracks.push(trackRow({
        slug: p.slug, releaseSlug: p.slug, songSlug: null, title: p.title, coverUrl: p.coverUrl ?? null,
        purchases: purchaseCounts[p.slug] || 0, kind: "single",
      }, take(p.id, null)));
      continue;
    }
    for (const song of songsByAlbum.get(p.id) || []) {
      tracks.push(trackRow({
        slug: `${p.slug}:${song.slug}`, releaseSlug: p.slug, songSlug: song.slug, title: song.title, coverUrl: p.coverUrl ?? null,
        purchases: null, // an album is bought as a whole — counted once, on the album row
        kind: "album_song",
      }, take(p.id, song.slug)));
    }
    // The album itself: its purchases, plus any plays recorded before
    // per-song tracking (those were keyed only by the album slug).
    tracks.push(trackRow({
      slug: p.slug, releaseSlug: p.slug, songSlug: null, title: `${p.title} (album)`, coverUrl: p.coverUrl ?? null,
      purchases: purchaseCounts[p.slug] || 0, kind: "album",
    }, take(p.id, null)));
  }
  // Plays for anything not in the catalog list (removed songs, renamed slugs)
  // are still shown — no listening is ever hidden.
  for (const [key, s] of stats) {
    if (used.has(key)) continue;
    const product = productById.get(s.product_id);
    tracks.push(trackRow({
      slug: key, releaseSlug: s.release_slug ?? product?.slug ?? null, songSlug: s.song_slug ?? null,
      title: s.title || s.song_slug || s.release_title || "Unknown recording", coverUrl: product?.coverUrl ?? null,
      purchases: null, kind: "uncatalogued",
    }, s));
  }
  tracks.sort((a, b) => b.plays - a.plays || b.qualifiedPlays - a.qualifiedPlays);

  // ── Audience (signed-in fans' profiles) ───────────────────────────────────
  const demo = (dimension) => demographics.filter((d) => d.dimension === dimension);
  const demoValue = (dimension, value) => num(demographics.find((d) => d.dimension === dimension && d.value === value)?.fans);
  const totalFansProfiled = demoValue("total", "all");
  const fansWithDemographics = demoValue("profiled", "gender_and_age");
  const gender = { male: demoValue("gender", "male"), female: demoValue("gender", "female"), unknown: 0 };
  gender.unknown = Math.max(0, totalFansProfiled - gender.male - gender.female);
  const ageRange = { "18-25": demoValue("age_range", "18-25"), "25-40": demoValue("age_range", "25-40"), "40-65": demoValue("age_range", "40-65"), unknown: 0 };
  ageRange.unknown = Math.max(0, totalFansProfiled - ageRange["18-25"] - ageRange["25-40"] - ageRange["40-65"]);
  const byCount = (a, b) => b.count - a.count;
  const topStates = demo("state").map((d) => ({ state: d.value, count: num(d.fans) })).sort(byCount).slice(0, 20);
  const topCities = demo("city").map((d) => {
    const [city, state] = String(d.value).split("|");
    return { city, state, count: num(d.fans) };
  }).sort(byCount).slice(0, 30);
  const topCountries = demo("country").map((d) => ({ country: d.value, count: num(d.fans) })).sort(byCount).slice(0, 50);

  // ── Growth: new listeners per month (first counted listen) ────────────────
  const growthByMonth = new Map(growth.map((g) => [g.month, g]));
  const monthly = lastMonths(12, now).map((month) => ({
    month,
    newListeners: num(growthByMonth.get(month)?.new_listeners),
    newFans: num(growthByMonth.get(month)?.new_fans),
  }));

  const totalFans = num(overview?.fans);
  return {
    range: range.key,
    tracks,
    totals: { plays: tracks.reduce((s, t) => s + t.plays, 0), purchases: paidOrders },
    overview: {
      totalFans,
      totalListeners: num(overview?.listeners),
      totalPlays: num(overview?.plays),
      qualifiedPlays: num(overview?.qualified_plays),
      completes: num(overview?.completes),
      skips: num(overview?.skips),
      listenSeconds: num(overview?.listen_seconds),
      downloads: num(overview?.downloads),
      downloadRemoves: num(overview?.download_removes),
      totalPurchases: paidOrders,
      giftsClaimed,
      freeClaims,
      totalRevenueCents: revenueCents,
      fansWithDemographics,
      demographicsCoverage: totalFansProfiled > 0 ? Math.round((fansWithDemographics / totalFansProfiled) * 100) : 0,
      historyStartsAt: overview?.first_event_at ?? null,
    },
    demographics: { gender, ageRange },
    geography: { topStates, topCities, topCountries },
    growth: { monthly },
  };
}

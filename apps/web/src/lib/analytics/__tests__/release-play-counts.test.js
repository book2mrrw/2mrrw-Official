import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { mock } from "node:test";

// Real catalog builder against a fake database: proves every release card's
// data carries its lifetime play count from the first render.
const rpcCalls = [];
let rpcResult = { data: [], error: null };
const PRODUCTS = [
  { id: "p-single", slug: "w2d", title: "W.2.D", product_type: "single", active: true, content_kind: "music", release_type: "singles", metadata: {} },
  { id: "p-album", slug: "love-hz-vol-1", title: "Love Hz Vol. 1", product_type: "album", active: true, content_kind: "music", release_type: "albums", metadata: {} },
  { id: "p-feature", slug: "ad", title: "AD", product_type: "feature", active: true, content_kind: "music", release_type: "features", metadata: {} },
];
function query(rows) {
  const q = {
    select: () => q, is: () => q, in: () => q, eq: () => q, order: () => q, range: () => q, limit: () => q,
    then: (resolve) => resolve({ data: rows, error: null, count: rows.length }),
  };
  return q;
}
const admin = {
  from: (table) => query(table === "products" ? PRODUCTS : []),
  rpc: async (name) => { rpcCalls.push(name); return rpcResult; },
};
mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => admin } });
mock.module("@/lib/audio-visual/release-video-lookup", { namedExports: { getMusicVideosForReleaseIds: async () => new Map() } });

const { getStorefrontCatalogFromDB } = await import("@/lib/media/catalog-db");
const counts = await import("@/lib/analytics/release-play-counts");
const { formatPlayCount, playCountLabel } = await import("@/lib/analytics/play-count-format");

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("every release in the storefront catalog carries its lifetime play count", async () => {
  counts.resetPlayCountCache();
  rpcResult = { data: [{ product_id: "p-single", plays: 1234 }, { product_id: "p-album", plays: 87 }], error: null };
  const catalog = await getStorefrontCatalogFromDB();
  assert.equal(catalog.singles.find((r) => r.slug === "w2d").playCount, 1234);
  assert.equal(catalog.albums.find((r) => r.slug === "love-hz-vol-1").playCount, 87, "album songs count toward their album");
  assert.equal(catalog.features.find((r) => r.slug === "ad").playCount, 0, "a release with no plays yet has 0");
});

test("before the migration (or on any error) the catalog still loads, just without counts", async () => {
  counts.resetPlayCountCache();
  rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function public.release_play_counts" } };
  const catalog = await getStorefrontCatalogFromDB();
  assert.ok(catalog, "catalog must not fail because of counts");
  assert.equal(catalog.singles[0].playCount, 0);
});

test("counts are read once a minute per server, not on every catalog request", async () => {
  counts.resetPlayCountCache();
  rpcCalls.length = 0;
  rpcResult = { data: [{ product_id: "p-single", plays: 5 }], error: null };
  const t0 = 1_000_000;
  await counts.getReleasePlayCounts(admin, t0);
  await counts.getReleasePlayCounts(admin, t0 + 30_000);
  assert.equal(rpcCalls.length, 1, "cached within the minute");
  await counts.getReleasePlayCounts(admin, t0 + 61_000);
  assert.equal(rpcCalls.length, 2, "refreshed after a minute");
});

test("a failed refresh keeps the last good counts instead of blanking every card", async () => {
  counts.resetPlayCountCache();
  rpcResult = { data: [{ product_id: "p-single", plays: 9 }], error: null };
  await counts.getReleasePlayCounts(admin, 0);
  rpcResult = { data: null, error: { code: "57014", message: "timeout" } };
  const after = await counts.getReleasePlayCounts(admin, 120_000);
  assert.equal(counts.playCountFor(after, "p-single"), 9);
});

test("card format: compact, never rounds up past what happened", () => {
  const cases = [[0, null], [-3, null], [1, "1"], [842, "842"], [999, "999"], [1000, "1K"], [1999, "1.9K"], [2300, "2.3K"],
    [12_345, "12K"], [999_999, "999K"], [1_000_000, "1M"], [1_234_567, "1.2M"], [23_456_789, "23M"]];
  for (const [n, expected] of cases) assert.equal(formatPlayCount(n), expected, String(n));
  assert.equal(playCountLabel(12345), "12,345 plays");
  assert.equal(playCountLabel(1), "1 play");
});

test("zero re-render: the card count is a pure component fed by catalog data, on all three card types", () => {
  const component = read("src/components/music/ReleasePlayCount.js");
  assert.doesNotMatch(component, /use(State|Effect|LayoutEffect|Memo|Callback|Ref|Context)\(/, "no hooks: it adds no render of its own");
  assert.doesNotMatch(component, /fetch\(/, "no client fetch");
  for (const file of ["src/components/home/CatalogGrid.js", "src/components/home/LatestSinglesStyleRow.js", "src/components/home/FeaturesRail.js"]) {
    assert.match(read(file), /<ReleasePlayCount count=\{mediaItem\.playCount\} \/>/, file);
  }
});

test("a new play never triggers a storefront refresh: counts are not part of the catalog revision", () => {
  const revision = read("src/lib/media/catalog-refresh-state.js");
  assert.doesNotMatch(revision, /media_stream_events|play_count|playCount/);
});

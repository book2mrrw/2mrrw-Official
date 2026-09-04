import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// ── every country clickable and correctly named, even at zero data ────────

test("numericToA2/valueMap are built from the complete A2_TO_NUMERIC table, not filtered to countries that already have a by_country row", () => {
  const src = read("src/app/admin/analytics/page.js");
  const fnAt = src.indexOf("const { geoFeatures, pathGen, projection, valueMap, numericToA2, countryByA2 } = useMemo(");
  const body = src.slice(fnAt, fnAt + 1200);
  assert.match(body, /const byA2 = new Map\(\(data\?\.by_country \|\| \[\]\)\.map\(c => \[c\.a2, c\]\)\);/);
  assert.match(body, /for \(const \[a2, num\] of Object\.entries\(A2_TO_NUMERIC\)\) \{/,
    "must iterate the full known-country table, not just data.by_country entries");
  assert.match(body, /const c = byA2\.get\(a2\) \|\| EMPTY_COUNTRY;/);
});

test("hover and click both resolve the country via countryByA2 and fall back to A2_TO_NAME, never leaving a real country labeled Unknown", () => {
  const src = read("src/app/admin/analytics/page.js");
  const hoverAt = src.indexOf("onMouseEnter={(e) => {\n                  setHoveredId(f.id);");
  const hoverBody = src.slice(hoverAt, hoverAt + 700);
  assert.match(hoverBody, /const found = countryByA2\.get\(a2\);/);
  assert.match(hoverBody, /const name = found\?\.country \|\| A2_TO_NAME\[a2\] \|\| a2 \|\| "Unknown";/);

  const clickAt = src.indexOf("onClick={() => {\n                  if (!a2) return;");
  const clickBody = src.slice(clickAt, clickAt + 700);
  assert.match(clickBody, /const found = countryByA2\.get\(a2\);/);
  assert.match(clickBody, /const countryName = found\?\.country \|\| A2_TO_NAME\[a2\] \|\| a2;/);
});

test("clicking a country with zero data still opens a real panel with its correct name and zeroed stats, via EMPTY_COUNTRY's shape", () => {
  const src = read("src/app/admin/analytics/page.js");
  assert.match(src, /const EMPTY_COUNTRY = \{ fans: 0, streams: 0, revenueCents: 0, male: 0, female: 0, ages: \{\}, growth: \{ fans: 0, prevFans: 0, streams: 0, prevStreams: 0, revenueCents: 0, prevRevenueCents: 0 \} \};/);
  const clickAt = src.indexOf("onClick={() => {\n                  if (!a2) return;");
  const clickBody = src.slice(clickAt, clickAt + 1000);
  assert.match(clickBody, /growth: found\?\.growth \|\| EMPTY_COUNTRY\.growth,/);
});

// ── city dots: visible on any activity, not just the selected metric ──────

test("cityDots tracks hasActivity across all three metrics, independent of which one is currently selected", () => {
  const src = read("src/app/admin/analytics/page.js");
  const fnAt = src.indexOf("const cityDots = useMemo(");
  const body = src.slice(fnAt, fnAt + 1400);
  assert.match(body, /const hasActivity = \(c\.fans \|\| 0\) \+ \(c\.streams \|\| 0\) \+ \(c\.revenueCents \|\| 0\) > 0;/);
  assert.match(body, /return \{ \.\.\.c, svgX, svgY, value: metricGet\(c\), hasActivity \};/);
});

test("a city dot only disappears when it truly has no activity at all — not merely because the selected metric is zero for it", () => {
  const src = read("src/app/admin/analytics/page.js");
  const renderAt = src.indexOf('mapMode === "DOTS" && cityDots.map(');
  const body = src.slice(renderAt, renderAt + 700);
  assert.match(body, /if \(!dot\.hasActivity\) return null;/);
  assert.doesNotMatch(body, /if \(opacity <= 0\) return null;/,
    "must not still gate visibility on the selected metric's opacity — that was the bug (a city with only streams was invisible in the default Fans view)");
});

// ── tooltip: bounded, non-overlapping ───────────────────────────────────────

test("the tooltip is clamped both horizontally and vertically to the map's own rect, so it can never escape into content below the card", () => {
  const src = read("src/app/admin/analytics/page.js");
  const tooltipAt = src.indexOf("{tooltip && (");
  const body = src.slice(tooltipAt, tooltipAt + 700);
  assert.match(body, /left: Math\.max\(8, Math\.min\(tooltip\.px \+ 14, tooltip\.maxLeft\)\),/);
  assert.match(body, /top: Math\.max\(8, Math\.min\(tooltip\.py - 64, tooltip\.maxTop - 140\)\),/,
    "vertical position must be clamped against the map's own height (maxTop), not left unbounded");
  assert.match(body, /width: 172,/, "a fixed width (not minWidth) keeps every tooltip's internal lines from wrapping unpredictably");
});

test("tooltip state carries maxTop from the map's own bounding rect on both country and city hover", () => {
  const src = read("src/app/admin/analytics/page.js");
  const matches = [...src.matchAll(/maxTop: rect\.height,/g)];
  assert.ok(matches.length >= 2, "both the country-hover and city-dot-hover tooltips must supply maxTop");
});

// ── zoom-to-country ──────────────────────────────────────────────────────

test("selecting a country computes a real zoom transform from its own bounding box via pathGen.bounds, not just a cosmetic highlight", () => {
  const src = read("src/app/admin/analytics/page.js");
  const fnAt = src.indexOf("const zoomTransform = useMemo(");
  const body = src.slice(fnAt, fnAt + 900);
  assert.match(body, /const \[\[x0, y0\], \[x1, y1\]\] = pathGen\.bounds\(feature\);/);
  assert.match(body, /const scale = Math\.max\(1, Math\.min\(8, 0\.82 \/ Math\.max\(dx \/ MAP_W, dy \/ MAP_H\)\)\);/,
    "zoom must be bounded (min 1x, max 8x) so a tiny country doesn't zoom to an absurd scale");
});

test("the zoom transform is applied to a wrapping <g> around the graticule/countries/city-dots layer, with a smooth CSS transition and non-scaling strokes so borders don't get chunky when zoomed", () => {
  const src = read("src/app/admin/analytics/page.js");
  assert.match(src, /<g style=\{\{ transition: "transform 0\.5s cubic-bezier\(0\.22,1,0\.36,1\)" \}\}\s*\n\s*transform=\{zoomTransform \? `translate\(\$\{zoomTransform\.translateX\},\$\{zoomTransform\.translateY\}\) scale\(\$\{zoomTransform\.scale\}\)` : undefined\}>/);
  const gAt = src.indexOf('<g style={{ transition: "transform 0.5s');
  const gBody = src.slice(gAt, src.indexOf("</g>", gAt));
  const vectorEffectMatches = [...gBody.matchAll(/vectorEffect="non-scaling-stroke"/g)];
  assert.ok(vectorEffectMatches.length >= 2, "graticule, country borders, and city dots should all keep a constant stroke width under zoom");
});

test("clearing the selected country (the CountryPanel's World button) resets the zoom, since zoomTransform depends on selectedCountry being set", () => {
  const src = read("src/app/admin/analytics/page.js");
  const fnAt = src.indexOf("const zoomTransform = useMemo(");
  const body = src.slice(fnAt, fnAt + 300);
  assert.match(body, /if \(!selectedCountry \|\| !pathGen \|\| !geoFeatures\.length\) return null;/);
});

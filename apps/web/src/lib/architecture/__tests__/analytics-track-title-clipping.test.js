import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// ── title clipping: the account panel is narrower than the 7-column grid needs ──

test("both the Overview 'Top Tracks' widget and the full Tracks tab wrap their grid in a horizontally-scrolling container with a real minimum width", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const wrapMatches = [...src.matchAll(/<div style=\{\{ overflowX:"auto" \}\}>\s*\n\s*<div style=\{\{ minWidth: isMobile \? "auto" : 480 \}\}>/g)];
  assert.equal(wrapMatches.length, 2,
    "both track-list locations must scroll instead of letting the 1fr title column collapse toward zero in a container narrower than ~454px");
});

test("the minWidth floor only applies on desktop — mobile's own stacked flex layout is untouched (auto width, no forced minimum)", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const matches = [...src.matchAll(/minWidth: isMobile \? "auto" : 480/g)];
  assert.equal(matches.length, 2);
});

// ── missing-cover state is visually distinct from a still-loading real cover ──

test("TrackRow renders a distinct glyph only when coverUrl is genuinely absent, never overlapping a real cover that's still loading in the browser", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("const coverGlyph = !track.coverUrl && (");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 300);
  assert.match(body, /title="No cover art on file for this release"/);

  // Both render sites (mobile stacked row, desktop grid row) must actually use it.
  const usageMatches = [...src.matchAll(/<div style=\{coverStyle\}>\{coverGlyph\}<\/div>/g)];
  assert.equal(usageMatches.length, 2, "the glyph must render in both the mobile and desktop TrackRow layouts");
});

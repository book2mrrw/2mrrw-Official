import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("warm caches are deduplicated, bounded, expiring, and invalidatable", () => {
  const source = fs.readFileSync("src/lib/performance/context-warmup.js", "utf8");
  assert.match(source, /const MAX_REQUESTS = 24/);
  assert.match(source, /const REQUEST_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(source, /if \(existing && Date\.now\(\) - existing\.createdAt < REQUEST_TTL_MS\) return existing\.promise/);
  assert.match(source, /if \(requests\.size > MAX_REQUESTS\) requests\.delete/);
  assert.match(source, /export function invalidateWarmJson/);
  assert.match(source, /export async function warmAudioVisualz/);
  assert.match(source, /\/api\/audio-visual\/browse/);
  assert.match(source, /\/peek/);
  assert.match(source, /if \(peek\?\.full\).*\/manifest/);
  assert.match(source, /const MAX_WARM_VIDEOS = 3/);
});

test("music siblings stay mounted before visibility and the radio-only snapshot is isolated", () => {
  const panels = fs.readFileSync("src/components/storefront/MusicTabCatalogPanels.js", "utf8");
  for (const tab of ["singles", "albums", "mixtapes", "mymusic"]) {
    assert.match(panels, new RegExp(`hidden=\\{activeTab !== "${tab}"\\}`));
  }
  const home = fs.readFileSync("src/app/HomeClient.js", "utf8");
  assert.doesNotMatch(home, /musicPrepared|setMusicPrepared/);
  assert.match(home, /const warmTopToBottom = async \(\) =>/);
  assert.doesNotMatch(home, /warmDestination\(activeTab, "selected"\)/);
  assert.doesNotMatch(home, /const preloadItems =/);
  assert.match(home, /eslint-disable-next-line react-hooks\/exhaustive-deps\s*\n\s*\}, \[\]\);/);
  assert.match(home, /RADIO_TURNT_SNAPSHOT = "\/images\/radio\/turnt-me-2-dis\.jpg"/);
  assert.match(home, /slide\.slug === "turnt-me-2-dis"/);
  assert.ok(fs.existsSync("public/images/radio/turnt-me-2-dis.jpg"));
});

test("asset warming preserves static fallbacks and respects motion cover types", () => {
  const source = fs.readFileSync("src/lib/performance/context-warmup.js", "utf8");
  assert.match(source, /const staticCover = item\?\.baseCover \|\| item\?\.artwork \|\| item\?\.poster_url/);
  assert.match(source, /item\?\.coverArtType \|\| "image"/);
});

test("pre-mounted artwork consumes decoded images and exposes native motion posters", () => {
  const source = fs.readFileSync("src/ui/skeletons/ArtworkSkeleton.js", "utf8");
  assert.match(source, /imagePipeline\.getFromCache\(src, \{ coverArtType: type \}\)/);
  assert.match(source, /visible=\{loaded \|\| mediaType !== "video" \|\| Boolean\(baseCover\)\}/);
  assert.match(source, /poster=\{baseCover \|\| undefined\}/);
});

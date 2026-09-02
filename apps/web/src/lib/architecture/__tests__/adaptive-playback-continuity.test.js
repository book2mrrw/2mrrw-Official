import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("responsive geometry never selects a different storefront React tree", () => {
  const home = read("src/app/HomeClient.js");
  const storefront = read("src/components/home/HomeStorefront.js");
  const carousel = read("src/components/home/CarouselUI.js");
  const countdown = read("src/components/home/LiveCountdownDisplays.js");

  assert.match(home, /className="storefront-adaptive-shell"/);
  assert.match(home, /className="storefront-primary-rail"/);
  assert.match(home, /className="storefront-main-column"/);
  assert.match(home, /className="storefront-cart-rail"/);
  assert.match(home, /className="storefront-mobile-ui"/);
  assert.doesNotMatch(home, /setIsMobile|useState\([^)]*(?:innerWidth|matchMedia)/);
  assert.doesNotMatch(home, /addEventListener\(["']resize["'][\s\S]{0,300}set[A-Z]/);
  for (const source of [storefront, carousel, countdown]) {
    assert.doesNotMatch(source, /\bisMobile\b/);
  }
});

test("capacity ranges are CSS-only and preserve compact, expanded, and large shells", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /@container catalog-grid \(max-width: 560px\)/);
  assert.match(css, /@container storefront-main \(min-width: 600px\)/);
  assert.match(css, /@media \(min-width: 840px\)[\s\S]*grid-template-columns: clamp\(196px, 19vw, 220px\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 1180px\)[\s\S]*grid-template-columns: 220px minmax\(0, 1fr\) clamp\(220px, 20vw, 248px\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test("playback authority and release modal remain rooted above adaptive content", () => {
  const layout = read("src/app/layout.js");
  const audioProviderStart = layout.indexOf("<AudioProvider>");
  const children = layout.indexOf("{children}", audioProviderStart);
  const player = layout.indexOf("<GlobalAudioPlayerBar />", children);
  const modal = layout.indexOf("<PlayerReleaseModalHost />", children);

  assert.ok(audioProviderStart > -1 && children > audioProviderStart);
  assert.ok(player > children && modal > children);
  assert.equal((layout.match(/<AudioProvider>/g) || []).length, 1);
  assert.equal((layout.match(/<GlobalAudioPlayerBar \/>/g) || []).length, 1);
});

test("adaptive player chrome mutates only CSS inset during geometry changes", () => {
  const player = read("src/components/audio/GlobalAudioPlayerBar.js");
  assert.match(player, /ResizeObserver/);
  assert.match(player, /--player-bar-inset/);
  assert.doesNotMatch(player, /ResizeObserver[\s\S]{0,600}(?:setCurrentTrack|playQueue|dispatchPlaybackCommand|\.load\(\))/);
});

test("playback mode subscriptions are isolated to the Flow State panel", () => {
  const bridge = read("src/components/storefront/HomeStorefrontFlowMode.js");
  const storefront = read("src/components/home/HomeStorefront.js");
  assert.doesNotMatch(bridge, /usePlaybackChromeLayout/);
  assert.match(storefront, /const HomeFlowStateIsland = memo/);
  assert.match(storefront, /HomeFlowStateIsland[\s\S]*usePlaybackChromeLayout/);
});

test("Media Session publishes static artwork and guards revision races", () => {
  const artwork = read("src/lib/media-session-artwork.js");
  const helpers = read("src/lib/playback/PlaybackHelperService.js");

  assert.doesNotMatch(helpers, /type:\s*["']video\/mp4["']/);
  assert.doesNotMatch(artwork, /sizes:\s*["'](?:96|128|256|512|1024)x/);
  assert.match(artwork, /mediaSessionTrackIdentity/);
  assert.match(helpers, /_mediaSessionUpdateEpoch/);
  assert.match(helpers, /updateEpoch !== self\._mediaSessionUpdateEpoch/);
  assert.match(helpers, /Number\.isFinite\(playbackRate\)/);
});

test("replace-master keeps public pointers stable until an atomic promotion", () => {
  const migration = read("supabase/migrations/20260901000000_audio_master_revision_authority.sql");
  const stage = read("src/app/api/admin/releases/[id]/replace-master/stage/route.js");
  const commit = read("src/app/api/admin/releases/[id]/replace-master/route.js");
  const authority = read("src/lib/media/master-revision-authority.js");
  const worker = read("workers/hls-transcoder/src/db.js");

  assert.match(stage, /audio_master_revisions/);
  assert.match(stage, /buildMasterRevisionKeys/);
  assert.match(authority, /revisions\/\$\{revisionId\}/);
  assert.match(commit, /activeMasterUnchanged:\s*true/);
  assert.match(commit, /getR2ObjectMetadata/);
  assert.match(worker, /promote_audio_master_revision/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.promote_audio_master_revision/);
  assert.match(migration, /previous_master_key/);
  assert.match(migration, /retire_after/);
  assert.match(migration, /public storefront projection changed while replacement was processing/);
});

test("Current Release edits retain the known-good editor route and refresh the mounted catalog in place", () => {
  const route = read("src/app/api/admin/releases/[id]/route.js");
  const catalogSurface = read("src/components/storefront/catalog-surface-context.js");

  assert.doesNotMatch(route, /rpc\("commit_current_release_edit"/);
  assert.match(route, /const finalStatus = lifecycleUpdates\.status \|\| release\.status/);
  assert.match(catalogSurface, /applyCatalogSnapshot|replaceCatalogSnapshot|catalogMutationRevision/);
  assert.doesNotMatch(catalogSurface, /router\.refresh\(/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("storefront release lists retain canonical React identity", () => {
  const latest = read("src/components/home/LatestSinglesStyleRow.js");
  const features = read("src/components/home/FeaturesRail.js");
  const catalog = read("src/components/home/CatalogGrid.js");

  assert.match(latest, /const stableKey = rawItem\.slug \|\| rawItem\.id/);
  assert.match(features, /const stableKey = feat\.slug \|\| feat\.id/);
  assert.match(catalog, /key=\{mediaItem\.slug\}/);
  assert.doesNotMatch(latest, /key=\{i\}|key=\{index\}/);
  assert.doesNotMatch(features, /key=\{i\}|key=\{index\}/);
});

test("viewport and audio priority cannot discard a ready release cover source", () => {
  const latest = read("src/components/home/LatestSinglesStyleRow.js");
  const coverArt = read("src/components/ui/CoverArt.js");

  const priorityBranch = latest.match(/if \(shouldDefer && el\.readyState < 2\) \{([\s\S]*?)\n\s*\}/)?.[1] || "";
  assert.ok(priorityBranch, "expected to find the audio-priority defer branch in LatestSinglesStyleRow.js");
  assert.doesNotMatch(priorityBranch, /removeAttribute\(["']src["']\)|\.load\(\)|\.pause\(\)/);
  // Audio priority never unloads a cover: the only branch it takes is to wait,
  // and only before the cover has loaded.
  assert.match(coverArt, /if \(shouldDefer && el\.readyState < 2\) return;/);
  assert.doesNotMatch(coverArt, /retainLoadedSource/);
  assert.match(coverArt, /presentationSnapshot\?\.coverReady/);
});

test("latest-single artwork videos never expose native mobile playback controls", () => {
  const latest = read("src/components/home/LatestSinglesStyleRow.js");
  const styles = read("src/app/globals.css");

  // Every artwork <video> in the row (one since the 2026-09-07 single-element
  // rewrite), each carrying all of the no-native-controls attributes.
  const videos = latest.match(/<video\b[\s\S]*?(?:\/>|<\/video>)/g) || [];
  assert.ok(videos.length >= 1);
  for (const tag of videos) {
    assert.match(tag, /className="release-card-artwork-video"/);
    assert.match(tag, /controls=\{false\}/);
    assert.match(tag, /disablePictureInPicture/);
    assert.match(tag, /disableRemotePlayback/);
  }
  assert.match(styles, /\.release-card-artwork-video::\-webkit-media-controls-overlay-play-button/);
  assert.match(styles, /\.release-card-artwork-video::\-webkit-media-controls-start-playback-button/);
});

test("release presentation diagnostics cover the required lifecycle", () => {
  const registry = read("src/lib/storefront/release-presentation-registry.js");
  for (const event of [
    "MOUNT",
    "UNMOUNT",
    "RENDER",
    "COVER_REQUEST",
    "COVER_LOAD",
    "COVER_DECODE",
    "ENTITLEMENT_RESOLUTION",
    "CONTROLS_READY",
    "PRESENTATION_READY",
  ]) {
    assert.match(registry, new RegExp(`\\b${event}\\b`));
  }
  assert.match(registry, /process\.env\.NODE_ENV === "development"/);
});

test("storefront cards are not viewport-windowed or CSS-hidden", () => {
  const sources = [
    "src/components/home/LatestSinglesStyleRow.js",
    "src/components/home/FeaturesRail.js",
    "src/components/home/CatalogGrid.js",
  ].map(read).join("\n");

  assert.doesNotMatch(sources, /useVirtualizer|react-window|react-virtualized|contentVisibility|content-visibility|containIntrinsicSize|contain-intrinsic-size/);
  assert.doesNotMatch(sources, /entry\.isIntersecting[\s\S]{0,300}(?:setItems|setLoaded)\(/);
});

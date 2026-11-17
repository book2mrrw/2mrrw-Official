import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("cover surfaces wait only for a track's startup, never for the rest of playback", () => {
  for (const file of ["src/components/ui/CoverArt.js", "src/components/home/LatestSinglesStyleRow.js"]) {
    const src = read(file);
    assert.match(src, /const shouldDefer = audioPriority\.startupActive && !isThisReleasePlaying;/, file);
    assert.doesNotMatch(src, /audioPriority\.active\b/, `${file} must not suspend covers for all of playback`);
    assert.doesNotMatch(src, /shouldSuspend/, file);
  }
});

test("loaded card loops are never paused for audio; only a hidden page pauses them", () => {
  const persistent = read("src/lib/storefront/storefront-persistent-media.js");
  const ensure = persistent.slice(persistent.indexOf("export function ensureStorefrontCarouselVideosPlaying("));
  const ensureBody = ensure.slice(0, ensure.indexOf("\n}\n"));
  assert.match(ensureBody, /if \(getAudioMediaPrioritySnapshot\(\)\.startupActive\) return false;/);
  assert.doesNotMatch(ensureBody, /pauseStorefrontCarouselVideos|\.pause\(\)/);

  const home = read("src/app/HomeClient.js");
  const heavy = home.slice(home.indexOf("const pauseHeavyMedia = () => {"));
  const heavyBody = heavy.slice(0, heavy.indexOf("\n    };"));
  assert.match(heavyBody, /if \(document\.hidden\) pauseStorefrontCarouselVideos\(singlesRowRef\.current\);/);
  const ensureMedia = home.slice(home.indexOf("const ensureStorefrontCarouselMedia = useCallback("));
  assert.doesNotMatch(ensureMedia.slice(0, ensureMedia.indexOf("}, [")), /isPlaying\) return;/);
});

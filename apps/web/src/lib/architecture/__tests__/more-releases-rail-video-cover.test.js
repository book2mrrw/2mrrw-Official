import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Regression for: the "More Releases" rail at the bottom of the Mixtape/EP/
// Album tracklist modal rendered a plain <img src={r.cover}> with zero
// awareness of video covers. Love Hz Vol. 1 is the one release among its
// Mixtape/EP siblings with an animated cover (canonical-catalog.js's `video`
// field) — catalogCoverDisplay() correctly resolves its `cover` to a URL
// that redirects to an .mp4, which an <img> tag cannot render, so its
// thumbnail silently failed while its non-video siblings (plain static
// images) rendered fine through the exact same line.

test("the rail no longer hand-rolls r.cover || r.coverArt directly into an <img> with no media-type awareness", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  assert.doesNotMatch(src, /\{r\.cover \|\| r\.coverArt \? \(/,
    "the old naive image-only rendering must be gone, not just supplemented");
});

test("moreReleaseThumbSrc uses catalogCoverDisplay (the same canonical resolver as the rest of the app) and falls back to the static baseCover for a video-cover release", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  const fnAt = src.indexOf("function moreReleaseThumbSrc(r) {");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 400);
  assert.match(body, /const \{ src, type \} = catalogCoverDisplay\(r \|\| \{\}\);/);
  assert.match(body, /if \(type === "video"\) return r\?\.baseCover \|\| r\?\.legacy_cover \|\| "";/);
  assert.match(body, /return src;/);
});

test("MoreReleaseThumb has real onError recovery to the letter-avatar placeholder, unlike the old rail which had none", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  const fnAt = src.indexOf("function MoreReleaseThumb({ r, accentColor, onClick }) {");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 1400);
  assert.match(body, /const \[failed, setFailed\] = useState\(false\);/);
  assert.match(body, /const thumbSrc = !failed \? moreReleaseThumbSrc\(r\) : "";/);
  assert.match(body, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(body, /\{\(r\.title \|\| "\?"\)\.charAt\(0\)\}/,
    "a failed/missing thumbnail must still fall back to the letter-avatar placeholder");
});

test("the rail renders MoreReleaseThumb per item instead of inlining the cover logic in the .map()", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  const mapAt = src.indexOf("{otherReleases.map((r) => (");
  assert.ok(mapAt > -1);
  const body = src.slice(mapAt, mapAt + 300);
  assert.match(body, /<MoreReleaseThumb\s*\n\s*key=\{r\.slug \|\| r\.id\}\s*\n\s*r=\{r\}\s*\n\s*accentColor=\{t\.accent\}\s*\n\s*onClick=\{\(\) => onReleaseClick\?\.\(r\)\}/);
});

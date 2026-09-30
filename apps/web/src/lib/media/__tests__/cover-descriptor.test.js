import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  coverDescriptorToLegacyFields,
  isMotionUrl,
  isStillUrl,
  resolveCoverDescriptor,
} from "@/lib/media/cover-descriptor";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// ── The distinction the old flat fields could not express ───────────────────

test("a video is never a still, however it is spelled", () => {
  for (const url of [
    "videos/mixtapes-and-eps/love-hz-vol-1/love-hz-vol-1.mp4",
    "https://pub-643e.r2.dev/videos/singles/all-yourz/all-yourz.mov",
    "/videos/A2B-720p.mp4",
    "/x/y.webm",
    "/x/y.m4v",
  ]) {
    assert.equal(isStillUrl(url), false, `${url} must not pass as a still`);
    assert.equal(isMotionUrl(url), true, `${url} should read as motion`);
  }
});

test("a discovery URL is motion-shaped and never a still", () => {
  // /api/media/visual 302s to whichever asset it finds and PREFERS VIDEO —
  // exactly the wrong answer for a poster. This is the specific value that was
  // reaching <video poster> and rendering black.
  const discovery = "/api/media/visual?releaseType=singles&slug=turnt-me-2-dis&legacyVideo=x.mp4";
  assert.equal(isStillUrl(discovery), false);
  assert.equal(isMotionUrl(discovery), true);
  // Absolute form must behave identically.
  assert.equal(isStillUrl(`https://www.2mrrw.com${discovery}`), false);
});

test("real artwork passes as a still and never as motion", () => {
  for (const url of [
    "/images/singles/turnt.jpg",
    "/images/albums/ad.JPG",
    "https://pub-643e.r2.dev/images/mixtapes-and-eps/tbh/tbh.jpg",
    "/images/features/n-2-k-5.png",
    "/_next/image?url=%2Fimages%2Falbums%2Fad.JPG&w=640&q=75",
  ]) {
    assert.equal(isStillUrl(url), true, `${url} should be a still`);
    assert.equal(isMotionUrl(url), false, `${url} must not read as motion`);
  }
});

// ── Resolution ──────────────────────────────────────────────────────────────

test("a video offered as a still is skipped, not accepted", () => {
  // The whole point of the module: passing the wrong thing cannot corrupt the
  // still slot, it just falls through to the next candidate.
  const d = resolveCoverDescriptor({
    still: ["videos/x/y.mp4", "/images/singles/turnt.jpg"],
    motion: "videos/x/y.mp4",
  });
  assert.equal(d.still, "/images/singles/turnt.jpg");
  assert.equal(d.motion, "videos/x/y.mp4");
  assert.equal(d.type, "video");
});

test("candidates are tried in order, best first", () => {
  const d = resolveCoverDescriptor({
    still: [null, "", "/images/a.jpg", "/images/b.jpg"],
    motion: [null, "/videos/v.mp4"],
  });
  assert.equal(d.still, "/images/a.jpg");
  assert.equal(d.motion, "/videos/v.mp4");
});

test("no motion means type image and motion null", () => {
  const d = resolveCoverDescriptor({ still: "/images/albums/tbh.jpg", motion: null });
  assert.equal(d.type, "image");
  assert.equal(d.motion, null);
});

test("the placeholder catches a release with no usable still at all", () => {
  // Without this a motion-only release would have a null poster, which is how
  // a card ends up black.
  const d = resolveCoverDescriptor({
    still: ["videos/only/motion.mp4"],
    motion: "videos/only/motion.mp4",
    placeholder: "/images/placeholder/artwork.jpg",
  });
  assert.equal(d.still, "/images/placeholder/artwork.jpg");
  assert.equal(d.type, "video");
});

test("the descriptor is frozen, so no consumer can mutate shared catalog state", () => {
  const d = resolveCoverDescriptor({ still: "/images/a.jpg" });
  assert.throws(() => { "use strict"; d.still = "/images/b.jpg"; });
});

// ── The legacy view ─────────────────────────────────────────────────────────

test("legacy fields keep their historical meaning", () => {
  // 51 files read these. `cover` must stay "motion when there is motion,
  // still otherwise" or every one of them changes behaviour.
  const motion = coverDescriptorToLegacyFields(
    resolveCoverDescriptor({ still: "/images/a.jpg", motion: "/videos/v.mp4" })
  );
  assert.deepEqual(motion, {
    cover: "/videos/v.mp4",
    baseCover: "/images/a.jpg",
    coverArtType: "video",
    video: "/videos/v.mp4",
  });

  const stillOnly = coverDescriptorToLegacyFields(
    resolveCoverDescriptor({ still: "/images/a.jpg", motion: null })
  );
  assert.deepEqual(stillOnly, {
    cover: "/images/a.jpg",
    baseCover: "/images/a.jpg",
    coverArtType: "image",
    video: undefined,
  });
});

test("baseCover from the legacy view is always safe for an <img>", () => {
  // The invariant that stops the poster bug recurring, stated as a property.
  for (const input of [
    { still: "/images/a.jpg", motion: "/videos/v.mp4" },
    { still: "/videos/v.mp4", motion: "/videos/v.mp4", placeholder: "/images/p.jpg" },
    { still: "/api/media/visual?slug=x", motion: "/api/media/visual?slug=x", placeholder: "/images/p.jpg" },
  ]) {
    const { baseCover } = coverDescriptorToLegacyFields(resolveCoverDescriptor(input));
    assert.ok(isStillUrl(baseCover), `baseCover ${baseCover} is not renderable in an <img>`);
  }
});

// ── The catalog derives its cover fields from one decision ──────────────────

test("every release resolves a still that is safe for an <img>", async () => {
  // The property that matters, asserted against the real catalog rather than
  // fixtures: no release may end up with a video or a discovery URL in the
  // slot that <img> and <video poster> read.
  const { CANONICAL_SINGLES, CANONICAL_FEATURES, CANONICAL_ALBUMS, getCanonicalReleaseBySlug } =
    await import("@/lib/media/canonical-catalog");
  const { withR2CatalogMedia } = await import("@/lib/media/r2-catalog-media");

  const releases = [...CANONICAL_SINGLES, ...CANONICAL_FEATURES, ...CANONICAL_ALBUMS];
  assert.ok(releases.length >= 9, "expected the canonical catalog to be populated");

  for (const r of releases) {
    const m = withR2CatalogMedia({ ...getCanonicalReleaseBySlug(r.slug) });
    assert.ok(
      isStillUrl(m.baseCover),
      `${r.slug}: baseCover ${m.baseCover} is not renderable in an <img>`
    );
    // And a still must be absolute, or it resolves against the current route.
    assert.ok(
      /^(https?:)?\/\//i.test(m.baseCover) || m.baseCover.startsWith("/"),
      `${r.slug}: baseCover ${m.baseCover} is relative`
    );
  }
});

test("withR2CatalogMedia derives the legacy fields, never recomputes them", () => {
  const source = read("src/lib/media/r2-catalog-media.js");

  assert.match(source, /from "@\/lib\/media\/cover-descriptor"/);
  assert.match(source, /const coverIdentity = resolveCoverDescriptor\(\{/);
  assert.match(source, /const legacy = coverDescriptorToLegacyFields\(coverIdentity\);/);

  // The old independent recomputations must stay gone. coverArtType derived
  // from `video` alone is what made an inherited track "image"; baseCover
  // re-resolved separately is what let a video URL land in it.
  assert.doesNotMatch(source, /next\.coverArtType = next\.video \? "video"/);
  assert.doesNotMatch(source, /next\.baseCover = resolveCatalogMediaField\(next\.cover/);
});

test("the descriptor is exposed on the item so surfaces can stop guessing", () => {
  const source = read("src/lib/media/r2-catalog-media.js");
  assert.match(source, /next\.coverIdentity = coverIdentity;/);
});

// ── The invariant, enforced across the app ──────────────────────────────────

test("no <video poster> in the app is fed a motion or discovery source", () => {
  // This is the test that would have caught Turnt Me 2 Dis rendering black the
  // day it shipped. A poster may only ever receive a still.
  //
  // Inspect ONLY the value inside the braces. Matching against the whole
  // `poster={...}` expression makes the allow-list match the literal word
  // "poster" in the attribute name, which silently skips every case — the
  // first version of this test did exactly that and passed while the bug was
  // present.
  const FORBIDDEN = /\b(?:cover|visual|video|motion)\b/i;
  const ALLOWED = /\b(?:baseCover|still|posterUrl|poster_url|posterKey|artwork|HERO_POSTER)\b/;

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== "__tests__") walk(rel); }
      else if (entry.name.endsWith(".js")) files.push(rel);
    }
  };
  walk("src/components");
  walk("src/ui");

  let inspected = 0;
  for (const file of files) {
    const source = read(file);
    for (const [, value] of source.matchAll(/poster=\{([^}]*)\}/g)) {
      inspected += 1;
      if (ALLOWED.test(value)) continue;
      assert.ok(
        !FORBIDDEN.test(value),
        `${file}: poster={${value.trim()}} — a poster must receive a still, never cover/visual/video`
      );
    }
  }
  // Guard against the regex silently matching nothing and the test passing
  // vacuously, which is the other way this kind of check rots.
  assert.ok(inspected >= 8, `expected to inspect the app's posters, saw ${inspected}`);
});

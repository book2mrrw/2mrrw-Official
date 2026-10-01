import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MEDIA_FAILED,
  MEDIA_PENDING,
  MEDIA_READY,
  isMediaElementFailed,
  isMediaElementReady,
  mediaElementOutcome,
  mediaReadyEventName,
} from "@/lib/media/element-readiness";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

/**
 * Every `<img .../>` element literal in a source file. Requires whitespace
 * after the tag name so a bare `<img>` mentioned in prose is not matched.
 */
function imageElements(source) {
  return source.match(/<img\s[\s\S]*?\/>/g) || [];
}

// ── The defect, as a unit ───────────────────────────────────────────────────
//
// The static covers for 2MRRW: (A.D) and T.B.H finished downloading before
// React hydrated, so the `load` event fired with no listener attached and was
// never replayed. Element state is the only thing that can still report it.

test("an image that settled before any listener attached is still reported ready", () => {
  const settledBeforeHydration = { src: "/images/albums/ad.JPG", complete: true, naturalWidth: 1600 };

  assert.equal(mediaElementOutcome(settledBeforeHydration, "image"), MEDIA_READY);
  assert.equal(isMediaElementReady(settledBeforeHydration, "image"), true);
});

test("a broken image reports failed rather than ready, even though it is complete", () => {
  // A decode failure also sets `complete`, so `complete` alone is not
  // readiness. This is also what recovers a dropped `error` event.
  const broken = { src: "/images/albums/missing.jpg", complete: true, naturalWidth: 0 };

  assert.equal(mediaElementOutcome(broken, "image"), MEDIA_FAILED);
  assert.equal(isMediaElementFailed(broken, "image"), true);
  assert.equal(isMediaElementReady(broken, "image"), false);
});

test("an image still in flight is pending, so the event path stays in charge", () => {
  const inFlight = { src: "/images/albums/tbh.jpg", complete: false, naturalWidth: 0 };

  assert.equal(mediaElementOutcome(inFlight, "image"), MEDIA_PENDING);
});

test("an intrinsically sizeless SVG is ready on complete, not treated as a decode failure", () => {
  // Every catalog cover is raster today, so this guards a future regression
  // rather than current behaviour: an SVG with no width/height attributes can
  // decode successfully and still report naturalWidth 0.
  const svg = { src: "/images/placeholder/artwork.svg", complete: true, naturalWidth: 0 };
  const svgWithQuery = { src: "/icons/mark.svgz?v=3", complete: true, naturalWidth: 0 };
  const raster = { src: "/images/albums/ad.JPG", complete: true, naturalWidth: 0 };

  assert.equal(mediaElementOutcome(svg, "image"), MEDIA_READY);
  assert.equal(mediaElementOutcome(svgWithQuery, "image"), MEDIA_READY);
  assert.equal(mediaElementOutcome(raster, "image"), MEDIA_FAILED);
});

test("a source-less or detached element is pending, never failed", () => {
  // An <img> with no src reports complete:true / naturalWidth:0, which must
  // not be mistaken for a decode failure. Protects SSR and detached refs.
  assert.equal(mediaElementOutcome({ complete: true, naturalWidth: 0 }, "image"), MEDIA_PENDING);
  assert.equal(mediaElementOutcome(null, "image"), MEDIA_PENDING);
  assert.equal(mediaElementOutcome(undefined, "video"), MEDIA_PENDING);
});

test("currentSrc alone is enough to consider a source resolved", () => {
  const resolved = { currentSrc: "/images/albums/ad.JPG", complete: true, naturalWidth: 1600 };

  assert.equal(mediaElementOutcome(resolved, "image"), MEDIA_READY);
});

test("video readiness is HAVE_CURRENT_DATA or better, and errors are terminal", () => {
  const src = "videos/mixtapes-and-eps/love-hz-vol-1/love-hz-vol-1.mp4";

  assert.equal(mediaElementOutcome({ src, readyState: 0 }, "video"), MEDIA_PENDING);
  assert.equal(mediaElementOutcome({ src, readyState: 1 }, "video"), MEDIA_PENDING);
  assert.equal(mediaElementOutcome({ src, readyState: 2 }, "video"), MEDIA_READY);
  assert.equal(mediaElementOutcome({ src, readyState: 4 }, "video"), MEDIA_READY);
  assert.equal(mediaElementOutcome({ src, readyState: 4, error: { code: 4 } }, "video"), MEDIA_FAILED);
});

test("readiness event name matches the element kind", () => {
  assert.equal(mediaReadyEventName("image"), "load");
  assert.equal(mediaReadyEventName("video"), "loadeddata");
});

// ── The contract that stops the defect from coming back ─────────────────────

test("CoverArt never swaps which element it renders once mounted", () => {
  // REGRESSION. The skeleton branch used to read
  // `!presentationSnapshot?.coverReady`. That was safe only because coverReady
  // could never become true — the one thing that set it was a React onLoad
  // attached after the image had already loaded, so the event was dropped.
  //
  // Making readiness real switched the flag on for the first time, the
  // condition inverted mid-life, and ArtworkSkeleton unmounted with a
  // different <img> mounting in its place on every card. A remount inside the
  // release card subtree swallows the first press on the play button.
  //
  // The branch must depend only on props, never on a value that changes while
  // mounted.
  const coverArt = read("src/components/ui/CoverArt.js");
  assert.match(
    coverArt,
    /if \(skeleton && src\) \{/,
    "the skeleton branch must be decided by props alone"
  );
  assert.doesNotMatch(
    coverArt,
    /if \(skeleton && src && [^)]*coverReady/,
    "the skeleton branch must not read coverReady — it flips while mounted and remounts the subtree"
  );
});

test("the persisted static fallback is decided at mount, never re-read while mounted", () => {
  // REGRESSION, same class as above. persistedStaticFallback picks VideoArt vs
  // <img>. It read the shared presentation registry on every render; once
  // readiness was real, another surface loading the release's still made it
  // flip on any later re-render, swapping the video for an <img> mid-life.
  const coverArt = read("src/components/ui/CoverArt.js");
  const init = coverArt.match(/const \[mountFallback\] = useState\(\(\) => \{([\s\S]*?)\n  \}\);/)?.[1] || "";
  assert.ok(init, "the fallback must be latched in a useState initializer");
  assert.match(init, /getReleasePresentation\(presentationIdentity\)/);
  assert.match(init, /presentationSnapshot\?\.coverReady/);
  const outside = coverArt.replace(init, "");
  assert.equal(
    (outside.match(/getReleasePresentation\(/g) || []).length,
    0,
    "the registry must not be read during render outside the mount-time initializer"
  );
  assert.match(coverArt, /const persistedStaticFallback = mountFallback\.src === src && mountFallback\.isStatic;/);
});

test("the readiness hook reads element state before it ever subscribes to an event", () => {
  const hook = read("src/hooks/useCoverReady.js");

  const stateCheck = hook.indexOf("mediaElementOutcome(element, kind)");
  const subscribe = hook.indexOf("element.addEventListener");

  assert.ok(stateCheck > -1, "expected useCoverReady to consult mediaElementOutcome");
  assert.ok(subscribe > -1, "expected useCoverReady to subscribe for genuinely pending media");
  assert.ok(
    stateCheck < subscribe,
    "element state must be read before subscribing, or a settled element is never reported"
  );
  // Listeners must be torn down, or a re-attached element leaks a subscription.
  assert.match(hook, /removeEventListener\(readyEvent, handleReady\)/);
  assert.match(hook, /removeEventListener\("error", handleFailed\)/);
});

test("no cover image gates its reveal on a load event alone", () => {
  // ArtworkSkeleton owns one cover image; CoverArt owns two (primary + the
  // static fallback used when a motion cover fails).
  for (const [file, expected] of [
    ["src/ui/skeletons/ArtworkSkeleton.js", 1],
    ["src/components/ui/CoverArt.js", 2],
  ]) {
    const source = read(file);
    const images = imageElements(source);
    assert.equal(images.length, expected, `expected ${expected} <img> element(s) in ${file}`);

    for (const image of images) {
      assert.doesNotMatch(
        image,
        /onLoad=/,
        `${file}: an <img> still reveals on onLoad — a cover that loads before hydration is stranded`
      );
      assert.match(
        image,
        /ref=\{attach(?:Image|CoverImage)\}/,
        `${file}: every cover <img> must route readiness through useCoverReady`
      );
    }
  }
});

test("the skeleton reveal is driven by element state, with the pipeline as a second source", () => {
  const skeleton = read("src/ui/skeletons/ArtworkSkeleton.js");

  // Element state is authoritative; a decoded pipeline entry remains a valid
  // additional proof, but can no longer be the only non-event source.
  assert.match(skeleton, /const loaded = isVideo \? videoLoadedSrc === src : imageReady \|\| pipelineDecoded/);
  assert.match(skeleton, /imagePipeline\.getFromCache\(src, \{ coverArtType: type \}\)/);
  assert.match(skeleton, /opacity: loaded \? 1 : 0/);

  // A re-attached, already-decoded video will not fire `loadeddata` again.
  assert.match(skeleton, /isMediaElementReady\(el, "video"\)/);
});

test("CoverArt subscribes readiness for whichever single image it owns", () => {
  const coverArt = read("src/components/ui/CoverArt.js");

  assert.match(
    coverArt,
    /const ownedImageSrc =\s*\n?\s*mediaType === "video" \? \(eff === FL_STATIC \? baseCover : null\) : src;/
  );
  assert.match(coverArt, /useCoverReady\(\{/);
  assert.match(coverArt, /onFailed: handleImgError/);

  // The hook must sit above the early returns, or it becomes conditional.
  const hookCall = coverArt.indexOf("useCoverReady({");
  const firstEarlyReturn = coverArt.indexOf("if (skeleton && src) {");
  assert.ok(hookCall > -1 && firstEarlyReturn > -1);
  assert.ok(hookCall < firstEarlyReturn, "useCoverReady must be called unconditionally");
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isConcreteVideoAssetPath, mapProductRow } from "../catalog-db.js";
import { withR2CatalogMedia } from "../r2-catalog-media.js";
import { catalogCoverDisplay } from "../../../components/home/catalogMedia.js";

const LIVE_AT = "2026-01-01T00:00:00.000Z";

function productRow(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    release_id: "00000000-0000-4000-8000-000000000002",
    slug: "canonical-single",
    title: "Canonical Single",
    product_type: "single",
    release_type: "singles",
    release_date: "2026-01-01",
    price_cents: 299,
    cover_url: "/images/singles/canonical-single/cover.jpg",
    metadata: { artist: "2MRRW", release_category: "single" },
    active: true,
    gifting_enabled: false,
    releases: {
      id: "00000000-0000-4000-8000-000000000002",
      status: "published",
      available_at: LIVE_AT,
      storefront_visible: true,
      upcoming_visible: false,
    },
    ...overrides,
  };
}

test("canonical product mapper emits the shared release identity aliases", () => {
  const release = mapProductRow(productRow());

  assert.equal(release.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(release.slug, "canonical-single");
  assert.equal(release.artist, "2MRRW");
  assert.equal(release.release_date, "2026-01-01");
  assert.equal(release.releaseDate, "2026-01-01");
  assert.equal(release.type, "single");
  assert.deepEqual(release.tracks, []);
  assert.equal(release.availability.live, true);
  assert.equal(release.availability.visible, true);
});

test("canonical product mapper delegates scheduled visibility to releaseAvailability", () => {
  const release = mapProductRow(productRow({
    active: true,
    releases: {
      id: "00000000-0000-4000-8000-000000000002",
      status: "scheduled",
      available_at: "2099-01-01T00:00:00.000Z",
      storefront_visible: false,
      upcoming_visible: true,
      preview_before_release: false,
    },
  }));

  assert.equal(release.availability.phase, "upcoming");
  assert.equal(release.availability.live, false);
  assert.equal(release.availability.visible, true);
  assert.equal(release.availability.canPlayFull, false);
});

test("folder-valued video_path never asserts that a motion object exists", () => {
  assert.equal(isConcreteVideoAssetPath("videos/mixtapes-and-eps/tbh/"), false);
  assert.equal(isConcreteVideoAssetPath("videos/mixtapes-and-eps/tbh/tbh.mp4"), true);

  const mapped = mapProductRow(productRow({
    slug: "tbh",
    title: "Tbh",
    product_type: "album",
    release_type: "mixtapes-and-eps",
    cover_url: "/images/albums/tbh.jpg",
    image_path: "images/mixtapes-and-eps/tbh/",
    video_path: "videos/mixtapes-and-eps/tbh/",
    metadata: { release_category: "mixtape" },
  }));

  assert.equal(mapped.video, undefined);
  assert.equal(mapped.coverArtType, "image");
});

test("Love Hz DB row resolves the canonical hyphenated video and a static fallback", () => {
  const mapped = mapProductRow(productRow({
    slug: "love-hz-vol-1",
    title: "Love Hz Vol 1",
    product_type: "album",
    release_type: "mixtapes-and-eps",
    cover_url: "/images/albums/lovehz.jpg",
    image_path: "images/mixtapes-and-eps/love-hz-vol-1/",
    video_path: "videos/mixtapes-and-eps/love-hz-vol-1/",
    metadata: { release_category: "mixtape", r2_ingested: true },
  }));
  const resolved = withR2CatalogMedia(mapped);

  assert.match(resolved.video, /videos\/mixtapes-and-eps\/love-hz-vol-1\/love-hz-vol-1\.mp4$/);
  assert.doesNotMatch(resolved.video, /lovehzvol1\.mp4$/);
  assert.equal(resolved.baseCover, "/images/albums/lovehz.jpg");
  assert.equal(resolved.coverArtType, "video");
});

test("A.D DB row canonicalizes case-sensitive bundled artwork without changing other covers", () => {
  const ad = withR2CatalogMedia(mapProductRow(productRow({
    slug: "ad",
    title: "2MRRW: (A.D)",
    product_type: "album",
    release_type: "mixtapes-and-eps",
    cover_url: "/images/albums/ad.jpg",
    image_path: "images/mixtapes-and-eps/ad/",
    video_path: "videos/mixtapes-and-eps/ad/",
    metadata: { release_category: "mixtape", r2_ingested: true },
  })));
  const tbh = withR2CatalogMedia(mapProductRow(productRow({
    slug: "tbh",
    title: "T.B.H",
    product_type: "album",
    release_type: "mixtapes-and-eps",
    cover_url: "/images/albums/tbh.jpg",
    video_path: "videos/mixtapes-and-eps/tbh/",
    metadata: { release_category: "mixtape" },
  })));

  assert.equal(ad.cover, "/images/albums/ad.JPG");
  assert.equal(ad.baseCover, "/images/albums/ad.JPG");
  assert.equal(ad.video, undefined);
  assert.equal(tbh.cover, "/images/albums/tbh.jpg");
  assert.equal(tbh.baseCover, "/images/albums/tbh.jpg");
});

test("catalog video cards delegate fallback and persistent motion to CoverArt", () => {
  const source = readFileSync(path.join(process.cwd(), "src/components/home/CatalogGrid.js"), "utf8");
  const coverArt = readFileSync(path.join(process.cwd(), "src/components/ui/CoverArt.js"), "utf8");
  assert.match(source, /const staticFallback = mediaItem\?\.baseCover/);
  assert.match(source, /src=\{coverDisplay\.src\}/);
  assert.match(source, /baseCover=\{staticFallback\}/);
  assert.match(source, /type=\{coverDisplay\.type \|\| mediaItem\.coverArtType\}/);
  assert.doesNotMatch(source, /<video/);
  assert.match(coverArt, /poster=\{readyPoster \|\| undefined\}/);
  assert.match(coverArt, /preload="auto"/);
  assert.match(coverArt, /createPersistentVisualLifecycle/);
});

test("2MRRW Radio renders four distinct canonical motion artworks with static failure posters", () => {
  const slides = [
    ["hour-glass", "/images/singles/hourglass.jpg"],
    ["w2d", "/images/singles/w2d.jpg"],
    ["artificial", "/images/singles/artificial.jpg"],
    ["turnt-me-2-dis", "/images/singles/turnt.jpg"],
  ];
  const primarySources = new Set();

  for (const [slug, cover] of slides) {
    const enriched = withR2CatalogMedia({ slug, cover });
    assert.equal(enriched.coverArtType, "video", slug);
    assert.match(enriched.cover, /^\/api\/media\/visual\?/, slug);

    const display = catalogCoverDisplay(enriched);
    assert.match(display.src, new RegExp(`slug=${slug}(?:&|$)`), slug);
    assert.equal(display.type, "video", slug);
    assert.equal(enriched.baseCover, cover, slug);
    primarySources.add(display.src);
  }
  assert.equal(primarySources.size, slides.length);

  const source = readFileSync(path.join(process.cwd(), "src/components/home/RadioCarousel.js"), "utf8");
  assert.match(source, /catalogCoverDisplay\(currentSlide\)/);
  assert.match(source, /<CoverArt/);
  assert.match(source, /baseCover=\{currentSlide\.baseCover \|\| undefined\}/);
  assert.doesNotMatch(source, /<img[\s\S]*src=\{currentSlide\.cover\}/);
});

test("2MRRW Radio fallback posters are distinct release assets", () => {
  const posters = ["hourglass.jpg", "w2d.jpg", "artificial.jpg", "turnt.jpg"];
  const hashes = posters.map((filename) => {
    const bytes = readFileSync(path.join(process.cwd(), "public/images/singles", filename));
    assert.ok(bytes.length > 50_000, filename);
    return createHash("sha256").update(bytes).digest("hex");
  });

  assert.equal(new Set(hashes).size, posters.length);
});

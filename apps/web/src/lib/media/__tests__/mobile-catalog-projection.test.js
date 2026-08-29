import assert from "node:assert/strict";
import test from "node:test";

import { toMobileCatalogReleases } from "../mobile-catalog-projection.js";

test("mobile projection includes mixtapes and preserves exact Love Hz and A.D media", () => {
  const releases = toMobileCatalogReleases({
    singles: [],
    features: [],
    albums: [],
    mixtapes: [
      {
        id: "love-hz-id",
        slug: "love-hz-vol-1",
        title: "Love Hz Vol. 1",
        type: "ep",
        cover: "/images/albums/lovehz.jpg",
        baseCover: "/images/albums/lovehz.jpg",
        video: "https://pub.example/videos/mixtapes-and-eps/love-hz-vol-1/lovehzvol1.mp4",
        coverArtType: "video",
        tracks: [],
      },
      {
        id: "ad-id",
        slug: "ad",
        title: "2MRRW: (A.D)",
        type: "mixtape",
        cover: "https://www.2mrrw.com/images/albums/ad.jpg",
        baseCover: "https://www.2mrrw.com/images/albums/ad.jpg",
        coverArtType: "image",
        tracks: [],
      },
    ],
  }, "https://www.2mrrw.com");

  assert.equal(releases.length, 2);
  const loveHz = releases.find((release) => release.slug === "love-hz-vol-1");
  const ad = releases.find((release) => release.slug === "ad");

  assert.equal(loveHz.cover, "https://www.2mrrw.com/images/albums/lovehz.jpg");
  assert.match(
    loveHz.video,
    /\/videos\/mixtapes-and-eps\/love-hz-vol-1\/love-hz-vol-1\.mp4$/
  );
  assert.equal(loveHz.coverArtType, "video");
  assert.equal(ad.cover, "https://www.2mrrw.com/images/albums/ad.JPG");
  assert.equal(ad.video, null);
  assert.equal(ad.coverArtType, "image");
});

test("mobile projection returns absolute URLs without changing media quality", () => {
  const [release] = toMobileCatalogReleases({
    singles: [{
      id: "one",
      slug: "noncanonical-release",
      title: "One",
      artist: "2MRRW",
      type: "single",
      cover: "/images/one.jpg",
      coverArtType: "image",
      tracks: [{
        id: "track-one",
        slug: "track-one",
        title: "Track One",
        preview: "/api/media/audio?key=one",
      }],
    }],
  }, "https://www.2mrrw.com");

  assert.equal(release.cover, "https://www.2mrrw.com/images/one.jpg");
  assert.equal(
    release.tracks[0].preview,
    "https://www.2mrrw.com/api/media/audio?key=one"
  );
});

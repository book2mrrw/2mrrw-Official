import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalogPlaybackLookup, mapAlbumTracksForPlayback, normalizeCatalogItemForPlayback, toPlaybackTrack } from "@/lib/music-playback";
import { withR2CatalogMedia } from "@/lib/media/r2-catalog-media";
import { normalizeTrack, resolvePlaybackPresentation } from "@/lib/playback/playback-track-utils";

import { recoveryFixture } from "./recovery-fixture.mjs";

const album = {
  slug: "continuity-release", title: "Release", release_type: "ep",
  cover: "https://cdn.example/release.mp4", video: "https://cdn.example/release.mp4",
  baseCover: "https://cdn.example/release.jpg", coverArtType: "video",
  tracks: [
    { slug: "first", title: "First", preview: "/first.mp3" },
    { slug: "second", title: "Second", preview: "/second.mp3",
      visual: "https://cdn.example/single.mp4", motion_cover_url: "https://cdn.example/single.mp4",
      cover_art_url: "https://cdn.example/single.jpg", coverIdentity: { still: "https://cdn.example/single.jpg", motion: "https://cdn.example/single.mp4", type: "video" } },
  ],
};

test("shared release artwork cache never replaces track data", () => {
  const base = { slug: "cache-release", cover: "/release.jpg" };
  const first = withR2CatalogMedia({ ...base, title: "One", trackSlug: "one", preview: "/same.mp3" });
  const second = withR2CatalogMedia({ ...base, title: "Two", trackSlug: "two", preview: "/same.mp3" });
  assert.equal(first.trackSlug, "one");
  assert.equal(second.trackSlug, "two");
  assert.equal(second.title, "Two");
});

test("normalization cache notices still-only artwork changes", () => {
  const base = { slug: "poster-change", cover: "/motion.mp4", video: "/motion.mp4" };
  withR2CatalogMedia({ ...base, baseCover: "https://cdn.example/old.jpg" });
  assert.equal(withR2CatalogMedia({ ...base, baseCover: "https://cdn.example/new.jpg" }).baseCover, "https://cdn.example/new.jpg");
});

for (const release_type of ["album", "mixtape", "ep"]) {
  test(`${release_type}: queue and repeated normalization retain release art despite single aliases`, () => {
    const queue = mapAlbumTracksForPlayback({ ...album, slug: `continuity-${release_type}`, release_type }, {});
    assert.equal(queue.length, 2);
    assert.notEqual(queue[0].metadata.trackSlug, queue[1].metadata.trackSlug);
    for (const track of queue) {
      const presented = resolvePlaybackPresentation(normalizeTrack(track), false, false);
      assert.equal(presented.cover, album.cover);
      assert.equal(presented.baseCover, album.baseCover);
      assert.equal(presented.coverArtType, "video");
    }
  });
}

test("static release suppresses a track's single animation", () => {
  const queue = mapAlbumTracksForPlayback({ ...album, slug: "static-release", video: null,
    cover: "https://cdn.example/static.jpg", baseCover: "https://cdn.example/static.jpg", coverArtType: "image" }, {});
  for (const track of queue) {
    assert.equal(track.cover, "https://cdn.example/static.jpg");
    assert.equal(track.coverArtType, "image");
  }
});

test("standalone single keeps its own artwork", () => {
  const single = toPlaybackTrack(normalizeCatalogItemForPlayback({ slug: "independent-single",
    title: "Single", cover: "https://cdn.example/single.jpg", video: "https://cdn.example/single.mp4", preview: "/single.mp3" }), {});
  assert.equal(single.cover, "https://cdn.example/single.mp4");
  assert.equal(single.baseCover, "https://cdn.example/single.jpg");
});


test("natural ended handoff carries the same release motion and still to the next recording", t => {
  const h = recoveryFixture(t);
  const queue = mapAlbumTracksForPlayback(album, { isAdmin: true }).map(normalizeTrack);
  h.deps.queueRef.current = queue;
  h.deps.queueIndexRef.current = 0;
  h.state.currentTrack = queue[0];
  h.state.isPlaying = true;
  h.audio.currentTime = h.audio.duration;
  h.audio.ended = true;
  const originalAudio = h.deps.audioRef.current;
  let handoff;
  h.deps.requestAuthoritativePlay = (track, options, occurrence) => {
    handoff = { track: resolvePlaybackPresentation(normalizeTrack(track), false, false), options, occurrence };
    return true;
  };
  h.handlers().onEnded();
  assert.ok(handoff, "natural completion must request the next recording");
  assert.equal(handoff.track.metadata.trackSlug, "second");
  assert.equal(handoff.track.cover, album.cover);
  assert.equal(handoff.track.baseCover, album.baseCover);
  assert.equal(handoff.occurrence.queueIndex, 1);
  assert.equal(handoff.occurrence.queueEntries, queue);
  assert.equal(h.deps.audioRef.current, originalAudio);
});

test("legacy title tracks resolved through single lookup inherit release art and retain titles", () => {
  const lookup = buildCatalogPlaybackLookup([{ slug: "second-single", title: "Second",
    cover: "https://cdn.example/single.jpg", visual: "https://cdn.example/single.mp4",
    video: "https://cdn.example/single.mp4", preview: "/second.mp3" }]);
  const queue = mapAlbumTracksForPlayback({ ...album, tracks: ["First", "Second"] }, {}, "album", lookup);
  assert.deepEqual(queue.map(t => t.title), ["First", "Second"]);
  for (const track of queue) {
    assert.equal(track.cover, album.cover);
    assert.equal(track.baseCover, album.baseCover);
  }
});

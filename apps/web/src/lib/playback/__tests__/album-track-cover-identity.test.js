import assert from "node:assert/strict";
import test from "node:test";

import { albumCardPlaybackItem, resolveAlbumTrackPlaybackItem } from "@/lib/music-playback";

/**
 * A track played from an album/mixtape/EP must carry that release's FULL cover
 * identity, not just its `cover` string.
 *
 * Inheriting `cover` alone left `coverArtType` undefined, so
 * normalizeCatalogItemForPlayback fell back to `track.video ? "video" :
 * "image"` and settled on "image"; with no `baseCover` to separate them it then
 * set `cover` and `baseCover` to the same value. For a release with a motion
 * cover that value is the .mp4 — which broke two things at once:
 *
 *   1. GlobalAudioPlayerBar gates the animated cover on
 *      `coverArtType === "video" && cover !== baseCover`, which could never
 *      pass, so a mixtape/EP played with no animated art in the player.
 *   2. The static layer received a video URL as an <img> src.
 */

const MOTION_ALBUM = Object.freeze({
  slug: "love-hz-vol-1",
  release_type: "ep",
  title: "Love Hz Vol. 1",
  cover: "https://pub-643e.r2.dev/videos/mixtapes-and-eps/love-hz-vol-1/love-hz-vol-1.mp4",
  baseCover: "/images/albums/lovehz.jpg",
  video: "videos/mixtapes-and-eps/love-hz-vol-1/love-hz-vol-1.mp4",
  coverArtType: "video",
  tracks: [{ slug: "01-roll-call", title: "Roll Call" }],
});

const STATIC_ALBUM = Object.freeze({
  slug: "tbh",
  release_type: "mixtape",
  title: "T.B.H",
  cover: "/images/albums/tbh.jpg",
  baseCover: "/images/albums/tbh.jpg",
  coverArtType: "image",
  tracks: [{ slug: "01-glass-full", title: "Glass Full" }],
});

/** The exact condition GlobalAudioPlayerBar uses to decide on animated art. */
function playerWouldAnimate(track) {
  const baseCover = track?.baseCover || track?.cover;
  return Boolean(
    track?.coverArtType === "video" && track?.cover && track.cover !== baseCover
  );
}

test("a track from a motion-cover release keeps coverArtType video", () => {
  const track = resolveAlbumTrackPlaybackItem(MOTION_ALBUM, MOTION_ALBUM.tracks[0], 0, null);
  assert.equal(track.coverArtType, "video");
});

test("cover and baseCover stay distinct, so the player can show animated art", () => {
  const track = resolveAlbumTrackPlaybackItem(MOTION_ALBUM, MOTION_ALBUM.tracks[0], 0, null);

  assert.ok(track.cover, "expected a cover");
  assert.ok(track.baseCover, "expected a baseCover");
  assert.notEqual(track.cover, track.baseCover, "collapsing these hides the animated cover");
  assert.ok(playerWouldAnimate(track), "GlobalAudioPlayerBar would not animate this track");
});

test("the static layer never receives a video URL", () => {
  const track = resolveAlbumTrackPlaybackItem(MOTION_ALBUM, MOTION_ALBUM.tracks[0], 0, null);
  assert.doesNotMatch(
    String(track.baseCover),
    /\.(mp4|webm|mov)(\?|#|$)/i,
    "baseCover is rendered in an <img>; a video URL there is a broken image"
  );
});

test("pressing play on the release card carries the same identity", () => {
  // albumCardPlaybackItem is what a release card hands the player.
  const item = albumCardPlaybackItem(MOTION_ALBUM, null);
  assert.equal(item.coverArtType, "video");
  assert.ok(playerWouldAnimate(item));
});

test("a string track title inherits the identity too", () => {
  // The legacy shape: tracks as plain title strings rather than objects.
  const track = resolveAlbumTrackPlaybackItem(MOTION_ALBUM, "Roll Call", 0, null);
  assert.equal(track.coverArtType, "video");
  assert.ok(playerWouldAnimate(track));
});

test("a static-cover release is unaffected and never claims to be animated", () => {
  const track = resolveAlbumTrackPlaybackItem(STATIC_ALBUM, STATIC_ALBUM.tracks[0], 0, null);

  assert.equal(track.coverArtType, "image");
  assert.equal(playerWouldAnimate(track), false);
  assert.match(String(track.baseCover), /\.jpg$/i);
});

test("a track's own baseCover is preserved rather than overwritten by the release", () => {
  // Documents real behaviour, which is narrower than it looks: an album track
  // is normalised under the RELEASE slug, so mergeCanonicalMetadata re-derives
  // coverArtType and cover from the canonical release and the release wins
  // those two. Per-track art is not a supported override today.
  //
  // What the fix must still guarantee is that inheritance is all-or-nothing:
  // a track carrying its own art keeps that art as its static layer, instead
  // of being handed the release's baseCover and silently losing it.
  const album = {
    ...MOTION_ALBUM,
    tracks: [{ slug: "x", title: "X", cover: "/images/track-x.jpg", coverArtType: "image" }],
  };
  const track = resolveAlbumTrackPlaybackItem(album, album.tracks[0], 0, null);

  assert.match(String(track.baseCover), /track-x\.jpg$/, "the track's own art must survive");
  assert.doesNotMatch(String(track.baseCover), /\.(mp4|webm|mov)(\?|#|$)/i);
});

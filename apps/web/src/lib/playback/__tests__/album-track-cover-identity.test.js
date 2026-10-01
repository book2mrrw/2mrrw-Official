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

test("the release's art wins over a track's own when played from its track list", () => {
  // SUPERSEDES an earlier assertion that a track's own baseCover survived here.
  //
  // That assertion documented observed behaviour rather than an intended rule —
  // its own note conceded "per-track art is not a supported override today" —
  // and it was really guarding against a narrower bug: a track cover paired with
  // the release's baseCover, which lost the track's art while keeping neither
  // identity whole. The guarantee it was protecting (never a mixed pair, never a
  // video URL in the static slot) still holds, and is still asserted below.
  //
  // The rule is now explicit: playing from a release's track list means the
  // release's artwork. Letting a track's own art win is precisely what made the
  // player swap covers partway through an album, because a track that is also a
  // single arrives carrying the single's artwork.
  const album = {
    ...MOTION_ALBUM,
    tracks: [{ slug: "x", title: "X", cover: "/images/track-x.jpg", coverArtType: "image" }],
  };
  const track = resolveAlbumTrackPlaybackItem(album, album.tracks[0], 0, null);

  assert.equal(track.baseCover, MOTION_ALBUM.baseCover, "the release's static layer must win");
  assert.equal(track.coverArtType, "video", "and its motion identity with it");
  // The original guarantee, unchanged: the static layer is never a video URL.
  assert.doesNotMatch(String(track.baseCover), /\.(mp4|webm|mov)(\?|#|$)/i);
});

// ── A track that is ALSO released as a single ────────────────────────────────
//
// The reported symptom: track 1 of Love Hz Vol. 1 showed the right animated
// cover in the global player and later tracks did not. The cause is that a track
// which is also a single resolves through the catalog lookup, and that lookup
// returns the SINGLE's artwork. Playing from the release's track list must use
// the RELEASE's artwork regardless.

/** A catalogLookup whose entries carry their own (single) cover identity. */
const SINGLE_LOOKUP = {
  bySlug: new Map([
    ["02-all-yourz", {
      slug: "all-yourz",
      title: "ALL YOURZ",
      cover: "https://pub-643e.r2.dev/images/singles/all-yourz/all-yourz.jpeg",
      baseCover: "https://pub-643e.r2.dev/images/singles/all-yourz/all-yourz.jpeg",
      coverArtType: "image",
    }],
  ]),
  byTitle: new Map([
    ["all yourz", {
      slug: "all-yourz",
      title: "ALL YOURZ",
      cover: "https://pub-643e.r2.dev/images/singles/all-yourz/all-yourz.jpeg",
      baseCover: "https://pub-643e.r2.dev/images/singles/all-yourz/all-yourz.jpeg",
      coverArtType: "image",
    }],
  ]),
};

test("an album track that is also a single uses the ALBUM's cover, not the single's", () => {
  const track = resolveAlbumTrackPlaybackItem(
    MOTION_ALBUM,
    { slug: "02-all-yourz", title: "ALL YOURZ" },
    1,
    SINGLE_LOOKUP
  );
  assert.equal(track.coverArtType, "video", "the album is animated, so the track must be too");
  assert.equal(track.baseCover, MOTION_ALBUM.baseCover);
  assert.doesNotMatch(String(track.baseCover), /all-yourz/, "the single's artwork leaked in");
  assert.ok(playerWouldAnimate(track), "the player would not animate this track");
});

test("same track as a bare title string also uses the album's cover", () => {
  // The string branch resolves through byTitle, which returns the single too.
  const track = resolveAlbumTrackPlaybackItem(MOTION_ALBUM, "ALL YOURZ", 1, SINGLE_LOOKUP);
  assert.equal(track.coverArtType, "video");
  assert.doesNotMatch(String(track.baseCover), /all-yourz/);
  assert.ok(playerWouldAnimate(track));
});

test("every track in a release resolves the same cover identity", () => {
  // The property behind the symptom: walking the whole track list must not
  // change artwork partway through.
  const tracks = [
    "Roll Call",
    { slug: "02-all-yourz", title: "ALL YOURZ" },
    { slug: "03-own-art", title: "Own Art", cover: "/images/singles/turnt.jpg" },
  ];
  const resolved = tracks.map((t, i) =>
    resolveAlbumTrackPlaybackItem(MOTION_ALBUM, t, i, SINGLE_LOOKUP)
  );
  const identities = new Set(
    resolved.map((t) => `${t.cover}|${t.baseCover}|${t.coverArtType}`)
  );
  assert.equal(identities.size, 1, `artwork changed mid-album: ${[...identities].join(" vs ")}`);
  for (const t of resolved) assert.ok(playerWouldAnimate(t));
});

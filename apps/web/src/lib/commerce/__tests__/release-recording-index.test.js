import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleaseRecordingIndex,
  recordingKey,
  releasesContainingStandalone,
  standaloneSlugsUnlockedByReleases,
} from "@/lib/commerce/release-recording-index";
import { getCanonicalTracksForAlbum } from "@/lib/media/canonical-catalog";
import { resolveTrackAccess } from "@/lib/music-access";

// Shapes mirror production rows (catalog_tracks + products) as of 2026-10-02.
const STANDALONE = [
  { slug: "w2d", title: "W2d", product_type: "single" },
  { slug: "hour-glass", title: "Hour Glass", product_type: "single" },
  { slug: "turnt-me-2-dis", title: "Turnt Me 2 Dis", product_type: "single" },
  { slug: "artificial", title: "Artificial", product_type: "single" },
  { slug: "all-yourz", title: "All Yourz", product_type: "single" },
  { slug: "2-heavy", title: "2 Heavy", product_type: "feature" },
  { slug: "i-dont-believe-you", title: "I Don't Believe You", product_type: "feature" },
];

const LOVE_HZ_TRACKS = [
  { album_slug: "love-hz-vol-1", track_number: 1, slug: "01-roll-call", title: "Roll Call" },
  { album_slug: "love-hz-vol-1", track_number: 2, slug: "02-w-2-d", title: "W.2.D" },
  { album_slug: "love-hz-vol-1", track_number: 9, slug: "09-hour-glass", title: "Hour Glass" },
  { album_slug: "love-hz-vol-1", track_number: 10, slug: "10-turnt-me-2-dis", title: "Turnt Me 2 Dis" },
];

function index(extraTracks = []) {
  return buildReleaseRecordingIndex({
    releaseSlugs: ["love-hz-vol-1", "tbh"],
    tracks: [
      ...LOVE_HZ_TRACKS,
      ...getCanonicalTracksForAlbum("tbh").map((t) => ({ ...t, album_slug: "tbh" })),
      ...extraTracks,
    ],
    standaloneProducts: STANDALONE,
  });
}

test("recording keys normalize punctuation and case", () => {
  assert.equal(recordingKey("W.2.D"), "w2d");
  assert.equal(recordingKey("ArTiFiCiAL"), "artificial");
});

test("owning an album unlocks every song on it that is also sold as a single", () => {
  const unlocked = standaloneSlugsUnlockedByReleases(index(), ["love-hz-vol-1"]).sort();
  assert.deepEqual(unlocked, ["hour-glass", "turnt-me-2-dis", "w2d"]);
});

test("a declared link covers a recording whose single is spelled differently (All Yours ↔ All Yourz)", () => {
  const unlocked = standaloneSlugsUnlockedByReleases(index(), ["tbh"]).sort();
  assert.deepEqual(unlocked, ["all-yourz", "artificial"]);
});

test("the rule is one-directional: a single or feature unlocks nothing", () => {
  assert.deepEqual(standaloneSlugsUnlockedByReleases(index(), ["w2d", "hour-glass", "2-heavy"]), []);
});

test("songs the user already owns are not reported as newly unlocked", () => {
  assert.deepEqual(
    standaloneSlugsUnlockedByReleases(index(), ["love-hz-vol-1", "w2d", "hour-glass"]),
    ["turnt-me-2-dis"]
  );
});

test("the server gate can find the releases that unlock a single", () => {
  assert.deepEqual(releasesContainingStandalone(index(), "hour-glass"), ["love-hz-vol-1"]);
  assert.deepEqual(releasesContainingStandalone(index(), "i-dont-believe-you"), []);
});

test("only the track-number prefix is stripped — a title that starts with a digit still matches correctly", () => {
  // "2-heavy" as track 5 keeps its leading 2; it must match the "2 Heavy" feature.
  const withTrack = index([{ album_slug: "tbh", track_number: 5, slug: "2-heavy", title: "2 Heavy" }]);
  assert.ok(standaloneSlugsUnlockedByReleases(withTrack, ["tbh"]).includes("2-heavy"));
  // A different song "Heavy" must NOT be mistaken for "2 Heavy".
  const unrelated = index([{ album_slug: "tbh", track_number: 3, slug: "03-heavy", title: "Heavy" }]);
  assert.ok(!standaloneSlugsUnlockedByReleases(unrelated, ["tbh"]).includes("2-heavy"));
});

test("tracks of releases that are not multi-track products are ignored", () => {
  const idx = buildReleaseRecordingIndex({
    releaseSlugs: ["love-hz-vol-1"],
    tracks: [{ album_slug: "w2d", track_number: 1, slug: "w2d", title: "W2d" }],
    standaloneProducts: STANDALONE,
  });
  assert.deepEqual(standaloneSlugsUnlockedByReleases(idx, ["w2d"]), []);
});

test("an album owner's account state streams the album's songs in full from their single cards", () => {
  const unlocked = standaloneSlugsUnlockedByReleases(index(), ["love-hz-vol-1"]);
  const accountState = {
    user: { id: "u1" },
    playbackPolicy: "PURCHASE_LIBRARY",
    permissions: {},
    library: [{ slug: "love-hz-vol-1", source: "gift", gifted: true, purchasedAt: "2026-09-24" }],
    ownedSlugs: ["love-hz-vol-1", ...unlocked],
  };
  for (const slug of ["hour-glass", "w2d", "turnt-me-2-dis"]) {
    const access = resolveTrackAccess({ slug }, accountState);
    assert.equal(access.canStream, true, slug);
    assert.equal(access.previewOnly, false, slug);
  }
  // A song NOT on the release stays a preview.
  assert.equal(resolveTrackAccess({ slug: "artificial" }, accountState).previewOnly, true);
});

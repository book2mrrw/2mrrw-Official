import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { location: { origin: "https://www.2mrrw.com" } };

const {
  buildArtworkEntries,
  clearMediaSessionArtworkCache,
  getArtworkEntriesForTrack,
  mediaSessionTrackIdentity,
} = await import("@/lib/media-session-artwork");

test("MediaMetadata artwork contains one truthful static source", () => {
  assert.deepEqual(buildArtworkEntries("/covers/release.webp"), [
    { src: "https://www.2mrrw.com/covers/release.webp", type: "image/webp" },
  ]);
  assert.deepEqual(buildArtworkEntries("https://cdn.example.com/art"), [
    { src: "https://cdn.example.com/art" },
  ]);
  assert.deepEqual(buildArtworkEntries("data:image/png;base64,abc"), []);
  assert.deepEqual(buildArtworkEntries("blob:https://www.2mrrw.com/asset"), []);
});

test("same-slug cover revisions have distinct Media Session identities", () => {
  const base = { id: "track-1", slug: "release", title: "Tomorrow", artist: "2MRRW" };
  const first = mediaSessionTrackIdentity({ ...base, cover: "/covers/r1.webp", artworkRevision: "1" });
  const second = mediaSessionTrackIdentity({ ...base, cover: "/covers/r2.webp", artworkRevision: "2" });
  assert.notEqual(first, second);
});

test("artwork cache keys include the concrete URL, not only the slug", async () => {
  clearMediaSessionArtworkCache();
  const first = await getArtworkEntriesForTrack("/covers/r1.png", "same-release");
  const second = await getArtworkEntriesForTrack("/covers/r2.png", "same-release");
  assert.notDeepEqual(first, second);
  assert.equal(first[0].src, "https://www.2mrrw.com/covers/r1.png");
  assert.equal(second[0].src, "https://www.2mrrw.com/covers/r2.png");
});

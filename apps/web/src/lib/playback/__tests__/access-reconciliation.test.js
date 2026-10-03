import assert from "node:assert/strict";
import test from "node:test";
import {
  isEntitlementStateHydrated,
  reconcileTrackAccess,
  upgradeTrackAccessForPlay,
} from "@/lib/playback/access-reconciliation";
import { pickDefaultTrackSlug } from "@/lib/playback/release-default-track";

const OWNER = {
  user: { id: "u1" },
  playbackPolicy: "PURCHASE_LIBRARY",
  permissions: {},
  library: [{ slug: "love-hz-vol-1", source: "gift", gifted: true, purchasedAt: "2026-09-24" }],
  ownedSlugs: ["love-hz-vol-1"],
};
const EMPTY = { user: null, library: [], ownedSlugs: [], permissions: {} };

// A Love Hz track a surface built before the session hydrated: preview stamp, no src.
const staleAlbumTrack = () => ({
  id: "love-hz-vol-1:09-hour-glass",
  slug: "love-hz-vol-1",
  src: "",
  preview: "previews/love-hz-vol-1/09-hour-glass.mp3",
  metadata: {
    trackSlug: "09-hour-glass",
    albumSlug: "love-hz-vol-1",
    access: { canStream: false, previewOnly: true },
  },
});

test("the pre-hydration empty state is not a session", () => {
  assert.equal(isEntitlementStateHydrated(EMPTY), false);
  assert.equal(isEntitlementStateHydrated(null), false);
  assert.equal(isEntitlementStateHydrated(OWNER), true);
});

test("play time lifts a stale preview stamp for an owner onto the full stream of the right track", () => {
  const next = upgradeTrackAccessForPlay(staleAlbumTrack(), OWNER);
  assert.equal(next.metadata.access.previewOnly, false);
  assert.equal(next.metadata.access.canStream, true);
  assert.equal(next.src, "/api/library/stream?slug=love-hz-vol-1&redirect=1&trackSlug=09-hour-glass");
});

test("play time respects a deliberate release-lifecycle lock (owned preorder before release day)", () => {
  const locked = staleAlbumTrack();
  locked.metadata.access.lifecycle = { canPlayFull: false, phase: "preorder" };
  assert.equal(upgradeTrackAccessForPlay(locked, OWNER), locked);
});

test("play time does nothing before the session hydrates", () => {
  const track = staleAlbumTrack();
  assert.equal(upgradeTrackAccessForPlay(track, EMPTY), track);
});

test("play time never downgrades — revocation is Effect 5's job, not a play intent's", () => {
  const entitled = {
    ...staleAlbumTrack(),
    src: "/api/library/stream?slug=love-hz-vol-1&redirect=1&trackSlug=09-hour-glass",
    metadata: { ...staleAlbumTrack().metadata, access: { canStream: true, previewOnly: false } },
  };
  const stranger = { ...OWNER, library: [], ownedSlugs: [] };
  assert.equal(upgradeTrackAccessForPlay(entitled, stranger), entitled);
});

test("entitlement sync (Effect 5) still downgrades a lapsed track back to its preview", () => {
  const entitled = {
    ...staleAlbumTrack(),
    src: "/api/library/stream?slug=love-hz-vol-1&redirect=1&trackSlug=09-hour-glass",
    metadata: { ...staleAlbumTrack().metadata, access: { canStream: true, previewOnly: false } },
  };
  const stranger = { ...OWNER, library: [], ownedSlugs: [] };
  const next = reconcileTrackAccess(entitled, stranger);
  assert.equal(next.metadata.access.previewOnly, true);
  assert.equal(next.src, "previews/love-hz-vol-1/09-hour-glass.mp3");
});

test("an entitled track that was built without a src gets the full stream", () => {
  const track = { ...staleAlbumTrack(), metadata: { ...staleAlbumTrack().metadata, access: { canStream: true, previewOnly: false } } };
  const next = upgradeTrackAccessForPlay(track, OWNER);
  assert.equal(next.src, "/api/library/stream?slug=love-hz-vol-1&redirect=1&trackSlug=09-hour-glass");
});

test("an unchanged track is returned by identity (no new objects, no re-render churn)", () => {
  const track = {
    ...staleAlbumTrack(),
    src: "/api/library/stream?slug=love-hz-vol-1&redirect=1&trackSlug=09-hour-glass",
    metadata: { ...staleAlbumTrack().metadata, access: { canStream: true, previewOnly: false } },
  };
  assert.equal(reconcileTrackAccess(track, OWNER), track);
});

test("a release requested without a track resolves to its first track", () => {
  assert.equal(
    pickDefaultTrackSlug(
      [{ slug: "03-guarded-heart", track_number: 3 }, { slug: "01-roll-call", track_number: 1 }],
      []
    ),
    "01-roll-call"
  );
  assert.equal(pickDefaultTrackSlug([], [{ slug: "02-x", track_number: 2 }, { slug: "01-y", track_number: 1 }]), "01-y");
  assert.equal(pickDefaultTrackSlug([], []), null);
});

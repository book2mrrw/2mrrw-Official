import test from "node:test";
import assert from "node:assert/strict";
import {
  closePlayerReleaseModal,
  getPlayerReleaseModalSnapshot,
  openPlayerReleaseModal,
  primePlayerReleaseModal,
  resolvePlayerReleaseModalKind,
  resolvePlayerReleaseSlug,
  subscribePlayerReleaseModal,
} from "../player-release-modal-bridge.js";

test("prime prepares a closed modal and open/close retains the prepared identity", () => {
  const track = { slug: "hour-glass", title: "Hour Glass" };
  let notifications = 0;
  const unsubscribe = subscribePlayerReleaseModal(() => {
    notifications += 1;
  });

  assert.equal(primePlayerReleaseModal(track), true);
  assert.equal(getPlayerReleaseModalSnapshot().track, track);
  assert.equal(getPlayerReleaseModalSnapshot().open, false);

  assert.equal(openPlayerReleaseModal(track), true);
  assert.equal(getPlayerReleaseModalSnapshot().track, track);
  assert.equal(getPlayerReleaseModalSnapshot().open, true);

  assert.equal(closePlayerReleaseModal(), true);
  assert.equal(getPlayerReleaseModalSnapshot().track, track);
  assert.equal(getPlayerReleaseModalSnapshot().open, false);
  assert.equal(notifications, 3);

  unsubscribe();
});

test("re-prime of the same release never closes an open modal", () => {
  const firstShape = { slug: "artificial", title: "Artificial" };
  const hydratedShape = { ...firstShape, cover: "/artificial.jpg" };

  openPlayerReleaseModal(firstShape);
  primePlayerReleaseModal(hydratedShape);

  assert.equal(getPlayerReleaseModalSnapshot().track, hydratedShape);
  assert.equal(getPlayerReleaseModalSnapshot().releaseSlug, "artificial");
  assert.equal(getPlayerReleaseModalSnapshot().open, true);
  closePlayerReleaseModal();
});

test("album identity wins over an individual track slug", () => {
  const track = {
    slug: "track-one",
    metadata: { albumSlug: "love-hz-vol-1" },
  };

  assert.equal(resolvePlayerReleaseSlug(track), "love-hz-vol-1");
  assert.equal(resolvePlayerReleaseModalKind({ type: "single" }, track), "album");
});

test("release categories select the canonical modal", () => {
  assert.equal(resolvePlayerReleaseModalKind({ release_type: "features" }), "feature");
  assert.equal(resolvePlayerReleaseModalKind({}, { source: "home_feature_card" }), "feature");
  assert.equal(resolvePlayerReleaseModalKind({ type: "ep" }), "album");
  assert.equal(resolvePlayerReleaseModalKind({ type: "mixtape" }), "album");
  assert.equal(resolvePlayerReleaseModalKind({ type: "single" }), "single");
});

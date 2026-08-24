import test from "node:test";
import assert from "node:assert/strict";
import { releaseAvailability, validateLifecycleConfiguration } from "../release-availability.js";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const TYPES = ["single", "feature", "album", "mixtape", "ep"];

for (const releaseType of TYPES) {
  test(`${releaseType}: release now is visible and entitlement-gated`, () => {
    const release = { release_type: releaseType, status: "published", available_at: "2026-09-10T11:00:00Z" };
    assert.equal(releaseAvailability(release, {}, NOW).visible, true);
    assert.equal(releaseAvailability(release, {}, NOW).canPlayFull, false);
    assert.equal(releaseAvailability(release, { owned: true, normallyEntitled: true }, NOW).canPlayFull, true);
  });

  test(`${releaseType}: scheduled hidden stays hidden before release and becomes live by time`, () => {
    const release = { release_type: releaseType, status: "scheduled", available_at: "2026-09-11T12:00:00Z" };
    assert.equal(releaseAvailability(release, {}, NOW).visible, false);
    assert.equal(releaseAvailability(release, {}, new Date("2026-09-11T12:00:01Z")).live, true);
  });

  test(`${releaseType}: scheduled public is visible but playback locked`, () => {
    const release = { release_type: releaseType, status: "scheduled", available_at: "2026-09-18T12:00:00Z", upcoming_visible: true };
    const result = releaseAvailability(release, { normallyEntitled: true, subscriber: true }, NOW);
    assert.equal(result.phase, "upcoming");
    assert.equal(result.visible, true);
    assert.equal(result.canPlayFull, false);
    assert.equal(result.canPreview, false);
  });

  test(`${releaseType}: preorder purchase remains locked before early access`, () => {
    const release = {
      release_type: releaseType, status: "scheduled", available_at: "2026-09-18T12:00:00Z",
      upcoming_visible: true, preorder_enabled: true, preorder_starts_at: "2026-09-01T12:00:00Z",
      preorder_price_cents: 999, early_access_enabled: true, early_access_starts_at: "2026-09-11T12:00:00Z",
      early_access_audiences: ["preorder_purchasers"],
    };
    const before = releaseAvailability(release, { owned: true, preorderOwned: true, normallyEntitled: true }, NOW);
    assert.equal(before.preorderOpen, true);
    assert.equal(before.canPlayFull, false);
    const early = releaseAvailability(release, { owned: true, preorderOwned: true, normallyEntitled: true }, new Date("2026-09-12T12:00:00Z"));
    assert.equal(early.earlyEligible, true);
    assert.equal(early.canPlayFull, true);
    const subscriber = releaseAvailability(release, { subscriber: true, normallyEntitled: true }, new Date("2026-09-12T12:00:00Z"));
    assert.equal(subscriber.canPlayFull, false);
  });
}

test("invalid lifecycle ordering is rejected", () => {
  const errors = validateLifecycleConfiguration({
    status: "scheduled",
    available_at: "2026-09-18T12:00:00Z",
    preorder_enabled: true,
    preorder_price_cents: 999,
    preorder_starts_at: "2026-09-19T12:00:00Z",
    early_access_enabled: true,
    early_access_starts_at: "2026-09-20T12:00:00Z",
  }, NOW);
  assert.ok(errors.length >= 2);
});

test("prerelease previews require an explicit release setting", () => {
  const release = { status: "scheduled", available_at: "2026-09-18T12:00:00Z", upcoming_visible: true };
  assert.equal(releaseAvailability(release, {}, NOW).canPreview, false);
  assert.equal(releaseAvailability({ ...release, preview_before_release: true }, {}, NOW).canPreview, true);
});

test("a timestamp never makes a draft public", () => {
  const result = releaseAvailability({ status: "draft", available_at: "2026-09-01T12:00:00Z" }, {}, NOW);
  assert.equal(result.live, false);
  assert.equal(result.visible, false);
});

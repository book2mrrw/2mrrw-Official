import assert from "node:assert/strict";
import test from "node:test";
import {
  getReleasePresentation,
  isReleasePresentationReady,
  recordReleasePresentationEvent,
  resetReleasePresentationRegistryForTests,
} from "../release-presentation-registry.js";

const identity = {
  key: "love-hz::home_catalog:albums",
  releaseId: "love-hz",
  surface: "home_catalog:albums",
  revision: "love-hz\0cover.jpg\0cover.mp4\0\0",
  coverAssetIdentity: "cover.mp4",
};

test.beforeEach(() => {
  globalThis.window = {};
  resetReleasePresentationRegistryForTests();
});

test.afterEach(() => {
  delete globalThis.window;
});

test("READY remains monotonic across viewport-style mount cycles", () => {
  recordReleasePresentationEvent(identity, "MOUNT");
  recordReleasePresentationEvent(identity, "COVER_REQUEST", { url: "cover.mp4" });
  recordReleasePresentationEvent(identity, "METADATA_READY");
  recordReleasePresentationEvent(identity, "ENTITLEMENT_RESOLUTION", {
    entitlementIdentity: "guest:member:standard:non-collector:stream:no-cart:live",
  });
  recordReleasePresentationEvent(identity, "CONTROLS_READY");
  recordReleasePresentationEvent(identity, "COVER_LOAD", { url: "cover.mp4" });
  recordReleasePresentationEvent(identity, "COVER_DECODE", { url: "cover.mp4" });

  assert.equal(isReleasePresentationReady(identity), true);

  recordReleasePresentationEvent(identity, "UNMOUNT");
  recordReleasePresentationEvent(identity, "MOUNT");
  recordReleasePresentationEvent(identity, "COVER_REQUEST", { url: "cover.mp4" });

  const afterReturn = getReleasePresentation(identity);
  assert.equal(afterReturn.presentationReady, true);
  assert.equal(afterReturn.coverReady, true);
  assert.equal(afterReturn.controlsReady, true);
});

test("a genuine media revision creates a new unresolved presentation", () => {
  for (const event of [
    "METADATA_READY",
    "ENTITLEMENT_RESOLUTION",
    "CONTROLS_READY",
    "COVER_LOAD",
    "COVER_DECODE",
  ]) {
    recordReleasePresentationEvent(identity, event, {
      entitlementIdentity: "guest",
      url: "cover.mp4",
    });
  }
  assert.equal(isReleasePresentationReady(identity), true);

  const revised = {
    ...identity,
    revision: "love-hz\0cover-v2.jpg\0cover-v2.mp4\0\0",
    coverAssetIdentity: "cover-v2.mp4",
  };
  recordReleasePresentationEvent(revised, "COVER_REQUEST", { url: "cover-v2.mp4" });

  assert.equal(isReleasePresentationReady(revised), false);
  assert.equal(getReleasePresentation(revised).presentationReady, false);
});

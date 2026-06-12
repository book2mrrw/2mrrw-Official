#!/usr/bin/env node
/**
 * Phase 5.2.13 — Direct preview CDN resolver tests.
 *
 * Run: node --import ./scripts/register-alias.mjs scripts/test-direct-preview-cdn.mjs
 */
import assert from "node:assert/strict";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";
import {
  isDirectPreviewCdnEnabled,
  getDirectPreviewFeatureFlags,
} from "@/lib/feature-flags/direct-preview";
import {
  isEligibleDirectPreviewR2Key,
  resolveConcretePreviewR2Key,
} from "@/lib/media/resolve-concrete-preview-key";

/** @type {Record<string, string | undefined>} */
const envSnapshot = {
  NEXT_PUBLIC_DIRECT_PREVIEW_CDN: process.env.NEXT_PUBLIC_DIRECT_PREVIEW_CDN,
  DIRECT_PREVIEW_ENABLED: process.env.DIRECT_PREVIEW_ENABLED,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setDirectPreviewEnv(on) {
  if (on) {
    process.env.NEXT_PUBLIC_DIRECT_PREVIEW_CDN = "1";
    process.env.DIRECT_PREVIEW_ENABLED = "1";
  } else {
    delete process.env.NEXT_PUBLIC_DIRECT_PREVIEW_CDN;
    delete process.env.DIRECT_PREVIEW_ENABLED;
  }
}

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}:`, err.message);
  }
}

restoreEnv();
setDirectPreviewEnv(false);

test("flag off by default", () => {
  assert.equal(isDirectPreviewCdnEnabled(), false);
});

test("flag on when NEXT_PUBLIC_DIRECT_PREVIEW_CDN=1", () => {
  process.env.NEXT_PUBLIC_DIRECT_PREVIEW_CDN = "1";
  assert.equal(isDirectPreviewCdnEnabled(), true);
  delete process.env.NEXT_PUBLIC_DIRECT_PREVIEW_CDN;
});

test("rejects flat root preview keys", () => {
  assert.equal(isEligibleDirectPreviewR2Key("previews/hourglass-preview.mp3"), false);
  assert.equal(
    isEligibleDirectPreviewR2Key("previews/singles/hour-glass/hourglass-preview.mp3"),
    true
  );
});

test("resolveConcretePreviewR2Key maps hour-glass slug", () => {
  const key = resolveConcretePreviewR2Key({
    entityFolder: "previews/singles/hour-glass/",
    legacyKey: "previews/hourglass-preview.mp3",
    slug: "hour-glass",
  });
  assert.equal(key, "previews/singles/hour-glass/hourglass-preview.mp3");
});

test("catalogPreviewAudioUrl flag off uses API discovery", () => {
  restoreEnv();
  setDirectPreviewEnv(false);
  const url = catalogPreviewAudioUrl("previews/singles/w2d/");
  assert.match(url, /^\/api\/media\/preview\?/);
});

test("catalogPreviewAudioUrl flag on uses direct CDN for canonical single", () => {
  restoreEnv();
  setDirectPreviewEnv(true);
  const url = catalogPreviewAudioUrl("previews/singles/w2d/");
  assert.match(url, /^https?:\/\//);
  assert.doesNotMatch(url, /\/api\/media\/preview/);
  assert.match(url, /previews\/singles\/w2d\/w2d-preview\.mp3/);
});

test("catalogPreviewAudioUrl flag on feature wav nested path", () => {
  restoreEnv();
  setDirectPreviewEnv(true);
  const url = catalogPreviewAudioUrl("previews/features/i-dont-believe-you/");
  assert.match(url, /i-dont-believe-you-preview\.wav/);
});

test("folder-only path without concrete key falls back to API", () => {
  restoreEnv();
  setDirectPreviewEnv(true);
  const url = catalogPreviewAudioUrl("previews/singles/unknown-release-xyz/");
  assert.match(url, /^\/api\/media\/preview\?/);
});

test("flat legacy path flag on never emits flat CDN URL", () => {
  restoreEnv();
  setDirectPreviewEnv(true);
  const url = catalogPreviewAudioUrl("/audio/previews/hourglass-preview.mp3");
  assert.doesNotMatch(url, /\/previews\/hourglass-preview\.mp3$/);
  assert.match(url, /previews\/singles\/hour-glass\/hourglass-preview\.mp3/);
});

test("getDirectPreviewFeatureFlags snapshot", () => {
  restoreEnv();
  setDirectPreviewEnv(true);
  const flags = getDirectPreviewFeatureFlags();
  assert.equal(flags.directPreviewCdnEnabled, true);
  assert.equal(flags.nextPublicDirectPreviewCdn, true);
});

restoreEnv();

if (failed > 0) {
  console.error(`direct-preview-cdn: FAILED (${failed})`);
  process.exit(1);
}
console.log("direct-preview-cdn: ok");

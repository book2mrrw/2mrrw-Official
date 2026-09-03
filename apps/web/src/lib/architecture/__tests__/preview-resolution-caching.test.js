import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("resolvePlaybackKey and resolvePlaybackKeyUncached are byte-for-byte untouched", () => {
  // The full-playback resolver must remain exactly as it was — this P1 work
  // only adds new capability to resolvePreviewKey, reusing the same shared
  // cache primitives (playbackKeyCache, playbackKeyInflight,
  // loadPersistedKeyResolution, persistKeyResolution) without modifying how
  // any of them behave for the master-resolution caller.
  const src = read("src/lib/playback/resolve-playback-key.js");
  assert.match(src, /export async function resolvePlaybackKey\(admin, productSlug, options = \{\}\) \{/);
  assert.match(src, /if \(value !== null\) \{/,
    "resolvePlaybackKey must still refuse to cache a negative master resolution");
});

test("resolvePreviewKey reuses the exact same shared cache Maps as resolvePlaybackKey, not a parallel cache", () => {
  const src = read("src/lib/playback/resolve-playback-key.js");
  const previewFnAt = src.indexOf("export async function resolvePreviewKey");
  const usesSharedCache = /playbackKeyCache\.(get|set|delete)/.test(src.slice(previewFnAt, previewFnAt + 1500));
  assert.ok(usesSharedCache, "resolvePreviewKey must read/write the same playbackKeyCache Map");
  assert.doesNotMatch(src, /const previewKeyCache = new Map/,
    "no separate, parallel cache Map should be introduced for previews");
});

test("preview cache entries are namespaced so they can never collide with a master resolution for the same slug", () => {
  const src = read("src/lib/playback/resolve-playback-key.js");
  assert.match(src, /function previewCacheKey\(slug, trackSlug\) \{\s*return `preview:\$\{playbackCacheKey\(slug, trackSlug\)\}`/);
});

test("a preview we generated ourselves resolves via a direct key lookup, with zero R2 discovery", () => {
  const src = read("src/lib/playback/resolve-playback-key.js");
  const uncachedAt = src.indexOf("async function resolvePreviewKeyUncached");
  const fastPathAt = src.indexOf("isConcreteMediaKey(rawPreviewPath)", uncachedAt);
  const discoveryAt = src.indexOf("resolvePreview(previewFolder, legacyPreview)", uncachedAt);
  assert.ok(uncachedAt > -1 && fastPathAt > uncachedAt && fastPathAt < discoveryAt,
    "the direct-key fast path must be checked, and must return, before any folder-discovery code runs");
  assert.match(src.slice(fastPathAt, discoveryAt), /return key;/);
});

test("unlike the master resolver, a confirmed-missing preview IS cached (short TTL), avoiding repeated live R2 scans", () => {
  const src = read("src/lib/playback/resolve-playback-key.js");
  assert.match(src, /PREVIEW_KEY_NEGATIVE_TTL_MS = 30_000/);
  assert.match(src, /const ttl = value \? PLAYBACK_KEY_TTL_MS : PREVIEW_KEY_NEGATIVE_TTL_MS/);
});

test("resolvePreviewKey accepts a trackSlug and resolves per-track previews for multi-track releases", () => {
  const src = read("src/lib/playback/resolve-playback-key.js");
  assert.match(src, /export async function resolvePreviewKey\(admin, slug, options = \{\}\) \{/);
  assert.match(src, /from\("catalog_tracks"\)\s*\.select\("preview_path"\)\s*\.eq\("album_slug", normalizedSlug\)\s*\.eq\("slug", trackSlug\)/);
});

test("the library stream route now forwards trackSlug into the preview path — previously silently dropped", () => {
  const src = read("src/app/api/library/stream/route.js");
  assert.match(src, /async function buildPreviewStreamResponse\(req, user, slug, \{ trackSlug = null, timing \} = \{\}\)/);
  assert.match(src, /return buildPreviewStreamResponse\(req, user, slug, \{ trackSlug, timing \}\)/,
    "buildStreamResponse must pass trackSlug through — a multi-track release's per-track preview upload work is otherwise unreachable");
  assert.match(src, /resolvePreviewKey\(admin, slug, \{ trackSlug: trackSlug \|\| undefined \}\)/);
});

test("the publish route stores a generated preview as its exact object key, not a folder, for single/feature releases", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /const preview_path = canonicalPreviewKey \|\| resolvePreviewPath\(typeFolder, releaseSlug\)/);
});

test("the publish route stores each generated per-track preview as its exact object key for multi-track releases", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /canonicalTrackPreviewKeys\.get\(t\.slug\) \|\| resolvePreviewPath\(typeFolder, t\.slug, releaseSlug\)/);
});

test("republishing an existing release invalidates the specific preview cache entry that changed", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /import \{ clearPersistedPreviewKey \} from "@\/lib\/playback\/resolve-playback-key"/);
  assert.match(src, /clearPersistedPreviewKey\(admin, releaseSlug\)/);
  assert.match(src, /clearPersistedPreviewKey\(admin, releaseSlug, track\.slug\)/);
});

test("userOwnsProduct is now cached under its own namespace, distinct from userCanStreamProduct's streaming-eligibility cache", () => {
  const src = read("src/lib/commerce/entitlements.js");
  assert.match(src, /getCachedOwnershipResult\(userId, productSlug\)/);
  assert.match(src, /setCachedOwnershipResult\(userId, productSlug, result\)/);
  // Must use a distinct inflight key from userCanStreamProduct's own — sharing
  // one would let a concurrent call to one function return the other's answer.
  assert.match(src, /withInflight\(`owns:\$\{userId\}:\$\{productSlug\}`/);
  const streamFnAt = src.indexOf("export async function userCanStreamProduct");
  assert.match(src.slice(streamFnAt, streamFnAt + 800), /withInflight\(`\$\{userId\}:\$\{productSlug\}`/);
});

test("userCanStreamProduct's own caching logic is completely unmodified", () => {
  const src = read("src/lib/commerce/entitlements.js");
  assert.match(src, /Admin fast-path: checked against the user object already in hand — zero DB cost\./);
  assert.match(src, /Coalesce concurrent calls for the same \(userId, slug\) pair behind a single/);
});

test("the ownership cache reuses the same generation-invalidation security model as the streaming cache, not a weaker one", () => {
  const src = read("src/lib/server/entitlement-cache.js");
  const ownsGetAt = src.indexOf("export async function getCachedOwnershipResult");
  const ownsBlock = src.slice(ownsGetAt, ownsGetAt + 1600);
  assert.match(ownsBlock, /readGenerationAndValue\(/, "ownership grants must be generation-validated, same as slug grants");
  assert.match(ownsBlock, /ent:owns:\$\{userId\}:\$\{slug\}/);
});

test("a purchase invalidates the ownership cache alongside the streaming cache, so new ownership is visible immediately", () => {
  const src = read("src/lib/server/entitlement-cache.js");
  const slugInvalidateAt = src.indexOf("export async function invalidateEntitlementSlugCache");
  const userInvalidateAt = src.indexOf("export async function invalidateUserEntitlementCache");
  assert.match(src.slice(slugInvalidateAt, slugInvalidateAt + 900), /ent:owns:\$\{userId\}:\$\{slug\}/);
  assert.match(src.slice(userInvalidateAt, userInvalidateAt + 1200), /ent:owns:\$\{userId\}:\$\{slug\}/);
});

test("__clearL1ForTests resets the new ownership L1 map too", () => {
  const src = read("src/lib/server/entitlement-cache.js");
  const fnAt = src.indexOf("export function __clearL1ForTests");
  assert.match(src.slice(fnAt, fnAt + 200), /_ownsL1\.clear\(\)/);
});

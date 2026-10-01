import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// ── resolveCoverUrl trusts the already-verified publish-time value first ───

test("resolveCoverUrl returns row.cover_url directly as its first check, before any recomputation", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  const fnAt = src.indexOf("function resolveCoverUrl(row) {");
  const body = src.slice(fnAt, fnAt + 200);
  assert.match(body, /^function resolveCoverUrl\(row\) \{\s*\n\s*if \(row\.cover_url\) return row\.cover_url;/,
    "cover_url must be the very first thing checked — it is the exact value the publish route already verified against R2 and computed via visualDiscoveryUrl itself");
});

test("recomputing via visualDiscoveryUrl only happens as a fallback for rows where cover_url was never populated at all (pre-dating the publish canonicalization flow)", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  const fnAt = src.indexOf("function resolveCoverUrl(row) {");
  const body = src.slice(fnAt, fnAt + 1100);
  const earlyReturnAt = body.indexOf("if (row.cover_url) return row.cover_url;");
  const discoveryCallAt = body.indexOf("return visualDiscoveryUrl(releaseTypeFolder, row.slug, {");
  assert.ok(earlyReturnAt > -1 && discoveryCallAt > earlyReturnAt,
    "the discovery recomputation must be unreachable code once cover_url is present");
  // legacyCover for the fallback tier must no longer include cover_url itself —
  // it was already checked and returned above, so re-including it here is dead weight.
  const legacyCoverAt = body.indexOf("const legacyCover =");
  const legacyCoverLine = body.slice(legacyCoverAt, body.indexOf(";", legacyCoverAt) + 1);
  assert.doesNotMatch(legacyCoverLine, /row\.cover_url/);
});

test("the publish route writes cover_url from a value it has already verified in R2 — confirming resolveCoverUrl's trust in the stored value is well-founded, not a guess", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");

  // The trust property is unchanged: cover_url is still derived only from
  // values this route has proven. What changed is the form it takes.
  //
  // cover_url is now ALWAYS the concrete canonical R2 key of the STATIC cover
  // — the same object the blocking headR2ObjectKey check verified — and never
  // a discovery redirect. catalog-db reads baseCover straight off cover_url,
  // so a redirect there resolved to the video and collapsed cover === baseCover,
  // which is what stopped mixtapes/EPs showing animated art in the player and
  // put an .mp4 behind an <img>. The motion cover travels separately as
  // metadata.animated_cover_r2_key / video_path, and catalog-db still builds
  // the discovery URL for `visual`/`video` where that indirection earns its keep.
  assert.match(
    src,
    /const visual\s+= canonicalCoverKey\s*\n?\s*\? getPublicR2Url\(canonicalCoverKey\)\s*\n?\s*: visualDiscoveryUrl\(typeFolder, releaseSlug, \{\}\);/,
    "cover_url must be the concrete verified static cover key"
  );

  // The discovery URL remains only as the fallback for a release with no
  // canonical cover key at all.
  assert.match(src, /visualDiscoveryUrl\(typeFolder, releaseSlug, \{\}\)/);
  assert.match(src, /cover_url:\s*visual \|\| null,/);

  // Whichever branch is taken, the value is one of exactly two verified
  // sources — never an unchecked guess.
  assert.match(src, /const canonicalCoverKey = resolvedCoverKey;|let canonicalCoverKey = resolvedCoverKey;/);
});

test("cover art is verified to exist in R2 (a real HEAD check) before a release can publish at all, so a modern release's cover_url is never a dangling reference", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /coverExists = await headR2ObjectKey\(resolvedCoverKey\);/);
  assert.match(src, /if \(!coverExists\) \{\s*\n\s*return NextResponse\.json\(\{ error: "BLOCKING: Cover artwork not found in storage/);
});

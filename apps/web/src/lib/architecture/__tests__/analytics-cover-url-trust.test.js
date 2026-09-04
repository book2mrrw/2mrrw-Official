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

test("the publish route writes cover_url as exactly visualDiscoveryUrl(typeFolder, releaseSlug, {}) — confirming resolveCoverUrl's trust in the stored value is well-founded, not a guess", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /const visual\s*=\s*visualDiscoveryUrl\(typeFolder, releaseSlug, \{\}\);/);
  assert.match(src, /cover_url:\s*visual \|\| null,/);
});

test("cover art is verified to exist in R2 (a real HEAD check) before a release can publish at all, so a modern release's cover_url is never a dangling reference", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /coverExists = await headR2ObjectKey\(resolvedCoverKey\);/);
  assert.match(src, /if \(!coverExists\) \{\s*\n\s*return NextResponse\.json\(\{ error: "BLOCKING: Cover artwork not found in storage/);
});

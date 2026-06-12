import assert from "node:assert/strict";

function catalogSlugIsOwned(slug, ownedSlugs = []) {
  if (!slug) return false;
  const set = ownedSlugs instanceof Set ? ownedSlugs : new Set(ownedSlugs || []);
  return set.has(slug);
}

function membershipHasPremiumAccess(membership) {
  if (!membership) return false;
  const status = String(membership.status || "").toLowerCase();
  return status === "active" || status === "trialing";
}

function catalogItemAllowsFullPlayback(item, track, accountState = {}) {
  const slug =
    item?.productSlug ||
    item?.product_slug ||
    track?.slug ||
    item?.slug ||
    null;
  const albumSlug = item?.albumSlug || item?.album_slug || null;
  const ownedSlugs = accountState.ownedSlugs || [];

  if (catalogSlugIsOwned(slug, ownedSlugs) || catalogSlugIsOwned(albumSlug, ownedSlugs)) {
    return true;
  }

  const membership = accountState.membership || null;
  if (!membershipHasPremiumAccess(membership)) return false;

  const permissions = accountState.permissions || {};
  if (permissions.subscriber) return true;

  const collectorRecords = accountState.collectorOwnerships || [];
  if (permissions.collectorAccess || permissions.collector) {
    return collectorRecords.length > 0 || permissions.collectorAccess;
  }

  return false;
}

assert.equal(catalogSlugIsOwned("hourglass-digital", ["hourglass-digital"]), true);
assert.equal(catalogSlugIsOwned("hourglass-digital", []), false);

assert.equal(
  catalogItemAllowsFullPlayback(
    { slug: "hourglass-digital", entitlement: { canStream: true } },
    null,
    { ownedSlugs: [] }
  ),
  false
);

assert.equal(
  catalogItemAllowsFullPlayback({ slug: "hourglass-digital" }, null, { ownedSlugs: ["hourglass-digital"] }),
  true
);

console.log("playback-gate: ok");

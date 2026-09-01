import assert from "node:assert/strict";
import test from "node:test";

import { mapProductRow } from "../catalog-db.js";

const LIVE_AT = "2026-01-01T00:00:00.000Z";

function productRow(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    release_id: "00000000-0000-4000-8000-000000000002",
    slug: "canonical-single",
    title: "Canonical Single",
    product_type: "single",
    release_type: "singles",
    release_date: "2026-01-01",
    price_cents: 299,
    cover_url: "/images/singles/canonical-single/cover.jpg",
    metadata: { artist: "2MRRW", release_category: "single" },
    active: true,
    gifting_enabled: false,
    releases: {
      id: "00000000-0000-4000-8000-000000000002",
      status: "published",
      available_at: LIVE_AT,
      storefront_visible: true,
      upcoming_visible: false,
    },
    ...overrides,
  };
}

test("canonical product mapper emits the shared release identity aliases", () => {
  const release = mapProductRow(productRow());

  assert.equal(release.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(release.slug, "canonical-single");
  assert.equal(release.artist, "2MRRW");
  assert.equal(release.release_date, "2026-01-01");
  assert.equal(release.releaseDate, "2026-01-01");
  assert.equal(release.type, "single");
  assert.deepEqual(release.tracks, []);
  assert.equal(release.availability.live, true);
  assert.equal(release.availability.visible, true);
});

test("canonical product mapper delegates scheduled visibility to releaseAvailability", () => {
  const release = mapProductRow(productRow({
    active: true,
    releases: {
      id: "00000000-0000-4000-8000-000000000002",
      status: "scheduled",
      available_at: "2099-01-01T00:00:00.000Z",
      storefront_visible: false,
      upcoming_visible: true,
      preview_before_release: false,
    },
  }));

  assert.equal(release.availability.phase, "upcoming");
  assert.equal(release.availability.live, false);
  assert.equal(release.availability.visible, true);
  assert.equal(release.availability.canPlayFull, false);
});

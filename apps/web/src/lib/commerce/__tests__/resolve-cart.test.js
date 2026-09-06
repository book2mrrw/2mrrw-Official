import assert from "node:assert/strict";
import test from "node:test";
import { resolveCartLines } from "../resolve-cart.js";

// Covers the Audio Visual (video_id) path added to resolveCartLines — the
// pre-existing slug/products path is untouched and was already unit-tested
// only indirectly (no dedicated test file existed for it before this).

function fakeAdmin({ audioVisuals = [], products = [] } = {}) {
  return {
    from(table) {
      if (table === "audio_visuals") {
        return {
          select() { return this; },
          in() { return Promise.resolve({ data: audioVisuals, error: null }); },
        };
      }
      if (table === "products") {
        return {
          select() { return this; },
          in() { return Promise.resolve({ data: products, error: null }); },
        };
      }
      throw new Error(`fakeAdmin: unexpected table ${table}`);
    },
  };
}

test("throws when the cart is empty", async () => {
  await assert.rejects(() => resolveCartLines([], fakeAdmin()), /Cart is empty/);
});

test("throws when no cart item has a slug or a video_id", async () => {
  await assert.rejects(() => resolveCartLines([{}], fakeAdmin()), /Cart items missing slugs/);
});

test("throws on an unknown video_id rather than silently dropping it", async () => {
  await assert.rejects(
    () => resolveCartLines([{ video_id: "video-1" }], fakeAdmin({ audioVisuals: [] })),
    /Unknown video: video-1/
  );
});

test("a video that is not published is rejected even if it has a ready, playable version", async () => {
  const admin = fakeAdmin({
    audioVisuals: [{ id: "video-1", title: "Behind the Scenes", price_cents: 500, poster_r2_key: null, publication_state: "ready" }],
  });
  await assert.rejects(
    () => resolveCartLines([{ video_id: "video-1" }], admin),
    /Video is not currently available for purchase: video-1/
  );
});

test("a published video resolves to a real, purchasable line with its DB price and title, never the client's", async () => {
  const admin = fakeAdmin({
    audioVisuals: [{ id: "video-1", title: "Real Title", price_cents: 999, poster_r2_key: "posters/video-1.jpg", publication_state: "published" }],
  });
  const lines = await resolveCartLines([{ video_id: "video-1", title: "Client-supplied title", price_cents: 1 }], admin);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].video_id, "video-1");
  assert.equal(lines[0].title, "Real Title");
  assert.equal(lines[0].price_cents, 999);
  assert.equal(lines[0].product_type, "audio_visual");
  assert.equal(typeof lines[0].cover_url, "string");
  assert.ok(lines[0].cover_url.length > 0);
});

test("a published video with no poster gets a null cover_url, not a broken URL", async () => {
  const admin = fakeAdmin({
    audioVisuals: [{ id: "video-1", title: "No Poster", price_cents: 999, poster_r2_key: null, publication_state: "published" }],
  });
  const lines = await resolveCartLines([{ video_id: "video-1" }], admin);
  assert.equal(lines[0].cover_url, null);
});

test("a cart item with neither slug nor video_id throws, even when other items in the same cart are valid", async () => {
  const admin = fakeAdmin({
    audioVisuals: [{ id: "video-1", title: "Real Title", price_cents: 999, poster_r2_key: null, publication_state: "published" }],
  });
  await assert.rejects(
    () => resolveCartLines([{ video_id: "video-1" }, {}], admin),
    /Cart item missing slug or video_id/
  );
});

test("a mixed cart resolves both a catalog slug line and an Audio Visual video line, preserving cart order", async () => {
  const admin = fakeAdmin({
    audioVisuals: [{ id: "video-1", title: "The Video", price_cents: 700, poster_r2_key: null, publication_state: "published" }],
    products: [{ slug: "the-shirt", title: "The Shirt", product_type: "merch", price_cents: 2500, cover_url: null, active: true, release_id: null, releases: null }],
  });
  const lines = await resolveCartLines([{ slug: "the-shirt" }, { video_id: "video-1" }], admin);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].slug, "the-shirt");
  assert.equal(lines[1].video_id, "video-1");
});

import assert from "node:assert/strict";
import test from "node:test";

process.env.CLOUDFLARE_R2_BUCKET_NAME ||= "test-bucket";
const { upsertProduct, upsertTracks } = await import("../r2-ingest-pipeline.js");

/** Fake Supabase admin: rows that already exist, and every upsert payload it receives. */
function fakeAdmin({ products = [], tracks = [] } = {}) {
  const writes = [];
  const query = (table) => {
    const filters = {};
    const api = {
      select() { return api; },
      eq(column, value) { filters[column] = value; return api; },
      maybeSingle: async () => ({ data: products.find((p) => p.slug === filters.slug) ?? null }),
      then(resolve) {
        resolve({ data: table === "catalog_tracks" ? tracks.filter((t) => t.product_id === filters.product_id) : [] });
      },
      upsert: async (rows) => { writes.push({ table, rows: [].concat(rows) }); return { error: null }; },
    };
    return api;
  };
  return { from: query, writes };
}

test("a re-sync never overwrites the title of a release that already exists", async () => {
  const admin = fakeAdmin({ products: [{ id: "p1", slug: "w2d" }] });
  await upsertProduct(admin, { slug: "w2d", title: "W2d", active: true });
  assert.equal(admin.writes.length, 1);
  assert.equal("title" in admin.writes[0].rows[0], false, "W.2.D must not become 'W2d'");
  assert.equal(admin.writes[0].rows[0].active, true, "everything else still syncs");
});

test("a newly discovered release is still named from its folder", async () => {
  const admin = fakeAdmin();
  await upsertProduct(admin, { slug: "new-single", title: "New Single" });
  assert.equal(admin.writes[0].rows[0].title, "New Single");
});

test("tracks: existing ones keep their titles, new ones get one, and no row is written with a missing title", async () => {
  const admin = fakeAdmin({ tracks: [{ product_id: "p1", slug: "02-w-2-d" }] });
  await upsertTracks(admin, "p1", [
    { slug: "02-w-2-d", title: "W 2 D", position: 2 },
    { slug: "13-new-song", title: "New Song", position: 13 },
  ]);
  const rows = admin.writes.flatMap((w) => w.rows);
  const existing = rows.find((r) => r.slug === "02-w-2-d");
  const fresh = rows.find((r) => r.slug === "13-new-song");
  assert.equal("title" in existing, false);
  assert.equal(fresh.title, "New Song");
  // Mixed columns in one batch would make PostgREST write NULL titles.
  for (const write of admin.writes) {
    const withTitle = write.rows.filter((r) => "title" in r).length;
    assert.ok(withTitle === 0 || withTitle === write.rows.length, "a batch is all-titled or all-untitled");
  }
});

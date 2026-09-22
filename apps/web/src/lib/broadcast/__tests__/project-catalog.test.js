import test from "node:test";
import assert from "node:assert/strict";
import { projectCard } from "../project-catalog.js";
import { mergeAdminSession } from "../admin-state.js";

const release = { id: "release-id", release_type: "album", status: "unrelzd", content_kind: "music", slug: "private-album",
  cover_art_r2_key: "private/secret.jpg", storage_scope: "private", metadata: { draft_title: "Private album", internal: "secret" } };
test("private project projection returns display fields and authorized artwork path only", () => {
  const card = projectCard(release, "release", 8);
  assert.equal(card.title, "Private album"); assert.equal(card.trackCount, 8);
  assert.equal(card.status, "unrelzd");
  assert.equal(card.artworkUrl, "/api/admin/broadcast/projects/release/release-id/artwork");
  assert.equal(JSON.stringify(card).includes("secret"), false);
  assert.equal(card.storage_scope, undefined); assert.equal(card.metadata, undefined);
});
test("unsupported, unpublished, nonmusic and duplicated wizard products are excluded", () => {
  for (const change of [{ release_type: "merch" }, { status: "draft" }, { content_kind: "podcast" }]) {
    assert.equal(projectCard({ ...release, ...change }, "release", 1), null);
  }
  assert.equal(projectCard({ id: "product", product_type: "single", active: false }, "product", 1), null);
  assert.equal(projectCard({ id: "product", product_type: "single", active: true, release_id: "wizard" }, "product", 1), null);
});
test("legacy single and feature identities remain products rather than duplicated releases", () => {
  for (const type of ["single", "feature"]) {
    const card = projectCard({ id: "legacy", product_type: type, active: true, title: "Original" }, "product", 0);
    assert.equal(card.kind, "product"); assert.equal(card.id, "legacy"); assert.equal(card.trackCount, 1);
  }
});
test("late poll response cannot replace a newer command snapshot", () => {
  const rows = [{ id: "a", sequence: 4, state: "TRACK_PLAYBACK" }];
  assert.equal(mergeAdminSession(rows, { id: "a", sequence: 3, state: "PRE_SHOW" }), rows);
  const next = mergeAdminSession(rows, { id: "a", sequence: 5, state: "ENDED" });
  assert.equal(next[0].state, "ENDED"); assert.equal(next.length, 1);
});

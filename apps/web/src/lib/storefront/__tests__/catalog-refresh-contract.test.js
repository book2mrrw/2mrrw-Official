import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileCanonicalCatalogPage } from "../catalog-page-reconcile.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("canonical page one replaces stale rows so archives propagate", () => {
  const current = [{ slug: "kept" }, { slug: "archived" }];
  const next = reconcileCanonicalCatalogPage(current, [{ slug: "kept", title: "Fresh" }], 1);

  assert.deepEqual(next, [{ slug: "kept", title: "Fresh" }]);
  assert.notEqual(next, current);
});

test("an authoritative empty page one remains empty", () => {
  assert.deepEqual(
    reconcileCanonicalCatalogPage([{ slug: "stale-ssr-seed" }], [], 1),
    []
  );
});

test("later pages append unique identities without replacing page one", () => {
  const current = [{ slug: "one" }, { slug: "two" }];
  const next = reconcileCanonicalCatalogPage(
    current,
    [{ slug: "two", title: "duplicate" }, { slug: "three" }],
    2
  );

  assert.deepEqual(next, [{ slug: "one" }, { slug: "two" }, { slug: "three" }]);
});

test("catalog mutation revisions notify synchronously and unsubscribe cleanly", async () => {
  const storeUrl = new URL(`../catalog-refresh-store.js?test=${Date.now()}`, import.meta.url);
  const store = await import(storeUrl.href);
  const observed = [];
  const unsubscribe = store.subscribeCatalogRefresh(() => {
    observed.push(store.getCatalogRefreshRevision());
  });

  assert.equal(store.getCatalogRefreshRevision(), 0);
  assert.equal(store.signalCatalogMutation("release_published"), 1);
  assert.equal(store.signalCatalogMutation("release_archived"), 2);
  unsubscribe();
  store.signalCatalogMutation("ignored_after_unsubscribe");

  assert.deepEqual(observed, [1, 2]);
  assert.equal(store.getCatalogRefreshRevision(), 3);
  assert.equal(store.getCatalogRefreshServerRevision(), 0);
});

test("the pinned storefront snapshot accepts authoritative empty and metadata changes", async () => {
  const storeUrl = new URL(
    `../storefront-display-singles-store.js?test=${Date.now()}`,
    import.meta.url
  );
  const store = await import(storeUrl.href);
  const observed = [];
  const unsubscribe = store.subscribeStorefrontDisplaySingles(() => {
    observed.push(store.getStorefrontDisplaySingles());
  });

  const original = [{ slug: "one", title: "Original", cover: "/same.jpg" }];
  const updated = [{ slug: "one", title: "Updated", cover: "/same.jpg" }];
  store.commitStorefrontDisplaySingles(original);
  store.commitStorefrontDisplaySingles(updated);
  store.commitStorefrontDisplaySingles([]);
  unsubscribe();

  assert.deepEqual(observed, [original, updated, []]);
  assert.deepEqual(store.getStorefrontDisplaySingles(), []);
});

test("successful admin mutations refresh the mounted catalog without an RSC reload", () => {
  const wizard = read("src/components/admin/UploadWizard.js");
  const manager = read("src/components/admin/InlineReleasesManager.js");
  const provider = read("src/components/storefront/catalog-surface-context.js");

  assert.match(wizard, /signalCatalogMutation/);
  assert.match(wizard, /release_published/);
  for (const reason of [
    "release_metadata_updated",
    "release_lyrics_updated",
    "release_master_promoted",
  ]) {
    assert.match(manager, new RegExp(reason));
  }
  assert.match(manager, /signalCatalogMutation\(`\$\{assetType\}_updated`\)/);
  assert.match(provider, /subscribeCatalogRefresh/);
  assert.match(provider, /catalogRequest\.revision === catalogMutationRevision/);
  assert.match(provider, /\? catalogRequest\.page\s*:\s*1/);
  assert.doesNotMatch(provider, /router\.refresh\(\)/);
  assert.match(provider, /applyCatalogSnapshot|replaceCatalogSnapshot|catalogMutationRevision/);
});

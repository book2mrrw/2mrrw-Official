import test from "node:test";
import assert from "node:assert/strict";
import { resolveStorageBucket, releaseStorageScope } from "../storage-scope.js";

test("existing public media keeps its configured bucket", () => {
  assert.equal(resolveStorageBucket(undefined, { CLOUDFLARE_R2_BUCKET_NAME: "existing" }), "existing");
  assert.equal(releaseStorageScope({ status: "published" }), "public");
});
test("private media fails closed without a distinct bucket", () => {
  for (const privateBucket of [undefined, "", "public", " public "]) {
    assert.throws(() => resolveStorageBucket("private", { CLOUDFLARE_R2_BUCKET_NAME: "public", CLOUDFLARE_R2_PRIVATE_BUCKET_NAME: privateBucket }));
  }
  assert.equal(resolveStorageBucket("private", { CLOUDFLARE_R2_BUCKET_NAME: "public", CLOUDFLARE_R2_PRIVATE_BUCKET_NAME: "private" }), "private");
  assert.throws(() => resolveStorageBucket("privtae"));
});
test("unrelzd drafts and saved releases cannot fall back to public storage", () => {
  assert.throws(() => releaseStorageScope({ status: "draft", publication_state: "unrelzd" }));
  assert.throws(() => releaseStorageScope({ status: "unrelzd", storage_scope: "public" }));
  assert.equal(releaseStorageScope({ status: "draft", publication_state: "unrelzd", storage_scope: "private" }), "private");
  assert.throws(() => releaseStorageScope(null));
});

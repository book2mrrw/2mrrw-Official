import assert from "node:assert/strict";
import test from "node:test";
import { getMusicVideosForReleaseIds } from "../release-video-lookup.js";

function fakeAdmin(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "audio_visuals");
      const state = { table };
      const builder = {
        select(cols) { state.select = cols; return this; },
        in(col, values) { state[col] = values; return this; },
        eq(col, value) { state[col] = value; return this; },
        then(resolve) {
          calls.push(state);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

test("getMusicVideosForReleaseIds returns an empty map for an empty/falsy id list, never touching the DB", async () => {
  const admin = fakeAdmin([]);
  const result = await getMusicVideosForReleaseIds([], admin);
  assert.equal(result.size, 0);
  assert.equal(admin.calls.length, 0);

  const result2 = await getMusicVideosForReleaseIds(null, admin);
  assert.equal(result2.size, 0);
});

test("getMusicVideosForReleaseIds keys results by release_id and resolves a public poster URL", async () => {
  const admin = fakeAdmin([
    { id: "video-1", release_id: "release-1", poster_r2_key: "audio-visual/video-1/poster.jpg" },
    { id: "video-2", release_id: "release-2", poster_r2_key: null },
  ]);
  const result = await getMusicVideosForReleaseIds(["release-1", "release-2"], admin);
  assert.equal(result.size, 2);
  assert.equal(result.get("release-1").id, "video-1");
  assert.match(result.get("release-1").poster_url, /audio-visual\/video-1\/poster\.jpg/);
  assert.equal(result.get("release-2").id, "video-2");
  assert.equal(result.get("release-2").poster_url, null);
  assert.equal(result.has("release-3"), false);
});

test("getMusicVideosForReleaseIds dedupes duplicate/falsy release ids before querying", async () => {
  const admin = fakeAdmin([]);
  await getMusicVideosForReleaseIds(["release-1", "release-1", null, undefined, "release-2"], admin);
  assert.deepEqual(admin.calls[0].release_id, ["release-1", "release-2"]);
});

test("getMusicVideosForReleaseIds only ever queries music_video, published/ready rows", async () => {
  const admin = fakeAdmin([]);
  await getMusicVideosForReleaseIds(["release-1"], admin);
  assert.equal(admin.calls[0].video_type, "music_video");
  assert.deepEqual(admin.calls[0].publication_state, ["ready", "published"]);
});

test("getMusicVideosForReleaseIds returns an empty map (not a throw) on a DB error", async () => {
  const admin = {
    from() {
      return {
        select() { return this; },
        in() { return this; },
        eq() { return this; },
        then(resolve) {
          return Promise.resolve({ data: null, error: { message: "connection reset" } }).then(resolve);
        },
      };
    },
  };
  const result = await getMusicVideosForReleaseIds(["release-1"], admin);
  assert.equal(result.size, 0);
});

test("getMusicVideosForReleaseIds keeps only the first match per release_id when duplicates exist", async () => {
  const admin = fakeAdmin([
    { id: "video-1", release_id: "release-1", poster_r2_key: null },
    { id: "video-2", release_id: "release-1", poster_r2_key: null },
  ]);
  const result = await getMusicVideosForReleaseIds(["release-1"], admin);
  assert.equal(result.size, 1);
  assert.equal(result.get("release-1").id, "video-1");
});

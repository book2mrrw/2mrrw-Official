import assert from "node:assert/strict";
import test from "node:test";
import { audioVisualR2FolderPath, contentTypeFolder, CONTENT_TYPE_FOLDERS } from "../r2-paths.js";

// This is the worker-side copy of apps/web/src/lib/audio-visual/r2-paths.js
// (separate deployables, no shared module path — see this file's header).
// Both copies must stay in sync; this suite proves this copy's behavior
// independently of the web app's.

test("all 8 content types map to a real, non-empty folder name", () => {
  for (const videoType of Object.keys(CONTENT_TYPE_FOLDERS)) {
    assert.ok(typeof contentTypeFolder(videoType) === "string" && contentTypeFolder(videoType).length > 0);
  }
});

test("standalone content sits directly in its own slug folder under the content-type folder", () => {
  assert.equal(audioVisualR2FolderPath({ videoType: "movie", slug: "my-movie" }), "2MRRW Studios/Movie/my-movie/");
});

test("episodic content nests under Seriez/{seriezSlug}/{episodeSlug}/", () => {
  assert.equal(
    audioVisualR2FolderPath({ videoType: "documentary", slug: "ep-2", seriezSlug: "our-story", episodeSlug: "ep-2" }),
    "2MRRW Studios/Documentary/Seriez/our-story/ep-2/"
  );
});

test("an unknown video_type throws rather than silently building a broken path", () => {
  assert.throws(() => contentTypeFolder("bogus"), /unknown video_type/);
});

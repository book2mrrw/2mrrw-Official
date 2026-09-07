import assert from "node:assert/strict";
import test from "node:test";
import { audioVisualR2FolderPath, contentTypeFolder, CONTENT_TYPE_FOLDERS } from "../r2-paths.js";

test("all 8 content types map to a real, non-empty folder name", () => {
  for (const videoType of ["music_video", "podcast", "interview", "movie", "documentary", "vlog", "concert", "short_film"]) {
    const folder = contentTypeFolder(videoType);
    assert.ok(typeof folder === "string" && folder.length > 0);
  }
});

test("an unknown video_type throws rather than silently producing a broken path", () => {
  assert.throws(() => contentTypeFolder("not-a-real-type"), /unknown video_type/);
});

test("standalone content sits directly in its own slug folder under the content-type folder", () => {
  const path = audioVisualR2FolderPath({ videoType: "podcast", slug: "my-podcast" });
  assert.equal(path, "2MRRW Studios/Podcast/my-podcast/");
});

test("episodic content nests under a Seriez subfolder, keyed by the seriez slug then the episode slug", () => {
  const path = audioVisualR2FolderPath({ videoType: "podcast", slug: "ep-1", seriezSlug: "the-show", episodeSlug: "ep-1" });
  assert.equal(path, "2MRRW Studios/Podcast/Seriez/the-show/ep-1/");
});

test("standalone content requires a slug — throws rather than producing an ambiguous shared folder", () => {
  assert.throws(() => audioVisualR2FolderPath({ videoType: "movie", slug: null }), /slug is required/);
});

test("Audio Visualz (music_video) maps to the branded folder name, not the internal DB value", () => {
  assert.equal(contentTypeFolder("music_video"), "Audio Visualz");
});

test("Short Filmz maps to its own branded folder name", () => {
  assert.equal(contentTypeFolder("short_film"), "Short Filmz");
});

test("every CONTENT_TYPE_FOLDERS key matches a real audio_visuals.video_type CHECK constraint value — no orphaned or missing mapping", () => {
  const expectedTypes = ["music_video", "podcast", "interview", "movie", "documentary", "vlog", "concert", "short_film"];
  assert.deepEqual(Object.keys(CONTENT_TYPE_FOLDERS).sort(), expectedTypes.sort());
});

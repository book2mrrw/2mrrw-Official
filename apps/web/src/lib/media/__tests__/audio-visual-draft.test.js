import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
const draft = read("src/app/api/admin/audio-visual/draft/route.js");

test("requires the canonical admin guard, same as every other Audio Visualz route", () => {
  assert.match(draft, /getAdminSessionUser/);
  assert.match(draft, /isAdminUser\(user\)/);
});

test("validates video_type against exactly the 8 real content-genre values", () => {
  assert.match(
    draft,
    /const VIDEO_TYPES = \["music_video", "podcast", "interview", "movie", "documentary", "vlog", "concert", "short_film"\];/
  );
});

test("music_video with a track_id derives its slug from the track's own slug plus a short suffix, never an independently-slugified title", () => {
  const fnAt = draft.indexOf('if (videoType === "music_video" && trackId)');
  assert.ok(fnAt > -1);
  const body = draft.slice(fnAt, fnAt + 700);
  assert.match(body, /\.from\("tracks"\)\.select\("slug"\)\.eq\("id", trackId\)/);
  assert.match(body, /baseSlugCandidate = `\$\{track\.slug\}-av`/);
});

test("every other content type falls back to slugifying the video's own title", () => {
  assert.match(draft, /baseSlugCandidate = slugify\(title\);/);
});

test("slug uniqueness is enforced with a numeric-suffix dedup loop mirroring releases/draft's own logic, with a random fallback", () => {
  assert.match(draft, /for \(let attempt = 1; attempt <= 10; attempt\+\+\)/);
  assert.match(draft, /candidate = `\$\{baseSlugCandidate\}-\$\{attempt \+ 1\}`/);
  assert.match(draft, /slug = `draft-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`/);
});

test("the new row starts life in publication_state 'draft' with a placeholder price, never a real price assumed", () => {
  const insertAt = draft.indexOf('.from("audio_visuals")\n    .insert(');
  const body = draft.slice(insertAt, insertAt + 400);
  assert.match(body, /publication_state: "draft"/);
  assert.match(body, /price_cents: 0/);
});

test("never touches or writes to tracks/releases — the only cross-reference is a single read-only select", () => {
  assert.doesNotMatch(draft, /\.update\(/);
  assert.doesNotMatch(draft, /\.insert\(\{[\s\S]{0,50}(?:track_id|release_id):\s*(?!trackId|releaseId)/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

function between(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`);
  return src.slice(start, end);
}

test("global player bar: dragging the scrubber never seeks — only the release commits one seek", () => {
  const src = read("src/components/audio/GlobalAudioPlayerBar.js");
  const scrub = between(src, "const PlayerBarScrub = memo(", "// ─── Cover art thumbnail");
  const follow = between(scrub, "const followFromEvent = useCallback(", "const commitScrub = useCallback(");
  assert.doesNotMatch(follow, /onSeek\(/, "following the pointer must not seek");
  const commit = between(scrub, "const commitScrub = useCallback(", "const onScrubStart = useCallback(");
  assert.equal((commit.match(/onSeek\(/g) || []).length, 1, "the release commits exactly one seek");
  const dragEffect = between(scrub, "if (!dragging) return undefined;", "}, [dragging, followFromEvent, commitScrub]);");
  assert.match(dragEffect, /const onMove = \(e\) => \{[\s\S]*followFromEvent\(e\);/);
  assert.match(dragEffect, /addEventListener\("mouseup", commitScrub\)/);
  assert.match(dragEffect, /addEventListener\("touchend", onTouchEnd\)/);
  // A touch is never followed by a second, compatibility-mouse scrub.
  const start = between(scrub, "const onScrubStart = useCallback(", "useEffect(() => {");
  assert.match(start, /if \(e\.type === "touchstart"\) lastTouchAtRef\.current = performance\.now\(\);\s*else if \(performance\.now\(\) - lastTouchAtRef\.current < 800\) return;/);
  // No element-level handler can seek mid-drag.
  assert.doesNotMatch(scrub, /onTouchMove=\{|onTouchEnd=\{|onClick=\{/);
  // Playback progress never repaints the bar out from under the finger.
  assert.match(scrub, /function applyProgress\(\) \{\s*if \(scrubbingRef\.current\) return;/);
});

test("global player bar: the time label follows the scrub position without re-rendering", () => {
  const src = read("src/components/audio/GlobalAudioPlayerBar.js");
  const label = between(src, "const PlayerBarCurrentTime = memo(", "// ─── Scrub bar");
  assert.match(label, /scrubPreview\.seconds \?\? getProgressSnapshot\(\)\.currentTime/);
  assert.match(label, /subscribeScrubPreview\(apply\)/);
  assert.doesNotMatch(label, /useState/);
});

test("release modal: dragging its scrubber never seeks — only the release commits one seek", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  const scrub = between(src, "function ScrubBar(", "\n}\n");
  const seekAt = between(scrub, "const seekAt = useCallback(", "const commit = useCallback(");
  assert.doesNotMatch(seekAt, /onSeekRatio\(/, "following the pointer must not seek");
  const commit = between(scrub, "const commit = useCallback(", "const onMouseDown = useCallback(");
  assert.equal((commit.match(/onSeekRatio\(/g) || []).length, 1, "the release commits exactly one seek");
  assert.match(scrub, /onTouchEnd=\{onTouchEnd\}/);
  assert.match(scrub, /const onTouchEnd = useCallback\(\(\) => \{\s*lastTouchAtRef\.current = performance\.now\(\);\s*commit\(\);/);
  assert.match(scrub, /const onUp = \(\) => \{\s*commit\(\);/);
  assert.match(scrub, /const onMouseDown = useCallback\(\(e\) => \{\s*if \(isPreview\) return;\s*if \(performance\.now\(\) - lastTouchAtRef\.current < 800\) return;/);
});

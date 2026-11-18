import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const between = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

// A fixed settle delay let the thumb snap back to the old position whenever
// the seek took longer than the delay, then jump forward when it landed.
test("both scrubbers hold where they were released until playback reports that spot", () => {
  const bar = read("src/components/audio/GlobalAudioPlayerBar.js");
  const barCommit = between(bar, "const commitScrub = useCallback(", "}, [onSeek]);");
  assert.match(barCommit, /Math\.abs\(getProgressSnapshot\(\)\.currentTime - seconds\) < SCRUB_HOLD_TOLERANCE_SEC/);
  assert.match(barCommit, /performance\.now\(\) - releasedAt < SCRUB_HOLD_MAX_MS/);
  assert.doesNotMatch(bar, /SCRUB_SETTLE_MS/);

  const modal = read("src/components/preview/ImmersivePreviewModal.js");
  const modalCommit = between(modal, "const commit = useCallback(() => {", "}, [onSeekRatio]);");
  assert.match(modalCommit, /Math\.abs\(pctRef\.current - ratio \* 100\) < SCRUB_HOLD_TOLERANCE_PCT/);
  assert.match(modalCommit, /performance\.now\(\) - releasedAt < SCRUB_HOLD_MAX_MS/);
  assert.doesNotMatch(modal, /SCRUB_SETTLE_MS/);
});

test("a scrub never changes play/pause: the seek path only repositions the audio", () => {
  const engine = read("src/lib/audio/WebAudioEngine.js");
  const seek = between(engine, "  seek(position, {", "  getSeekPosition(");
  assert.doesNotMatch(seek, /\.play\(|\.pause\(/);
  const transport = read("src/lib/playback/PlaybackTransportCommands.js");
  const seekInternal = between(transport, "self.seekInternal = function seekInternal(time) {", "const skipStep =");
  assert.doesNotMatch(seekInternal, /\.play\(|\.pause\(|playInternal|pauseInternal/);
});

test("the HLS engine resumes buffering for a seek outside the buffer (iOS ManagedMediaSource)", () => {
  const src = read("src/lib/audio/HLSEngine.js");
  const guardAt = src.indexOf("this._removeBufferingGuard = attachBufferingGuard(hls, audioEl);");
  assert.ok(guardAt > -1);
  assert.ok(guardAt < src.indexOf("hls.attachMedia(audioEl);"), "must run before hls.js's own seeking handler");
  assert.match(src, /_destroyHls\(\) \{\s*this\._removeBufferingGuard\?\.\(\);/);
});

test("the player bar scrubber's touch target is taller than its 16px box without moving anything", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.player-bar-compact \.player-bar-scrub \{\s*position: relative;\s*height: 16px;/);
  assert.match(css, /\.player-bar-compact \.player-bar-scrub::before \{\s*content: "";\s*position: absolute;\s*inset: -6px 0 -4px;/);
});

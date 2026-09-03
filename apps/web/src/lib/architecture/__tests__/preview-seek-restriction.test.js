import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("seekInternal rejects every seek for preview-only tracks — the single enforcement point every caller shares", () => {
  const src = read("src/lib/playback/PlaybackTransportCommands.js");
  const fnAt = src.indexOf("self.seekInternal = function seekInternal");
  const guardAt = src.indexOf("if (track?.metadata?.access?.previewOnly) return;", fnAt);
  const audioWriteAt = src.indexOf("audio.currentTime = Math.max", fnAt);
  assert.ok(fnAt > -1 && guardAt > fnAt && guardAt < audioWriteAt,
    "the previewOnly guard must return before audio.currentTime is ever touched");
});

test("non-preview seeking is completely unchanged — no clamping logic was left behind for it", () => {
  const src = read("src/lib/playback/PlaybackTransportCommands.js");
  const fnAt = src.indexOf("self.seekInternal = function seekInternal");
  const fnBody = src.slice(fnAt, fnAt + 1500);
  assert.doesNotMatch(fnBody, /let capped = time/,
    "the old clamp-to-cap variable should be gone — full tracks seek to exactly the requested time, same as before");
  assert.match(fnBody, /audio\.currentTime = Math\.max\(0, Math\.min\(time,/);
});

test("seekBack, keyboard shortcuts, and Media Session seekbackward/seekforward/seekto all route through the one protected function", () => {
  const src = read("src/lib/playback/PlaybackTransportCommands.js");
  assert.match(src, /self\.seekBack = function seekBack\(seconds = 15\) \{\s*const audio = self\._deps\.audioRef\.current;\s*if \(!audio\) return;\s*self\.seekInternal\(/);

  const effects = read("src/lib/playback/usePlaybackEffects.js");
  assert.match(effects, /ms\.setActionHandler\("seekbackward"/);
  assert.match(effects, /ms\.setActionHandler\("seekforward"/);
  assert.match(effects, /ms\.setActionHandler\("seekto", handleSeek\)/);
  // These call the public seek() API, not audio.currentTime directly — so
  // they inherit the seekInternal guard automatically rather than needing
  // their own previewOnly check.
  assert.doesNotMatch(effects, /audioRef\.current\.currentTime\s*=/);
});

test("the unused PREVIEW_HARD_CAP_SEC import was removed from PlaybackTransportCommands.js, not left as dead code", () => {
  const src = read("src/lib/playback/PlaybackTransportCommands.js");
  assert.doesNotMatch(src, /import \{ PREVIEW_HARD_CAP_SEC \} from "@\/lib\/playback\/PlaybackEventHandlers"/);
});

test("a preview that hits the hard cap resets audio.currentTime to 0, matching the sibling natural-end path", () => {
  const src = read("src/lib/playback/PlaybackEventHandlers.js");
  const hardCapAt = src.indexOf("if (audio.currentTime >= PREVIEW_HARD_CAP_SEC) {");
  const pauseAt = src.indexOf("audio.pause();", hardCapAt);
  const resetAt = src.indexOf("audio.currentTime = 0;", hardCapAt);
  const endedPreviewAt = src.indexOf('playbackState: "ended_preview"', hardCapAt);
  assert.ok(
    hardCapAt > -1 && pauseAt > hardCapAt && resetAt > pauseAt && resetAt < endedPreviewAt,
    "audio.currentTime must be reset to 0 after pausing at the cap, before the ended_preview state is committed — otherwise the next Play call resumes from the end instead of replaying"
  );
});

test("the naturally-shorter-than-cap onEnded path already had this reset — confirms the hard-cap path was the only gap, not a new invariant", () => {
  const src = read("src/lib/playback/PlaybackEventHandlers.js");
  const previewOnlyEndedAt = src.indexOf("if (previewOnly) {", src.indexOf("if (audio.currentTime >= PREVIEW_HARD_CAP_SEC) {") + 1);
  assert.match(src.slice(previewOnlyEndedAt, previewOnlyEndedAt + 1600), /audio\.currentTime = 0;/);
});

test("the global player bar scrubber is fully non-interactive for preview — no drag-state, no seek, on any input path", () => {
  const src = read("src/components/audio/GlobalAudioPlayerBar.js");
  const scrubFnAt = src.indexOf("const PlayerBarScrub = memo(");
  const scrubBody = src.slice(scrubFnAt, scrubFnAt + 6000);
  assert.match(scrubBody, /if \(previewOnly \|\| !maxSeek\) return;/,
    "seekFromEvent must no-op for preview before computing or applying any ratio");
  assert.match(scrubBody, /const onScrubStart = useCallback\(\s*\(e\) => \{\s*if \(previewOnly\) return;/,
    "onScrubStart must not even enter the dragging state for preview");
  assert.match(scrubBody, /tabIndex=\{previewOnly \? -1 : 0\}/);
  assert.match(scrubBody, /aria-disabled=\{previewOnly \|\| undefined\}/);
});

test("the immersive preview modal's own ScrubBar (a second, separate scrub implementation) is also non-interactive for preview", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  const scrubFnAt = src.indexOf("function ScrubBar(");
  const scrubBody = src.slice(scrubFnAt, scrubFnAt + 3000);
  assert.match(scrubBody, /const seekAt = useCallback\(\(e\) => \{\s*\/\/[^\n]*\n[^\n]*\n[^\n]*\n\s*if \(isPreview\) return;/);
  assert.match(scrubBody, /const onMouseDown = useCallback\(\(e\) => \{\s*if \(isPreview\) return;/);
  assert.match(scrubBody, /const onTouchMove = useCallback\(\(e\) => \{\s*if \(isPreview\) return;/);
  assert.match(scrubBody, /cursor: isPreview \? "default" : "pointer"/);
});

test("skip-back/skip-forward buttons and lyric click-to-seek are disabled (not just visually dimmed) for preview tracks", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  // Both FloatingPlayer call sites must withhold the seek callbacks entirely —
  // FloatingPlayer's own dimStyle/disabled logic already keys off the prop
  // being falsy, so passing undefined reuses that existing behavior for free.
  assert.match(src, /onSkipBack=\{isPreview \? undefined : seekBack\}/);
  assert.match(src, /onSkipFwd=\{isPreview \? undefined : seekForward\}/);
  assert.match(src, /onSkipBack=\{isPreview && activeTrack && !activeTrack\?\.free \? undefined : seekBack\}/);
  assert.match(src, /onSkipFwd=\{isPreview && activeTrack && !activeTrack\?\.free \? undefined : seekForward\}/);
  assert.match(src, /onSeek=\{isPreview && activeTrack && !activeTrack\?\.free \? undefined : seek\}/);
});

test("the preview duration label matches the real enforced cap (PREVIEW_HARD_CAP_SEC), not a stale hardcoded value", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  assert.match(src, /import \{ PREVIEW_HARD_CAP_SEC \} from "@\/lib\/playback\/PlaybackEventHandlers"/);
  assert.doesNotMatch(src, /"0:30"/,
    "the stale 30-second preview label must be gone — the actual cap is 15s");
  assert.match(src, /isPreview \? fmt\(PREVIEW_HARD_CAP_SEC\) : fmt\(duration\)/);
});

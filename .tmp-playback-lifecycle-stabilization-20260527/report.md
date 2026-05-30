# Playback Lifecycle Stabilization — 2026-05-27

## Phase 1 — applyPendingSeek / saved progress (HIGHEST)

**Findings**
- `applyPendingSeek` clamped only to `duration - 1`, allowing restores within ~1s of track end → immediate `ended`.
- `getSavedPlaybackPosition` and `accountState.mediaProgress` restored without near-end rejection.
- Stale near-end localStorage entries were never cleared.

**Fixes** (`src/context/AudioContext.js`)
- Added `clampRestorePosition` / `isNearEndRestorePosition` with 3s buffer (lines 58–84).
- Resume resolution in `playTrack` clamps/rejects and clears bad localStorage (lines 1221–1255).
- `applyPendingSeek` uses safe clamp + clears storage on reject (lines 1355–1370).
- Same-track inline seek uses clamp (lines 1342–1351).
- `resumeAt: 0` explicitly clears saved position (lines 1226–1229).

## Phase 2 — upgradeToFullStream 2s timer

**Findings**
- `upgradeToFullStream` always called `waitAudioSrcReady` even when already on signed full URL → decode interrupt.
- Release card scheduled 2s upgrade for all `canStream` tracks, including those already on full stream.

**Fixes**
- `normalizePlaybackSrc` + early returns when already on signed/full stream (lines 1420–1444, 1456–1475).
- Skip reload when resolved URL equals current `currentSrc` (metadata-only patch).
- `ReleaseCardPlayButton`: timer only when `previewOnly && canStream` (lines 59–64).

## Phase 3 — onEnded / replay corruption

**Findings**
- Replay on ended track could retain `playbackState: "ending"` and near-end `currentTime`.
- Spurious `ended` after bad seek was unguarded.

**Fixes**
- `isReplay` resets `currentTime`, `pendingSeek`, `playbackState` (lines 1268–1272).
- `spuriousEndedGuardRef` ignores `ended` for 1.2s after load/bad seek; rewinds instead of queue advance (lines 330, 721–733, 1335, 1366).

## Phase 4 — Playback state persistence

**Findings**
- Interval/visibility/pagehide saves could persist near-end positions for next resume.

**Fixes**
- Skip `savePlaybackPosition` when position is near end (lines 347–351, 1898–1904, 1965–1971).
- `clearPlaybackPosition` on rejected restore (multiple paths above).

## Phase 5 — Verification

- `npm run build` — pass (Next.js 16.2.4).
- Entitlement checks, stream fetch, and access-denied paths unchanged.

## Files changed

| File | Role |
|------|------|
| `src/context/AudioContext.js` | Restore clamping, upgrade guards, ended/replay, save skips |
| `src/components/music/ReleaseCardPlayButton.js` | Preview-only upgrade timer |

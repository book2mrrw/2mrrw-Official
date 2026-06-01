# Phase 15C — Playback Consolidation Report (Safe)

**Date:** 2026-06-01  
**Scope:** Read-only audit + minimal hygiene only. No state-machine rewrite, no `recoverAudioHard` rename, no `recoverPlayback` alias change, no AudioContext architecture rewrite.

**Builds on:** Phase 14F (audibility truth), Phase 15 (PlaybackStateMachine), Phase 15B (recovery centralization).

---

## 1. CONFLICT MAP

Four layers can disagree about “is playback happening?” Each layer has a role; conflicts are detected and routed to recovery.

| Layer | Source of truth | Location | Notes |
|-------|-----------------|----------|-------|
| **Audibility** (highest) | `isAudioActuallyAudible()` — element unpaused + readyState ≥ 2 + Web Audio running + currentTime advancing | `src/lib/playback/audibility.js` | Phase 14F. Not merely `!paused`. |
| **Element** | `!audio.paused && !audio.ended` | `<audio>` ref in `AudioContext.js` | Reconciled downward in `patchState` via `reconcileIsPlayingWithElement`. |
| **Machine** | `playbackStateMachine.state` — IDLE/LOADING/PLAYING/PAUSED/DEGRADED/RECOVERING | `src/media/PlaybackStateMachine.js` | Orchestration only; recovery executor calls `recoverAudioHard`. |
| **React `isPlaying`** (lowest) | `state.isPlaying` + `playbackState` | `AudioContext.js` `patchState` / element handlers | UI/command intent; corrected when audibility or element disagree. |

### Bridge (`mediaEngineBridge`)

- Registered in `AudioContext.js:1262–1291`.
- `getState().isPlaying` = audibility truth (`isAudioActuallyAudible`), not React `isPlaying`.
- `notifyMediaEngineBridge()` fires on progress/state changes.

### GAPB ladder (`GlobalAudioPlayerBar`)

Display play ring uses a fallback ladder (`GlobalAudioPlayerBar.js:536–538`):

```
dockIsPlaying = getIsAudiblyPlaying() ?? engineIsPlaying ?? isPlaying
```

| Rung | Source | Truth level |
|------|--------|-------------|
| 1 | `getIsAudiblyPlaying()` → audibility | Highest |
| 2 | `engineIsPlaying` from `useMediaEngine` | Bridge (also audibility-first via `mapAudioContextToMediaEngine`) |
| 3 | React `isPlaying` from `useImmersivePlayback` | Lowest |

`useMediaEngine.js:127–134` mirrors the same audibility → bridge → element ladder.

### Parallel recovery lanes (intentional, not conflicts)

| Path | Target | Does NOT call `recoverAudioHard` |
|------|--------|----------------------------------|
| `PLAYBACK_COMMANDS.RECOVER` (hard) | `requestPlaybackRecovery` → machine → `recoverAudioHard` | — |
| `recoverPlayback` alias | `RECOVER_PLAYBACK` → `retryStreamPlayback()` | ✓ (stream retry only) |
| Stall recovery (`waiting`/`stalled`) | `retryStreamPlayback()` after 12s | ✓ |
| `onError` stream refresh | Inline `fetchLibraryStream` + src swap | ✓ |
| `onPause` interruption | Direct `audio.play()` retry | ✓ |

These are **soft recovery** paths for network/buffer issues. Hard graph teardown is reserved for the machine executor.

### Known desync scenarios (handled)

| Symptom | Detector | Route |
|---------|----------|-------|
| UI playing, not audible | `validatePlaybackTruthIntegrity` / audibility watchdog | `AUDIO_DESYNC_DETECTED` → `recoverAudioHard` |
| `patchState({ isPlaying: true })` while silent | `patchState` invariant (FATAL_AUDIO_DESYNC) | `AUDIO_DESYNC_DETECTED` |
| React `isPlaying` but element paused | `reconcileIsPlayingWithElement` | Downgrade React state (no recovery) |
| Play ring shows wrong state | GAPB audibility ladder | Self-corrects on next bridge tick |

---

## 2. RECOVERY FLOW MAP

All hard recovery converges: **entry point → `requestPlaybackRecovery` (or direct `playbackStateMachine.transition`) → `_beginRecovery` → registered executor → `recoverAudioHard`**.

```
requestPlaybackRecovery(event, payload)
  └─ playbackStateMachine.transition(event, payload)
       └─ _beginRecovery (dedupes via recoveryPromise)
            └─ recoverExecutor(reason, { resumeAfter })
                 └─ recoverAudioHard(reason, { resumeAfter })   [AudioContext.js:2753]
```

### Entry points → `requestPlaybackRecovery` / machine

| # | Entry | Event | Reason | resumeAfter | File:line |
|---|-------|-------|--------|-------------|-----------|
| 1 | Audibility watchdog — truth violation | `AUDIO_DESYNC_DETECTED` | `truth_violation` | isPlaying && !userPaused | `AudioContext.js:3022` |
| 2 | Audibility watchdog — silent desync | `AUDIO_DESYNC_DETECTED` | `silent_desync_detected` | !userPaused | `AudioContext.js:3047` |
| 3 | `patchState` invariant break | `AUDIO_DESYNC_DETECTED` | `fatal_audio_desync_invariant` | !userPaused && track | `AudioContext.js:952` |
| 4 | `PLAYBACK_COMMANDS.RECOVER` (hard) | `RECOVERY_REQUESTED` | payload reason | payload (default true) | `AudioContext.js:3656` |
| 5 | `resumeInternal` — suspended AudioContext | `RECOVERY_REQUESTED` | `audio_context_suspended` | true | `AudioContext.js:3370` |
| 6 | `playTrackInternal` — suspended AudioContext | `RECOVERY_REQUESTED` | `audio_context_suspended` | true | `AudioContext.js:2024` |
| 7 | `resumePlaybackTransport` — hasStarted session | `RECOVERY_REQUESTED` | `session_recovery_transport` | false | `AudioContext.js:2960` |
| 8 | `visibilitychange` → visible | `RECOVERY_REQUESTED` | `visibility_return` | wasPlayingBeforeHide && entitled | `AudioContext.js:4102` |
| 9 | `pageshow` — bfcache (`event.persisted`) | `RECOVERY_REQUESTED` | `bfcache_restore` | wasPlaying && entitled | `AudioContext.js:4134` |

### Entry points that bypass machine (soft recovery)

| Entry | Handler | File:line |
|-------|---------|-----------|
| `recoverPlayback` / `RECOVER_PLAYBACK` command | `retryStreamPlayback()` | `AudioContext.js:3683` |
| Stall timer (12s buffering) | `retryStreamPlayback()` | `AudioContext.js:824` |
| Stream element error | Inline stream URL refresh | `AudioContext.js:1701` |
| Offline → online | `playTrackRef` with forceStream | `AudioContext.js:1684` |
| Unexpected pause (not user/viewport) | `audio.play()` on canplay | `AudioContext.js:1441` |

### `recoverAudioHard` guards

- `isRecoveringRef` — no re-entry
- `recoveryCooldownUntilRef` — 6s cooldown (bypassed for `truth_violation`)
- Machine `recoveryPromise` — dedupes concurrent recovery requests

---

## 3. RISK AREAS

| Risk | Severity | Detail |
|------|----------|--------|
| **Dead `syncPlaybackUiFromAudioElement`** | Low (hygiene) | Defined `AudioContext.js:3912–3966`, zero call sites. Superseded by direct `requestPlaybackRecovery` on visibility return (Phase 15). Safe to remove. |
| **`recoverPlayback` vs `RECOVER` naming** | Low (doc) | Alias maps to stream retry, not hard recovery. Callers must not assume graph teardown. |
| **Stall/error paths skip machine** | Medium (by design) | Network retries may leave Web Audio graph degraded if audibility watchdog is slow (1.25s interval). Watchdog catches persistent silence. |
| **`pageshow` non-bfcache gap** | Low | `pageshow` without `event.persisted` only rehydrates media session (`AudioContext.js:4146–4148`). Relies on paired `visibilitychange` for recovery. Rare edge on iOS if visibility event is missed. |
| **Dual machine callers** | Low | Some sites call `playbackStateMachine.transition` directly (#3, #6, #7) vs `requestPlaybackRecovery` wrapper — functionally identical. |
| **`onPlay` sets `isPlaying: true` before audibility confirms** | Low | `patchState` invariant + watchdog correct within ~1.25s. GAPB uses audibility for display. |
| **Command queue during RECOVERING** | Low | Machine stays RECOVERING until executor completes; LOAD_START allowed, LOAD_END suppressed. |

---

## 4. MINIMAL FIX LIST

| # | Fix | File:line | Lines | Safe? |
|---|-----|-----------|-------|-------|
| 1 | Remove dead `syncPlaybackUiFromAudioElement` (0 call sites) | `src/context/AudioContext.js:3912–3966` | ~55 | ✓ |
| 2 | Add truth hierarchy JSDoc block | `src/lib/playback/audibility.js:1–5` | +4 | ✓ |

No other changes required. Do **not** rename `recoverAudioHard`, change `recoverPlayback` alias, or reroute `RECOVER` command handling.

---

## 5. CONFIRMATION

**NO ARCHITECTURE REWRITE REQUIRED**

Phase 14F/15/15B/15C stack is coherent:
- Audibility is authoritative for “actually playing.”
- PlaybackStateMachine serializes hard recovery through one executor.
- `requestPlaybackRecovery` is the single front door for hard recovery.
- GAPB and mediaEngine bridge already prefer audibility over React state.
- Remaining work is dead-code hygiene and documentation only.

---

## 6. TRUTH HIERARCHY

When layers disagree, resolution order is:

```
audibility (isAudioActuallyAudible)
    ↓ overrides
element (!paused && !ended)
    ↓ overrides
machine (orchestration state — RECOVERING/DEGRADED)
    ↓ overrides
React isPlaying (UI intent)
```

**Rules:**
1. **Display** (GAPB play ring, mediaEngine bridge): audibility first, then bridge, then element, then React.
2. **Recovery trigger**: audibility failure while React says playing → `AUDIO_DESYNC_DETECTED` → `recoverAudioHard`.
3. **State patch safety**: setting `isPlaying: true` while element is paused → `reconcileIsPlayingWithElement` downgrades React.
4. **Machine state** is diagnostic/orchestration; it does not override audibility for UI.
5. **`!audio.paused` alone is not truth** — frozen currentTime or suspended AudioContext = not audible.

---

## 7. iOS VISIBILITY / PAGESHOW FUNNEL

### Verified paths

| Event | Condition | Action | Recovery? |
|-------|-----------|--------|-----------|
| `visibilitychange` → hidden | hasStarted + track | Save position; optional stream URL prefetch; set `wasPlayingBeforeHideRef` | No |
| `visibilitychange` → visible | hasStarted + track | `requestPlaybackRecovery({ reason: visibility_return })` | **Yes** |
| `pageshow` | `event.persisted` (bfcache) | `requestPlaybackRecovery({ reason: bfcache_restore })` | **Yes** |
| `pagehide` | isPlaying | Save position | No |

### Gaps (report only — no code change)

1. **`pageshow` non-persisted:** Only calls `rehydrateMediaSession()` when visible + hasStarted (`AudioContext.js:4146–4148`). Recovery depends on `visibilitychange` having fired first. On iOS Safari this is normally paired; an orphaned `pageshow` would skip hard recovery.
2. **`page.js` visibility handler** (`page.js:679–685`) pauses carousel videos only — does not interfere with audio recovery (separate concern).
3. **Preview tracks:** `resumeAfter` on visibility return requires `isEntitledFullPlaybackTrack(track)` — preview playback does not auto-resume after background (intentional).

### iOS-specific behavior preserved

- `wasPlayingBeforeHideRef` captured on hidden (`AudioContext.js:4057–4059`)
- Hard recovery clears src + reloads element (`recoverAudioHard` iOS silent-graph mitigation)
- Web Audio graph teardown with `preserveMediaElementSource: true`
- Position saved on hidden/pagehide for restore inside `recoverAudioHard`

---

## Appendix — Key file index

| File | Role |
|------|------|
| `src/lib/playback/audibility.js` | Audibility truth + Web Audio teardown |
| `src/media/PlaybackStateMachine.js` | Recovery orchestration singleton |
| `src/context/AudioContext.js` | Engine, commands, recovery executor, lifecycle |
| `src/components/audio/GlobalAudioPlayerBar.js` | GAPB audibility ladder + RECOVERING indicator |
| `src/media/useMediaEngine.js` | Bridge consumer audibility ladder |
| `src/media/mediaEngineBridge.js` | Imperative bridge registry |
| `src/lib/player/useImmersivePlayback.js` | Thin adapter (no separate truth) |

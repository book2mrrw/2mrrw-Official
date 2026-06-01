# Phase 3 — Mobile Background Playback

**Date:** 2026-05-31  
**Scope:** Mobile playback continuity, lock-screen, background/foreground sync. Phase 1+2 playback/entitlement/queue architecture unchanged.

---

## 1. Executive summary

Foreground return after lock, app switch, or tab background was incorrectly showing **paused** UI for entitled streams even when the `<audio>` element was still playing, and **never attempted RECOVER** when iOS Safari paused the element in background because React `isPlaying` was already cleared by the `pause` event before the visibility handler ran.

**Fix:** Sync UI from the audio element on `visibilitychange` → `visible`, use `wasPlayingBeforeHideRef` (element truth on hide) for entitled `RECOVER`, remove iOS-only forced paused UI. Hidden path unchanged (no app-initiated pause). Media Session handlers verified intact. Phase 2 recovery queue gating unchanged (`AudioPhase10Bridge`).

**Build:** PASS  
**test:playback-resolver-fallback:** PASS (21/21)

---

## 2. Files modified

| File | Change |
|------|--------|
| `src/context/AudioContext.js` | `isEntitledFullPlaybackTrack`, `syncPlaybackUiFromAudioElement`, visibility handler fixes |

No changes to `GlobalAudioPlayerBar.js`, layout, or globals.

---

## 3. Root cause

### 3.1 Foreground sync bug (primary)

On `visibilitychange` → `visible`, recovery only ran when:

```text
el.paused && stateRef.current.isPlaying
```

When the OS pauses audio in background, the element’s `pause` event fires first and sets `isPlaying: false`. On return, `wasPlayingBeforeHide` was true but `isPlaying` was false → **no RECOVER**.

### 3.2 iOS forced paused UI (secondary)

For the narrow case that did match `el.paused && isPlaying`, **iOS** took a branch that called `patchState({ isPlaying: false, playbackState: "paused" })` instead of `PLAYBACK_COMMANDS.RECOVER`, desyncing lock-screen / in-app UI from entitled background playback intent.

### 3.3 Not a root cause (verified)

- **Hidden handler** does not call `audio.pause()` for entitled streams (saves position + optional stream URL refresh only).
- **`pagehide`** saves position only.
- **`page.js` visibility** pauses carousel **videos**, not the global music element.

---

## 4. Implementation

### `isEntitledFullPlaybackTrack(track)`

True when `metadata.access.canStream` and not `previewOnly`. Used to gate auto-recover on foreground (guest 15s preview path unchanged).

### `syncPlaybackUiFromAudioElement({ wasPlayingBeforeHide })`

| Element state | Action |
|---------------|--------|
| `!audio.paused` | Align UI to playing; restart keep-alive / RAF / position timers; refresh Media Session |
| `audio.paused` + was playing before hide + entitled | Return `"recover"` → `PLAYBACK_COMMANDS.RECOVER` (all platforms, including iOS) |
| `audio.paused` + stale `isPlaying` | Sync UI to paused |

### Hidden capture

`wasPlayingBeforeHideRef` now uses `!audio.paused` (element truth) instead of `isPlaying && !paused`.

---

## 5. Media Session / lock-screen / Bluetooth

Handlers (unchanged, verified wired):

- `play` → `resume()` → `RESUME` / `RECOVER` path via `resumeInternal`
- `pause` → `pause()` → `PAUSE`
- `nexttrack` / `previoustrack` → `playNext` / `playPrevious`
- `seekto`, `seekbackward`, `seekforward` → `seek()` (preview capped at 15s in `seekInternal`)
- `stop` → `stop()`
- `togglemicrophone` → CS mode toggle

`updateMediaSession` + `setPositionState` re-run on foreground via existing rehydrate / sync path.

**Bluetooth / CarPlay:** Same Media Session surface; no separate stack.

---

## 6. Guest preview preservation

| Behavior | Status |
|----------|--------|
| 15s hard cap (`PREVIEW_HARD_CAP_SEC`) | Unchanged |
| Fade + `ended_preview` | Unchanged |
| Seek cap in `seekInternal` | Unchanged |
| No auto-next on preview end | Unchanged |
| Foreground auto-recover after background | **Entitled only** — preview does not get `RECOVER` on visibility return |

---

## 7. Recovery / queue (Phase 2)

`useSessionRecovery` still dispatches `2mrrw:playback-recovery` on mount. `AudioPhase10Bridge` still skips `setQueue` when `hasStarted` or `queue.length > 0`. No change required for background/foreground tab switches (recovery does not re-fire).

---

## 8. Validation matrix (code-path)

| Tier | Hidden | Foreground return | Lock-screen play/pause | Notes |
|------|--------|-------------------|------------------------|-------|
| Guest preview | No app pause | UI sync only; no auto-recover | Same handlers; seek capped | 15s cap still enforced in `timeupdate` |
| Entitled stream | Position save + URL refresh | Sync playing OR `RECOVER` | `resumeInternal` / `pauseInternal` | **Live device QA required** for iOS lock / BT |
| Preview-only asset (non-subscriber) | Same as guest | Cap/stop unchanged | Duration = preview file | |

### Commands run

```bash
npm run build                          # PASS
npm run test:playback-resolver-fallback  # PASS 21/21
```

### Live device QA (required)

- iOS Safari: lock screen while playing entitled track → audio continues; unlock → UI shows playing (not forced paused).
- iOS: Control Center play/pause/next.
- Android Chrome: tab background / PIP if applicable.
- Bluetooth headset transport controls.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| iOS may still suspend audio without user gesture after long background | `RECOVER` attempts `audio.play()`; failure logs `VISIBILITY_RECOVER_BLOCKED` and syncs paused UI |
| Double timer start on foreground sync | `startKeepAlivePing` / RAF / position timers idempotent or replace intervals |
| OS `pause` during hide still clears React state | `wasPlayingBeforeHideRef` + entitled `RECOVER` on visible |

---

## 10. Out of scope (unchanged)

- Playback resolver, entitlement resolution, queue purchase/subscription flows
- Modal close `pause()` on album/single modals (Phase 5.2.2 known behavior)
- Cinematic shell / second audio element policy

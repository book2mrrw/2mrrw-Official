# Phase 6B — Viewport-Aware Audio Focus Resume System

**Project:** 2MRRW Artist Platform (`/Users/recharge/artist-platform`)  
**Date:** 2026-05-31  
**Mode:** DESIGN + IMPLEMENTATION PLAN ONLY — no code changes in this phase  
**Goal:** Deterministic viewport-based audio focus with conditional auto-resume on exit

---

## Problem statement

Today, scrolling into the **Audio Visuals** section pauses global music via `handleAudioVisualsFocused → pause()` but **never resumes** when the user scrolls away. Forensic audits (Phase 5B scroll trace, playback interruption forensic) confirm this is intentional AV handoff code, not a provider bug — but it breaks the fan expectation that background music continues after passing through the section.

Phase 6B adds **resume-on-exit** only when the pause was caused by viewport focus, not by explicit user intent.

---

## Current behavior (baseline)

| Location | Behavior |
|----------|----------|
| `page.js` L408–421 | `IntersectionObserver` on `AudioVisualsSection` — enter triggers `triggerFocus()` once; re-enter sends YouTube `playVideo`; exit sends `pauseVideo` |
| `page.js` L760–762 | `handleAudioVisualsFocused`: `if (isPlaying) pause()` |
| `AudioContext.js` L2904, L2557–2559 | `pause()` → `PAUSE` command → `pauseInternal()` → `userPausedRef = true` → `audio.pause()` |
| `AudioContext.js` L416–418 (via IO exit) | YouTube `pauseVideo` only — **no** music `resume()` |
| Prior audit | `docs/reports/audio-logic-audit-20260525.md` §E — "no auto-resume on exit unless product changes" |

**Product change:** Phase 6B implements conditional auto-resume.

---

## SECTION 1 — State model in AudioContext

### Design principle

Viewport focus state lives in **refs**, not React state. It must not trigger provider re-renders or cascade into catalog/hero churn documented in Phase 5B audits.

Mirror the existing `wasPlayingBeforeHideRef` pattern (`AudioContext.js` L553, L3046, L3085–3103) but scoped to Audio Visuals viewport, with explicit user-action tracking.

### State shape

Add a single ref object `viewportAudioFocusRef` (name TBD at implementation) initialized once:

```javascript
const viewportAudioFocusRef = useRef({
  /** True while Audio Visuals section is intersecting viewport */
  isInAudioVisualViewport: false,

  /** Captured at viewport-enter pause: music was audibly playing before AV handoff */
  wasPlayingBeforeViewportPause: false,

  /**
   * Last explicit user playback intent.
   * Values: "play" | "pause" | "track_change" | "stop" | null
   * Updated only from user-gesture command paths (see Section 5).
   */
  lastUserAction: null,

  /** Track id (normalized track.id) captured at viewport-enter pause */
  lastTrackId: null,

  /**
   * Derived latch: may auto-resume on viewport exit.
   * Set true on viewport-enter pause when eligible.
   * Cleared on manual pause, track change, stop, ineligible exit, or successful resume.
   */
  resumeEligible: false,
});
```

### Location

| Item | File | Placement |
|------|------|-----------|
| Ref declaration | `src/context/AudioContext.js` | Adjacent to `wasPlayingBeforeHideRef` (~L553) |
| Read/write helpers | `src/context/AudioContext.js` | Module-level or `useCallback` helpers inside `AudioProvider` |
| Public API | `src/context/AudioContext.js` | Two new methods on context value (~L3281+) |
| IO wiring | `src/app/page.js` | Replace `handleAudioVisualsFocused` with enter/exit handlers (~L759–762, L408–421) |

**Do not** add these fields to `EMPTY_STATE` or `patchState` — they are internal coordination refs only.

### Update rules

| Event | Field updates |
|-------|---------------|
| User taps pause (bar, modal, media session) | `lastUserAction = "pause"`, `resumeEligible = false`, `wasPlayingBeforeViewportPause = false` |
| User taps play/resume | `lastUserAction = "play"` (does not set `resumeEligible`) |
| User plays new track / skip / queue change | `lastUserAction = "track_change"`, `resumeEligible = false`, `wasPlayingBeforeViewportPause = false`, `lastTrackId = newId` |
| User stop | `lastUserAction = "stop"`, clear all viewport resume fields |
| Viewport **enter** (see Section 2) | `isInAudioVisualViewport = true`; conditionally set `wasPlayingBeforeViewportPause`, `lastTrackId`, `resumeEligible` |
| Viewport **exit** (see Section 3) | `isInAudioVisualViewport = false`; if resume fires, clear `resumeEligible` and `wasPlayingBeforeViewportPause` |
| Successful auto-resume | `resumeEligible = false`, `wasPlayingBeforeViewportPause = false` |
| Tab hide / visibility hidden | **No change** to viewport refs (orthogonal systems) |
| Provider unmount / `stopInternal` | Reset entire ref object to initial values |

### Relationship to existing refs

| Existing ref | Interaction |
|--------------|-------------|
| `userPausedRef` | **Must not** be set `true` on viewport-enter pause. Today `pauseInternal()` always sets it (L2558) — Phase 6B requires a viewport-specific pause path (see Section 5). |
| `wasPlayingBeforeHideRef` | Independent. Tab visibility resume and viewport resume must not cross-contaminate. |
| `skipPauseInterruptionRef` | Unrelated to viewport; do not reuse for viewport pause. |

---

## SECTION 2 — Enter viewport

### Trigger

`AudioVisualsSection` IO callback when `entry.isIntersecting === true` (every enter, not only first — see IO changes in Section 5).

### Algorithm

```
onAudioVisualViewportEnter():
  vf = viewportAudioFocusRef.current
  vf.isInAudioVisualViewport = true

  s = stateRef.current
  audio = audioRef.current

  // Already inside viewport (IO flicker re-entry) — idempotent
  if vf.wasPlayingBeforeViewportPause && vf.resumeEligible:
    return  // pause already applied; do not re-capture

  playingNow = s.isPlaying && audio && !audio.paused

  if playingNow && vf.lastUserAction !== "pause":
    vf.wasPlayingBeforeViewportPause = true
    vf.lastTrackId = s.currentTrack?.id ?? null
    vf.resumeEligible = true
    dispatchViewportPause()   // new path — does NOT set userPausedRef
  else:
    vf.wasPlayingBeforeViewportPause = false
    vf.resumeEligible = false
    // If music is playing but user manually paused earlier in same session,
    // isPlaying is already false — no-op.
    // If music playing despite lastUserAction === "pause" (stale), still no pause:
    //   user explicitly paused; AV section must not override.
```

### Replace pause-only hook

**Current:** `handleAudioVisualsFocused` → `if (isPlaying) pause()`  
**Target:** `onAudioVisualViewportEnter()` → context API `enterAudioVisualViewport()` implementing the algorithm above.

### First-enter vs repeat-enter

| Case | Music | YouTube | Viewport pause |
|------|-------|---------|----------------|
| First intersect | Pause if eligible | `triggerFocus()` mounts iframe (unchanged) | Capture + pause |
| Re-intersect after exit | Pause if eligible again | `playVideo` (unchanged L412–414) | Re-capture if user resumed music while away |

If user manually resumed while scrolled away from AV, re-enter should pause again and re-arm resume (same rules).

---

## SECTION 3 — Exit viewport

### Trigger

IO callback when `entry.isIntersecting === false` and `hasBeenInView === true` (existing guard L416–417).

### Resume conditions (all required)

1. `wasPlayingBeforeViewportPause === true`
2. `resumeEligible === true`
3. `lastUserAction !== "pause"` and `lastUserAction !== "stop"`
4. `stateRef.current.currentTrack?.id === lastTrackId` (same track)
5. `stateRef.current.hasStarted === true`
6. `document.visibilityState === "visible"` (do not resume while tab hidden)
7. No modal that explicitly pauses music is open (feature modal path — see Section 4)
8. Audio element exists and is paused (not already playing)

### Algorithm

```
onAudioVisualViewportExit():
  vf = viewportAudioFocusRef.current
  vf.isInAudioVisualViewport = false

  if !shouldAutoResumeViewport(vf, stateRef.current):
    vf.resumeEligible = false
    vf.wasPlayingBeforeViewportPause = false
    return

  vf.resumeEligible = false   // consume latch BEFORE dispatch (anti double-resume)
  vf.wasPlayingBeforeViewportPause = false

  dispatchPlaybackCommand(RESUME)   // existing resumeInternal path
  vf.lastUserAction = "play"        // optional: reflect system-resume as non-user-pause
```

### No duplicate `play()`

| Guard | Mechanism |
|-------|-----------|
| Latch consumption | Clear `resumeEligible` before enqueueing `RESUME` |
| Command queue | `dispatchPlaybackCommand(RESUME)` is serial (L2765+) — only one resume in flight |
| `resumeInternal` | L2565: early return if no track; L2573: `audio.play()` only when invoked |
| Already playing | Exit handler checks `audio.paused === true` before dispatch |
| `onPause` auto-recover | Viewport pause must **not** set `userPausedRef`, avoiding L1119–1135 competing recover |

---

## SECTION 4 — Anti-bug guards

### Manual pause

| Source | Rule |
|--------|------|
| Global bar toggle | `pause()` → set `lastUserAction = "pause"`, clear viewport resume |
| Media session pause | Same |
| Feature modal close (`page.js` L1338) | Same — explicit product pause |
| Immersive modal pause controls | Same |

**While inside AV viewport:** manual pause clears `resumeEligible`. Exit must **not** resume.

### Track change

Any of: `playTrack`, `playQueue`, `playNext`, `playPrevious`, `stopInternal`, preview ended, queue auto-advance.

→ Set `lastUserAction = "track_change"`, clear viewport resume fields, update `lastTrackId` to new track if playing.

**While inside AV viewport:** if user starts a different track, exit resume must not restore previous track's playback.

### Modal interactions

| Modal | On open | On close |
|-------|---------|----------|
| Single/album release | No pause (unchanged) | No pause (unchanged) |
| Feature modal | — | `pause()` — clears resume eligibility |
| Any future modal with explicit pause | Must call standard `pause()` | — |

**Guard:** `shouldAutoResumeViewport` checks page-level modal flags OR relies on `lastUserAction === "pause"` set by modal close.

### Seek-only

`seek`, `seekBack`, `seekForward` — **do not** update `lastUserAction`, **do not** clear `resumeEligible`.

Rationale: seeking while paused outside AV should not affect viewport resume contract.

### Preview / entitlement edge cases

| Case | Rule |
|------|------|
| Preview hard cap pause | `skipPauseInterruptionRef` path — treat as system, not user; clear viewport resume |
| Stream swap during AV viewport | If pause is internal (src swap), preserve `resumeEligible` if `wasPlayingBeforeViewportPause` |
| Access denied on resume | `resumeInternal` failure — leave paused; do not retry loop |

### User paused then scrolls into AV

Music already paused → enter handler: `playingNow === false` → no capture, `resumeEligible = false`. Exit: no resume. Correct.

### User paused inside AV viewport

Manual pause clears eligibility. Exit: no resume. Correct.

---

## SECTION 5 — Integration points

### 5.1 AudioContext.js — new API

Export on context value:

```javascript
enterAudioVisualViewport()   // Section 2 algorithm
exitAudioVisualViewport()    // Section 3 algorithm
```

Optional diagnostic hook (dev only):

```javascript
getViewportAudioFocusSnapshot() // read-only copy for playback-diagnostics
```

### 5.2 AudioContext.js — viewport pause path

**New internal:** `pauseForViewportInternal()`

- Calls `audioRef.current?.pause()` directly OR dispatches new command `PLAYBACK_COMMANDS.VIEWPORT_PAUSE`
- **Does not** set `userPausedRef.current = true`
- Still runs normal `onPause` → `patchState({ isPlaying: false })` for UI sync
- `onPause` L1119 auto-recover: must not fire for viewport pause — ensure `userPausedRef` stays false and consider a one-shot `viewportPauseInProgressRef` if `canplay` recover interferes

**Alternative (preferred):** add `pauseInternal({ reason })` where `reason === "viewport"` skips `userPausedRef`.

### 5.3 AudioContext.js — lastUserAction writers

| Command / handler | Set `lastUserAction` |
|-------------------|----------------------|
| `pauseInternal` (default/user) | `"pause"` + clear viewport resume |
| `resumeInternal` (user gesture) | `"play"` |
| `playTrackInternal` / track change | `"track_change"` + clear viewport resume |
| `stopInternal` | `"stop"` + clear viewport resume |
| `enterAudioVisualViewport` | no change to `lastUserAction` |
| `exitAudioVisualViewport` auto-resume | optionally `"play"` after success |
| `seekInternal` | **no update** |

Wire in `executePlaybackCommand` (L2721+) and/or at start of each `*Internal` function.

### 5.4 page.js — AudioVisualsSection IO

**Current IO (L408–421):**

```javascript
if (entry.isIntersecting) {
  triggerFocus();
  if (hasBeenInView) sendCmd("playVideo");
  hasBeenInView = true;
} else if (hasBeenInView) {
  sendCmd("pauseVideo");
}
```

**Target IO:**

```javascript
if (entry.isIntersecting) {
  triggerFocus();                    // keep first-enter iframe mount semantics
  onAudioVisualViewportEnter();      // NEW — every enter
  if (hasBeenInView) sendCmd("playVideo");
  hasBeenInView = true;
} else if (hasBeenInView) {
  sendCmd("pauseVideo");
  onAudioVisualViewportExit();       // NEW — every exit
}
```

### 5.5 page.js — handler replacement

**Remove:**

```javascript
const handleAudioVisualsFocused = useCallback(() => {
  if (isPlaying) pause();
}, [isPlaying, pause]);
```

**Add:**

```javascript
const { enterAudioVisualViewport, exitAudioVisualViewport } = useAudio(); // names TBD

const handleAudioVisualViewportEnter = useCallback(() => {
  enterAudioVisualViewport();
}, [enterAudioVisualViewport]);

const handleAudioVisualViewportExit = useCallback(() => {
  exitAudioVisualViewport();
}, [exitAudioVisualViewport]);
```

Pass both callbacks to `AudioVisualsSection`. `triggerFocus` may still call enter on first focus OR enter is only from IO (preferred — single path).

**Recommendation:** IO-only enter/exit calls; `triggerFocus` retains iframe mount + `firedFocusRef` but **does not** call pause — avoids double enter on first intersect.

### 5.6 Props change — AudioVisualsSection

```javascript
AudioVisualsSection({
  isMobile,
  onAudioVisualViewportEnter,
  onAudioVisualViewportExit,
})
```

Deprecate `onAudioVisualsFocused` prop name.

### 5.7 Command handler summary

| Command | Viewport interaction |
|---------|---------------------|
| `PAUSE` | User pause — clears resume |
| `VIEWPORT_PAUSE` (new) or `pauseInternal({ reason: "viewport" })` | Enter AV — sets resume fields |
| `RESUME` | Exit AV auto-resume OR user resume |
| `PLAY_TRACK` / `PLAY_QUEUE` | Clears resume |
| `INTERRUPT` | Do not use for viewport (same as PAUSE today) |
| `RECOVER` | Visibility only — unrelated |

---

## SECTION 6 — Failure modes and mitigations

See `RACE_CONDITION_ANALYSIS.md` for full matrix. Summary:

| Failure | Mitigation |
|---------|------------|
| Double resume | Consume `resumeEligible` before dispatch; serial command queue |
| Fast scroll race | 50–100ms IO debounce OR transition lock on viewport ref |
| IO flicker at threshold | Hysteresis: require exit below 0.35 after enter at 0.4/0.5; or `rootMargin` shrink |
| iOS scroll jitter | Same hysteresis; defer resume to `requestAnimationFrame` double-read |
| `userPausedRef` leak | Viewport pause must bypass `userPausedRef = true` |
| `onPause` canplay recover (L1119) | Viewport pause keeps `userPausedRef` false; add `viewportPauseActiveRef` if needed |
| Visibility + viewport overlap | Exit resume checks `document.visibilityState === "visible"`; visibility recover uses separate ref |
| Re-enter before resume completes | Enter clears previous latch and re-evaluates playing state |
| Tab switch away while in AV | No exit resume while hidden; if user returns visible still in AV, no spurious resume until exit |
| Duplicate `AudioVisualsSection` instances | Both instances on home/desktop layouts (L2133, L2226) — only one mounted per tab; same handlers OK |
| Feature modal pause then scroll | `lastUserAction === "pause"` blocks resume — correct |

---

## Implementation plan (ordered)

1. **AudioContext:** Add `viewportAudioFocusRef` + helpers + `pauseForViewportInternal`
2. **AudioContext:** Wire `lastUserAction` in user command paths
3. **AudioContext:** Export `enterAudioVisualViewport` / `exitAudioVisualViewport`
4. **page.js:** Extend IO callbacks; replace `handleAudioVisualsFocused`
5. **Diagnostics:** Log viewport transitions via existing `playback-diagnostics.js` (optional, dev flag)
6. **Manual test matrix:** See below
7. **No UI changes** — GlobalAudioPlayerBar reflects `isPlaying` as today

### Test matrix (manual, iOS Safari first)

| # | Steps | Expected |
|---|-------|----------|
| 1 | Play track → scroll into AV → scroll away | Music resumes at same position |
| 2 | Play → pause manually → scroll into AV → away | Stays paused |
| 3 | Play → scroll into AV → pause manually → away | Stays paused |
| 4 | Play → scroll into AV → change track → away | New track state unchanged (no resume of old) |
| 5 | Play → scroll into AV → away → pause → scroll into AV again | No resume on second exit unless user played again |
| 6 | Play → scroll into AV → background tab → foreground → away | Resume only if still eligible and visible |
| 7 | Fast scroll through AV | No double-audio; no resume loop |
| 8 | Feature modal close (pause) → scroll through AV | No auto-resume on exit |

---

## References

| Doc | Relevance |
|-----|-----------|
| `.tmp-phase5b-playback-death-admin-hydration-20260531/SCROLL_TRACE.md` | Primary repro chain |
| `.tmp-playback-interruption-forensic-20260531/report.md` | Root cause = AV IO pause |
| `docs/reports/audio-logic-audit-20260525.md` §E | Prior intentional no-resume policy |
| `src/context/AudioContext.js` L3040–3112 | Visibility resume pattern to mirror |
| `src/app/page.js` L371–426, L760–762 | Current IO + pause hook |

---

## Out of scope (Phase 6B)

- UI indicator for "paused for Audio Visuals"
- Changing YouTube iframe behavior
- Hero/singles carousel video coordination
- Reducing `page.js` re-render churn (separate initiative)
- Auto-resume for feature modal close path

# Race Condition Analysis — Viewport Audio Focus Resume

**Phase 6B design artifact**  
**Purpose:** Identify concurrency hazards before implementation

---

## Hazard catalog

### RC-1 — Double resume

**Scenario:** `AV_EXIT` fires twice (IO flicker) or exit handler + visibility recover both dispatch play.

| Factor | Detail |
|--------|--------|
| Trigger | Rapid IO exit/enter; parallel `RESUME` + `RECOVER` |
| Symptom | Audio stutter, `play()` promise rejection, UI `isPlaying` flapping |
| Root | `resumeEligible` not consumed atomically |

**Mitigation:**
1. Set `resumeEligible = false` **before** `dispatchPlaybackCommand(RESUME)`
2. Serial command queue (existing L2765+) — second RESUME waits
3. `resumeInternal` early exit if `!audio.paused` (add explicit guard)
4. Visibility recover (`RECOVER`) and viewport resume (`RESUME`) use separate refs — never copy `wasPlayingBeforeHide` into viewport latch

**Severity:** High  
**Confidence:** High (IO flicker common on mobile)

---

### RC-2 — Fast scroll race (enter → exit before pause completes)

**Scenario:** User flings scroll through AV section in <100ms.

| Timeline | Risk |
|----------|------|
| T0 | AV_ENTER → viewport pause dispatched |
| T1 | AV_EXIT → resume dispatched |
| T2 | pause `onPause` fires |
| T3 | resume `play()` fires |

**Symptom:** Music resumes while still visually in AV, or pause wins after resume.

**Mitigation:**
1. Viewport pause uses same command queue — enter pause completes before exit resume
2. At exit, re-check `isInAudioVisualViewport` ref — if re-enter already happened, skip resume
3. Optional: monotonic `viewportGeneration` counter increment on enter/exit; exit resume only if generation matches

```javascript
// Pseudocode
let viewportGeneration = 0;
enter() { viewportGeneration++; gen = viewportGeneration; ... pause ... }
exit() {
  const exitGen = viewportGeneration;
  ... if (exitGen !== viewportGeneration) return; // re-entered
}
```

**Severity:** Medium  
**Confidence:** Medium (depends on scroll speed)

---

### RC-3 — IO flicker at threshold boundary

**Scenario:** Section hovers at 39%/41% visible; IO toggles intersecting rapidly.

| Current code | Risk |
|--------------|------|
| threshold `[0, 0.4]` | Binary flip near boundary |
| No hysteresis | enter/exit/enter/exit storm |

**Symptom:** Pause/resume loop audible to user.

**Mitigation:**
1. **Exit debounce:** 50–100ms trailing timer — only resume after stable exit
2. **Hysteresis:** enter at ratio ≥ 0.4, exit at ratio < 0.25 (requires separate ratio read or dual threshold)
3. **Minimum dwell:** do not resume if total time in AV < 200ms (anti-fling)
4. **Enter is NOT debounced** — pause should feel immediate

**Implementation preference:** exit debounce + generation counter (RC-2).

**Severity:** High on iOS Safari  
**Confidence:** High (documented in Phase 5B scroll + hero parallax churn)

---

### RC-4 — iOS scroll jitter / rubber-banding

**Scenario:** Momentum scroll overshoots; `getBoundingClientRect` and IO disagree briefly.

**Mitigation:**
1. Defer resume to `requestAnimationFrame` × 2 (read layout after scroll settles)
2. Re-read `entry.isIntersecting` via `IntersectionObserver.takeRecords()` before resume — if still intersecting, abort
3. Align with existing iOS patterns in `syncPlaybackUiFromAudioElement` (L2915+) and visibility handler (L3039+)

**Severity:** Medium  
**Confidence:** Medium–High

---

### RC-5 — `userPausedRef` contamination

**Scenario:** Viewport enter calls standard `pause()` → `userPausedRef = true` (L2558).

| Downstream effect | Line |
|-------------------|------|
| `onPause` skips auto-recover path incorrectly | L1098–1096 |
| Exit `RESUME` sets `userPausedRef = false` (L2567) — OK |
| But user intent falsely recorded as pause | — |

**Symptom:** Exit resume blocked if we gate on `userPausedRef` instead of `lastUserAction`.

**Mitigation:**
- Dedicated `pauseForViewportInternal()` — never sets `userPausedRef`
- Track intent in `lastUserAction` separately

**Severity:** High (implementation blocker)  
**Confidence:** High — current code always sets userPausedRef on pause()

---

### RC-6 — `onPause` canplay auto-recover (L1119–1135)

**Scenario:** Viewport pause triggers `onPause`; `userPausedRef` is false → `resumeAfterInterrupt` listener attached.

**Symptom:** Music resumes **while still inside AV viewport** without user action.

**Mitigation:**
1. Viewport pause: set short-lived `viewportPauseInProgressRef = true` cleared after pause settles
2. In `onPause`, skip L1119 block when `viewportPauseInProgressRef` or `isInAudioVisualViewport`
3. Prefer explicit guard over relying on `userPausedRef` alone

**Severity:** High  
**Confidence:** High if userPausedRef fix lands without onPause guard

---

### RC-7 — Overlap with visibility recover

**Scenario:** User scrolls into AV (music pauses), backgrounds tab, returns foreground still in AV, scrolls away.

| Step | Visibility ref | Viewport ref |
|------|----------------|--------------|
| Hide | `wasPlayingBeforeHide = false` (already paused) | W=1, E=1 |
| Visible | no recover | unchanged |
| AV exit | — | should resume ✓ |

**Alternate:** Music playing, scroll into AV, hide tab before pause completes.

**Mitigation:**
- Exit resume requires `document.visibilityState === "visible"`
- Visibility recover requires `wasPlayingBeforeHide` — independent
- Never merge the two ref objects

**Severity:** Low–Medium  
**Confidence:** High

---

### RC-8 — Command queue stall during stream swap

**Scenario:** Viewport exit dispatches RESUME while `PLAY_TRACK` stream swap in flight.

**Mitigation:** Existing serial queue — RESUME waits; `resumeInternal` stream refresh path (L2585+) handles signed URL refresh
- If RESUME fails, do not retry in loop — log `VIEWPORT_RESUME_FAILED` once

**Severity:** Low  
**Confidence:** Medium

---

### RC-9 — Track change during viewport pause

**Scenario:** User inside AV, selects different track from mini player or external control.

**Mitigation:**
- `playTrackInternal` sets `lastUserAction = track_change`, clears E/W
- Exit: `currentTrack.id !== lastTrackId` → no resume

**Severity:** Low  
**Confidence:** High

---

### RC-10 — Component unmount while V=1

**Scenario:** User switches tab (`tabKey` remount) while scrolled into AV.

**Mitigation:**
- IO cleanup calls `exitAudioVisualViewport()` 
- If unmount without exit IO event, reset `isInAudioVisualViewport = false` in cleanup
- Do not auto-resume on unmount unless product wants it — **default: no resume on unmount**

**Severity:** Low  
**Confidence:** Medium

---

### RC-11 — Duplicate enter without exit (layout shift)

**Scenario:** iframe mount (`setHasEntered`) changes section height; IO fires enter again without exit.

**Mitigation:**
- Enter handler idempotent: if already `isInAudioVisualViewport && !audio.paused` → pause again
- If already paused with E=1 → no-op re-capture

**Severity:** Low  
**Confidence:** Medium

---

### RC-12 — Feature modal pause + scroll through AV

**Scenario:** `closeFeatureModal` → pause (L1338) → user scrolls through AV → exit.

**Mitigation:**
- `pauseInternal` sets `lastUserAction = pause`, clears E
- Exit: guard fails — no resume

**Severity:** None (correct behavior)  
**Confidence:** High

---

## Recommended implementation ordering (risk-first)

| Priority | Item | Addresses |
|----------|------|-----------|
| P0 | Viewport-specific pause (no userPausedRef) | RC-5, RC-6 |
| P0 | onPause guard for viewport pause | RC-6 |
| P1 | Consume resumeEligible before RESUME | RC-1 |
| P1 | Exit generation counter or re-check V | RC-2 |
| P2 | Exit debounce 50ms | RC-3, RC-4 |
| P3 | IO cleanup on unmount | RC-10 |
| P3 | Diagnostic logging | all |

---

## Test scenarios for race validation

| ID | Repro | Pass criteria |
|----|-------|---------------|
| R-T1 | Flick scroll in/out of AV 5× in 2s | No audio overlap; ends paused or playing consistently with last user intent |
| R-T2 | Enter AV → immediate exit (<50ms) | No resume loop; max one resume |
| R-T3 | Enter AV → background 5s → foreground → exit | Single resume at exit |
| R-T4 | Enter AV → pause → exit | Silent stay paused |
| R-T5 | Play → enter AV → skip track → exit | New track unaffected |
| R-T6 | iOS Safari rubber-band scroll over AV | No stutter loop |

---

## Prior audit correlation

| Prior finding | RC link |
|---------------|---------|
| Phase 5B: first bad event = AV IO pause | RC-5 — pause path must be viewport-aware |
| Forensic: no auto-resume on exit | RC-1–3 — new failure class if resume loops |
| Auth churn RC-2 (separate) | Not viewport — do not conflate |
| page.js 1Hz re-render | Amplifies visual flicker, not audio race |

---

## Decision log

| Decision | Rationale |
|----------|-----------|
| Refs not React state | Avoid Page re-render feedback into IO |
| Separate from visibility recover | Orthogonal lifecycles; simpler guards |
| Exit-only debounce | Enter pause must remain snappy |
| `lastUserAction` over `userPausedRef` | Explicit intent for multi-source pause |
| No resume on seek | Seek is not playback-intent change |

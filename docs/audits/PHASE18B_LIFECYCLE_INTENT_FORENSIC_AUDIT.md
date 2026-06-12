# Phase 18B — Lifecycle intent capture forensic audit

**Date:** 2026-06-01  
**Baseline:** `78e2e19` (Phase 18A)  
**Follow-up:** `77eaaaa` (Phase 18C) — see `PHASE18C_INTENT_CAPTURE_FIX_VALIDATION.md`  
**Scope:** Background/tab lifecycle interrupt vs React playback state ordering in `AudioContext.js` (audit only; fixes landed in 18C).

---

## Executive summary

Phase 18A introduced `playbackIntentBeforeHideRef` and audibility-based capture on `onPause`, plus lifecycle health reasons that avoid `transport_ok_paused` when interrupt intent exists. Forensic replay on iOS Safari showed **intent still missed** when the OS paused `<audio>` before audibility reflected playback and before `visibilitychange` → hidden. Phase 18B documents that gap; Phase 18C repairs capture (React authority), `canplay` retry gating, and deferred intent clearing on return.

---

## Observed failure mode

1. Fan starts entitled playback; audio is audibly playing.
2. User locks screen or switches app; WebKit fires `pause` on the media element.
3. `onPause` runs `patchState({ isPlaying: false })` after 18A’s audibility check — `readIsAudiblyPlaying()` may already be false.
4. `playbackIntentBeforeHideRef` stays false; `wasPlayingBeforeHideRef` false on `visibilitychange` → hidden.
5. On return, `resumeAfter` is false; `evaluateLifecyclePlaybackHealth({ resumeAfter: false })` returns **`transport_ok_paused`** (healthy).
6. Lifecycle recovery is skipped (`LIFECYCLE_HEALTHY_SKIP_RECOVERY`) while the element remains paused.
7. Optional: stream reload fires `canplay`; retry gated on `stateRef.isPlaying` (already false) — no retry.

**User impact:** Music does not resume after background; fan must tap play again despite no explicit pause.

---

## Root cause analysis

| Layer | Issue |
|-------|--------|
| Event ordering | OS `pause` often precedes `visibilitychange` hidden and precedes stable audibility samples. |
| Capture signal (18A) | `readIsAudiblyPlaying()` on `onPause` is **downstream** of element pause — false negative. |
| State authority | React `isPlaying` + `hasStarted` reflect user/session intent until user or viewport pause clears them — correct pre-`patchState` signal. |
| Health evaluation | `transport_ok_paused` treated interrupt same as user pause when `resumeAfter` false. |
| Retry path | `canplay` handler required `stateRef.isPlaying` after pause patch — always false after OS pause. |

---

## Evidence checklist (trace)

With `NEXT_PUBLIC_PLAYBACK_TRACE=1`:

- Missing `PLAYBACK_INTENT_CAPTURED` on background interrupt (pre-18C).
- `LIFECYCLE_HEALTHY_SKIP_RECOVERY` with `reason: transport_ok_paused` while `audio.paused === true` after return.
- No `PLAYBACK_INTENT_RETRY` on `canplay` after interrupt when element had been playing.

Post-18C (`77eaaaa`): expect `PLAYBACK_INTENT_CAPTURED` on OS pause; health may return `paused_after_lifecycle_interrupt` or coalesced resume; optional `PLAYBACK_INTENT_RETRY`.

---

## Recommended fixes (implemented in 18C)

1. **FIX 1:** On `onPause`, set intent from `stateRef.isPlaying && hasStarted && !userInitiated && !wasViewportPause` **before** `patchState`.
2. **FIX 2:** Gate `canplay` interruption retry on `wasPlayingBeforePause || playbackIntentBeforeHideRef`.
3. **FIX 3:** Trace `PLAYBACK_INTENT_CAPTURED` / `PLAYBACK_INTENT_RETRY`.
4. **FIX 4:** Defer clearing intent until after lifecycle health on visible/bfcache; pass `lifecycleIntent` into health evaluation.

Full validation steps: **`docs/audits/PHASE18C_INTENT_CAPTURE_FIX_VALIDATION.md`**.

---

## Files reviewed

| File | Role |
|------|------|
| `src/context/AudioContext.js` | `onPause`, visibility, `evaluateLifecyclePlaybackHealth`, `canplay` retry |
| `src/lib/diagnostics/playback-trace.js` | Trace events (18A Restored title; 18C intent) |
| `src/components/system/AudioPhase10Bridge.js` | Lifecycle bridge (18A trace only) |

---

## Out of scope

- PlaybackStateMachine rewrite
- `src/app/page.js` render islands
- Player chrome / title guards (18A — `resolve-player-display-title.js`)

---

## Verification (release gate)

```bash
npm run build
npm run check:frontend-guardrails
```

Manual: Phase 18C validation doc § Manual validation.

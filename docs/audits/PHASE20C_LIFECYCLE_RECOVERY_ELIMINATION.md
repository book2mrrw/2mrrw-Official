# Phase 20C — Lifecycle recovery elimination and transport continuity

**Date:** 2026-06-01  
**Baseline:** Phase 19 (`b5c8b60`), Phase 20B forensic audit  
**Scope:** `AudioContext.js`, `playback-trace.js` (trace helpers). No PlaybackStateMachine rewrite, `page.js`, Stripe, entitlements, or `SessionRecoveryRoot`.

---

## Root cause (one-liner)

Lock/unlock and Safari background return treated **OS pause + suspended AudioContext** as transport failure, escalating visibility-return lifecycle recovery to **`recoverAudioHard`** (src teardown/reload) even when **track, queue, and element `src` were intact** — perceived as subsystem “rehydration.”

---

## User expectation matrix (target behavior)

| Case | Expected | Phase 20C approach |
|------|----------|-------------------|
| **A** | Playing → lock → continues → unlock → same track, no hard recovery | Transport-intact path: lightweight `play()` + suppression grace; no `recoverAudioHard` |
| **B** | Playing → leave Safari → return → no recovery UI | Same; watchdog/desync blocked during suppression when transport intact |
| **C** | Paused → lock → unlock → stays paused | `!resumeAfter` + intact transport → skip coalesced hard path, sync Media Session paused |
| **D** | Paused → leave Safari → return → stays paused | Same as C |
| **E** | Real transport failure | `evaluatePlaybackTransportHealth` fails → lightweight first, then hard recovery allowed |

---

## Trigger map

| Trigger | Reason / condition | File | Line (approx) | Can call `recoverAudioHard`? |
|---------|-------------------|------|---------------|------------------------------|
| `visibilitychange` → visible | Transport intact + `resumeAfter` → lightweight success | `AudioContext.js` | ~4889–4901 | **No** |
| `visibilitychange` → visible | Transport intact + paused (`!resumeAfter`) | `AudioContext.js` | ~4876–4886 | **No** |
| `visibilitychange` → visible | Transport intact + ctx suspended (gesture) | `AudioContext.js` | ~4903–4921 | **No** (suppress + MS sync) |
| `visibilitychange` → visible | Health healthy | `AudioContext.js` | ~4930–4952 | **No** |
| `visibilitychange` → visible | Health unhealthy, transport broken | `AudioContext.js` | ~4954–4959 | **Yes** (via coalesced → machine) |
| `runCoalescedLifecycleRecovery` | Lightweight OK + healthy | `AudioContext.js` | ~3520–3540 | **No** |
| `runCoalescedLifecycleRecovery` | Transport intact + OS interrupt, lightweight incomplete | `AudioContext.js` | ~3541–3551 | **No** |
| `runCoalescedLifecycleRecovery` | `!resumeAfter` + transport intact | `AudioContext.js` | ~3558–3567 | **No** |
| `runCoalescedLifecycleRecovery` | `runHardRecovery` + transport intact + lifecycle reason | `AudioContext.js` | ~3488–3499 | **No** (suppressed) |
| `runCoalescedLifecycleRecovery` | `runHardRecovery` + transport failed | `AudioContext.js` | ~3500–3508 | **Yes** |
| `requestPlaybackRecovery` | `RECOVERY_REQUESTED` / `AUDIO_DESYNC_DETECTED` during suppression + intact transport | `AudioContext.js` | ~3395–3410 | **No** (lightweight only) |
| `requestPlaybackRecovery` | Genuine failure / grace expired | `AudioContext.js` | ~3412–3420 | **Yes** |
| `recoverAudioHard` | Lifecycle interrupt + intact transport + not truth violation | `AudioContext.js` | ~3155–3188 | **No** (lightweight / return false) |
| `recoverAudioHard` | Stream detached / ended / media error | `AudioContext.js` | ~3190+ | **Yes** |
| `patchState` invariant | `isPlaying` + not audible during suppression | `AudioContext.js` | ~1195–1205 | **No** |
| Audibility watchdog | `truth_violation` | `AudioContext.js` | ~3680–3695 | **Yes** |
| Audibility watchdog | `silent_desync_detected` suppressed | `AudioContext.js` | ~3710–3718 | **No** |
| Audibility watchdog | `silent_desync_detected` allowed | `AudioContext.js` | ~3728–3735 | **Yes** |
| `playTrackInternal` | `audio_context_suspended` during recovery lock/suppression | `AudioContext.js` | ~2414–2433 | **No** (lightweight or defer) |
| `playTrackInternal` | `audio_context_suspended` transport broken | `AudioContext.js` | ~2426–2430 | **Yes** |
| `resumeInternal` | ctx not running | `AudioContext.js` | ~4045–4049 | **Yes** |
| `executePlaybackCommand` RECOVER | hard recover command | `AudioContext.js` | ~4332–4338 | **Yes** |
| `PlaybackStateMachine` | `RECOVERY_REQUESTED` / `AUDIO_DESYNC_DETECTED` | `PlaybackStateMachine.js` | ~138–192 | **Yes** (executor = `recoverAudioHard`) |
| `pageshow` bfcache | Unhealthy after health check | `AudioContext.js` | ~5005+ | **Yes** (coalesced) |

---

## Implementation summary (T1–T7)

| ID | Change |
|----|--------|
| **T1** | Visibility return tries transport-intact lightweight resume before coalesced hard recovery |
| **T2** | `evaluatePlaybackTransportHealth()` — recovery gated on transport, not pause/visibility/ctx suspend alone |
| **T3** | `isLifecycleInterruptReason()` vs `isGenuineTransportFailureReason()` — separate OS interrupt from broken transport |
| **T4** | `playTrack` logs `TRACK_SWITCH_DURING_RECOVERY`; `playTrackInternal` defers hard recover when lifecycle lock/suppression active |
| **T5** | `lifecycleRecoverySuppressedUntilRef` (2.5s grace) blocks `requestPlaybackRecovery`, watchdog desync, `recoverAudioHard` when transport intact |
| **T6** | `syncMediaSessionAfterLifecycle()` after healthy/lightweight lifecycle return |
| **T7** | Trace: `LIFECYCLE_TRANSPORT_*`, `LIFECYCLE_RECOVERY_*`, `TRACK_SWITCH_DURING_RECOVERY`, `TRACK_SWITCH_AFTER_UNLOCK` (`NEXT_PUBLIC_PLAYBACK_TRACE=1`) |

---

## Files changed

| File | Role |
|------|------|
| `src/context/AudioContext.js` | Transport health, suppression window, lifecycle/visibility/recovery gating |
| `src/lib/diagnostics/playback-trace.js` | Phase 20C trace helpers |
| `docs/audits/PHASE20C_LIFECYCLE_RECOVERY_ELIMINATION.md` | This deliverable |

**Untouched:** `PlaybackStateMachine.js` (read-only routing), `SessionRecoveryRoot`, `page.js`, Stripe/checkout.

---

## Validation results

| Scenario | Expected trace (when `NEXT_PUBLIC_PLAYBACK_TRACE=1`) |
|----------|------------------------------------------------------|
| A — play, lock, unlock | `LIFECYCLE_TRANSPORT_HEALTHY`, `BACKGROUND_RECOVERY_SKIPPED` / no `recoverAudioHard` |
| B — background Safari return | `LIFECYCLE_RECOVERY_SUPPRESSED` on false desync; no recovery UI |
| C/D — user paused | `transport_ok_paused`, no `BACKGROUND_RECOVERY_TRIGGER` |
| E — broken src | `LIFECYCLE_TRANSPORT_FAILED`, `LIFECYCLE_RECOVERY_ALLOWED`, optional hard recover |

Manual: iOS Safari + entitled track per Phase 18C/19 validation docs.

---

## Build / guardrail results

| Command | Result |
|---------|--------|
| `npm run build` | **Pass** (Next.js 16.2.4) |
| `npm run check:frontend-guardrails` | **Pass** (0 errors, 3 pre-existing `page.js` warnings) |

---

## Commit hash

`2624840` — Phase 20C: lifecycle recovery elimination and transport continuity

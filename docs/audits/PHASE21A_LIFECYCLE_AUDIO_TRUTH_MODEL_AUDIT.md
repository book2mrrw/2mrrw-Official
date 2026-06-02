# Phase 21A — Lifecycle audio truth model audit

**Date:** 2026-06-02  
**Mode:** Audit + trace instrumentation (log-only). No `recoverAudioHard` behavior changes.  
**Repository:** `/Users/recharge/artist-platform`  
**Baseline read:** `PHASE19_TRUE_BACKGROUND_AUDIO_CONTINUITY.md`, `PHASE21_AUDIBLE_OUTPUT_DIVERGENCE_FORENSIC_AUDIT.md`, `PHASE22X_BACKGROUND_PLAYBACK_CAPABILITY_AUDIT.md`, `PHASE20C_LIFECYCLE_RECOVERY_ELIMINATION.md`, `PHASE20H_MEDIA_DETERMINISM_LOCK.md`  
**Primary sources:** `src/context/AudioContext.js`, `src/lib/playback/audibility.js`, `src/lib/diagnostics/playback-trace.js`, `src/media/PlaybackStateMachine.js`, `src/lib/playback/audio-engine-runtime.js`

---

## A. Root cause (one-liner)

WebKit OS-suspends the Web Audio graph and pauses `HTMLMediaElement` on lock/background while the app deliberately preserves Media Session `playing` and React clears `isPlaying` — producing a **three-way divergence** (React paused, Media Session playing, output silent) that is **expected OS behavior**, not transport failure, but legacy recovery and audibility gates still treat silence as desync unless lifecycle intent refs and Phase 20C suppression are active.

---

## B. Lifecycle truth table

| Phase | HTMLAudioElement | AudioContext | React `isPlaying` | Media Session | Transport (`src`) | Audible output | App belief (pre-21B) |
|-------|------------------|--------------|-------------------|---------------|-------------------|----------------|----------------------|
| **Foreground playing** | `paused: false` | `running` | `true` | `playing` | intact | **yes** | aligned |
| **Lock / background (B)** | `paused: true` (OS) | `suspended` | `false` (cleared on `onPause`) | **`playing`** (preserved) | intact | **no** | **diverged** |
| **Unlock off-Safari (C)** | `paused: true` | `suspended` | `false` | `playing` | intact | **no** | diverged |
| **Return to Safari (D)** | `play()` → `paused: false` | `resume()` → `running` | restored via lightweight | re-synced | intact | **yes** | realigned |

### Signal authority (truth hierarchy)

| Signal | Authoritative for | NOT authoritative for |
|--------|-------------------|----------------------|
| `isAudioActuallyAudible` | Speaker output | Lifecycle classification alone (returns false on OS suspend) |
| `HTMLAudioElement.paused` | Element transport state | User intent (OS can pause) |
| `AudioContext.state` | Web Audio graph output | Transport validity |
| `hasIntactPlaybackTransport` | Stream/src binding | Audibility |
| `playbackIntentBeforeHideRef` | User-was-playing through OS interrupt | Current audibility |
| `userPausedRef` | User-initiated pause | OS pause |
| `mediaSession.playbackState` | Lock-screen UX | Audibility or transport |
| React `isPlaying` | UI display | Ground truth (cleared on OS pause) |

### Key file:line citations

| Transition | First change | Citation |
|------------|--------------|----------|
| OS pause event | WebKit `pause` on detached `<audio>` | `AudioContext.js:1777` (`onPause`) |
| Intent capture | `playbackIntentBeforeHideRef = true` | `AudioContext.js:1795` |
| React belief cleared | `patchState({ isPlaying: false })` | `AudioContext.js:1888` |
| MS preserved | `preserveLockScreenPlaying` → `updateMediaSession(..., { playing: true })` | `AudioContext.js:1892-1897` |
| Ctx suspend observed | `ctx?.state === "suspended"` in health | `AudioContext.js:899`, `audibility.js:105` |
| Background flag | `lifecycleInBackgroundRef = true` | `AudioContext.js:4916` |
| Foreground resume | `attemptLightweightPlaybackResume` | `AudioContext.js:1513-1540`, `4931-4943` |

---

## C. Classification system (A–D)

Phase 21B should model every playback moment into exactly one lifecycle class:

| Class | Code | Definition | Entry conditions | Exit conditions |
|-------|------|------------|------------------|-----------------|
| **A** | `USER_PLAYING` | User initiated play; foreground; audibility expected | `onPlay`, user gesture, `!userPausedRef`, element unpaused + ctx running | OS interrupt, user pause, track end, transport failure |
| **B** | `USER_PAUSED` | User explicitly paused | `pause()` sets `userPausedRef = true` | User `play()` / `resume()` |
| **C** | `OS_SUSPENDED` | Expected WebKit background/lock silence; transport intact | OS `onPause` without `userPausedRef`; `playbackIntentBeforeHideRef`; ctx suspended and/or element paused; `hasIntactPlaybackTransport` | `visibility_visible` + lightweight resume success |
| **D** | `RECOVERING` | Real transport/orchestration failure only | `evaluatePlaybackTransportHealth` fails; `truth_violation` with visible tab; lightweight resume failed after return; media error | `RECOVER_COMPLETE` / audibility restored / user pause |

### Mapping current signals → classification (today)

| Signal state | Current classification | Gap |
|--------------|------------------------|-----|
| OS pause + intent ref + intact transport | Implicit C (via refs); React shows B-like `isPlaying: false` | No explicit `lifecycleClass` state |
| MS `playing` + silent | Looks like A externally | Misleading — actually C |
| `evaluateLifecyclePlaybackHealth` unhealthy + ctx suspended | Treated as failure reason `context_suspended_resume_needed` | Correct for resume gate; wrong if escalated to hard recover without suppression |
| `silent_desync_detected` + intact transport + suppression | Blocked → no-op | Correct (Phase 20C) |
| `silent_desync_detected` + grace expired + foreground | May trigger hard recover | **Misclassification risk** if OS suspend lingered |

---

## D. Recovery rule set (enforcement plan for 21B)

### Critical rules

1. **OS suspension ≠ failure** — `AudioContext.state === "suspended"` and OS element pause alone must never call `recoverAudioHard`.
2. **Media Session is NOT truth** — `navigator.mediaSession.playbackState === "playing"` must not drive recovery, audibility checks, or React `isPlaying`.
3. **AudioContext suspension is expected** — suspended ctx during hidden tab is normal WebKit policy, not desync.
4. **Only real transport failure triggers hard recovery** — src detached, media error, ended, queue invalid, network/stream failure, or `truth_violation` on **visible** tab after grace.

### Recovery path matrix (current + 21B target)

| Condition | Current path | 21B target |
|-----------|--------------|------------|
| Hidden + intent + transport intact | Watchdog suppressed; hard blocked | **no_op** (class C) |
| Visible return + intent + transport intact | Lightweight resume | **lightweight** → class A |
| Visible return + lightweight fails + ctx suspended | Suppression + MS sync; no hard | **deferred** (await gesture) — class C until resume |
| Visible return + transport broken | Coalesced → hard | **hard** — class D |
| User paused + lock/background | No intent capture; stay paused | **no_op** — class B |
| `truth_violation` visible + not lifecycle | Hard via machine | **hard** — class D |
| Audibility watchdog + suppression + intact | Suppressed | **no_op** |
| Audibility watchdog + no suppression + foreground | Hard via `silent_desync_detected` | Must verify not class C before hard |

### Function-level recovery gates (file:line)

| Function | Role | Hard recover? |
|----------|------|---------------|
| `recoverAudioHard` | Hard path executor | Blocked when `lifecycleOnlyPause` — `AudioContext.js:3277-3318` |
| `runCoalescedLifecycleRecovery` | Lifecycle orchestration | Skips hard when transport intact + lifecycle reason — `AudioContext.js:3679-3696` |
| `requestPlaybackRecovery` | Machine entry | Suppressed → lightweight only — `AudioContext.js:3583-3600` |
| `evaluateLifecyclePlaybackHealth` | Return health check | Transport-first; ctx suspend = unhealthy for resume, not broken transport — `AudioContext.js:872-950` |
| Audibility watchdog | Foreground desync poll | Early return when hidden/intent — `AudioContext.js:3862-3868` |
| `patchState` invariant | React truth guard | Suppressed during lifecycle grace — `AudioContext.js:1243-1250` |
| `PlaybackStateMachine._beginRecovery` | Routes to executor | Unchanged — executor gating is in `recoverAudioHard` — `PlaybackStateMachine.js:151-192` |

---

## E. File-level findings

### 1. AudioContext lifecycle truth — `ctx.state`, OS vs app, resume vs audibility

| Finding | Severity | Citation |
|---------|----------|----------|
| `resumeWebAudioContextIfSuspended` only resumes when `state === "suspended"`; no app-initiated `ctx.suspend()` | Info | `AudioContext.js:497-519` |
| `ensureWebAudioRunning` gates play on ctx running | Expected | `AudioContext.js:528-533` |
| Best-effort resume on hidden usually rejected by WebKit | Expected | `AudioContext.js:5018` (`visibility_hidden`) |
| `recordAudioContextState` stores dev snapshot only; not a belief model | Gap | `performanceMarks.js:636-644` |
| All audible output routes through MES graph; suspended ctx = silence | **Root architectural factor** | `AudioContext.js:1474-1475`, `audibility.js:105` |

### 2. HTMLAudioElement truth — play/pause vs OS, user intent vs interruption

| Finding | Severity | Citation |
|---------|----------|----------|
| OS `pause` fires first; app `onPause` is reactive | Info | `AudioContext.js:1777` |
| `userPausedRef` set only on app `pause()`/`stop()` | Correct | `AudioContext.js:4168`, `4172` |
| `skipPauseInterruptionRef` prevents false intent on programmatic pause | Correct | `AudioContext.js:1781-1785` |
| OS `play()` retry on interrupt usually rejected in background | Expected | `AudioContext.js:1849-1852` |
| Detached element persisted in DOM across provider remounts | Correct | `audio-engine-runtime.js:68-97` |

### 3. Media Session intentional mismatch

| Finding | Severity | Citation |
|---------|----------|----------|
| `preserveLockScreenPlaying` keeps MS `playing` on OS interrupt | **By design** | `AudioContext.js:1892-1903` |
| Downstream code must not infer audibility from MS | Risk if unguarded | MS handlers ~L4380+ |
| `syncMediaSessionAfterLifecycle` re-aligns on visible return | Correct | `AudioContext.js:1413-1426` |
| Lock-screen position from frozen `currentTime`, not live advancement | Info | `audibility.js:34`, `syncPositionState` |

### 4. Playback intent refs — sufficient?

| Ref | Purpose | Set | Cleared | Sufficient? |
|-----|---------|-----|---------|-------------|
| `playbackIntentBeforeHideRef` | OS interrupt, user was playing | `onPause` when `wasPlayingBeforePause` | visibility return, user pause, recovery complete | **Partial** — recovery gating yes; no unified lifecycle class |
| `userPausedRef` | User-initiated pause | `pause()`, `stop()` | `onPlay`, start of `onPause` | **Yes** for pause discrimination |
| `wasPlayingBeforeHideRef` | Snapshot at hidden | `visibility_hidden` | `visibility_visible`, `pageshow` | **Partial** — redundant with intent ref in most paths; used for `resumeAfter` OR |

**Verdict: NO — intent refs are sufficient for Phase 20C recovery suppression but NOT for app belief alignment.**

**Gaps for 21B:**
- No single `lifecyclePlaybackClass` ref (A/B/C/D) consumed by UI, machine, and recovery
- React `isPlaying: false` during class C looks like user pause to UI
- `evaluateLifecyclePlaybackHealth` returns `healthy: false` for expected OS suspend when `resumeAfter: true` — correct for resume trigger but indistinguishable from class D without explicit classification
- `wasPlayingBeforeHideRef` overlaps `playbackIntentBeforeHideRef`; could consolidate under class C state

### 5. Recovery correctness — lightweight / coalesced / hard / watchdog

| Mechanism | Misclassifies OS suspend? | Citation |
|-----------|---------------------------|----------|
| `recoverAudioHard` lifecycle block | **No** (blocked) | `AudioContext.js:3277-3318` |
| `runCoalescedLifecycleRecovery` | **No** when transport intact | `AudioContext.js:3679-3796` |
| Audibility watchdog | **No** when hidden/intent/suppressed | `AudioContext.js:3862-3868`, `3956-3970` |
| `evaluateLifecyclePlaybackHealth` | **Semantic** — marks unhealthy for ctx suspend but does not alone trigger hard | `AudioContext.js:916-924` |
| `patchState` FATAL_AUDIO_DESYNC | **Risk** if suppression grace expired during lingering suspend on visible tab | `AudioContext.js:1251-1288` |
| Pre-20C historical | **Yes** — hard on false desync | Phase 19/20C docs |

**Recovery misclassification summary:** Phase 20C suppression largely prevents hard recovery on OS suspend. Remaining risk: foreground audibility watchdog or `patchState` invariant firing after suppression grace (2.5s) expires while ctx still suspended pending gesture — should classify as C (deferred), not D (hard).

### 6. Audibility functions — OS suspend misclassification?

| Function | Returns false on OS suspend? | Misclassifies as failure? | Citation |
|----------|------------------------------|---------------------------|----------|
| `isAudioActuallyAudible` | **Yes** (paused + ctx !== running) | Only if caller treats false as failure without lifecycle context | `audibility.js:102-126` |
| `readIsAudiblyPlaying` | **Yes** (wraps above) | Same | `AudioContext.js:833-837` |
| `evaluateLifecyclePlaybackHealth` | Uses audibility when `resumeAfter` | Returns unhealthy reasons that are lifecycle-interrupt, not transport-fail — gated by `isLifecycleInterruptReason` | `AudioContext.js:872-950`, `501-515` |
| `validatePlaybackTruthIntegrity` | **Yes** | Can trigger `truth_violation` if UI says playing but not audible — suppressed during lifecycle grace | `audibility.js:73-99`, `AudioContext.js:1243-1250` |

**Conclusion:** Audibility functions correctly report silence during OS suspend. Misclassification occurs at **call sites** that interpret `false` as failure without checking class C conditions.

---

## Phase 21A trace events (added)

Enable: `NEXT_PUBLIC_PLAYBACK_TRACE=1`

| Event | When | File |
|-------|------|------|
| `LIFECYCLE_AUDIO_STATE_TRANSITION` | `onPlay`, `onPause`, `visibility_hidden`, `visibility_visible` | `playback-trace.js`, hooks in `AudioContext.js` |
| `AUDIO_CONTEXT_STATE_CHANGE` | After `ctx.resume()` attempt | `playback-trace.js`, `resumeWebAudioContextIfSuspended` |
| `OS_SUSPEND_DETECTED` | OS interrupt `onPause`, `visibility_hidden` when paused/suspended | `playback-trace.js`, `AudioContext.js` |
| `AUDIO_OUTPUT_SILENCE_REASON` | Classified silence reason via `classifyAudioOutputSilence` | `playback-trace.js`, `AudioContext.js` |
| `RECOVERY_CLASSIFICATION_REASON` | Recovery path decisions (no_op/lightweight/hard) | `playback-trace.js`, `logRecoveryPathClassification` |

Existing Phase 19/20C/21 traces remain (`BACKGROUND_*`, `LIFECYCLE_TRANSPORT_*`, `AUDIBLE_STATE`, etc.).

---

## F. Phase 21B implementation plan outline

### P0 — Lifecycle class state (no recovery behavior change yet)

1. Add `lifecyclePlaybackClassRef` (`USER_PLAYING` | `USER_PAUSED` | `OS_SUSPENDED` | `RECOVERING`) set atomically in `onPlay`, `onPause`, `visibilitychange`, recovery entry/exit.
2. Derive class from existing refs first (no new heuristics): C when `playbackIntentBeforeHideRef && !userPausedRef && transport intact`; B when `userPausedRef`; D only on genuine transport failure or post-return lightweight failure.
3. Expose read-only `getLifecyclePlaybackClass()` for diagnostics; do not drive UI yet.

### P1 — Belief alignment (React + machine, not MS)

1. During class C: keep React `isPlaying` false for UI bar but add internal `lifecycleInterrupted: true` (or equivalent) so components don't show "user paused."
2. Do **not** change Media Session preserve behavior in 21B unless explicitly scoped — MS is UX, not truth.
3. Gate `patchState` FATAL_AUDIO_DESYNC on `lifecyclePlaybackClass !== OS_SUSPENDED`.

### P2 — Recovery classification hardening

1. Centralize recovery decision in one function returning `{ path: "no_op" | "lightweight" | "hard" | "deferred", class, reason }`.
2. Audibility watchdog: if class C or suppression active → no-op (already mostly true; formalize).
3. Extend suppression grace or tie to class C until ctx resumed or user gesture.

### P3 — Optional (out of minimal 21B)

1. Dual output path (Phase 22Y) for iOS background — bypass MES when class C.
2. Align MS `playbackState` with audibility — tradeoff for lock-screen UX.

### 21B enforcement checklist

- [ ] OS suspend never calls `recoverAudioHard`
- [ ] Media Session never used as recovery trigger
- [ ] `AudioContext.state === "suspended"` alone → class C, not D
- [ ] Hard recovery requires `isGenuineTransportFailureReason` OR visible-tab `truth_violation` after lightweight failure
- [ ] Trace validates class transitions on device

---

## Files changed (21A)

| File | Change |
|------|--------|
| `src/lib/diagnostics/playback-trace.js` | Phase 21A trace helpers + `classifyAudioOutputSilence` |
| `src/context/AudioContext.js` | Log-only hooks at lifecycle/recovery decision points |
| `docs/audits/PHASE21A_LIFECYCLE_AUDIO_TRUTH_MODEL_AUDIT.md` | This deliverable |

**Untouched:** `recoverAudioHard` behavior, `PlaybackStateMachine.js`, `audibility.js`, `audio-engine-runtime.js`.

---

## Validation

```bash
npm run build
npm run check:frontend-guardrails
```

| Command | Result |
|---------|--------|
| `npm run build` | *(see below)* |
| `npm run check:frontend-guardrails` | *(see below)* |

---

## Manual validation (device)

1. `NEXT_PUBLIC_PLAYBACK_TRACE=1`, entitled track, iOS Safari.
2. Play → lock: expect `OS_SUSPEND_DETECTED`, `AUDIO_OUTPUT_SILENCE_REASON: os_suspend_element_and_ctx`, `LIFECYCLE_AUDIO_STATE_TRANSITION classification: OS_SUSPENDED`, `RECOVERY_CLASSIFICATION_REASON path: no_op` (no hard).
3. User pause → lock: expect `USER_PAUSED`, no `PLAYBACK_INTENT_CAPTURED`.
4. Return to Safari: expect `LIFECYCLE_AUDIO_STATE_TRANSITION`, `RECOVERY_CLASSIFICATION_REASON path: lightweight`, `AUDIO_CONTEXT_STATE_CHANGE resumed: true`.

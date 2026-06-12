# Phase 22X — Background playback capability audit

**Date:** 2026-06-01  
**Mode:** Audit only (read-only). No code changes, no fixes, no refactors, no commits.  
**Repository:** `/Users/recharge/artist-platform`  
**Prior audits read:** `PHASE19_TRUE_BACKGROUND_AUDIO_CONTINUITY.md`, `PHASE20C_LIFECYCLE_RECOVERY_ELIMINATION.md`, `PHASE21_AUDIBLE_OUTPUT_DIVERGENCE_FORENSIC_AUDIT.md`  
**Primary sources:** `src/context/AudioContext.js`, `src/lib/playback/audio-engine-runtime.js`, `src/lib/playback/audibility.js`, `src/media/PlaybackStateMachine.js`

---

## Executive summary

| Field | Answer |
|--------|--------|
| **Overall capability (audible continuity)** | **D** — cannot maintain true uninterrupted audible playback while locked, backgrounded, or app-switched on iOS Safari |
| **Post-return continuity** | **C** — transport/session preserved; audible output restored on foreground via lightweight resume |
| **Primary question** | **No** — this exact architecture cannot support uninterrupted background playback on iOS Safari |
| **Root cause (one-liner)** | WebKit suspends the Web Audio graph and OS-pauses the media element on lock/background while Media Session is intentionally left `playing`, so transport looks active but the MediaElementSource→destination path is silent |

---

## Capability answer (A/B/C/D)

**Scale used (not defined in repo; applied consistently):**

| Grade | Meaning |
|-------|---------|
| **A** | True uninterrupted **audible** playback while locked/backgrounded |
| **B** | Audible may dip but **auto-continues without foreground** |
| **C** | Transport/session preserved; **audible output needs foreground** (lightweight resume) |
| **D** | **Cannot** maintain background audible output in current architecture |

| Scenario | Grade | Why |
|----------|-------|-----|
| **Lock screen** | **D** | WebKit fires `pause` on `<audio>` and suspends `AudioContext`; audibility requires `!paused` + `ctx.state === "running"` (`audibility.js:isAudioActuallyAudible:102-105`). App preserves Media Session `playing` but that does not drive speakers (`AudioContext.js:onPause:1828-1833`). |
| **Safari backgrounded** | **D** | `visibilitychange` → `hidden` sets `lifecycleInBackgroundRef` (`AudioContext.js:onVisibility:4846-4848`); same OS pause/suspend; best-effort `ctx.resume()` on hidden does not override policy (`AudioContext.js:onVisibility:4855-4856`). |
| **App switch** | **D** | Same as background: document hidden + OS media pause. |

**Overall capability:** **D** for true background audible continuity. **C** for post-return continuity (transport intact + `attemptLightweightPlaybackResume` — `AudioContext.js:4931-4943`).

---

## Primary question

**Can this exact architecture support uninterrupted background playback on iOS Safari?**

**No.**

1. **OS/WebKit policy** — Background/lock pauses `HTMLMediaElement` and suspends `AudioContext` (Phase 19/21; `onPause:1749`, `evaluateLifecyclePlaybackHealth:872-898`).
2. **Exclusive Web Audio routing** — `createMediaElementSource(audio)` (`AudioContext.js:1449`) sends all output through `source → … → ctx.destination` (`connectWebAudioDownstream:1412-1415`). Suspended context = **no speaker output** even if metadata says playing (`audibility.js:105`).
3. **Resume constraints** — `resumeWebAudioContextIfSuspended` / `audio.play()` succeed reliably only in foreground/gesture context (`AudioContext.js:490-498`, `onPause:1792-1794`).

**Architecture (current):** `HTMLAudioElement` → `MediaElementSource` → `Analyser` → `StereoPanner` → `Filters` → `AudioContext.destination`

---

## Deliverables A–G

| ID | Answer |
|----|--------|
| **A. One-line root cause** | WebKit suspends the Web Audio graph and OS-pauses the media element on lock/background while Media Session is intentionally left `playing`, so transport looks active but the MediaElementSource→destination path is silent. |
| **B. Subsystem** | Web Audio playback graph in `AudioContext.js` (`initWebAudio`, `connectWebAudioDownstream`, lifecycle handlers). |
| **C. Object** | `AudioContext` instance (`audioCtxRef`) + `MediaElementAudioSourceNode` from `ctx.createMediaElementSource(audio)`. |
| **D. Achievable in current architecture?** | **No** for true uninterrupted lock/background **audible** playback; **yes** for fast foreground resume without `src` teardown (Phase 20C). |
| **E. Web Audio routing a factor?** | **Yes** — exclusive MES routing makes `ctx.state !== "running"` equivalent to silence. |
| **F. AudioContext suspension expected or abnormal?** | **Expected** on iOS Safari background/lock (WebKit policy); **abnormal** only if treated as transport failure → hard recovery (largely suppressed since Phase 20C). |
| **G. Recommended next phase** | **Phase 22Y — iOS background output path:** lifecycle-aware dual routing (bypass graph / direct element output when hidden + intent), or platform-specific engine split; device trace validation (`NEXT_PUBLIC_PLAYBACK_TRACE=1`); defer Media Session “playing” vs audibility alignment until output path is fixed. |

---

## 1. Background playback capability

See capability table above — all **D** for uninterrupted audible; recovery on return is **C**-class.

**Why playback stops (observed):** Media Session visible, cover art visible, metadata visible, queue intact, stream intact, resumes on return — but audio silent/stops during background.

**Phase 21 known facts (confirmed):**

- `audio.paused === true`
- `currentTime` stops advancing
- `AudioContext.state === "suspended"`
- Media Session active; transport/queue/source/entitlements intact

---

## 2. Audio lifecycle trace (play → lock → unlock)

| Phase | HTMLAudioElement | AudioContext | Media Session | Transport | Playback intent |
|-------|------------------|--------------|---------------|-----------|-----------------|
| **Play (foreground)** | `paused: false` via `onPlay` | `running` after `ensureWebAudioRunning` | `playbackState: playing` | `hasIntactPlaybackTransport` true | `userPausedRef: false` |
| | `AudioContext.js:onPlay:1723-1744` | `AudioContext.js:ensureWebAudioRunning:502-506` | `AudioContext.js:updateMediaSession:1365` | `AudioContext.js:hasIntactPlaybackTransport:426-430` | |
| **Lock / hidden** | OS `pause` → `paused: true` | `suspended` | **Still `playing`** (preserve) | **Intact** (`src` unchanged) | `playbackIntentBeforeHideRef: true` |
| | `AudioContext.js:onPause:1749` | `audibility.js:105`, `evaluateLifecyclePlaybackHealth:873` | `AudioContext.js:onPause:1828-1833` | `evaluatePlaybackTransportHealth:453` | `AudioContext.js:onPause:1768-1769` |
| **Unlock (off-Safari)** | Still paused | Still suspended | Still shows playing | Intact | Intent may remain |
| | `isDocumentPlaybackHidden:419-422` | `onVisibility:4894+` (no resume until visible) | frozen `setPositionState` | | |
| **Return to Safari** | `play()` succeeds | `resume()` → `running` | Re-synced | Intact | Cleared after resume |
| | `attemptLightweightPlaybackResume:1503-1510` | `resumeWebAudioContextIfSuspended:491-498` | `syncMediaSessionAfterLifecycle:1387-1397` | no `src` reload | `onVisibility:4941` |

---

## 3. Pause source analysis (who pauses first)

**Order:**

1. **WebKit / iOS (first)** — `pause` event on `HTMLAudioElement` (not preceded by app `audio.pause()` for lifecycle).
2. **App `onPause` handler (reactive)** — captures intent, clears React `isPlaying`, preserves MS — `AudioContext.js:onPause:1749-1824`.
3. **App retry (non-authoritative)** — `void audio.play().catch(...)` — `AudioContext.js:1791-1794` (OS rejects in background).
4. **WebKit** — `AudioContext` → `suspended` (concurrent/near-same; audibility/health checks — `evaluateLifecyclePlaybackHealth:872-898`).
5. **Not primary in background:** `recoverAudioHard` pause+`src` clear (blocked when transport intact — `recoverAudioHard:3218-3250`), Media Session handlers (do not pause element), PlaybackStateMachine (only on recovery events).

**Call path (lifecycle interrupt):**

`iOS lock/background` → `HTMLAudioElement` `pause` event → `onPause` (`1749`) → `patchState({ isPlaying: false })` (`1824`) → optional `audio.play()` (`1791`) → WebKit rejects → `AudioContext.state` `suspended` → `isAudioActuallyAudible` false (`audibility.js:102-105`).

| Candidate | Pauses first in normal background? |
|-----------|-------------------------------------|
| App code (`audio.pause()`) | **No** (reactive `onPause` only) |
| WebKit / iOS | **Yes** |
| HTMLAudioElement (OS) | **Yes** (via WebKit) |
| AudioContext suspend | **Yes** (WebKit, near-same time) |
| Recovery (`recoverAudioHard`) | **No** (blocked Phase 20C) |
| Media Session | **No** (preserves playing) |

---

## 4. AudioContext suspension analysis

| Aspect | Finding | Citation |
|--------|---------|----------|
| **Why suspended** | iOS Safari background audio policy for Web Audio API | Phase 19/21; health `ctxSuspended` — `evaluateLifecyclePlaybackHealth:872-898` |
| **Expected?** | **Yes** for hidden/locked tab | `resumeWebAudioContextIfSuspended` comment — `AudioContext.js:490` |
| **App-triggered suspend** | No explicit `ctx.suspend()` in lifecycle path | grep shows only `resume()` |
| **Recovery-triggered** | Hard recover may close/reinit graph; blocked for lifecycle-only pause | `recoverAudioHard:3291-3300`, `3218-3250` |
| **Hidden best-effort** | `void resumeWebAudioContextIfSuspended` on `visibility_hidden` | `AudioContext.js:4855-4856` — usually insufficient while fully backgrounded |

| Attribution | Role |
|-------------|------|
| WebKit policy | Primary — suspends context on background/lock |
| App lifecycle handlers | Reactive resume attempts; cannot override policy |
| Recovery | Not primary cause of normal background silence (Phase 20C) |

---

## 5. MediaElementSource analysis

| Topic | Finding | Citation |
|-------|---------|----------|
| **Routing** | `createMediaElementSource` once per element (`MRRW_MEDIA_SOURCE_BOUND`) | `AudioContext.js:1448-1451` |
| **Graph** | `source → analyser → stereoPanner → bassFilter → destination` | `connectWebAudioDownstream:1412-1415` |
| **iOS effect** | Element no longer plays to default output; **all** audible output depends on `ctx.state === "running"` | `isAudioActuallyAudible:105` |
| **Background/lock** | OS pauses element **and** suspends context → double silence | Phase 21 timeline |
| **Init failure fallback** | Catch path disables graph, direct element possible | `initWebAudio:1462-1483` — not normal path |
| **Cannot call MES twice** | Re-bind guard → `webAudioAvailableRef = false` | `initWebAudio:1453-1456` |

**iOS/WebKit limitation:** `createMediaElementSource` disconnects default element output; background/lock-screen/app-switch audible continuity requires a running graph — which WebKit does not guarantee when hidden.

---

## 6. Transport integrity during background

| Stays valid | Becomes invalid (for audibility) |
|-------------|----------------------------------|
| `audio.currentSrc` / `track.src` | `audio.paused === true` |
| Queue index/length (unless real failure) | `AudioContext.state !== "running"` |
| Stream metadata / signed URL meta ref | `currentTime` not advancing (`updateAudibilitySample:34`) |
| `navigator.mediaSession` metadata + forced `playing` | React `isPlaying` (cleared on pause) |
| `playbackIntentBeforeHideRef` | `isAudioActuallyAudible` → false |
| | `readIsAudiblyPlaying` → false (`807-810`) |

Citations: `hasIntactPlaybackTransport:426-430`, `evaluatePlaybackTransportHealth:439-453`, `onPause:1828-1833`.

---

## 7. Recovery interference (YES/NO during **normal** background)

| Mechanism | Interferes with normal background audible? | Notes |
|-----------|---------------------------------------------|-------|
| `attemptLightweightPlaybackResume` | **NO** (harmless; OS rejects `play` in BG) | `1487-1510`, `onPause:1791` |
| `runCoalescedLifecycleRecovery` | **NO** while hidden; runs on visible | `3560-3706`, `onVisibility:4996` |
| `recoverAudioHard` | **NO** when transport intact + lifecycle (blocked) | `3218-3250` |
| `PlaybackStateMachine` | **NO** unless recovery event fired | `PlaybackStateMachine.js:138-172` |
| Audibility watchdog | **NO** — early return when hidden/intent | `3777-3829` |
| Audibility checks / `patchState` invariant | **NO** when suppression + intact transport | `1217-1223` |
| **Pre-20C behavior** | **YES** (historical) — hard recover on false desync | Phase 19/20C docs |

**Conclusion:** Current silence is **OS + routing**, not recovery tearing down `src` during normal lock/background.

---

## 8. Detached audio element audit

| Question | Answer | Citation |
|----------|--------|----------|
| Detached? | Singleton created in JS, **appended to `document.body`** when used | `audio-engine-runtime.js:75-92` |
| Survives provider remount? | **Yes** — `window.__2MRRW_AUDIO_ENGINE_RUNTIME__` | `audio-engine-runtime.js:47-54`, `noteAudioProviderUnmount:117` |
| Survives backgrounding? | **Element persists in DOM**; playback **paused by OS** | Phase 21 |
| Attached? | **Yes** when `audio.isConnected` | `audio-engine-runtime.js:88-92` |
| Eligible for iOS background? | Has `playsinline`, `preload=auto`, `crossOrigin` — **necessary but not sufficient** with Web Audio graph | `audio-engine-runtime.js:76-80`; blocker is MES + ctx suspend |

---

## 9. Implementation feasibility (within current architecture)

| Goal | Feasible? |
|------|-----------|
| Uninterrupted audible while locked/BG on iOS Safari | **No** without architectural change |
| Lock-screen metadata + controls | **Yes** (already) |
| Resume same position on foreground without reload | **Yes** (Phase 20C lightweight path) |

**Blockers:** WebKit lifecycle policy; mandatory audible path through suspended `AudioContext`; no background `resume()` without gesture.

**Required areas for true BG audio:** dual output path, or element-only iOS mode, or native/PWA shell with AVAudioSession-equivalent (out of pure web graph scope).

---

## 10. Files reviewed

- `/Users/recharge/artist-platform/docs/audits/PHASE21_AUDIBLE_OUTPUT_DIVERGENCE_FORENSIC_AUDIT.md`
- `/Users/recharge/artist-platform/docs/audits/PHASE19_TRUE_BACKGROUND_AUDIO_CONTINUITY.md`
- `/Users/recharge/artist-platform/docs/audits/PHASE20C_LIFECYCLE_RECOVERY_ELIMINATION.md`
- `/Users/recharge/artist-platform/src/context/AudioContext.js`
- `/Users/recharge/artist-platform/src/lib/playback/audio-engine-runtime.js`
- `/Users/recharge/artist-platform/src/lib/playback/audibility.js`
- `/Users/recharge/artist-platform/src/media/PlaybackStateMachine.js`

---

## Audit metadata

| Field | Value |
|-------|-------|
| **Audit ID** | PHASE 22X |
| **Type** | Current architecture background playback capability |
| **Code changes** | None |
| **Commits** | None (audit-only) |

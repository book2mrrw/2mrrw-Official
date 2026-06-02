# Phase 20B — Playback subsystem rehydration / remount forensic audit

**Date:** 2026-06-01  
**Mode:** Audit only (read-only).  
**Baseline:** Phase 19 deployed per checkpoint `a6f5215` / tag `e912722` (docs manifest).  
**Prior audits read:** `PHASE17_RENDER_ISLAND_AUDIT.md`, `PHASE18B_LIFECYCLE_INTENT_FORENSIC_AUDIT.md`, `PHASE19_TRUE_BACKGROUND_AUDIO_CONTINUITY.md`.

---

## Executive summary

| Field | Answer |
|--------|--------|
| **Top root cause (one-liner)** | Lock/unlock does not remount React playback shells; **visibility-return lifecycle recovery** re-initializes transport (lightweight `play()` + `AudioContext.resume()`, then **`recoverAudioHard`** stream/graph rebuild) while **Media Session** stays populated—feels like “rehydration.” |
| **Primary question — exact subsystem** | **`AudioContext` lifecycle recovery pipeline** (`runCoalescedLifecycleRecovery` → `attemptLightweightPlaybackResume` → `PlaybackStateMachine` → `recoverAudioHard`) plus **`rehydrateMediaSession`** — **not** `SessionRecoveryRoot` / cold session queue restore. |
| **Remount on lock return?** | **No** for `AudioProvider`, `PlaybackChromeIsland`, `GlobalAudioPlayerBar`, `AudioPhase10Bridge`, or detached `<audio>`. **Yes** only on full app-shell remount (navigation/HMR), not typical lock/unlock. |

---

## A. Playback subsystem lifecycle

### 1. `AudioProvider` (`src/context/AudioContext.js`)

| Concern | Location | Behavior on lock/unlock |
|---------|----------|-------------------------|
| Provider shell | `AudioProvider` L639–4990 | Stays mounted in `layout.js` L46–59 |
| Detached `<audio>` | `audio-engine-runtime.js` L68–97; mount effect L911–921 | **Singleton per tab** — survives provider re-renders |
| Intent capture | `onPause` L1563–1691 | Sets `playbackIntentBeforeHideRef` (L1582–1583); preserves Media Session “playing” (L1642–1657); OS `play()` retry (L1605–1608) |
| Hidden | `visibilitychange` L4462–4506 | `lifecycleInBackgroundRef = true` (L4464); saves position; optional stream meta refresh |
| Visible | L4509–4593 | Clears background ref (L4510); **`evaluateLifecyclePlaybackHealth`** (L4556–4559); **`runCoalescedLifecycleRecovery`** if unhealthy (L4578–4582) |
| Hard recovery | `recoverAudioHard` L2989–3207 | Clears `src`, `teardownWebAudioGraph`, reloads stream, `patchState` `playbackState: "recovering"` (L3068–3074) |
| Lightweight | `attemptLightweightPlaybackResume` L1302–1338 | `resumeWebAudioContextIfSuspended` + `audio.play()` without src tear-down |
| State machine hook | L3225–3230 | `playbackStateMachine.setRecoverExecutor(recoverAudioHard)` |
| Bridge child | L4985–4987 | `<AudioPhase10Bridge />` always rendered inside provider |

### 2. `PlaybackChromeIsland` (`src/components/storefront/PlaybackChromeIsland.js`)

- `memo` wrapper L19–209; **no `key`** in `page.js` L1435–2122.
- Subscribes via `useAudioPlayer()` L27–40 — **re-renders** on context `state` changes, **does not remount** on visibility.
- `nowPlaying` derived in effect L85–116 from `currentTrack` / `playbackState` — UI can “flash” when recovery sets `recovering` / `ready` without island remount.

### 3. `AudioPhase10Bridge` (`src/components/system/AudioPhase10Bridge.js`)

- L14–124: `useQueuePreloader`, `usePlaybackRecovery` (persist only), listener for `2mrrw:playback-recovery` L47–121.
- **Cold session restore** only if `!hasStarted && activeQueue.length === 0` (L53–60) — **not** lock/unlock on an active session.

### 4. `PlaybackStateMachine` (`src/media/PlaybackStateMachine.js`)

- Singleton L196; `RECOVERY_REQUESTED` / `AUDIO_DESYNC_DETECTED` → `_beginRecovery` L151–192 → registered `recoverAudioHard`.
- React hook `usePlaybackStateMachine` L199–205 — used by `GlobalAudioPlayerBar` for orchestration display, not remounted on lock.

### 5. `SessionRecoveryRoot` / `useSessionRecovery`

- `layout.js` L49–55 wraps app content.
- `useSessionRecovery.js` L16–73: **single `useEffect([], [])`** — hydrate + `2mrrw:playback-recovery` event **on first mount only**, not on visibility return.

### 6. Media Session handlers

- Registered in `AudioContext` effect L4380–4450 (`play`, `pause`, `next`, `prev`, `seekto`, etc.).
- **`rehydrateMediaSession`** L1210–1215: re-applies metadata/position from `stateRef` — called on `pageshow` / visible return L4591, 4625, 4634, 4640.
- Lock: `onPause` can keep `ms.playbackState === "playing"` while element paused (L1645–1657) — matches user report (lock screen UI present, audio stopped).

---

## B. Mount / remount detection

| Component | Remount on iPhone lock → unlock (SPA stays loaded)? | Evidence |
|-----------|-----------------------------------------------------|----------|
| `AudioProvider` | **No** | Root `layout.js`; `noteAudioProviderMount` only on provider effect mount L911–921; detached audio retained `audio-engine-runtime.js` L110–118 |
| `PlaybackChromeIsland` | **No** | No remount `key`; `useBlackscreenMountTrace` only fires on true mount/unmount |
| `GlobalAudioPlayerBar` | **No** | Sibling under `AudioProvider` in layout L58 |
| Queue (React + refs) | **No remount** | `queueRef` / `state.queue` updated only via `setQueueInternal` L3604–3618 |
| `AudioPhase10Bridge` | **No** | Child of provider L4986 |
| `PlaybackStateMachine` observers | **No** | Module singleton; listeners added/removed per hook subscribe |
| Detached `<audio>` | **No** | `window.__2MRRW_AUDIO_ENGINE_RUNTIME__` L47–54 |

**What does remount (unrelated to lock):** `HomeStorefront` when `activeTab !== "home"` (Phase 17 L1595–1642) — can look like “refresh” after tab change, not lock alone.

**Diagnostics:** `useBlackscreenMountTrace("AudioProvider")` L640; enable blackscreen trace to confirm no unmount on lock return.

---

## C. Recovery path tracing (prose sequence diagram)

**Lock (hidden):**

1. iOS pauses `<audio>` → `onPause` (L1563).
2. `playbackIntentBeforeHideRef = true` if was playing (L1582–1583).
3. `patchState({ isPlaying: false })` (L1638).
4. Media Session may stay **playing** (L1645–1647).
5. `visibilitychange` → hidden: `lifecycleInBackgroundRef = true` (L4464); position persist (L4472–4478).
6. Watchdog / truth recovery **suppressed** while hidden or intent set (L3441–3447, L3471–3477).

**Unlock (visible, no full browser refresh):**

1. `visibilitychange` → visible (L4509).
2. `lifecycleInBackgroundRef = false` (L4510).
3. `resumeAfter` computed from `wasPlayingBeforeHide` + intent + entitlement (L4526–4529).
4. If `AudioContext` still suspended → optional `runCoalescedLifecycleRecovery` with `gesture_unlock_required` (L4532–4550).
5. `evaluateLifecyclePlaybackHealth` — with Phase 18C intent, `paused_after_lifecycle_interrupt` when element paused (L768–776).
6. If unhealthy → **`runCoalescedLifecycleRecovery`** (L3280–3364):
   - `attemptLightweightPlaybackResume(trigger)` (L3332).
   - On success + healthy → skip hard, clear intent (L3338–3346).
   - Else → `requestPlaybackRecovery(RECOVERY_REQUESTED)` → **`recoverAudioHard`** (L3356).
7. `syncMediaAfterLifecycle` → `updateMediaSession` + `syncPositionState` (L4516–4523).
8. Parallel: `pageshow` (non-persisted) may call `rehydrateMediaSession` (L4639–4640).

**Also wired:** `pagehide` position save L4654–4667; `pageshow` bfcache branch L4595–4636 (not typical lock).

---

## D. Queue integrity after lock-screen return

| Mechanism | Rebuilds queue? | Citation |
|-----------|-----------------|----------|
| Lifecycle visibility recovery | **No** | Uses existing `queueRef` / `currentTrack` |
| `recoverAudioHard` | **No** | Reloads **current** track `src` only L3101–3110 |
| `useSessionRecovery` | **Only on cold mount** | `useSessionRecovery.js` L16–73 |
| `AudioPhase10Bridge` recovery event | **Only if empty active session** | L53–60 |
| `usePlaybackRecovery` | **Persist only** | `usePlaybackRecovery.js` L21–30 |
| `setQueueInternal` | **User/command driven** | L3604–3618 |

**Conclusion:** Queue is **reused** in memory; not rehydrated from `recoveryStore` on lock return unless the whole app remounted.

---

## E. Track-switch-after-return

| Step | Behavior |
|------|----------|
| `playTrack` L4302–4337 | Logs `TRACK_SWITCH_AFTER_RETURN` if visible within 8s of last visibility change (L4308–4322) — **diagnostic only** |
| Recovery before switch? | **No explicit gate** — `playTrack` goes straight to `dispatchPlaybackCommand(PLAY_TRACK)` L4333–4337 |
| `playTrackInternal` L2240+ | Always `initWebAudio` + `resumeWebAudioContextIfSuspended` L2256–2258; if context not running → **`RECOVERY_REQUESTED`** L2259–2263 **before** track load |
| Concurrent lifecycle recovery | Commands serialized via `commandQueueRef` L4156+; `recoverAudioHard` sets `isRecoveringRef` L2991, L3019 — watchdog skips while recovering L3428 |
| Post-return desync | If `patchState` sets `isPlaying: true` while not audible, `patchState` invariant L1049–1093 can queue **`AUDIO_DESYNC_DETECTED`** → hard recovery |

**Conclusion:** Recovery does not run *instead of* track switch, but **can run immediately before or overlap** via command queue / suspended `AudioContext` / audibility invariant — explains “recovery-style” behavior on next tap.

---

## F. Deliverables

### 1. Exact subsystem reinitializing

1. **Lifecycle transport recovery** in `AudioContext` (`attemptLightweightPlaybackResume`, `recoverAudioHard`, orchestration `RECOVERING`).
2. **Media Session surface** (`rehydrateMediaSession` / `updateMediaSession`).
3. **Web Audio graph** (partial teardown in `recoverAudioHard` L3056–3065; reconnect in `initWebAudio` L1238+).
4. **React playback UI state** (`patchState` `playbackState`, `isBuffering`, chrome `nowPlaying` effects).

**Not reinitializing on lock return:** `SessionRecoveryRoot` cold hydrate, queue from localStorage, `AudioProvider` instance, detached `<audio>` element.

### 2. Mount/remount locations (file:function:lines)

| Location | Remount? |
|----------|----------|
| `src/app/layout.js` — `AudioProvider` L46–59 | Only full layout remount |
| `src/context/AudioContext.js` — `AudioProvider` mount effect L911–921 | Provider mount count++, not lock |
| `src/app/page.js` — `PlaybackChromeIsland` L1435 | No key — no lock remount |
| `src/components/storefront/PlaybackChromeIsland.js` L19 | `memo` — render only |
| `src/components/audio/GlobalAudioPlayerBar.js` L310 | Layout-level stable |
| `src/lib/playback/audio-engine-runtime.js` L68–97 | Element once per tab |

### 3. Recovery path (sequence diagram in prose)

See **Section C** above for the full lock → unlock prose sequence.

### 4. Root cause

Observed behavior matches **iOS lifecycle pause** (audio stops, Media Session metadata remains) followed by **visibility-return recovery** that **re-syncs transport and UI state** without remounting React playback islands. Phase 19 reduces hard recovery **while hidden** but **visible return** can still escalate to **`recoverAudioHard`** when lightweight resume or health checks fail—perceived as subsystem “rehydration.” Phase 17 island work is **not regressed** by remount (there is none); **re-renders** from `patchState` during recovery can still churn chrome.

### 5. Recommended implementation plan (no code)

1. **Instrument** lock/unlock with `NEXT_PUBLIC_PLAYBACK_TRACE=1`: confirm `BACKGROUND_RECOVERY_TRIGGER` vs `BACKGROUND_RECOVERY_SKIPPED` vs `recoverAudioHard` on **visible** only.
2. **Separate “resume same track” from “hard recover”** on `visibility_return` when `hasIntactPlaybackTransport` — avoid `src` clear unless stream invalid (align Phase 19 matrix).
3. **Defer audibility invariant** (`patchState` L1049–1093) for N ms after `visibility_return` to avoid recovery racing user track tap.
4. **Gate `playTrackInternal` recovery** when lifecycle recovery in flight (`isRecoveringRef` / machine `RECOVERING`) — queue play after lightweight success or coalesce.
5. **Do not expand `SessionRecoveryRoot`** for lock path — wrong layer; keep cold-restore mount-only.
6. **Validate** Phase 17: ensure `PlaybackChromeIsland` stays isolated; avoid re-adding `useAudioPlayer()` to `page.js`.

### 6. Risk assessment

| Risk | Level | Notes |
|------|-------|-------|
| Audible glitch on unlock | **High** | `recoverAudioHard` reload |
| False “Restored” titles | **Medium** | Reduced by Phase 18/19; still possible if hard recovery + hydrate path |
| Track-tap races recovery | **Medium** | Serial queue + `playTrackInternal` context check |
| Phase 17 regression | **Low** | No provider/chrome remount on lock |
| Phase 18 intent regression | **Low** | Intent refs still drive health |
| Phase 19 regression | **Medium** | Hard path still on visible failure; lock still stops audio (OS) |

### 7. Phase 17–19 regression check

| Phase | Lock/unlock impact |
|-------|-------------------|
| **17** Render islands | **No remount** of `PlaybackChromeIsland`; re-renders from playback state still possible |
| **18** Intent capture | **Preserved** — drives `resumeAfter` and health `paused_after_lifecycle_interrupt` |
| **19** Background continuity | **Partial** — suppresses watchdog/hard while hidden; **visible return** still runs full coalesced recovery |

---

## Primary question (direct answer)

After lock-screen return **without** a full page reload, the subsystem being **recreated/restored/rehydrated** is the **in-process audio transport and Media Session sync layer inside `AudioContext`** (lifecycle recovery + optional hard stream/WebAudio rebuild), **not** a React remount of the playback provider, chrome island, or queue store. **`SessionRecoveryRoot` does not re-run** on unlock for an active session.

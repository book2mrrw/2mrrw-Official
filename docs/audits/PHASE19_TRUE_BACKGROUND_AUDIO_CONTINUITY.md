# Phase 19 — True background audio continuity (iOS Safari)

**Date:** 2026-06-01  
**Baseline:** `77eaaaa` (Phase 18C)  
**Scope:** `AudioContext.js`, `playback-trace.js` (trace helpers only). No PlaybackStateMachine rewrite, no `page.js`, Stripe, entitlements, or catalog changes.

---

## Executive summary

Phase 18 fixed **intent capture and recovery after** OS/tab pause. Phase 19 addresses **continuity**: WebKit often pauses `<audio>` and suspends `AudioContext` on lock/background while Media Session metadata still shows “playing.” The prior **audibility watchdog** and **`recoverAudioHard`** treated that as desync and **reloaded the stream** (src clear, graph teardown), causing audible stop, lock-screen/UI drift, and spurious “Restored” hydration on the next track change.

**Top root cause (one-liner):** Hard recovery and the audibility watchdog fire during normal iOS background suspension while transport is intact, destroying healthy playback instead of resuming `AudioContext` + `HTMLMediaElement.play()`.

---

## P0 audit answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Why does playback stop on phone lock? | iOS Safari pauses the media element and suspends Web Audio; output stops even when lock-screen controls still show metadata. |
| 2 | Why does playback stop on Safari background? | Same: `visibilitychange` → hidden; OS `pause` on `<audio>`; `AudioContext.state` → `suspended`. |
| 3 | AudioContext suspended? | **Yes** — common in background; `isAudioActuallyAudible` returns false while element may still have valid `src`. |
| 4 | HTMLAudioElement paused? | **Yes** — OS-initiated `pause` event; not always user-initiated. |
| 5 | Stream source removed/invalidated? | **Often only after our recovery** — `recoverAudioHard` removes `src` and reloads; not the initial OS pause. |
| 6 | MediaSession active? | **Yes** — metadata/lock-screen can remain while element paused (Phase 19 preserves `playbackState: playing` on lifecycle interrupt). |
| 7 | `recoverAudioHard` interrupting healthy playback? | **Yes (pre-19)** — triggered by watchdog `silent_desync_detected` and lifecycle recovery while transport intact. |
| 8 | Lifecycle recovery causing interruption? | **Yes when hard path ran** — coalesced recovery called state machine → `recoverAudioHard` instead of lightweight resume. |
| 9 | What prevents uninterrupted background playback today? | WebKit OS policy (cannot fully override) + **our** pause handler clearing UI state + hard recovery on false desync. Phase 19 blocks hard recovery in background and prefers lightweight resume. |

---

## Authoritative behavior matrix

| Case | Expected | Phase 19 approach |
|------|----------|-------------------|
| **1** Playing → lock/background | Continue uninterrupted; no recovery UI / “Restored” | Suppress watchdog/hard recover while hidden + intent; immediate `play()` attempt on OS `pause`; preserve Media Session playing; lightweight resume on return before hard recover |
| **2** User paused → lock/background | Stay paused | No intent capture (`userPausedRef` / user-initiated); no auto-resume |
| **3** Return to site | Playing continues OR recovery only on real failure | `attemptLightweightPlaybackResume` then health check; `recoverAudioHard` only if lightweight fails |

---

## Failure detection rule (enforced)

Recovery (hard) only when:

- Stream/src invalid or detached
- Network/transport failure
- Truth violation with **visible** tab and no lifecycle-only interrupt
- Lightweight resume failed after return

**Not** on: normal lock/background/visibility hidden with intact `src` and captured playback intent.

---

## Root cause (detailed)

```mermaid
sequenceDiagram
  participant User
  participant iOS as iOS WebKit
  participant Audio as HTMLAudioElement
  participant Ctx as AudioContext
  participant App as AudioContext.js

  User->>iOS: Lock screen
  iOS->>Audio: pause event
  iOS->>Ctx: suspend
  Audio->>App: onPause (OS)
  App->>App: patchState isPlaying false
  Note over App: Phase 18: intent ref set
  App->>App: Watchdog: ui was playing, not audible
  App->>App: recoverAudioHard (pre-19)
  App->>Audio: removeAttribute src, load
  Note over User: Audio stops; lock screen may still show metadata
```

---

## Phase 17 / 18 regression check

| Area | Status |
|------|--------|
| Phase 17 render islands | **Untouched** — no `page.js` / provider churn |
| Phase 18A intent refs | **Preserved** — `playbackIntentBeforeHideRef` still drives health |
| Phase 18C onPause capture | **Extended** — same React-authority capture; added OS `play()` retry + Media Session preserve |
| Phase 18 Restored title guard | **Untouched** — hard recover less likely → fewer hydrate “Restored” paths |
| PlaybackStateMachine | **Untouched** — still routes recovery to registered executor |

---

## P1 implementation summary

| Change | File |
|--------|------|
| `lifecycleInBackgroundRef` + hidden/visible diagnostics | `AudioContext.js` |
| Suppress audibility watchdog + truth recovery when hidden or lifecycle intent | `AudioContext.js` |
| `attemptLightweightPlaybackResume` before coalesced hard recovery | `AudioContext.js` |
| Block `recoverAudioHard` in background when transport intact; try lightweight | `AudioContext.js` |
| OS `onPause`: immediate `play()` retry, preserve Media Session playing, trace | `AudioContext.js` |
| `visibility` hidden: `resumeWebAudioContextIfSuspended` best-effort | `AudioContext.js` |
| Phase 19 trace helpers (`BACKGROUND_*`, `PLAYBACK_INTENT_STATE`, etc.) | `playback-trace.js` |

Audio element (`audio-engine-runtime.js`): already `preload=auto`, `playsinline`, `webkit-playsinline`, `crossOrigin=anonymous` — no change required.

---

## P2 trace events (gated)

Enable: `NEXT_PUBLIC_PLAYBACK_TRACE=1`

| Event | When |
|-------|------|
| `BACKGROUND_PLAYBACK_STOPPED` | OS/lifecycle `onPause` with captured intent |
| `BACKGROUND_AUDIOCONTEXT_STATE` | Hidden/visible diagnostic snapshots |
| `BACKGROUND_MEDIA_SESSION_STATE` | Hidden/visible diagnostic snapshots |
| `BACKGROUND_AUDIO_ELEMENT_STATE` | Hidden/visible diagnostic snapshots |
| `BACKGROUND_RECOVERY_TRIGGER` | Coalesced lifecycle recovery armed |
| `BACKGROUND_RECOVERY_SKIPPED` | Lightweight resume succeeded or hard recover blocked in background |
| `LOCKSCREEN_MEDIA_SESSION_ACTIVE` | Media Session playing while element paused |
| `PLAYBACK_CONTINUITY_LOST` | Lightweight resume failed before hard recovery |
| `PLAYBACK_INTENT_STATE` | Intent ref snapshot |

---

## Files reviewed

| File | Role |
|------|------|
| `src/context/AudioContext.js` | Lifecycle, recovery, watchdog, Media Session |
| `src/lib/playback/audibility.js` | Audibility truth (unchanged) |
| `src/media/PlaybackStateMachine.js` | Recovery routing (unchanged) |
| `src/lib/playback/audio-engine-runtime.js` | Detached `<audio>` shell |
| `src/lib/diagnostics/playback-trace.js` | Trace helpers |
| `docs/audits/PHASE18*.md`, `PHASE17*.md` | Prior phase context |

**Note:** User-requested filenames `PHASE18_BACKGROUND_PLAYBACK_AND_RECOVERY_FORENSIC_AUDIT.md` and `PHASE18B_BACKGROUND_PLAYBACK_VERIFICATION.md` are not in repo; equivalent content is in `PHASE18B_LIFECYCLE_INTENT_FORENSIC_AUDIT.md`, `PHASE18A_*`, `PHASE18C_*`.

---

## Manual validation

1. `NEXT_PUBLIC_PLAYBACK_TRACE=1`, entitled track, iOS Safari.
2. **Case 1:** Play → lock 10s → unlock. Expect audio resumes without full reload; console may show `BACKGROUND_PLAYBACK_STOPPED`, optional `BACKGROUND_RECOVERY_SKIPPED` with `path: lightweight`; avoid `recoverAudioHard` on hidden tab.
3. **Case 2:** User pause → lock → unlock. No auto-resume; no `PLAYBACK_INTENT_CAPTURED`.
4. **Case 3:** After return, switch track. No spurious “Restored” title (Phase 18 guard + less hard recovery).

```bash
npm run build
npm run check:frontend-guardrails
```

---

## Verification results

| Command | Result |
|---------|--------|
| `npm run build` | **Pass** (Next.js 16.2.4) |
| `npm run check:frontend-guardrails` | **Pass** (see commit) |

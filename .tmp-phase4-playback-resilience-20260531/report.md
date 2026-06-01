# Phase 4 — Playback Resilience Audit & Hardening

**Date:** 2026-05-31  
**Scope:** Production hardening only — lock screen/Bluetooth, queue persistence, stream resilience, dev diagnostics. Phase 1–3 playback/entitlement/queue architecture unchanged.

---

## Executive summary

Phase 4 audited all four resilience areas. Media Session routing and queue persistence were already sound from Phases 2–3. Targeted hardening added: unified preview fallback for invalid/unreachable streams, stall recovery for entitled playback, and dev-only `[playback-resilience]` logging behind `NEXT_PUBLIC_STATE_CHURN_LOG`.

**Build:** PASS  
**test:playback-resolver-fallback:** PASS (21/21)

---

## Section results

| Section | Result | Notes |
|---------|--------|-------|
| 1 — Lock screen & Bluetooth | **PASS** | Handlers verified; no routing gaps. Dev logging added for route changes and seek no-ops. |
| 2 — Queue persistence | **PASS** | No issues found; Phase 2 recovery gating intact. |
| 3 — Stream resilience | **PASS** (hardened) | Extended preview fallback; stall recovery timer added. |
| 4 — Diagnostics | **PASS** (hardened) | `logPlaybackResilience` + wiring across failure paths. |

---

## Section 1 — Lock screen & Bluetooth

### Audit findings

Media Session in `AudioContext.js` (lines ~2955–3015):

| Handler | Routes to | Engine |
|---------|-----------|--------|
| `play` | `resume()` → `RESUME` / `RECOVER` | Single `<audio>` via `dispatchPlaybackCommand` |
| `pause` | `pause()` → `PAUSE` | Same |
| `nexttrack` | `playNext()` → `NEXT_TRACK` | Same |
| `previoustrack` | `playPrevious()` → `PREV_TRACK` | Same |
| `seekto` | `seek()` (preview capped at 15s in `seekInternal`) | Same |
| `seekbackward` / `seekforward` | `seek()` with offset | Same |
| `stop` | `stop()` → `STOP` | Same |
| `togglemicrophone` | `toggleCSMode()` | Same |

Metadata: `updateMediaSession` sets title/artist/album/artwork + `setPositionState` (1s throttle). Rehydration on `pageshow` / visibility return unchanged from Phase 3.

`registerMediaEngineBridge` exposes single-engine state — no second player.

### Changes

- Dev-only log on Bluetooth/audio route change (`devicechange` → `[playback-resilience] audio-route-change`).
- Dev-only log when `seekto` arrives without a valid `seekTime` (helps diagnose lock-screen scrub issues).

### Root cause

None — handlers and routing were complete. No code changes required for core behavior.

---

## Section 2 — Queue persistence

### Audit findings

| Scenario | Behavior | Status |
|----------|----------|--------|
| Route navigation | Queue in React state + `queueRef`; persists via `usePlaybackRecovery` every 5s | OK |
| Modal open/close | No queue reset in modal paths | OK |
| Entitlement refresh | `entitlements:updated` → `upgradeToFullStream` only; no `setQueue` | OK |
| Account refresh | `AuthContext.refreshAccountState` does not touch queue | OK |
| Background/foreground | Phase 3 visibility sync; queue refs preserved | OK |
| Recovery overwrite | `AudioPhase10Bridge` skips `setQueue` when `hasStarted \|\| queue.length > 0` | OK (Phase 2) |

`setQueue` is only called from `playQueueInternal` and recovery bridge — no AuthContext coupling.

### Changes

None required.

### Root cause

None.

---

## Section 3 — Stream resilience

### Audit findings

Existing paths (pre-Phase 4):

- `onError`: offline → reconnect listener; signed URL retry once; preview fallback on 401/404/403; `streamRetryable` UI state.
- `playTrackInternal`: preview fallback on library stream load failure; concurrent stream conflict handling.
- `fetchLibraryStream`: structured error codes (401, 403, 404, 422, 409, missing URL).
- `resolvePlaybackKey`: server-side master/stream fallback (tested via resolver-fallback suite).

### Gaps found

1. **Preview fallback incomplete** — 415 (invalid content type) and 422 (asset unavailable) did not trigger guest preview fallback; could leave entitled users stuck on bad stream URLs.
2. **Stall with no recovery** — `waiting`/`stalled` set `isBuffering` but never attempted recovery on prolonged buffer (network blip mid-stream).
3. **onError diagnostics** — used `console.error` only; no structured diagnostic payload.

### Changes

| File | Change |
|------|--------|
| `AudioContext.js` | `canFallbackStreamToPreview()` — unified fallback for 401/403/404/415/422 + error codes |
| `AudioContext.js` | `startStallRecovery()` — 12s timer on entitled streams; one retry via `retryStreamPlayback` |
| `AudioContext.js` | `onError` → `reportPlaybackDiagnostic` + `logPlaybackResilience` |
| `stream-client.js` | Dev resilience logs on auth denied, unavailable, request failed, missing URL |

Guest 15s preview cap, entitled full playback, and Phase 3 background behavior preserved.

---

## Section 4 — Diagnostics

### Audit findings

- `state-churn-log.js` — `[state-churn]` for Auth/entitlement churn (Phase 2).
- `reportPlaybackDiagnostic` — `[playback-diagnostic]` on warn/error paths.
- Gaps: no unified dev flag for playback/stream failures; stream-client and some error paths silent in dev tooling.

### Changes

| File | Change |
|------|--------|
| `state-churn-log.js` | Added `logPlaybackResilience(kind, meta)` |
| `playback-diagnostics.js` | Mirrors to `[playback-resilience]` when flag enabled |
| `stream-client.js` | Resilience logs on stream failures |
| `AudioContext.js` | Resilience logs: stream error, stall recovery, network restore, audio route change, media-session seek noop |

**Enable:** `NODE_ENV=development` (default) or `NEXT_PUBLIC_STATE_CHURN_LOG=1`  
**Disable:** `NEXT_PUBLIC_STATE_CHURN_LOG=0`

---

## Files modified

```
src/lib/diagnostics/state-churn-log.js
src/lib/playback/playback-diagnostics.js
src/lib/playback/stream-client.js
src/context/AudioContext.js
```

---

## Validation

| Check | Result |
|-------|--------|
| `npm run build` | PASS |
| `npm run test:playback-resolver-fallback` | PASS (21/21) |

---

## Remaining risks

1. **Stall recovery is single-shot** — repeated network failure may still require manual tap-to-retry; by design (minimal scope).
2. **Media Session seek no-op** — some OEM lock screens may send non-standard seek payloads; dev log helps diagnose but no auto-fix without device-specific handling.
3. **Recovery hydration** — cold start still depends on `/api/catalog/hydrate`; partial hydration falls back to slug-only stream URLs (pre-existing).
4. **Production diagnostics** — `[playback-diagnostic]` warn/error still emit in production; `[playback-resilience]` is dev-only.

---

## Preserved (unchanged)

- Guest 15s preview hard cap
- Entitled full stream path + Phase 3 background/foreground RECOVER
- Phase 2 queue recovery overwrite protection
- Single audio element / command queue architecture
- No UI, layout, or entitlement source-of-truth changes

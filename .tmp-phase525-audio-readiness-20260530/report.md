# Phase 5.2.5 — Audio Readiness & Early Player Initialization

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Zip:** `/Users/recharge/Downloads/phase525-audio-readiness-20260530.zip`  
**Status:** **READY**

---

## Executive summary

Reduced tap → audible latency through **readiness and initialization only** — no entitlement, queue, resolver, or streaming architecture changes. Root causes were (1) `AudioProvider` blocked behind `AppAuthRoot` hydration placeholder, (2) `waitAudioSrcReady` waiting for `canplay` when `loadeddata`/`HAVE_CURRENT_DATA` suffices, (3) redundant iOS unlock on every play after session gesture, and (4) ~3 s first-listen volume swell masking early output.

Estimated improvement: **~2.5–3 s** on first-listen cold preview; **~250–700 ms** on repeat same-source plays. Production API latency unchanged (Phase 5.2.4 curl baselines).

---

## Root causes

| # | Cause | Evidence |
|---|-------|----------|
| 1 | **Hydration gate unmounts audio tree** | `AppAuthRoot` returned `BOOT_PLACEHOLDER` until `useEffect` → `AudioProvider`, `<audio>`, gesture listeners, and `GlobalAudioPlayerBar` did not exist until ~1 React cycle after first client paint |
| 2 | **`waitAudioSrcReady` over-waits** | Resolved on `canplay` (readyState ≥ 3); `loadeddata` only marked perf, not readiness; stale early exit on `readyState >= 1` before src assignment removed |
| 3 | **Redundant gesture unlock** | `unlockAudioFromGesture` (silent play/pause) ran on every `playTrackInternal` even after document-level gesture handler set `sessionUnlockedRef` |
| 4 | **First-listen volume swell** | 0.033/step × 100 ms ≈ 3 s before full perceived volume on new slugs |

Server/API latency (Phase 5.2.4): preview redirect ~215 ms, stream redirect ~174–192 ms — **not** the remaining dominant factor.

---

## Remediation (files modified)

### `src/app/layout.js`
- Moved `AudioProvider` **outside** `AppAuthRoot` (still inside `AuthProvider`).
- Moved `GlobalAudioPlayerBar` to sibling of `AppAuthRoot` inside `AudioProvider`.
- Auth gate UX unchanged: `AppAuthRoot` still shows placeholder then shell + OTP overlay.

### `src/context/AudioContext.js`
- **`waitAudioSrcReady`:** same-src + `readyState >= 2` fast path; resolve on `loadeddata` at `HAVE_CURRENT_DATA`; skip redundant `load()` when already ready.
- **`playTrackInternal`:** skip `unlockAudioFromGesture` when `sessionUnlockedRef` is true.
- **Volume swell:** 500 ms ramp (was ~3000 ms).
- **Dev marks:** `PLAYBACK_PROVIDER_MOUNT`, `PLAYBACK_AUDIO_ELEMENT_READY` on mount.

### `src/components/auth/AppAuthRoot.js`
- Dev-only `HYDRATION_START` / `HYDRATION_END` marks for init vs tap measurement.

### `src/lib/dev/performanceMarks.js`
- New marks + measures: `playback-provider-to-tap`, `playback-hydration-to-tap`.

### `src/lib/media/canonical-catalog.js`
- Phase 5.2.3 album track title fix included (was already unstaged in workspace).

---

## Timing summary

See `timing-breakdown.md` for full stage table.

| Scenario | Before (est.) | After (est.) |
|----------|---------------|--------------|
| First listen, cold preview | ~3.5–4.1 s | ~0.9–1.25 s |
| Repeat same source | ~0.3–0.9 s | ~0.05–0.2 s |
| Prod API (curl) | ~170–580 ms | **Unchanged** |

Dev verification: `window.dumpPlaybackTiming()` after play in development.

---

## Validation

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** |
| `npm run test:playback-resolver-fallback` | **PASS** (21/21) |
| `npm run test:foundation` | **FAIL** (2) — pre-existing anchor drift: HEAD `8997d9e` vs tag `foundation-stable-v3` `bac9eb7`; not caused by this phase |

---

## Risk

| Risk | Mitigation |
|------|------------|
| `AudioProvider` mounts before cinematic shell visible | Provider is inert until play; auth gate overlay unchanged |
| `loadeddata` readiness vs `canplay` | `canplay` listener retained as fallback; Safari progressive MP3 supports play at `HAVE_CURRENT_DATA` |
| Faster volume swell | Still ramps from 0; shorter duration only |
| `GlobalAudioPlayerBar` outside auth placeholder | Bar only surfaces when playback state active (`hasStarted`) |

---

## Rollback

Selective restore (preferred):

```bash
git checkout HEAD -- src/app/layout.js src/components/auth/AppAuthRoot.js src/context/AudioContext.js src/lib/dev/performanceMarks.js
```

Or full foundation recovery per `docs/foundation/FRONTEND_RECOVERY_PROTOCOL.md` if broader regression.

---

## Out of scope (honored)

- Entitlement / queue / resolver / signed URL flow
- Audiovisual viewport
- Aggressive media preload
- AudioContext orchestration rewrite
- Commit / push / deploy

---

## Verdict

**READY** — Build and playback resolver tests pass; client initialization and readiness optimizations are scoped, reversible, and address Phase 5.2.4 top bottlenecks without prohibited system changes.

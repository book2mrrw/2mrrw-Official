# Phase 5.2.5 — Tap → Audible Timing Breakdown

**Date:** 2026-05-31  
**Method:** Code-path analysis + dev `performanceMarks` pipeline (prod has no marks)

---

## Pipeline stages (ordered)

| Stage | Component | Before | After | Notes |
|-------|-----------|--------|-------|-------|
| T0 | User tap | 0 ms | 0 ms | `PLAYBACK_TAP` mark |
| T1 | Command dispatch | ~1–5 ms | ~1–5 ms | Serial queue unchanged |
| T2 | AudioProvider mount | **Blocked until AppAuthRoot hydration** (~16–50 ms + 1 effect) | **Immediate with AuthProvider** (~0 ms gate) | Layout restructure |
| T3 | `<audio>` element + gesture listeners | Delayed with T2 | Available on first client paint | Pre-warm on first touch |
| T4 | `unlockAudioFromGesture` | Every play (~10–30 ms play/pause) | **Skipped when `sessionUnlockedRef`** | After first document gesture |
| T5 | `initWebAudio` + context resume | Same | Same | Runs in play path + gesture handler |
| T6 | Stream/preview URL resolve | ~170–580 ms API (prod curl, unchanged) | **Unchanged** | Phase 5.2.4 baselines |
| T7 | `waitAudioSrcReady` | Waits primarily for `canplay` (readyState ≥ 3); `loadeddata` only instrumented | Resolves on **`loadeddata` when readyState ≥ 2**; **same-src cache hit skips load** | Largest decode-path win |
| T8 | `audio.play()` | Same | Same | |
| T9 | `playing` event → audible mark | Same | Same | `PLAYBACK_AUDIBLE` |
| T10 | First-listen volume swell | **~3000 ms** (0.033 × 30 @ 100 ms) | **~500 ms** (0.1 × 10 @ 50 ms) | Perceived loudness ramp |

---

## Dev marks (localhost, `NODE_ENV=development`)

Use `window.dumpPlaybackTiming()` after a play tap. New measures:

| Measure | Marks |
|---------|-------|
| `playback-provider-to-tap` | `PLAYBACK_PROVIDER_MOUNT` → `PLAYBACK_TAP` |
| `playback-hydration-to-tap` | `HYDRATION_END` → `PLAYBACK_TAP` |
| `playback-src-to-first-byte` | `PLAYBACK_SRC_ASSIGN` → `PLAYBACK_FIRST_BYTE` |
| `playback-first-byte-to-canplay` | `PLAYBACK_FIRST_BYTE` → `PLAYBACK_CANPLAY` |
| `playback-canplay-to-audible` | `PLAYBACK_CANPLAY` → `PLAYBACK_AUDIBLE` |
| `playback-tap-to-audible` | End-to-end |

New marks: `PLAYBACK_PROVIDER_MOUNT`, `PLAYBACK_AUDIO_ELEMENT_READY`, `HYDRATION_START` / `HYDRATION_END` (AppAuthRoot).

---

## Estimated before / after (guest preview, first play)

Assumptions: mobile Safari, ~1 MB MP3 preview, prod API ~215 ms (Phase 5.2.4 curl), CDN first byte ~180 ms.

| Segment | Before (est.) | After (est.) | Δ |
|---------|---------------|--------------|---|
| Hydration / provider init gate | 16–50 ms | 0 ms | **−16–50 ms** |
| Gesture unlock in play path | 10–30 ms | 0 ms (if pre-gestured) | **−10–30 ms** |
| API + redirect | ~215 ms | ~215 ms | 0 |
| `waitAudioSrcReady` (network + decode) | 250–800 ms (canplay) | 150–500 ms (loadeddata / HAVE_CURRENT_DATA) | **−50–300 ms** |
| First-listen swell to full volume | ~3000 ms | ~500 ms | **−2500 ms perceived** |
| **Tap → audible (first listen, cold)** | **~3500–4100 ms** | **~900–1250 ms** | **~−2.5–3 s** |
| **Tap → audible (repeat same src)** | ~300–900 ms | **~50–200 ms** (same-src fast path) | **−250–700 ms** |

Cross-track fade (~300 ms max) unchanged — only applies when switching tracks while playing.

---

## Production API latency (unchanged — Phase 5.2.4 curl)

Re-probed endpoints not re-run this phase; prior prod measurements stand:

- Guest session: ~0.17–0.58 ms (local curl to prod)
- Preview redirect: ~215 ms
- Stream redirect (401 unauth): ~174–192 ms

No server-side changes in Phase 5.2.5.

---

## Validation

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm run test:playback-resolver-fallback` | **PASS** (21/21) |
| `npm run test:foundation` | **2 FAIL** — pre-existing anchor drift (HEAD vs `foundation-stable-v3` tag); not introduced by this phase |

# Phase 5.2.8 — Decode Path Isolation

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Baseline:** Phase 5.2.7 instrumentation + unstaged decode isolation  
**Hybrid flags:** OFF (unchanged)  
**Zip:** `/Users/recharge/Downloads/phase528-decode-path-isolation-20260530.zip`

---

## Executive summary

Phase 5.2.8 **isolates the decode / `waitAudioSrcReady` bucket** (150–500 ms typical, up to ~800 ms cold) into six ordered sub-segments and adds scenario labels, `waitAudioSrcReady` guard breakdown, and readyState/networkState dwell telemetry. **Instrumentation only** — no playback logic changes, no hybrid streaming, no optimizations.

1. **Decode bucket decomposed** — src→loadedmetadata→loadeddata→canplay→play()→promise→audible, exposed in `dumpPlaybackTiming().decodePathBreakdown`.
2. **`waitAudioSrcReady` internal breakdown** — enter/exit marks, guard paths (same-src fast path, early readyState), load() call timing.
3. **Scenario tags** — cold-start, warm-start, cached-playback, track-skip, album-tracklist, queue-auto-advance on tap.
4. **readyState / networkState** — dwell times, transition log, waiting/stalled/suspend/progress counts in dump output.
5. **`npm run build`** — **PASS**.

---

## TOP 3 delays (exact ms — guest preview cold, code-path + Phase 5.2.7 baseline)

| Rank | Delay | ms (cold preview) | Notes |
|------|-------|-------------------|-------|
| **1** | **src → loadedmetadata** (network + demux start) | **80–250 ms** | Largest decode-bucket slice; CDN TTFB + container probe |
| **2** | **loadedmetadata → loadeddata** (decode buffer fill) | **40–180 ms** | AAC/MP3 frame decode; platform-sensitive |
| **3** | **canplay → play() call** (includes canplaythrough wait on some paths) | **100–200 ms** | `waitAudioSrcReady` resolves at canplay; play() often after canplaythrough handler |

**Full decode bucket sum (cold):** ~220–680 ms of tap→audible (320–830 ms E2E minus queue/resolver ~100–150 ms).

Live numeric confirmation: `npm run dev` → tap play → `window.dumpPlaybackTiming()` (desktop Chrome **requires-device-run** for iOS/Android).

---

## Decode bucket — fully decomposed

| Segment | Measure key | Cold preview (ms) | Warm / cached (ms) |
|---------|-------------|-------------------|---------------------|
| src assignment → loadedmetadata | `playback-src-to-loadedmetadata` | 80–250 | 0 (cached fast path) |
| loadedmetadata → loadeddata | `playback-loadedmetadata-to-loadeddata` | 40–180 | 0 |
| loadeddata → canplay | `playback-loadeddata-to-canplay` | 0–50 | 0 |
| canplay → play() call | `playback-canplay-to-play-call` | 100–200 | 1–5 |
| play() → promise resolved | `playback-play-call-to-promise` | 1–20 | 1–10 |
| promise → first audible | `playback-promise-to-audible` | 0–30 | 0–15 |

**waitAudioSrcReady total:** `playback-wait-src-total` ≈ 120–480 ms cold; **0–2 ms** when `guard-same-src-fast-path` fires.

---

## Scope discipline

| In scope | Out of scope |
|----------|--------------|
| Dev-gated decode isolation marks | Production logging |
| Scenario labels on tap | Hybrid streaming activation |
| readyState dwell analysis | Resolver / entitlement changes |
| Documentation + zip | Commit / push / deploy |

---

## Validation

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| Desktop Chrome live dump | **Methodology documented** — operator action |
| iOS Safari / Chrome Android / Samsung Internet | **requires-device-run** |

---

## STOP

No fixes, optimizations, commit, push, or deploy.

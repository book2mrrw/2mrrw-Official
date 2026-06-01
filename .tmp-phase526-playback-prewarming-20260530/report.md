# Phase 5.2.6 — Playback Prewarming & Network Preparation

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Prod baseline:** commit `82aeeb0` (Phase 5.2.3–5.2.5)  
**Hybrid flags:** OFF (unchanged)  
**Zip:** `/Users/recharge/Downloads/phase526-playback-prewarming-20260530.zip`

---

## Executive summary

Phase 5.2.6 moves **connection setup** and **playback descriptor assembly** earlier in the fan journey — before tap — without changing audible behavior, entitlements, or hybrid activation.

1. **Network preconnect** — R2 public CDN origin in root `<head>` for preview-byte path.
2. **Viewport prewarm** — IntersectionObserver on home release cards warms in-memory descriptors (metadata, queue shape, URL strings).
3. **Tap fast-path** — Play button reuses warmed normalization; fresh access/`src` resolution at tap.
4. **Page init** — Documented ranked findings; no risky `page.js` surgery.

---

## Files modified

| File | Change |
|------|--------|
| `src/app/layout.js` | `<head>` + `PlaybackNetworkHints` |
| `src/components/system/PlaybackNetworkHints.js` | **NEW** — preconnect/dns-prefetch |
| `src/lib/playback/play-path-domains.js` | **NEW** — play-path origin audit helper |
| `src/lib/playback/playback-prewarm-cache.js` | **NEW** — Map cache + bundle builder |
| `src/hooks/usePlaybackCardPrewarm.js` | **NEW** — IntersectionObserver hook |
| `src/components/music/PlaybackPrewarmCardShell.js` | **NEW** — card wrapper |
| `src/components/home/LatestSinglesStyleRow.js` | Prewarm shell on row cards |
| `src/components/home/CatalogGrid.js` | Prewarm shell on album cards |
| `src/components/music/ReleaseCardPlayButton.js` | Prewarm cache lookup on tap |

---

## Bottleneck ranking (after 5.2.6)

| Rank | Bottleneck | Status |
|------|------------|--------|
| 1 | Client decode + `waitAudioSrcReady` | **Still dominant** — unchanged this phase |
| 2 | Stream/preview API + CDN first byte | **Partially improved** — preconnect saves ~40–150 ms on first R2 CDN connection |
| 3 | Catalog normalization at tap | **Improved** — prewarm when card visible (~5–20 ms saved at tap) |
| 4 | Page JS hydration / effect fan-out | Documented — not fixed |
| 5 | Cross-track fade / command queue | Unchanged |

---

## Before / after tap→audible (estimates)

| Stage | Before 5.2.6 (guest, prod-ish) | After 5.2.6 (card visible ≥1s) |
|-------|-------------------------------|--------------------------------|
| TCP/TLS to R2 CDN | On tap | **Before tap** (~80 ms median saved) |
| Catalog normalize + URL build | On tap | **Before tap** (~5–20 ms saved) |
| API preview/stream RTT | On tap | Unchanged |
| Audio decode → audible | On tap | Unchanged (largest share) |
| **Total tap→audible (guest preview)** | ~400–900 ms typical | ~320–830 ms projected (**~10–15%**) |

Dev marks: use `window.dumpPlaybackTiming()` after play — compare `playback-tap-to-request` and `playback-resolver` stages; `playback-tap-to-audible` should show smaller resolver/normalize contribution when prewarm hit.

---

## Validation

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm run test:playback-resolver-fallback` | **PASS** (21/21) |
| `npm run test:foundation` | **2 FAIL** — pre-existing anchor doc HEAD mismatch (`82aeeb0` vs documented baseline); unrelated to 5.2.6 code |

---

## Risk assessment

| Area | Risk | Mitigation |
|------|------|------------|
| Preconnect | Low | Single known public CDN; env-aware |
| Prewarm cache | Low | No bytes, no signed URLs, LRU cap 96 |
| Stale access after login | Low | `toPlaybackTrack` re-resolves access at tap |
| Layout `<head>` | Low | Standard Next.js pattern |
| Hybrid flags | None | Not touched |

---

## Rollback

1. Remove `PlaybackNetworkHints` from `layout.js`.
2. Revert `LatestSinglesStyleRow.js`, `CatalogGrid.js`, `ReleaseCardPlayButton.js` to prior card/play handlers.
3. Delete new files under `src/lib/playback/play-path-domains.js`, `playback-prewarm-cache.js`, `src/hooks/usePlaybackCardPrewarm.js`, `PlaybackPrewarmCardShell.js`, `PlaybackNetworkHints.js`.

No schema, entitlement, or flag changes — rollback is file-level.

---

## Readiness score: **74 / 100**

| Criterion | Score | Notes |
|-----------|-------|-------|
| Network path | 78 | Preconnect for CDN; same-origin API already warm |
| Pre-tap descriptor prep | 80 | Viewport prewarm + tap cache hit |
| Client decode pipeline | 55 | Still primary bottleneck (5.2.4) |
| Init / hydration | 65 | Documented; monolithic page remains |
| Safety / scope discipline | 95 | No flags, no byte prefetch, no entitlement changes |

**Delta from 5.2.4 audit posture (~68 implied): +6** — incremental, safe shift of work before tap; full audible win requires decode/init phase or hybrid staging (flags still OFF).

---

## STOP

No commit, push, or deploy. Hybrid flags remain OFF.

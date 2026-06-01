# Phase 5.2.9 — Source Acquisition Root-Cause Analysis

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Scope:** Forensic only — attribute every ms between `audio.src` assignment and `loadedmetadata`  
**Hybrid streaming:** OFF (unchanged)  
**Zip:** `/Users/recharge/Downloads/phase529-source-acquisition-20260530.zip`

---

## Executive summary

Phase 5.2.8 isolated **src → loadedmetadata** as the largest decode-bucket slice (**80–250 ms** cold guest preview). Phase 5.2.9 decomposes that window into **network acquisition** (DNS/TCP/TLS/TTFB/first bytes) vs **browser demux/header parse** vs **preconnect effectiveness**, using live `curl` probes against production `www.2mrrw.com` + R2 public CDN and new dev-only **PerformanceResourceTiming** capture in `dumpPlaybackTiming()`.

**No playback behavior changes.** Dev instrumentation: `collectPlaybackResourceTiming()` on `loadedmetadata` (measurement-only).

---

## TOP 3 root causes (src → loadedmetadata)

| Rank | Contributor | ms (cold guest preview) | Evidence |
|------|-------------|---------------------------|----------|
| **1** | **CDN/R2 TTFB (edge → first response byte)** | **131–195 ms** | Live curl Range/HEAD to `previews/singles/hour-glass/hourglass-preview.mp3` (2026-05-31); aligns with Phase 5.2.8 **80–250 ms** bucket when connection already warm |
| **2** | **Cold DNS + TCP + TLS** (no preconnect) | **+40–150 ms** additive on first fetch to CDN origin | `PRECONNECT_SETUP_SAVINGS_MS` in `play-path-domains.js`; curl TLS ~35 ms + connect ~11 ms when warm; mobile Safari **requires-device-run** |
| **3** | **MP3 ID3 scan + loadedmetadata dispatch** | **~15–55 ms** | Residual after TTFB within **80–250 ms** window; ID3v2 tag at byte 0 (~8 KB tag region before first audio frame); browser-internal — confirm via `dumpPlaybackTiming().sourceAcquisitionAttribution.estimatedParseAndDispatchMs` |

**Not in src→metadata window (but delays audible start):**

- Preview API **302 redirect** before `src` assign: **~362 ms TTFB** + **~1.21 s** total redirect chain (curl, 2026-05-31).
- Entitled **stream API 401** then preview fallback: **401 ~instant**; gap is client fallback path (documented in scenarios).

---

## Methodology

1. Code-path review: `waitAudioSrcReady` (`AudioContext.js`), preview redirect (`/api/media/preview`), prewarm (`playback-prewarm-cache.js`, `usePlaybackCardPrewarm.js`).
2. Live probes: `curl -w` timings + cache headers on prod CDN/API (see `curl-probes-raw.txt` in bundle).
3. Dev attribution: `window.dumpPlaybackTiming()` → `sourceAcquisition`, `sourceAcquisitionAttribution` (Resource Timing vs `playback-src-to-loadedmetadata`).

---

## Key findings

| Finding | Impact |
|---------|--------|
| Flat legacy CDN keys (`/previews/hourglass-preview.mp3`, `/previews/w2d-preview.mp3`) return **404** | Wrong URL in env/catalog → full failure, not slow metadata |
| Canonical preview: `previews/singles/hour-glass/hourglass-preview.mp3` | **200/206**, Accept-Ranges, **831,656 B** MP3 |
| `x-vercel-cache: MISS` on preview API redirect | First visitor pays redirect + CDN; CDN itself shows no `cf-cache-status` on R2 dev host |
| Card prewarm warms **URLs/descriptors only** — no audio bytes | Saves resolver/URL build, **not** src→metadata unless same `src` replay |
| Resource Timing cross-origin | Requires `Timing-Allow-Origin` on CDN; if absent, use curl TTFB + mark delta |

---

## Instrumentation added (dev-only)

| File | Change |
|------|--------|
| `src/lib/dev/performanceMarks.js` | `collectPlaybackResourceTiming()`, `sourceAcquisition` + attribution in `dumpPlaybackTiming()` |

---

## Validation

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| Live browser Resource Timing | **Operator / device** — `npm run dev` → play → `dumpPlaybackTiming()` |
| iOS Safari / Chrome Android / Samsung Internet | **requires-device-run** — see `platform-comparison.md` |

---

## STOP

No optimizations, hybrid streaming, entitlement/resolver edits, commit, push, or deploy.

# Phase 4.7 — Playback Startup Fast-Path Analysis

**Date:** 2026-05-30  
**Repo:** `/Users/recharge/artist-platform`  
**Mode:** Analysis only — no source changes  
**Zip:** `/Users/recharge/Downloads/phase47-playback-fastpath-20260529.zip`

## Executive summary

Phase 4.7 validates the playback startup fast path after Phase 4.5 audits, playback latency instrumentation, and Phase 4.6 React/network optimizations. The **entitled redirect path** (`/api/library/stream?redirect=1`) is correctly wired: client assigns `audio.src` without `fetchLibraryStream` or HEAD. Remaining startup delay is dominated by **server stream resolution**, **preview API redirect** (guest folder previews), and **CDN first-byte** latency—not by missing client fast-path logic.

Production curl (this session) measured **9** checkpoints; **11** remain pending (entitled 200 stream, nine dev Performance marks, iOS device tap→audible).

## Top 3 measured bottlenecks

1. **CDN first-byte (preview)** — 954 ms TTFB for first 64 KiB (`Range: bytes=0-65535`); full file 2131 ms total. Dominates guest preview after src assign.
2. **Preview API redirect** — 602 ms TTFB on `GET /api/media/preview?folder=previews/singles/hour-glass/` before CDN fetch.
3. **Library stream API** — 279–804 ms TTFB on `redirect=1` and JSON paths (401 without session); server auth/entitlement chain runs even when denied.

*Outlier excluded from ranking:* CDN cold HEAD 7846 ms — probe artifact; do not use HEAD on hot paths.

## Fast-path verdict

| Path | Client RTTs | Server work | Status |
|------|-------------|-------------|--------|
| Entitled `redirect=1` | 0 prefetch | Full chain on first GET | **Optimal client design** |
| Preview CDN direct | 0–1 API + 1 CDN | Minimal | **Good**; folder preview adds API hop |
| JSON + HEAD refresh | 2+ client | Same server | **Avoid on tap**; use for refresh only |

## Instrumentation (`performanceMarks.js`)

Nine stage measures defined; `dumpPlaybackTiming()` dev-only. Redirect plays leave `playback-resolver` and `playback-signed-url` null—use Network tab or future `Server-Timing` for server segment.

## Phase 4.6 interaction

Main-thread improvements (progress decoupling, scroll ref parallax, hero preload metadata) reduce contention around tap but do not shorten stream API or CDN segments. No playback architecture changes in 4.6.

## Deliverables

| File | Contents |
|------|----------|
| `01-full-playback-timeline.md` | T0–T6 timeline + marks |
| `02-measured-latency-table.md` | Curl + pending scorecard |
| `03-current-playback-path.md` | As-built paths |
| `04-optimized-playback-path.md` | Target vs gaps |
| `05-top-10-bottlenecks.md` | Ranked list |
| `06-recommended-fixes.md` | P0–P3 actions |
| `07-mobile-safari-findings.md` | iOS synthesis |
| `08-network-analysis.md` | Waterfalls + curl |
| `09-playback-readiness-analysis.md` | waitAudioSrcReady |
| `curl-measurements.txt` | Raw probes |

## Next validation (P0)

1. Localhost dev + `dumpPlaybackTiming()` — entitled redirect + preview on iOS width.  
2. Staging/prod HAR with fan cookie — 200 stream TTFB and time-to-first-byte.  
3. Optional `Server-Timing` on `library/stream` (implementation phase).

## Measurement scorecard

| | Count |
|---|------|
| **Measured** | 9 |
| **Pending** | 11 |

See `02-measured-latency-table.md` for breakdown.

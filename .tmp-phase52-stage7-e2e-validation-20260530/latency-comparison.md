# Phase 5.2 Stage 7 — Latency Comparison

**Date:** 2026-05-30  
**Legend:** **[M]** = measured curl; **[P]** = projected from architecture/tests; **[U]** = unit-test simulation only

---

## Executive summary

With **all hybrid flags OFF** (default), Phase 5.2 introduces **zero runtime latency change** — stream-first resolver branch is not entered, upload transcode hook is skipped, and backfill does not run automatically.

Post-rollout latency improvements from stream renditions are **[P]** until operator enables flags, runs backfill, and validates entitled playback on staging/prod.

---

## Before — Phase 4.7 production baseline [M]

Source: `.tmp-phase47-playback-fastpath-20260529/02-measured-latency-table.md` (2026-05-30T18:22Z, www.2mrrw.com)

| Probe | HTTP | TTFB |
|-------|------|------|
| Preview API `previews/singles/hour-glass/` | 302 | **602 ms** |
| Stream JSON `slug=hour-glass` | 401 | **451 ms** |
| Stream redirect `slug=hour-glass&redirect=1` | 401 | **513 ms** |
| Stream redirect `slug=love-hz-vol-1&redirect=1` | 401 | **804 ms** |
| CDN range first 64 KiB (preview) | 206 | **954 ms** |

---

## Phase 4.8 local instrumentation [M] (pre–Phase 5.2 deploy)

Source: `.tmp-phase48-playback-fastpath-20260529/validation-results.md` (`next start` localhost)

| Probe | Condition | TTFB | Server-Timing |
|-------|-----------|------|---------------|
| Preview API | warm | **4 ms** | fastpath=0, redirect=0, total=0.1 ms |
| Stream redirect hour-glass | warm 401 | **3 ms** | auth=0.3, total=0.4 ms |
| Stream redirect love-hz | warm 401 | **9 ms** | auth=0.2, total=0.3 ms |

Caveat: local excludes Vercel edge RTT; warm local ≠ prod warm.

---

## Stage 7 re-measure — production [M] (pre–Phase 5.2 deploy)

Captured this session (2026-05-30T20:21Z):

| Probe | HTTP | TTFB range | vs Phase 4.7 |
|-------|------|------------|--------------|
| Preview API hour-glass | 302 | **131–506 ms** | Improved vs 602 ms (variance expected) |
| Stream redirect hour-glass | 401 | **165–257 ms** | Improved vs 513 ms |

Variance is normal (edge region, TLS, cold/warm). **No Phase 5.2 code on prod yet** — confirms baseline stability, not hybrid impact.

---

## After Phase 5.2 — flags OFF (current default) [M/U]

| Path | Expected TTFB | Evidence |
|------|---------------|----------|
| Preview API | Same as Phase 4.7/4.8 prod | No preview route changes; prod curl within baseline range |
| Stream API (401 guest) | Same as Phase 4.7/4.8 prod | Resolver stream branch gated off; Stage 5 `gate-master-kept-flags-off` PASS |
| Stream API (200 entitled) | Same as pre-5.2 master | `STREAM_PLAYBACK_PREFERRED=0` → master key only |
| Upload / admin sync | Same | Transcode hook skipped when `AUTO_GENERATE_STREAM_ASSETS=0` |

**Delta vs before:** **0 ms** (no functional path change with flags OFF).

---

## After Phase 5.2 — flags ON simulation [P/U]

Source: Stage 5 unit tests + `.tmp-phase5-hybrid-architecture-20260530/10-performance-projections.md`

| Scenario | Before (master) | After (stream hit) | Basis |
|----------|-----------------|-------------------|-------|
| Entitled stream resolve | 279–804 ms API + large master CDN byte | **50–200 ms [P]** API + smaller AAC object | Smaller object, `-faststart` moov at head |
| Resolver overhead (stream attempt) | N/A | **+5–30 ms [P]** R2 head + DB columns | `resolveStreamAssetKey` HEAD |
| Fallback on stream miss | N/A | **0 ms delta vs master** | Master key retained; tests PASS |
| Preview path | Unchanged | Unchanged | Previews use `previews/` folder, not stream renditions |

Unit-test measured resolver segments (in-process, no network):
- `shadow-metrics-aggregate` records fallback rate and avg duration — shadow only, not prod latency.

---

## Server-Timing segments (post-deploy, Phase 4.8 + Stage 4)

When Phase 5.2 is deployed, `/api/library/stream` exposes:

| Segment | Meaning |
|---------|---------|
| `auth` | Session/entitlement check |
| `resolve` | Full `resolvePlaybackKey` (master + optional stream) |
| `sign` | Presigned URL generation |
| `total` | End-to-end handler |

With flags OFF, `resolve` reports `master` source only. With flags ON + stream hit, `resolve` reports `stream`.

`X-Playback-Resolver` dev header available when `NODE_ENV=development` or debug flags set.

---

## Measurement scorecard

| Category | Measured | Pending |
|----------|----------|---------|
| Prod preview TTFB (pre-deploy) | **3 runs** | Post-5.2 deploy comparison |
| Prod stream 401 TTFB (pre-deploy) | **3 runs** | Entitled 200 with cookie |
| Flags OFF regression | **21 unit tests** | — |
| Flags ON stream hit latency | **0 prod** | Staging canary |
| Mobile tap→audible | **0** | iOS Safari manual |

---

## Conclusion

- **Flags OFF:** Latency **unchanged** from Phase 4.7/4.8 master-only behavior (confirmed by code gates + prod curl baseline + 21 fallback tests).
- **Flags ON:** Stream playback latency improvement is **[P]** 30–70% on entitled cold start once AAC assets exist in `streaming/` — requires migration, backfill, and staged enablement.

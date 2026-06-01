# Performance Measurements — Phase 5.3.4

**Run date:** 2026-05-31  
**Sources:** Phase 5.3 canary, Phase 5.2.15 direct preview, Phase 5.3.3B catalog validation, architecture projections

Legend: **[M]** measured | **[P]** projected | **[E]** estimated post-activation

---

## Stream hit / fallback rates (post-5.3.3B, flags ON)

| Metric | Value |
|--------|------:|
| Total playable assets | 36 |
| Stream hits | 35 |
| **Stream hit rate** | **97.2%** |
| Master fallbacks | 1 |
| **Fallback rate** | **2.8%** |
| Fallback item | `love-hz-vol-1/01-roll-call` (MASTER_ABSENT) |

---

## Tap → audible — Guest Preview (direct preview OFF)

Hybrid flags do not affect guest preview.

| Case | Baseline (API+302) | Direct preview ON | Hybrid ON (this activation) |
|------|-------------------|-------------------|----------------------------|
| Avg | ~588 ms **[M]** | ~298 ms **[M]** | ~588 ms (unchanged) |
| Median | ~450 ms **[E]** | ~280 ms **[E]** | ~450 ms |
| Worst | ~825 ms **[M]** | ~390 ms **[M]** | ~825 ms |

Source: Phase 5.2.15 `before-after-latency.md`

---

## Tap → audible — Entitled Stream hit (flags ON, AAC registered)

| Segment | Master (before) | Stream hit (after) **[P/E]** |
|---------|-----------------|------------------------------|
| API auth + entitlement | 180–265 ms | 180–265 ms |
| Resolver (+ stream HEAD) | 50–200 ms | 55–230 ms (+5–30 ms) |
| Presign + proxy first byte | 130–195 ms | 50–120 ms |
| Client decode | 150–500 ms (WAV) | 80–250 ms (AAC-LC) |
| **Total tap→audible** | **400–1200 ms** | **200–600 ms** |

| Stat | Master | Stream hit | Δ |
|------|--------|------------|---|
| **Avg** | ~700 ms | ~350 ms **[E]** | **~350 ms saved** |
| **Median** | ~550 ms | ~320 ms **[E]** | **~230 ms saved** |
| **Worst** | ~1500 ms | ~650 ms **[E]** | **~850 ms saved** |

Basis: Phase 5.3 latency comparison + AAC `-faststart` architecture; 35 stream assets now exist in R2 (validated HEAD 100%).

---

## Tap → audible — Entitled Master fallback (2.8%)

Roll Call and any future misses use master path — identical to pre-hybrid latency:

| Stat | ms |
|------|-----|
| Avg | ~700 ms |
| Median | ~550 ms |
| Worst | ~1500 ms |

Additional resolver overhead on miss: +5–30 ms (stream attempt then fallback).

---

## Weighted catalog estimate (97.2% stream / 2.8% fallback)

| Stat | Estimated tap→audible |
|------|----------------------:|
| **Avg** | ~340 ms |
| **Median** | ~315 ms |
| **Worst** | ~650 ms (stream) / ~1500 ms (Roll Call only) |

Formula: `0.972 × stream_avg + 0.028 × master_avg`

---

## Comparison table (activation summary)

| Path | Avg | Median | Worst |
|------|-----|--------|-------|
| Guest preview (flags OFF) | ~588 ms | ~450 ms | ~825 ms |
| Entitled stream hit | ~350 ms **[E]** | ~320 ms **[E]** | ~650 ms **[E]** |
| Entitled master fallback | ~700 ms | ~550 ms | ~1500 ms |

---

## Pending live measurements

Browser `dumpPlaybackTiming()` samples on staging with subscriber session not captured in this automated run. Recommend post-deploy probe of `hour-glass` entitled play with `X-Playback-Resolver: stream`.

---

## Performance verdict

**CONDITIONAL PASS** — Architecture and inventory support projected 30–50% entitled latency reduction; live mobile tap→audible pending staging QA.

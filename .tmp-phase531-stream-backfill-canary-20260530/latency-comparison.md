# Latency Comparison — Phase 5.3.1

**Run date:** 2026-05-31  
**Legend:** **[M]** measured this run | **[P]** projected from Phase 5.3 / architecture

---

## Executive summary

Stream assets are **~4.4–5.9 MB [M]** AAC-LC vs **~30–80 MB [P]** WAV masters — **~85–94% size reduction [P]**. R2 HEAD to stream objects: **93–203 ms [M]**. End-to-end tap→audible improvement for entitled playback on backfilled items is projected at **−200 to −600 ms [P]** vs master-only cold start.

---

## Measured stream objects (R2 HEAD)

| Probe | Stream bytes | HEAD ms | Content-Type |
|-------|-------------|---------|--------------|
| hour-glass | 4,578,043 | 135.5 | audio/mp4 |
| 2-heavy | 5,935,933 | 203.2 | audio/mp4 |
| ad/01-2mrrws-ntro | 4,943,988 | 93.2 | audio/mp4 |

---

## Master vs stream (entitled path)

| Segment | Master (before) | Stream hit (after) | Δ |
|---------|-----------------|-------------------|---|
| Object size | ~30–80 MB WAV [P] | ~4.5–5.9 MB AAC [M] | **−85 to −94% [P/M]** |
| Presign + first byte | 130–195 ms [P] | 50–120 ms [P] | **−80–75 ms [P]** |
| Client decode | 150–500 ms WAV [P] | 80–250 ms AAC [P] | **−70–250 ms [P]** |
| Resolver (+ HEAD) | 50–200 ms | 55–230 ms | +5–30 ms |
| **Tap→audible (cold)** | **400–1200 ms [P]** | **200–600 ms [P]** | **−200–600 ms [P]** |

---

## Before vs after this phase

| State | Stream inventory | Entitled latency |
|-------|------------------|------------------|
| Phase 5.3 (pre-backfill) | 0 registered | Master only; +5–30 ms resolver overhead |
| Phase 5.3.1 (canary) | 8 registered | Stream hit on 8 items; projected benefit above |

---

## Backfill pipeline duration [M]

| Item | Approx wall time | Notes |
|------|------------------|-------|
| hour-glass | ~30 s | First run incl. cold R2 |
| 2-heavy | ~4 min | Large master download + transcode |
| ad/01-2mrrws-ntro | ~2 min | Mixtape track |
| tbh/01-glass-full | ~6.5 min | Long master |

Operator cost is one-time; playback benefit is per-stream.

---

## Methodology

- `scripts/phase531-latency-probe.mjs` — R2 `HeadObject` for stream keys
- Phase 5.3 entitled-path model for master baseline
- Browser tap→audible not captured this run (recommend staging DevTools on `hour-glass` next)

---

## Latency delta (headline)

**Projected entitled tap→audible: −200 to −600 ms [P] on stream hit**  
**Measured R2 stream HEAD: 93–203 ms [M]** (negligible vs download/decode savings)

# Bottleneck Re-Ranking — Post Direct Preview (Phase 5.2.15)

**Prior baseline:** Phase 5.2.7 (`bottleneck-ranking.md`)  
**Change:** Phase 5.2.13 direct preview removes preview API TTFB + 302 redirect for eligible guest plays  
**Measurement:** Phase 5.2.15 curl probes + Phase 5.2.7 decode marks (unchanged)

---

## What moved

| Former rank | Bottleneck | Pre direct-preview (typical ms) | Post direct-preview (typical ms) | Δ |
|-------------|------------|--------------------------------|----------------------------------|---|
| **#2** | API + CDN first byte | **170–580** (+ redirect) | **105–140** (CDN only) | **−290 avg** |
| **#1** | Client decode + src ready | **150–500** | **150–500** | unchanged |
| **#3** | Cross-track fade | **0–300** | **0–300** | unchanged |
| **#4** | Command queue | **1–15** | **1–15** | unchanged |
| **#5** | First-listen swell | **~500 perceived** | **~500 perceived** | unchanged |

---

## Updated TOP 3 (guest preview cold start)

### Rank 1 — Client decode + `waitAudioSrcReady` (~150–500 ms)

| Metric | Value |
|--------|-------|
| Segment | `PLAYBACK_SRC_ASSIGN` → `PLAYBACK_LOADEDDATA` / `PLAYBACK_CANPLAY` |
| Measures | `playback-src-to-loadedmetadata`, `playback-loadedmetadata-to-loadeddata`, `playback-loadeddata-to-canplay` |
| Worst case | **600–800 ms** (Slow 4G, large MP3) |

**Why #1 now:** Network hop removal promotes decode/demux to dominant contiguous block after tap. Same-src repeat still **~0–20 ms**.

---

### Rank 2 — TLS + CDN first byte (~105–210 ms)

| Metric | Value |
|--------|-------|
| Segment | Tap → CDN `responseStart` (direct) |
| Measured (5.2.15) | HEAD avg **118 ms**, p95 **135 ms**, cold worst **208 ms** |
| Mitigation | `PlaybackNetworkHints` preconnect when card visible: **−40–150 ms** |

**Why #2:** Was combined API+redirect (#2 pre-change at 170–580 ms). Now CDN-only; preconnect further shrinks.

---

### Rank 3 — Cross-track fade (conditional, 0–300 ms)

| Metric | Value |
|--------|-------|
| When | Switching tracks while playing |
| Typical | **0 ms** (first play / paused) |
| Active | Up to **~300 ms** intentional UX |

**Why #3:** Unchanged; rarely dominates first tap.

---

## Demoted bottlenecks

| Former rank | Bottleneck | New rank | Notes |
|-------------|------------|----------|-------|
| #2 (API+CDN) | Preview API + 302 | **Removed for canonical guest preview** | Entitled path still has stream API (~250–730 ms) — separate path |
| #4 | Command queue | **#4** | Still 1–15 ms |
| #5 | First-listen swell | **#5** | Perceived, post-audible |

---

## Entitled path (unchanged ranking)

For subscriber/collector/purchase plays, **Rank 1–2 remain**:

1. Client decode (~150–500 ms)
2. `/api/library/stream` + signed URL RTT (~250–730 ms before src assign)

Direct preview flags do not apply.

---

## Summary table

| Rank | Bottleneck | ms (typical) | ms (worst) | Measured how |
|------|------------|--------------|------------|--------------|
| **1** | Client decode + src ready | **150–500** | **600–800** | Dev marks |
| **2** | CDN first byte (direct) | **105–140** | **210** | curl 5.2.15 |
| **3** | Cross-track fade | **0–300** | **300** | Code timing |

**Net guest preview improvement:** ~**290 ms avg** removed from former #2; tap→audible expected **~298 ms** vs **~588 ms** baseline (network + decode estimate).

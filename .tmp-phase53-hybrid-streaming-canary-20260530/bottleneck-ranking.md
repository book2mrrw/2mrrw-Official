# Bottleneck Re-Ranking — Post Hybrid Streaming (Phase 5.3)

**Prior baseline:** Phase 5.2.15 direct preview canary (`bottleneck-ranking.md`)  
**Change:** Phase 5.3 validates hybrid stream path readiness (AAC stream vs master for entitled users)  
**Measurement date:** 2026-05-31

---

## Context

| Path | Pre-hybrid entitled (master) | Post-hybrid (stream hit, projected) | Post-hybrid (today, no assets) |
|------|------------------------------|---------------------------------------|-------------------------------|
| Dominant bottleneck | API + master acquisition | Smaller AAC + faster decode | **Same as pre-hybrid** (master fallback) |

Direct preview already addressed **guest** preview latency (−290 ms avg). Hybrid targets **entitled** latency.

---

## Updated TOP 3 — Entitled playback (cold start)

### Rank 1 — Client decode + `waitAudioSrcReady` (~150–500 ms master / ~80–250 ms [P] AAC)

| Metric | Value |
|--------|-------|
| Segment | `PLAYBACK_SRC_ASSIGN` → `PLAYBACK_CANPLAY` |
| Master (current) | **150–500 ms** typical; **600–800 ms** worst (Slow 4G, WAV) |
| Stream AAC [P] | **80–250 ms** — smaller file, `-faststart` moov at head |
| Same-src repeat | **~0–20 ms** |

**Why #1:** Even with faster network acquisition, decode remains largest client-side block after tap.

**Hybrid impact:** **−70–250 ms [P]** when stream asset served vs WAV master.

---

### Rank 2 — `/api/library/stream` + signed proxy first byte (~250–730 ms master / ~80–250 ms [P] stream)

| Metric | Value |
|--------|-------|
| Segment | Tap → first audio byte through same-origin proxy |
| Master (measured components) | Auth 180–265 ms [M] guest proxy + resolver 50–200 ms + CDN 130–195 ms |
| Stream hit [P] | Auth unchanged; resolver +5–30 ms; CDN **50–120 ms [P]** (smaller Range response) |
| Flags ON, no assets (today) | **250–730 ms** — master fallback + ~5–30 ms overhead |

**Why #2:** Server round-trip + R2 fetch dominates entitled cold start before decode.

**Hybrid impact:** **−100–400 ms [P]** when stream hit; **~0 ms today**.

---

### Rank 3 — Cross-track fade (conditional, 0–300 ms)

| Metric | Value |
|--------|-------|
| When | Switching tracks while playing |
| Typical | **0 ms** (first play / paused) |
| Active | Up to **~300 ms** intentional UX |

**Why #3:** Unchanged from Phase 5.2.15; rarely dominates first tap.

---

## Guest preview TOP 3 (unchanged — direct preview separate)

From Phase 5.2.15 (direct preview ON):

| Rank | Bottleneck | ms (typical) |
|------|------------|--------------|
| 1 | Client decode | 150–500 |
| 2 | CDN first byte (direct) | 105–140 |
| 3 | Cross-track fade | 0–300 |

Hybrid flags **do not affect** guest preview ranking.

---

## Demoted / resolved bottlenecks

| Former rank (entitled) | Bottleneck | Post-hybrid status |
|------------------------|------------|-------------------|
| #2 combined | Large master CDN byte | **Demoted [P]** when AAC stream hit — smaller object |
| N/A | Stream resolver overhead | **New minor cost** +5–30 ms — negligible vs savings |

---

## Summary table — Entitled cold start

| Rank | Bottleneck | ms (typical, master) | ms (typical, stream hit [P]) | Measured how |
|------|------------|----------------------|------------------------------|--------------|
| **1** | Client decode + src ready | **150–500** | **80–250 [P]** | Dev marks |
| **2** | Stream API + proxy TTFB | **250–730** | **80–250 [P]** | curl + Server-Timing (partial) |
| **3** | Cross-track fade | **0–300** | **0–300** | Code timing |

---

## Canary state bottleneck note

**Today (flags ON, no stream assets):**

| Rank | Bottleneck | ms | Notes |
|------|------------|-----|-------|
| 1 | Client decode (master) | 150–500 | Unchanged |
| 2 | Stream API + master proxy | 250–730 | +5–30 ms resolver overhead |
| 3 | Cross-track fade | 0–300 | Unchanged |

**No re-ranking benefit until backfill completes.**

---

## Next measurement milestone

After staging backfill + flags ON:

1. Re-measure entitled `library/stream` TTFB with `X-Playback-Resolver: stream`
2. Compare `dumpPlaybackTiming()` tap→audible vs master rollback
3. Update Rank 1–2 with **[M]** values

**Projected net entitled improvement when stream hits: −200–600 ms tap→audible [P].**

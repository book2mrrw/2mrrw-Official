# Latency Comparison — Hybrid Streaming Canary (Phase 5.3)

**Run date:** 2026-05-31  
**Legend:** **[M]** measured | **[P]** projected from architecture/tests | **[U]** unit-test only

---

## Executive summary

Entitled playback remains the dominant latency path (~250–730 ms API + master acquisition). Hybrid streaming can reduce this **30–70% [P]** once AAC stream assets exist in `streaming/` and resolver hits stream branch.

**Current canary state:** Flags can be enabled safely, but **no latency improvement measurable** — R2 `streaming/` objects return **404**, DB `stream_key` columns are **null**, resolver falls back to master with ~5–30 ms overhead.

---

## Entitled path — before hybrid (master-only)

Source: Phase 5.2.10 entitled-path analysis + Phase 5.2.15 bottleneck ranking

| Segment | Typical ms | Worst ms | Evidence |
|---------|------------|----------|----------|
| `/api/library/stream` auth + entitlement | 180–265 | 265 | **[M]** guest 401 TTFB (proxy for auth stack) |
| `resolvePlaybackKey` (DB + R2 master discovery) | 50–200 | 400+ | Code + Phase 4.8 Server-Timing |
| Presign + proxy first byte (`cdn` segment) | 130–195 | 300+ | **[M]** Phase 5.2.10 CDN probes |
| Client decode (WAV/MP3 master) | 150–500 | 600–800 | Phase 5.2.7 dev marks |
| **Tap→audible (est. cold)** | **400–1200** | **1500+** | Sum of above |

Guest stream 401 probes (www.2mrrw.com, Phase 5.2.10):

| Probe | TTFB |
|-------|------|
| `?slug=hour-glass&redirect=1` | **265 ms** |
| JSON mode | **183 ms** |

---

## Entitled path — after hybrid (stream hit, projected)

Source: Phase 5.2 Stage 7 performance projections + AAC `-faststart` architecture

| Segment | Before (master) | After (stream hit) | Δ |
|---------|-----------------|-------------------|---|
| API handler (auth + entitlement) | 180–265 ms | 180–265 ms | 0 |
| Resolver (+ stream HEAD) | 50–200 ms | 55–230 ms | +5–30 ms |
| Presign + proxy first byte | 130–195 ms (large object) | **50–120 ms [P]** (smaller AAC) | **−80–75 ms [P]** |
| Client decode (AAC-LC m4a) | 150–500 ms (WAV) | **80–250 ms [P]** | **−70–250 ms [P]** |
| **Tap→audible (est. cold)** | **400–1200 ms** | **200–600 ms [P]** | **−200–600 ms [P]** |

Improvement basis:

- AAC 192k m4a ~3–8 MB vs WAV master ~30–80 MB
- `-faststart` moov atom at head → faster `loadedmetadata`
- Same-origin proxy path unchanged (no client contract change)

---

## Entitled path — flags ON today (no stream assets)

| Segment | ms | Notes |
|---------|-----|-------|
| Stream resolver attempt | +5–30 | R2 HEAD → `r2_missing` or `no_stream_registration` |
| Playback asset | Master (unchanged) | Fallback proven in 21/21 tests |
| **Net tap→audible delta** | **~0 to +30 ms** | Overhead only; no benefit |

---

## R2 probes (2026-05-31)

Public CDN bucket (same host as previews):

| Object | HTTP | TTFB |
|--------|------|------|
| `streaming/singles/hour-glass/hour-glass.m4a` | **404** | 223 ms |
| `streaming/singles/hour-glass/hour-glass_192.m4a` | **404** | 110 ms |
| `digital-assets/singles/hour-glass/hour-glass.wav` | **404** | 117 ms |

Masters and streams are served via signed R2 proxy, not public CDN — 404 on public bucket confirms **no stream assets published yet**.

---

## Guest preview path (orthogonal)

Direct preview (Phase 5.2.15) already removed ~290 ms avg from guest preview when enabled. **Hybrid flags do not affect guest preview.**

| Path | Baseline | Direct preview ON | Hybrid flags |
|------|----------|-------------------|--------------|
| Guest preview tap→audible | ~588 ms | ~298 ms | **Unchanged** |

For hybrid-only canary, keep direct preview **OFF** to isolate entitled measurements.

---

## Measurement procedure (staging, post-backfill)

1. Enable hybrid flags on staging
2. Log in as subscriber on staging URL
3. DevTools → Network → `library/stream?slug=hour-glass&redirect=1`
4. Record:
   - TTFB (overall)
   - `Server-Timing`: auth, resolve, sign, cdn
   - `X-Playback-Resolver`: `{ result: "stream", fallbackReason: null }`
5. Compare to same probe with `STREAM_PLAYBACK_PREFERRED=0`
6. Mobile: `dumpPlaybackTiming()` marks for tap→audible

---

## Scorecard

| Measurement | Status |
|-------------|--------|
| Prod guest stream 401 TTFB | **[M]** 183–265 ms |
| Prod entitled stream 200 TTFB | **Not measured** — requires session |
| Stream AAC vs master size delta | **[P]** from architecture |
| Hybrid stream hit TTFB | **Blocked** — no assets |
| Mobile tap→audible hybrid | **Pending** staging QA |

---

## Conclusion

| State | Latency impact |
|-------|----------------|
| Flags OFF (default) | **0 ms** — master-only |
| Flags ON, no assets | **~0 ms** — safe master fallback |
| Flags ON, assets backfilled | **−200–600 ms [P]** entitled cold start |

**Latency delta for canary today: ~0 ms.** Real improvement requires backfill + staging measurement.

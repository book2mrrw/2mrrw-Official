# 09 — Cost Analysis

**Note:** Dollar figures are **projections** unless marked measured. Use for comparative decisions, not finance sign-off.

---

## Storage (R2)

| Item | Current | After hybrid | Δ |
|------|---------|--------------|---|
| Masters (WAV) | Baseline | Same | 0% |
| Stream AAC | — | ~9% of master size per track | **+9% storage** |
| Previews | Baseline | Same (MVP) | 0% |
| HLS segments (5e) | — | +15–25% vs single AAC | optional |

**Example (projection):** 40 MB master + 3.8 MB stream ≈ **+10%** object storage per track.

**Ops cost:** One-time transcode compute (see below).

---

## Bandwidth / CDN egress

| Path | Current | Hybrid | Confidence |
|------|---------|--------|------------|
| Full play (entitled) | ~40 MB WAV via proxy | ~3.8 MB AAC | **High** (−90% bytes) |
| Preview (guest) | ~0.8 MB MP3 | Same MVP | — |
| Repeat play (browser cache) | Variable | Smaller cache footprint | Medium |

**Measured context:** Full preview download **2131 ms** total for ~832 KB (4.7) — stream full track similar magnitude vs 40+ MB master.

**Monthly egress projection:** If 10k full streams/month × 40 MB → 400 TB-month masters vs 38 TB-month streams — **~90% egress reduction** on play path (**Projection**, assumes stream used).

Proxy still terminates at Vercel — smaller bodies reduce function egress + duration charges (**Projection** −20–40% function GB-sec).

---

## Transcoding (one-time + incremental)

| Model | Cost driver |
|-------|-------------|
| Self-hosted FFmpeg batch | Engineer time + CI minutes |
| Cloud transcoding API | ~$0.01–0.05 per minute audio (vendor dependent) |
| Incremental new release | 1 job per entity folder |

**Catalog backfill (projection):** 50 tracks × 4 min × $0.02/min ≈ **$4** API — negligible vs engineering.

---

## Vercel / Next.js functions

| Segment | Impact |
|---------|--------|
| `library/stream` CPU | Similar; less proxy duration with smaller files (**Projection** −10–30% GB-sec) |
| Cold starts | Unchanged |
| Server-Timing | Negligible |

Phase 4.8 warm auth **3–9 ms** — not reduced by hybrid; byte phase is target.

---

## Cloudflare R2 pricing (qualitative)

- Storage: incremental +10% objects
- Class A ops: transcode HEAD/LIST during backfill spike — one-time
- Egress: R2→Cloudflare CDN often $0 within CF; public preview CDN already optimized

---

## Opportunity cost of *not* hybrid

| Cost | Basis |
|------|-------|
| Fan churn from slow tap→audible | Qualitative |
| Mobile data overage perception | Qualitative |
| Higher Vercel proxy bandwidth on masters | **Projection** |

---

## HLS optional (5e)

| Item | Extra cost |
|------|------------|
| Storage | 2–3× single AAC |
| Transcode | packaging ladder |
| Ops complexity | manifest invalidation |

Defer until AAC MVP proves p95 latency target.

---

## Summary table

| Category | Direction | Magnitude |
|----------|-----------|-----------|
| R2 storage | ↑ | Low (+10%) |
| Play egress | ↓ | **High (−80–90%)** |
| Transcode | ↑ one-time | Low |
| Function compute | ↓ | Medium |
| Engineering | ↑ initial | 2–4 weeks implementation |

**ROI hypothesis:** Egress + fan experience gains exceed +10% storage (**Projection**, **Medium confidence**).

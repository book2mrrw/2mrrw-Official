# 10 — Cost Analysis

**Note:** Dollar figures are **projections** unless marked measured. Catalog size from Phase 5.1 inventory (36 entity folders).

---

## Storage (R2)

### Current (estimated)

| Layer | Calculation | Total |
|-------|-------------|------:|
| Masters (WAV, 36 × 35.3 MB) | 36 × 35.3 MB | **1.27 GB** |
| Previews | 34 MP3 + 2 WAV clips | **~78 MB** |
| Images + video | 9 releases | **~25–80 MB** |
| **Current subtotal** | | **~1.35–1.43 GB** |

### After hybrid (estimated)

| Layer | Calculation | Δ |
|-------|-------------|---|
| Masters | Unchanged | 0% |
| Stream AAC (36 × 3.28 MB) | 36 × 3.28 MB | **+118 MB (+9%)** |
| Previews | Unchanged MVP | 0% |
| HLS (5e optional) | +15–25% vs single AAC | deferred |
| **Hybrid subtotal** | | **~1.47–1.55 GB** |

**Label:** All storage totals **estimated** (no live R2 byte census).

---

## Bandwidth / CDN egress

### Per full play (4 min track, estimated)

| Asset | Size | Egress per play |
|-------|-----:|----------------:|
| WAV master | 35.3 MB | 35.3 MB |
| AAC 128 stream | 3.28 MB | 3.28 MB |
| Preview MP3 (~90 s) | 1.41 MB | 1.41 MB |

**Savings per entitled full play:** ~**91%** bytes (35.3 → 3.28 MB).

### Monthly scenarios (projection)

| Scenario | Plays/mo | Master egress | Stream egress | Savings |
|----------|--------:|--------------:|--------------:|--------:|
| **Best** (low traffic) | 1,000 | 35 TB | 3.3 TB | 31.7 TB |
| **Expected** | 10,000 | 353 TB | 33 TB | 320 TB |
| **Worst** (viral drop) | 50,000 | 1,765 TB | 165 TB | 1,600 TB |

*Assumes average 35.3 MB master per play; actual mix varies by track length.*

### Measured context

| Signal | Value | Source |
|--------|-------|--------|
| Full preview download | 2131 ms total, ~832 KB | **Measured** Phase 4.7 |
| CDN range TTFB | 954 ms (64 KiB) | **Measured** Phase 4.7 |

Stream full-track download magnitude similar to preview total time vs 40+ MB master — **projection**.

### Vercel function egress

Same-origin proxy (`r2-stream-proxy.js`) terminates smaller bodies:

| Impact | Projection |
|--------|------------|
| Proxy duration | −10–30% GB-sec |
| Function egress | −80–90% on play path |

Phase 4.8 warm auth (3–9 ms) unchanged — hybrid targets byte phase.

---

## Transcoding (one-time + incremental)

| Model | Cost driver | Estimate |
|-------|-------------|----------|
| Self-hosted FFmpeg | Engineer time + CI | 2–4 dev-days backfill |
| Cloud API | ~$0.01–0.05/min audio | 36 tracks × 3.5 min × $0.02 ≈ **$2.50** |
| Per new release | 1 job per entity | ~$0.07/release |

**Catalog backfill compute:** Negligible vs engineering (**projection**).

### FFmpeg reference (implementation)

```bash
ffmpeg -i master.wav -c:a aac -b:a 128k -movflags +faststart out.m4a
```

---

## Cloudflare R2 (qualitative)

| Line item | Direction | Notes |
|-----------|-----------|-------|
| Storage | ↑ ~9% | +118 MB stream layer |
| Class A ops (LIST/HEAD) | ↑ one-time spike | Backfill discovery |
| Egress R2→CF CDN | ↓ on play path | Smaller objects |
| Public preview CDN | → | Unchanged |

---

## Operational cost

| Item | Estimate |
|------|----------|
| Implementation engineering | 2–4 weeks |
| Ongoing transcode per release | ~15 min ops (automated target: 0) |
| Monitoring / diagnostics | Existing Server-Timing |
| Dual-maintenance period | 90 days stream + master |

---

## Opportunity cost of *not* hybrid

| Cost | Basis |
|------|-------|
| Fan friction on tap→audible | Phase 4.5/4.7 latency audits |
| Mobile data perception | Large WAV over cellular |
| Vercel proxy bandwidth on masters | **Projection** |
| Competitive playback UX | Industry AAC norm |

---

## HLS optional (Phase 5e)

| Item | Extra cost |
|------|------------|
| Storage | 2–3× single AAC per track |
| Transcode | Packaging ladder |
| Ops | Manifest invalidation |

**Defer** until AAC MVP proves p95 latency target.

---

## Summary

| Category | Direction | Magnitude | Confidence |
|----------|-----------|-----------|------------|
| R2 storage | ↑ | Low (+9%) | Medium |
| Play egress | ↓ | **High (−91%)** | High (arithmetic) |
| Transcode | ↑ one-time | Low ($) | Medium |
| Function compute | ↓ | Medium | Medium |
| Engineering | ↑ initial | 2–4 weeks | High |

**ROI hypothesis:** Egress + playback UX gains exceed +9% storage (**projection**, medium confidence).

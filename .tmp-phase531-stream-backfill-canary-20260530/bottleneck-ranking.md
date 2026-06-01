# Bottleneck Ranking — Phase 5.3.1

**Run date:** 2026-05-31  
**Post-backfill entitled path (stream hit)**

---

## Ranked bottlenecks (backfilled entitled playback)

| Rank | Bottleneck | Typical ms | Notes |
|------|------------|------------|-------|
| 1 | Auth + entitlement (`/api/library/stream`) | 180–265 [P] | Unchanged by stream |
| 2 | Client AAC decode + buffer | 80–250 [P] | Down from WAV 150–500 ms |
| 3 | Presign + proxy first byte | 50–120 [P] | Smaller object vs master |
| 4 | `resolvePlaybackKey` + stream HEAD | 55–230 [P] | +5–30 ms vs master-only resolver |
| 5 | R2 stream HEAD alone | 93–203 [M] | Subset of resolver |

---

## Removed / reduced vs master-only

| Former bottleneck | Before | After stream hit |
|-------------------|--------|------------------|
| Large master download | 30–80 MB | ~4.5–5.9 MB [M] |
| WAV decode latency | High | AAC-LC + faststart |
| `no_stream_registration` fallback | 100% catalog | 78% catalog remaining |

---

## Backfill operator bottlenecks

| Rank | Bottleneck | Impact |
|------|------------|--------|
| 1 | Master download size | 2-heavy ~4 min transcode wall |
| 2 | ffmpeg availability | Requires PATH or `FFMPEG_PATH` |
| 3 | Missing masters | Blocks per-item registration |
| 4 | CLI filter semantics | Risk of over-backfilling products |

---

## Next optimization (out of scope)

1. Fix `--album-slug` to skip unrelated products
2. Repair `love-hz-vol-1` master paths
3. Staging browser tap→audible measurement
4. Gradual track backfill (28 remaining)

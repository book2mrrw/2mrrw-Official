# Stream Inventory — Phase 5.3.1 Canary

**Run date:** 2026-05-31  
**Codec:** AAC-LC 192 kbps, `-movflags +faststart`, container `.m4a`  
**R2 prefix:** `streaming/`  
**Masters:** Unmodified in `digital-assets/`

---

## Created objects (8)

| # | Entity | Type | Stream key | Approx size |
|---|--------|------|------------|-------------|
| 1 | hour-glass | Single | `streaming/singles/hour-glass/hour-glass_192.m4a` | 4.58 MB |
| 2 | 2-heavy | Feature | `streaming/features/2-heavy/2-heavy_192.m4a` | 5.94 MB |
| 3 | artificial | Single | `streaming/singles/artificial/artificial_192.m4a` | — |
| 4 | i-dont-believe-you | Feature | `streaming/features/i-dont-believe-you/i-dont-believe-you_192.m4a` | — |
| 5 | turnt-me-2-dis | Single | `streaming/singles/turnt-me-2-dis/turnt-me-2-dis_192.m4a` | — |
| 6 | w2d | Single | `streaming/singles/w2d/w2d_192.m4a` | — |
| 7 | ad / 01-2mrrws-ntro | Mixtape track | `streaming/mixtapes-and-eps/ad/01-2mrrws-ntro/01-2mrrws-ntro_192.m4a` | 4.94 MB |
| 8 | tbh / 01-glass-full | Mixtape track | `streaming/mixtapes-and-eps/tbh/01-glass-full/01-glass-full_192.m4a` | — |

Sizes measured via R2 `HeadObject` for probes 1, 2, 7; others confirmed via successful upload + resolver HEAD hit.

---

## Intended canary selection (5)

| Role | Selection | Result |
|------|-----------|--------|
| Single | `hour-glass` | ✅ |
| Feature | `2-heavy` | ✅ |
| Mixtape/EP | `ad/01-2mrrws-ntro` | ✅ |
| Mixtape/EP (alt) | `tbh/01-glass-full` | ✅ |
| Multi-track EP | `love-hz-vol-1/01-roll-call` | ❌ master not in R2 |

---

## Failed / skipped

| Entity | Error | Notes |
|--------|-------|-------|
| `love-hz-vol-1/01-roll-call` | `master_not_found` | `storage_path` present in DB but no WAV/FLAC under entity folder |

---

## Checkpoint

File: `.backfill-stream-canary-phase531.json`  
Completed: 8 | Failed: 1

---

## Generation pipeline

```
master (digital-assets/) → download → ffmpeg AAC-LC 192k +faststart → upload streaming/ → DB register
```

**ffmpeg:** `FFMPEG_PATH=node_modules/ffmpeg-static/ffmpeg` (system `ffmpeg` not on PATH).

# 01 — Media Inventory

**Date:** 2026-05-30  
**Source:** `src/lib/media/canonical-catalog.js`, `canonical-paths.js`  
**R2 live listing:** **Unavailable** (no credentials in audit environment; no destructive/list probe run)

---

## Catalog counts (code-derived, exact)

| Category | Count | Source |
|----------|------:|--------|
| Singles | 4 | `CANONICAL_SINGLES` |
| Features | 2 | `CANONICAL_FEATURES` |
| Mixtapes & EPs (releases) | 3 | `CANONICAL_MIXTAPES_AND_EPS` |
| True albums | 0 | `CANONICAL_TRUE_ALBUMS` |
| Album/mixtape tracks | 30 | `CANONICAL_TRACKS` (10 + 11 + 9) |
| **Master audio entity folders** | **36** | 4 + 2 + 30 |
| Preview entity folders | 36 | One per playable entity |
| Slug aliases | 1 | `love-hz` → `love-hz-vol-1` |

### Release inventory

| Slug | Type | Tracks | Preview ext (catalog) |
|------|------|-------:|-------------------------|
| hour-glass | single | 1 | mp3 |
| turnt-me-2-dis | single | 1 | mp3 |
| w2d | single | 1 | mp3 |
| artificial | single | 1 | mp3 |
| i-dont-believe-you | feature | 1 | wav |
| 2-heavy | feature | 1 | wav |
| love-hz-vol-1 | ep | 10 | mp3 (per-track) |
| ad | mixtape | 11 | mp3 (per-track) |
| tbh | mixtape | 9 | mp3 (per-track) |

**Overlap note:** `w2d`, `artificial`, `hour-glass`, and `turnt-me-2-dis` exist as both standalone singles **and** album tracks on `love-hz-vol-1` / `tbh`. Hybrid migration must transcode **each entity folder** independently (up to 40 master folders if all singles + all tracks populated in R2).

---

## Format inventory

### Measured

| Signal | Value | Source |
|--------|-------|--------|
| Master discovery order | `.wav` → `.flac` → `.m4a` → `.mp3` | `entity-resolver.js` L16 |
| Preview CDN sample (hour-glass) | ~832 KB MP3 | Phase 4.7 measured |
| CDN range TTFB (64 KiB preview) | 954 ms | Phase 4.7 measured |

### Estimated (no live R2 format census)

| Format | Master count | Preview count | Assumption |
|--------|-------------:|--------------:|------------|
| WAV | 28–36 | 2 (features) | Resolver prefers WAV; features use WAV previews in catalog |
| FLAC | 0–8 | 0 | Fallback if WAV absent |
| MP3 | 0–8 | 34 | Singles + album track previews |
| M4A (stream) | **0 today** | 0 | Proposed layer — not in bucket yet |

**Confidence:** Format split is **estimated** until R2 `ListObjectsV2` inventory script runs against `digital-assets/` and `previews/`.

---

## Storage estimates

### Assumptions (explicit)

| Parameter | Value | Label |
|-----------|-------|-------|
| Average track duration | 210 s (3.5 min) | **Estimated** |
| WAV PCM 44.1 kHz / 16-bit stereo | 176,400 B/s | Arithmetic |
| FLAC compression vs WAV | 55% | **Estimated** industry typical |
| AAC-LC stream bitrate | 128 kbps CBR | Phase 5 design |
| Preview clip duration | 90 s | **Estimated** |
| Preview MP3 bitrate | 128 kbps | **Estimated** |

### Per-object size formulas

```
WAV_bytes   = 44100 × 2 × 2 × duration_sec
FLAC_bytes  = WAV_bytes × 0.55
AAC_bytes   = (128 × 1024 / 8) × duration_sec
Preview_MP3 = (128 × 1024 / 8) × 90
Preview_WAV = 44100 × 2 × 2 × 90
```

### Per-track calculations (210 s full master)

| Format | Calculation | Size |
|--------|-------------|-----:|
| WAV master | 44100 × 2 × 2 × 210 | **35.3 MB** |
| FLAC master | 35.3 × 0.55 | **19.4 MB** |
| AAC stream | (128×1024/8) × 210 | **3.28 MB** |
| MP3 preview (90 s) | (128×1024/8) × 90 | **1.41 MB** |
| WAV preview (90 s) | 44100 × 2 × 2 × 90 | **15.1 MB** |

### Catalog totals (36 entity folders, WAV masters assumed)

| Layer | Formula | Total | Label |
|-------|---------|------:|-------|
| Masters (WAV) | 36 × 35.3 MB | **1.27 GB** | **Estimated** |
| Masters (80% WAV / 20% FLAC) | (28×35.3)+(8×19.4) MB | **1.14 GB** | **Estimated** |
| Previews | (34×1.41)+(2×15.1) MB | **78 MB** | **Estimated** |
| Stream renditions (proposed) | 36 × 3.28 MB | **118 MB** | **Estimated** |
| **Current total (masters + previews)** | | **~1.35 GB** | **Estimated** |
| **After hybrid (+ streams)** | | **~1.47 GB** | **Estimated** (+9%) |

### Streaming footprint projections

| Scenario | Monthly full plays | Egress (masters WAV) | Egress (AAC stream) | Savings |
|----------|-------------------:|---------------------:|--------------------:|--------:|
| Low | 1,000 | 35.3 TB | 3.3 TB | **−91%** |
| Expected | 10,000 | 353 TB | 33 TB | **−91%** |
| High | 50,000 | 1,765 TB | 165 TB | **−91%** |

*Assumes one full play per stream event, 35.3 MB WAV vs 3.28 MB AAC per play, 36-track average — scale linearly.*

### Images & video (out of stream scope, inventory only)

| Type | Entity folders | Est. per release | Est. total |
|------|---------------:|-----------------:|-----------:|
| Cover images | 9 releases | 0.5–2 MB JPEG | **5–18 MB** |
| Motion loops (singles) | 4 | 5–15 MB MP4 | **20–60 MB** |

---

## Entity path examples

| Entity | Master folder (`digital-assets/`) | Proposed stream (`streaming/`) |
|--------|-----------------------------------|--------------------------------|
| Single | `singles/hour-glass/` | `singles/hour-glass/hour-glass.m4a` |
| Feature | `features/i-dont-believe-you/` | `features/i-dont-believe-you/i-dont-believe-you.m4a` |
| Album track | `mixtapes-and-eps/love-hz-vol-1/01-roll-call/` | `mixtapes-and-eps/love-hz-vol-1/01-roll-call/01-roll-call.m4a` |

Built by `resolveStoragePath()` in `src/lib/media/canonical-paths.js` L72–88.

---

## R2 inventory gap

**Action for Phase 5b:** Run read-only `listR2Objects('digital-assets/', { recursive: true })` via admin diagnostics or one-off script to replace estimates with measured format counts and byte totals. This audit did **not** execute live listing to honor analysis-only scope without env credentials.

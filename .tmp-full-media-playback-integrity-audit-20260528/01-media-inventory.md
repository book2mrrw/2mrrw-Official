# 01 — Media inventory

**Audit date:** 2026-05-29  
**Sources:** `src/lib/commerce/catalog.js`, `src/app/page.js` (INLINE_*), `scripts/migrate-r2-bucket.mjs`, `storage/digital-assets.manifest.json`

## Canonical R2 layout (source of truth)

| Prefix | Purpose |
|--------|---------|
| `digital-assets/singles/` | Single + feature full masters |
| `digital-assets/features/` | **Not used in code** — canonical stores features under `singles/` |
| `digital-assets/albums/` | Album masters (Control System / future) |
| `digital-assets/mixtapes-and-eps/` | **No `src/` references** |
| `previews/` | Public preview audio |
| `images/`, `videos/singles/` | Cover art, motion loops |

## Streamable catalog (digital audio)

| Slug | Type | Preview (storefront path → R2) | Full master (`storage_path` / resolved key) |
|------|------|----------------------------------|-----------------------------------------------|
| `hour-glass` | single | `/audio/previews/hourglass-preview.mp3` → `previews/hourglass-preview.mp3` | `singles/hour-glass/audio.mp3` → `digital-assets/singles/hour-glass/audio.mp3` |
| `w2d` | single | `previews/w2d-preview.mp3` | `digital-assets/singles/w2d/audio.mp3` |
| `artificial` | single | `previews/artificial-preview.mp3` | `digital-assets/singles/artificial/audio.mp3` |
| `turnt-me-2-dis` | single | `previews/turntme2dis-preview.mp3` | `digital-assets/singles/turnt-me-2-dis/audio.mp3` |
| `i-dont-believe-you` | feature | `previews/i-dont-believe-you-preview.wav` | `digital-assets/singles/i-dont-believe-you/audio.wav` |
| `2-heavy` | feature | `previews/2-heavy-preview.wav` | `digital-assets/singles/2-heavy/audio.wav` |

## Albums (inline only — no `storage_path` in seed)

| Slug | Tracks (title strings) | Notes |
|------|------------------------|-------|
| `tbh` | 8 titles | Playback via `resolvePlaybackKey` → `content_id` / `media_assets` |
| `ad` | 10 titles | Same |
| `love-hz` | 6 titles | Same |

## Non-audio catalog rows

Vinyl, vault cards, merch (`hoodie`, `shirt`, `hat`) — no stream keys in `PRODUCT_CATALOG`.

## Migration manifest keys (`scripts/migrate-r2-bucket.mjs`)

Lists 12 audio keys (4 single MP3 masters, 2 feature WAV masters, 6 previews) plus images/videos — aligns with table above.

## UI duplicate definitions

- **Commerce seed:** `src/lib/commerce/catalog.js` (`PRODUCT_CATALOG`)
- **Home inline:** `src/app/page.js` (`singles`, `features`, `albums`, `radioSlides`)
- Both must stay aligned on slug + preview paths; albums exist only in `page.js` for track lists.

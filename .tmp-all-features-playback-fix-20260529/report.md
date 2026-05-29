# All Features Playback Fix — 2026-05-29

Extends commit `6637a3a` (i-dont-believe-you preview API routing) to **all** canonical Features catalog tracks via generic catalog/path resolution — no slug-specific hacks.

## Feature slugs (CANONICAL_FEATURES)

| Slug | Title | release_type (product) | R2 folder segment |
|------|-------|------------------------|-------------------|
| `i-dont-believe-you` | I Don't Believe You | `feature` → `features` | `features/` |
| `2-heavy` | 2 Heavy | `feature` → `features` | `features/` |

## Per-slug status

| Slug | preview_path | preview_legacy | storage_path | mergeCanonical + withR2 | R2 audio | R2 preview folder | R2 legacy flat |
|------|--------------|----------------|--------------|-------------------------|----------|-------------------|----------------|
| `i-dont-believe-you` | `previews/features/i-dont-believe-you/` | `previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav` | `features/i-dont-believe-you/` | ✅ page.js + FeaturesRail + music-playback | ✅ `digital-assets/features/i-dont-believe-you/` | ❌ empty | ❌ not in bucket |
| `2-heavy` | `previews/features/2-heavy/` | `previews/features/2-heavy/2-heavy-preview.wav` | `features/2-heavy/` | ✅ same generic path | ✅ `digital-assets/features/2-heavy/` | ❌ empty | ❌ not in bucket |

## 2-heavy before / after

| Kind | Before | After |
|------|--------|-------|
| page.js inline preview | `/audio/previews/2-heavy-preview.wav` | `previews/features/2-heavy/` |
| Resolved client URL | Flat CDN `…/previews/2-heavy-preview.wav` (404) | `/api/media/preview?folder=previews/features/2-heavy/&legacy=previews/features/2-heavy/2-heavy-preview.wav` |
| storage_path (DB/catalog) | `digital-assets/singles/2-heavy/audio.wav` (legacy) | `features/2-heavy/` → `digital-assets/features/2-heavy/` |
| Preview error UX | Watchdog / retry loops | `Preview unavailable` (graceful) |
| music-playback priority | `preview` before `preview_path` | `preview_path` before `preview` |

## Code fixes (this commit)

| File | Change |
|------|--------|
| `src/lib/music-playback.js` | Prefer `preview_path` in `normalizeCatalogItemForPlayback` + `resolveCatalogPlaybackItem` (all features) |
| `src/components/home/FeaturesRail.js` | Apply `withR2CatalogMedia` per card (canonical merge + discovery API URLs) |
| `scripts/seed-products.mjs` | Use `getProductCatalog()`; seed entity-folder paths + catalog_tracks |
| `scripts/verify-r2-entity-folders.mjs` | Feature `preview_legacy` → entity-folder keys |
| `scripts/migrate-r2-bucket.mjs` | Add canonical feature entity keys (keep flat legacy keys) |

## Inherited from 6637a3a (already on branch)

- `src/lib/media-urls.js` — flat preview → `/api/media/preview` + entity folder
- `src/app/api/media/preview/route.js` — legacy candidate chain + R2 HEAD verify
- `src/context/AudioContext.js` — block flat CDN previews; graceful unavailable
- `src/app/page.js` — both features use `previews/features/{slug}/`

## R2 upload checklist (ops)

Upload **at least one** preview per slug (preferred = entity folder):

### i-dont-believe-you
- [ ] `previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav` **(preferred)**
- [ ] `previews/i-dont-believe-you-preview.wav` (legacy flat fallback)
- [x] `digital-assets/features/i-dont-believe-you/*.wav` — present (`I Don't Believe You ft. 2mrrw.wav`)

### 2-heavy
- [ ] `previews/features/2-heavy/2-heavy-preview.wav` **(preferred)**
- [ ] `previews/2-heavy-preview.wav` (legacy flat fallback)
- [x] `digital-assets/features/2-heavy/*.wav` — present (`2 Heavy ft. 2mrrw .wav`)

Verify after upload:
```bash
node scripts/verify-r2-entity-folders.mjs --json
```

## Build

`npm run build` — ✅ passed (Next.js 16.2.4)

## User test checklist

- [ ] Guest: play **2 Heavy** → preview API request (not flat CDN); unavailable if R2 preview missing
- [ ] Guest: play **I Don't Believe You** → same behavior as 2-heavy
- [ ] Entitled user: stream resolves `digital-assets/features/{slug}/` master
- [ ] Network tab: `/api/media/preview?folder=previews/features/{slug}/` for both features

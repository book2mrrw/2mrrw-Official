# 09 — Image Optimization (Compression, CDN, Duplicate Requests)

## CDN architecture

**Public media:** Cloudflare R2 via `NEXT_PUBLIC_R2_PUBLIC_URL` / fallback CDN base  
**Files:** `src/lib/storage/r2-public-cdn.js`, `src/lib/media-urls.js`

**Helpers:**
- `catalogCoverUrl()` — cover display normalization
- `catalogPublicMediaUrl()` — generic public paths
- `catalogVisualMediaUrl()` — visual assets

**Signed/protected:** `/api/media/visual`, `/api/media/preview`, `/api/library/stream` — not CDN-public.

## Client image pipeline

**File:** `src/media/imagePipeline/ImagePipeline.js`

Features:
- Priority queue (`priorityQueue.js`)
- In-memory cache (`cache.js`)
- `decoding="async"` on Image elements
- `<link rel="preload" as="image">` hints for critical covers
- Explicitly **skips** video URLs (L7–11)

**CoverArt:** triggers preload on every src change (`src/components/ui/CoverArt.js` L29–33).

## Format support

Entity resolver discovers: `.jpg`, `.jpeg`, `.png`, `.webp` (`entity-resolver.js` L17)  
No AVIF/srcset generation in codebase — single URL per cover.

## Duplicate request patterns

1. **Poster + video** on singles cards — poster image + video first frame
2. **imagePipeline.preload + `<img src>`** — pipeline dedupes via cache, but first paint may double-fetch without cache hit
3. **MediaSession artwork** — separate resolution path (`src/lib/media-session-artwork.js`)
4. **Background ambience** — CSS `backgroundImage: url(...)` duplicates img fetch if same cover

## Next.js Image

No `next/image` usage detected in audited storefront components — raw `<img>` and CSS backgrounds.  
**Tradeoff:** No automatic srcset/format negotiation; full resolution always fetched.

## Placeholders

`getArtworkPlaceholderUrl()` in canonical paths — used when cover missing (`catalogMedia.js` L22–31).

## Findings

1. **No responsive images** — mobile loads desktop-sized covers.
2. **WebP in resolver but no format negotiation** — serves whatever exists in R2 folder.
3. **Image pipeline is well-structured** — priority queue + cache are strengths to extend, not replace.
4. **Link preload hints** may accumulate — `cancelHints()` exists but usage sparse.

## Validation checklist

- [ ] Sample 5 cover URLs — bytes transferred at 375px display width
- [ ] Network: duplicate requests for same cover URL on Home load
- [ ] Compare WebP vs JPEG sizes in R2 for same release

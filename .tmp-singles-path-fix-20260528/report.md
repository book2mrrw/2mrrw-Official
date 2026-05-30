# Singles media path fix — 2026-05-28

**Scope:** Include `releaseSlug` entity folder in singles media path resolution. Minimal diff — no UI/page.js edits.

---

## 1. Root cause (broken file + line)

| File | Line(s) | Bug |
|------|---------|-----|
| `src/lib/media/canonical-paths.js` | 176 (old) | `legacyCoverPublicPath` built flat `images/singles/hourglass.jpg` — stripped hyphens from slug, **skipped** `hour-glass/` folder |
| `src/lib/media/canonical-paths.js` | 207–209 (old) | `legacyVideoPublicPath` built flat `videos/singles/hourglass.mp4` — same skip |
| `src/lib/media/constants/storage-domains.js` | 5 (old) | `PREVIEW_ROOT = "previews"` — R2 bucket uses `audio/{releaseType}/{releaseSlug}/` |
| `src/lib/media/canonical-catalog.js` | 358–366 (old) | `mergeCanonicalMetadata` preferred inline `page.js` flat paths over canonical discovery URLs |
| `src/lib/media/r2-catalog-media.js` | 11 (old) | `withR2CatalogMedia` never called `mergeCanonicalMetadata` — singles carousel bypassed canonical path builders |

Albums/features were unaffected because they already used nested `{releaseSlug}/{trackSlug}/` in `nestedCollectionFolder()` and DB `storage_path` values.

---

## 2. Before / after keys — `hour-glass` single

| Domain | Before (broken) | After (correct) |
|--------|-----------------|-----------------|
| Artwork entity folder | `images/singles/` (flat filename) | `images/singles/hour-glass/` |
| Artwork legacy fallback | `images/singles/hourglass.jpg` | `images/singles/hour-glass/hourglass.jpg` |
| Video entity folder | `videos/singles/` (flat) | `videos/singles/hour-glass/` |
| Video legacy fallback | `videos/singles/hourglass.mp4` | `videos/singles/hour-glass/hourglass.mp4` |
| Preview entity folder | `previews/singles/hour-glass/` | `audio/singles/hour-glass/` |
| Preview legacy fallback | `previews/hourglass-preview.mp3` | `audio/singles/hour-glass/hourglass-preview.mp3` |
| Storefront visual URL | CDN flat key or `/images/singles/hourglass.jpg` | `/api/media/visual?releaseType=singles&slug=hour-glass&legacyVideo=videos/singles/hour-glass/hourglass.mp4&legacyImage=images/singles/hour-glass/hourglass.jpg` |
| Storefront preview URL | `/audio/previews/hourglass-preview.mp3` → CDN `previews/hourglass-preview.mp3` | `/api/media/preview?folder=audio/singles/hour-glass/&legacy=audio/singles/hour-glass/hourglass-preview.mp3` |

**R2 canonical keys (production target):**

```
images/singles/hour-glass/hourglass.jpeg
videos/singles/hour-glass/hourglass.mp4
audio/singles/hour-glass/hourglass-preview.mp3
```

Folder slug `hour-glass` and filename stem `hourglass` remain distinct — not collapsed.

---

## 3. Fix applied (minimal)

1. **`PREVIEW_ROOT` → `audio`** — aligns `resolvePreviewPath` with R2 bucket layout.
2. **`legacyCoverPublicPath` / `legacyVideoPublicPath`** — singles now emit `{domain}/singles/{releaseSlug}/{legacyStem}.{ext}`; optional `legacy_cover_stem` / `legacy_video_stem` on catalog rows for mismatched stems (e.g. turnt cover vs turntme2dis video).
3. **`CANONICAL_SINGLES` preview_legacy** — updated to entity-folder keys under `audio/singles/{slug}/`.
4. **`mergeCanonicalMetadata`** — canonical discovery URLs win over inline flat `page.js` paths.
5. **`withR2CatalogMedia`** — calls `mergeCanonicalMetadata` before CDN resolution so singles carousel uses folder discovery without editing protected `page.js`.

---

## 4. Files changed

| File | Change |
|------|--------|
| `src/lib/media/constants/storage-domains.js` | `PREVIEW_ROOT = "audio"` |
| `src/lib/media/canonical-paths.js` | Entity-folder legacy paths; preview public path handles `audio/` |
| `src/lib/media/canonical-catalog.js` | Singles legacy stems + entity preview keys; merge order fix |
| `src/lib/media/r2-catalog-media.js` | Merge canonical metadata before R2 URL resolution |
| `src/lib/media-urls.js` | Pass-through `/api/media/*` discovery URLs; direct `audio/` CDN keys |

---

## 5. Build verification

```
npm run build — ✓ success (Next.js 16.2.4)
```

No TypeScript or compile errors introduced.

---

## 6. Recommended R2 CORS for www.2mrrw.com (document only)

Apply in Cloudflare R2 bucket → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": [
      "https://www.2mrrw.com",
      "https://2mrrw.com",
      "https://artist-platform-silk.vercel.app",
      "https://2mrrw-official.vercel.app",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": [
      "Range",
      "Content-Type",
      "Authorization",
      "Origin",
      "Accept"
    ],
    "ExposeHeaders": [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "Content-Type",
      "ETag",
      "Last-Modified"
    ],
    "MaxAgeSeconds": 86400
  }
]
```

No wrangler R2 CORS config exists in repo — configure via Cloudflare dashboard only.

---

## 7. Summary checklist

| Item | Status |
|------|--------|
| releaseSlug folder in all singles path builders | **Fixed** |
| PREVIEW domain aligned to R2 `audio/` | **Fixed** |
| page.js inline singles bypass canonical paths | **Fixed via merge in withR2CatalogMedia** |
| Filename vs folder slug kept distinct | **Yes** (`hour-glass/` + `hourglass.*`) |
| Features / albums regression risk | **Low** — features legacy paths unchanged; albums use nested DB paths |
| Flat `previews/*.mp3` still in bucket | Legacy fallback via `previews/` prefix in `legacyPreviewPublicPath` |
| Build | **Pass** |
| Commit message | `fix(media): include releaseSlug folder in singles media path resolution` |

### Remaining risks

- R2 objects must exist under entity folders (`images/singles/hour-glass/hourglass.jpeg`, etc.). Discovery API falls back to legacy keys if folder listing is empty.
- Feature preview legacy keys still use flat `previews/{slug}-preview.wav` — unchanged (features reported working).
- Supabase migration rows may still reference `previews/singles/` — runtime canonical catalog overrides for storefront singles.

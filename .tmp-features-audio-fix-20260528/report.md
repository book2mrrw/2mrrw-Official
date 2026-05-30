# Features section audio fix — 2026-05-28

## Prompt requirements

1. Audit `resolvePlaybackSrc`, `catalogPreviewAudioUrl`, `withR2CatalogMedia` for `releaseType = features`
2. Audit Features rail play path (`FeaturesRail` → `ReleaseCardActions` → `toPlaybackTrack` / `playQueue`)
3. Minimum fix — no UI redesign, no AudioContext rewrite, no auth OTP changes
4. Preserve entity-folder paths, `normalizeReleaseType`, site-api-url (b72a707), entitlement `feature` in `isDigitalProduct` (a6929c0), incomplete media tolerance, features→singles fallback in `resolve-playback-key`
5. `npm run build` passes
6. Deliverable zip at `/Users/recharge/Downloads/features-audio-fix-20260528.zip`

## Root cause

**Server stream resolver treated features as singles when product metadata was thin.**

| Layer | Singles (working) | Features (broken) |
|-------|-------------------|-------------------|
| Client preview | `previews/singles/{slug}/` via canonical merge + `/api/media/preview` | Same pipeline when `mergeCanonicalMetadata` runs (`displayFeatures`) |
| Guest `resolvePlaybackSrc` | Preview discovery URL | Preview discovery URL (OK after `displayFeatures`) |
| Entitled `/api/library/stream` | `resolvePlaybackKey` → `digital-assets/singles/{slug}/` | **`resolvePlaybackKey` preview fallback used `content_type \|\| "single"`** when `metadata.release_category` missing → `previews/singles/{slug}/` (404) while R2 has `previews/features/{slug}/` |
| Products select | N/A | **`preview_path` column omitted from Supabase select** — DB preview folder never used as legacy fallback |

Secondary (already fixed on branch): `isDigitalProduct` omitted `product_type: "feature"` → entitled clients got `/api/library/stream` but server returned **403** (`entitlements.js` includes `feature` since prior fix).

## Fix applied

**`src/lib/playback/resolve-playback-key.js`**

- Select `product_type` and `preview_path` from `products`
- Add `inferProductReleaseType()` — `metadata` → `product_type` → canonical catalog slug → `storage_path` segment (`features/`, `singles/`, …)
- Preview fallback uses `inferProductReleaseType` + `product.preview_path` (not singles-only default)

## Before / after paths (canonical slugs)

| Slug | Before (broken stream fallback) | After |
|------|----------------------------------|-------|
| `i-dont-believe-you` | Master: `digital-assets/features/i-dont-believe-you/` (OK if listed); preview fallback: `previews/singles/i-dont-believe-you/` | Master: `digital-assets/features/i-dont-believe-you/` (+ singles fallback if empty); preview: `previews/features/i-dont-believe-you/` |
| `2-heavy` | Same misroute to `previews/singles/2-heavy/` | `previews/features/2-heavy/` |

Client preview (guest / preview-only): `/api/media/preview?folder=previews%2Ffeatures%2F{i-dont-believe-you|2-heavy}%2F` (unchanged when canonical merge runs).

## Files changed

- `src/lib/playback/resolve-playback-key.js`

## Verification

- [x] `npm run build` — success
- [ ] Manual: Features rail ▶ on iOS Safari — preview audible for guest
- [ ] Manual: Subscriber/admin — full stream via `/api/library/stream?slug=i-dont-believe-you&redirect=1` → 302 to R2 WAV
- [ ] Manual: Feature modal open autoplays same track

## Commit

`66e7174` — fix(audio): resolve feature preview folders in library stream

# Features section audio — root cause (2026-05-27)

## Root cause

**Entitlement mismatch:** the client treats subscribers/admins as entitled to full stream for every catalog slug (`resolveTrackAccess` → `canStream: true`), and `resolvePlaybackSrc` returns `/api/library/stream?slug=…&redirect=1`. The stream API gates on `userCanStreamProduct()` → `isDigitalProduct(product)`, which **did not include** `product_type: "feature"`.

| Layer | Singles | Features (broken) |
|-------|---------|-------------------|
| Client `canStream` (subscriber) | true | true |
| `resolvePlaybackSrc` | `/api/library/stream?slug=hour-glass&redirect=1` | same for `i-dont-believe-you` / `2-heavy` |
| Server `isDigitalProduct` | `single` ✓ | `feature` ✗ → **403** |
| Audio element | 302 → signed R2 | JSON error body → silent failure |

**Evidence**

- `src/lib/music-access.js:214-221` — stream URL when `access.canStream`
- `src/lib/commerce/entitlements.js:117-122` — `userCanStreamProduct` uses `isDigitalProduct`
- `src/lib/commerce/entitlements.js:244-247` (before fix) — `feature` omitted from `isDigitalProduct`
- `src/app/api/library/stream/route.js:40-44` — 403 when not entitled
- Production probe: stream without auth → 401; entitled path was 403 for features

Commit `51af6ff` correctly normalized R2 previews and catalog lookup; playback still failed for the usual production testers (subscriber/admin) because the **stream gate** rejected features.

## Fix

1. `src/lib/commerce/entitlements.js` — add `feature` to `isDigitalProduct`
2. `src/lib/music-playback.js` — always set `metadata.previewSrc` when a preview path exists (fallback payload)
3. `src/context/AudioContext.js` — on stream 401 **or 403**, fall back to preview (same as singles retry path)

## Files changed

- `src/lib/commerce/entitlements.js`
- `src/lib/music-playback.js`
- `src/context/AudioContext.js`

## Not root causes (verified)

- Missing preview after `displayFeatures` / `withR2CatalogMedia` — previews resolve (R2 200)
- Wrong slug — `i-dont-believe-you`, `2-heavy` match `products` table
- `playTrack` not called — `openFeatureModal` / `ReleaseCardActions` call it on gesture
- Modal fake timer — `ImmersivePreviewModal` uses `useMediaEngine` (AudioContext)
- Guest queue filter — no guest-specific empty queue for features

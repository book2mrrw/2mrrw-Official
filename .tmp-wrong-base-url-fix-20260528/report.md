# Wrong base URL fix — 2026-05-28

## Problem

The storefront was sometimes resolving media/API paths with the R2 public CDN host (`https://pub-{hash}.r2.dev`) as the base. That host serves object keys only — not Next.js routes. URLs like:

```
https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/api/media/visual?releaseType=singles&slug=hour-glass
```

always 404 because `/api/media/*` must hit the site origin.

## Valid patterns (unchanged intent)

| Use case | Correct pattern |
|----------|-----------------|
| Entitlement / discovery / stream | `/api/media/visual`, `/api/media/preview`, `/api/library/stream` (same-origin relative) |
| Public cover / preview file on CDN | `https://pub-{hash}.r2.dev/images/singles/{slug}/cover.jpg` (object key after host) |

`NEXT_PUBLIC_R2_PUBLIC_URL` is for Pattern B only — never as the base for `/api/*`.

## Root cause

`getPublicR2Url`, `catalogPublicMediaUrl` / `toCatalogCdnUrl`, and `resolveAbsoluteArtworkUrl` prefixed **any** non-absolute path with the R2 CDN base. Paths like `api/media/visual?...` (or already-misbound `https://pub-*.r2.dev/api/...`) were not excluded before prefixing.

`absolutizeControlSystemMediaUrl` and `signedUrlEndpointForAsset` could also join `/api/media/*` to an R2 base when `apiBaseUrl` was mis-set to the public CDN URL.

## Fix

Added `src/lib/media/site-api-url.js`:

- `isSiteApiMediaPath` — detects `/api/media/*` and `/api/library/*`
- `repairMisboundR2ApiUrl` — strips R2 host from `pub-*.r2.dev/api/...` → `/api/...`
- `ensureRelativeSiteApiPath` — normalizes to same-origin relative API paths
- `isR2PublicCdnBaseUrl` — blocks using R2 CDN as `apiBaseUrl` for API joins

Wired into:

- `src/lib/storage/r2.js` — `getPublicR2Url`
- `src/lib/media-urls.js` — catalog URL helpers
- `src/lib/media-session-artwork.js` — lock-screen artwork (site origin for API paths)
- `src/lib/control-system/media.js` — signed URL endpoints and batch URL

## Before / after URL patterns

| Input | Before (wrong) | After (correct) |
|-------|----------------|-----------------|
| `api/media/visual?releaseType=singles&slug=hour-glass` | `https://pub-….r2.dev/api/media/visual?...` | `/api/media/visual?releaseType=singles&slug=hour-glass` |
| `https://pub-….r2.dev/api/media/preview?folder=...` | (unchanged, 404) | `/api/media/preview?folder=...` |
| `images/singles/hour-glass/cover.jpg` | `https://pub-….r2.dev/images/singles/...` | unchanged (Pattern B) |
| `/api/library/stream?slug=w2d&redirect=1` | could be mis-absolutized | `/api/library/stream?slug=w2d&redirect=1` |

## Verification

- `npm run build` — pass (Next.js 16.2.4)

## Out of scope (per prompt)

- Playback engine rewrite
- Auth OTP changes
- UI redesign

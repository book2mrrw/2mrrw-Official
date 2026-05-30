# 04 — URL validation

## Public CDN resolution

| Layer | File | Behavior |
|-------|------|----------|
| Base URL | `src/lib/storage/r2-public-cdn.js` | `NEXT_PUBLIC_R2_PUBLIC_URL` or documented fallback `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` |
| Preview map | `src/lib/media-urls.js` | `/audio/previews/foo.mp3` → `{CDN}/previews/foo.mp3` |
| Covers/video | `src/components/home/catalogMedia.js` | `withR2CatalogMedia` |

**Validated:** All inline preview paths resolve to **200** on canonical CDN (see `02-r2-object-validation.md`).

## Entitled stream URLs

| Step | URL |
|------|-----|
| Client | `/api/library/stream?slug={slug}` or `&redirect=1` |
| Server | Presigned S3 GET on `normalizePlaybackR2Key` key |
| Fast path | `libraryStreamRedirectSrc` in `music-access.js` — `<audio src>` follows 302 |

**Prod probe (unauthenticated):** `GET https://www.2mrrw.com/api/library/stream?slug=hour-glass` → **401** JSON (expected).

## Legacy / failure modes

| Issue | Symptom |
|-------|---------|
| Wrong `NEXT_PUBLIC_R2_PUBLIC_URL` | Previews 401/404; `warnPublicCdnEnvMismatch` in console |
| Legacy host `pub-992d4f5d…` | **401** (see `curl-probes.txt`) |
| `assertSignedAudioUrl` HEAD on presigned URL | May fail if **bucket CORS** blocks storefront origin (element play may still work) |

## Album / CS URLs

- `catalogPublicMediaUrl` for `csAudio` / control-system paths
- Album rows often lack `preview` — `resolvePlaybackSrc` may return empty for guests

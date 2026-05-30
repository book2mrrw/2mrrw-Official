# 03 Media URL Map

## URL base sources
- Storefront public CDN base: `NEXT_PUBLIC_R2_PUBLIC_URL` with fallback in `src/lib/storage/r2-public-cdn.js:2`, `src/lib/storage/r2-public-cdn.js:15`.
- Control System public URL usage: `/Users/recharge/2MRRW-Control-System/src/lib/storage/r2.ts:53`.
- Control-system-driven media fallback for frontend: `/Users/recharge/2MRRW-Control-System/src/lib/media/frontendMediaFallbacks.ts:14`.

## URL generation paths by media type
- **Audio preview/public**: catalog/media helpers rely on public CDN base (`src/lib/media-urls.js:21`; `src/lib/control-system/media.js:7`-`8`).
- **Full stream (entitled)**: `/api/library/stream?slug=...` from `resolvePlaybackSrc` (`src/lib/music-access.js:206`, `src/lib/music-access.js:214`) -> signed URL returned by stream route (`src/app/api/library/stream/route.js:77`).
- **Artwork/media session art**: resolved from env public CDN base (`src/lib/media-session-artwork.js:12`-`13`).
- **Next Image allowlist**: includes explicit and wildcard r2.dev host patterns (`next.config.mjs:9`, `next.config.mjs:13`; control twin at `/Users/recharge/2MRRW-Control-System/next.config.mjs:9`, `:13`).

## Signed/fallback behavior
- Signed stream URLs are cached server-side (`src/lib/playback/stream-url-cache.js:12`).
- Public fallback constant exists for previews/covers (`src/lib/storage/r2-public-cdn.js:2`).

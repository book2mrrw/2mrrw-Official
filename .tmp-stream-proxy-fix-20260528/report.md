# Stream proxy fix — 2026-05-28

## Prompt requirements (executed)

| Requirement | Status |
|-------------|--------|
| Browser must never hit `r2.cloudflarestorage.com` | Done — signed URL used server-side only |
| `/api/library/stream` proxies bytes with Range forwarding | Done |
| Entitlement check before proxying | Unchanged (`validateStreamEntitlement`) |
| All release types (singles, features, albums, mixtapes) | Unchanged `resolvePlaybackKey` path |
| Preserve `media-cors` / Range CORS (85a79d2 pattern) | `applyMediaCors` on proxy response |
| Preview route if signed S3 URL | N/A — preview redirects to public CDN (`pub-*.r2.dev`), not `cloudflarestorage.com` |
| `npm run build` passes | Yes |
| No AudioContext / UI / auth OTP rewrite | Only route + small stream-client HEAD creds |

## Root cause

`/api/library/stream?redirect=1` returned **302** to a presigned `*.r2.cloudflarestorage.com` URL. Safari and other browsers then fetched audio directly from the private S3 endpoint, which **does not honor Cloudflare dashboard CORS** → repeated **403** on Range/seek despite bucket policy work.

JSON prefetch path also returned the presigned URL in `{ url }`, so recovery/refresh flows hit R2 from the browser via `fetchLibraryStream` + HEAD.

## Files changed

| File | Change |
|------|--------|
| `src/lib/server/r2-stream-proxy.js` | **New** — server-side fetch + stream body, Range/HEAD |
| `src/app/api/library/stream/route.js` | Proxy on `redirect=1`; JSON returns same-origin proxy URL |
| `src/lib/playback/stream-client.js` | HEAD validation uses `credentials: include` for library stream URLs |
| `src/lib/music-access.js` | Comment updates only |

## Before / after stream flow

### Before

```
Browser <audio src="/api/library/stream?slug=X&redirect=1">
  → GET (cookie session)
  → entitlement OK
  → 302 Location: https://….r2.cloudflarestorage.com/…?X-Amz-…
Browser → GET/Range directly to R2 S3 endpoint → 403 (CORS)
```

JSON path: `{ url: "https://….r2.cloudflarestorage.com/…" }` → client HEAD/GET to R2.

### After

```
Browser <audio src="/api/library/stream?slug=X&redirect=1">
  → GET + Range (cookie session)
  → entitlement OK
  → server fetch(presignedUrl, { Range })
  → 200/206 Response(body) + media CORS headers
Browser only talks to www.2mrrw.com (or preview host)
```

JSON path: `{ url: "/api/library/stream?slug=X&redirect=1" }` — same proxy endpoint.

## Verification

- `npm run build` — success (Next.js 16.2.4)
- Manual: entitled play on iOS Safari — Network tab should show only `/api/library/stream`, never `cloudflarestorage.com`

## Commit

`4309ca4f1c0601dbae253d680f9a47e347e20969` — pushed to `main`.

## Zip

`/Users/recharge/Downloads/stream-proxy-fix-20260528.zip`

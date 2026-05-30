# Phase 4.8 — Files Changed

## New files

| File | Purpose |
|------|---------|
| `src/lib/server/server-timing.js` | Server-Timing collector + dev `X-Playback-Timing` header |
| `src/lib/playback/preview-resolution-cache.js` | 60s TTL + inflight dedup for preview media resolution |

## Modified files

| File | Changes |
|------|---------|
| `src/app/api/library/stream/route.js` | Server-Timing segments (auth, entitlement, resolve, product, session, sign, cdn); reuse `productId` from `resolvePlaybackKey`; signed URL cache hit marker |
| `src/app/api/media/preview/route.js` | Canonical preview fast path; resolution cache; Server-Timing (fastpath, resolve, redirect) |
| `src/lib/server/r2-stream-proxy.js` | CDN/proxy segment timing hook |
| `src/lib/server/media-cors.js` | Expose `Server-Timing`, `X-Playback-Timing` to browser |
| `src/lib/playback/resolve-playback-key.js` | 60s in-memory cache + inflight dedup; returns `productId` to skip duplicate products lookup |
| `src/lib/playback/stream-url-cache.js` | TTL aligned to presign expiry (~55 min); trackSlug-aware invalidation; cache hit metadata |
| `src/lib/media/entity-resolver.js` | Inflight dedup on folder discovery cache |
| `src/lib/media/cache-invalidation.js` | Clears playback key + preview resolution caches |
| `src/context/AudioContext.js` | Defer cover preload until `canplay` on mobile; desktop unchanged |

## Unchanged (architecture lock)

- Playback queue, entitlements flow, R2 signing, proxy architecture, WAV masters, cinematic shell

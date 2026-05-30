# Phase 4.8 — Rollback Paths

No commit was created. Roll back via git restore or selective file revert.

## Full rollback (all Phase 4.8 changes)

```bash
cd /Users/recharge/artist-platform
git restore \
  src/app/api/library/stream/route.js \
  src/app/api/media/preview/route.js \
  src/lib/server/r2-stream-proxy.js \
  src/lib/server/media-cors.js \
  src/lib/playback/resolve-playback-key.js \
  src/lib/playback/stream-url-cache.js \
  src/lib/media/entity-resolver.js \
  src/lib/media/cache-invalidation.js \
  src/context/AudioContext.js
rm -f src/lib/server/server-timing.js \
      src/lib/playback/preview-resolution-cache.js
npm run build
```

## Selective rollback by concern

| Concern | Revert |
|---------|--------|
| Server-Timing only | `server-timing.js`, timing hooks in stream/preview/proxy routes, `media-cors.js` expose headers |
| Preview fast path | `preview/route.js`, `preview-resolution-cache.js`, cache-invalidation import |
| Playback key cache | `resolve-playback-key.js`, `clearPlaybackKeyCache` in cache-invalidation |
| Stream URL cache TTL | `stream-url-cache.js` only |
| Entity resolver inflight | `entity-resolver.js` only |
| Mobile cover deferral | `AudioContext.js` preload block only |

## Recovery anchor

If playback regressions appear post-deploy:

1. `npm run recover:foundation -- --dry-run`
2. Selective restore: `docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md`
3. Foundation verify: `npm run verify:foundation`

## Deploy rollback

If deployed to Vercel: promote previous deployment from dashboard or revert the deploy commit on the release branch.

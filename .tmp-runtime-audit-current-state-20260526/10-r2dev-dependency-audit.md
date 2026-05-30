# 10 r2.dev Dependency Audit

## Active runtime path references (file:line)
- `artist-platform/src/lib/storage/r2-public-cdn.js:2`
- `artist-platform/src/lib/storage/r2-public-cdn.js:4`
- `artist-platform/src/lib/control-system/media.js:8`
- `artist-platform/next.config.mjs:9`
- `artist-platform/next.config.mjs:13`
- `/Users/recharge/2MRRW-Control-System/src/lib/storage/r2.ts:53`
- `/Users/recharge/2MRRW-Control-System/src/server/media/artworkPublicFallback.ts:53`
- `/Users/recharge/2MRRW-Control-System/src/lib/media/frontendMediaFallbacks.ts:14`
- `/Users/recharge/2MRRW-Control-System/next.config.mjs:9`
- `/Users/recharge/2MRRW-Control-System/next.config.mjs:13`
- `/Users/recharge/2MRRW-Control-System/.env.example:52`

## Legacy/comment/doc references (non-runtime)
- `artist-platform/docs/reports/r2-playback-fix-20260525.md:11`
- `artist-platform/docs/reports/production-stabilization-20260526.md:84`
- `/Users/recharge/2MRRW-Control-System/reports/AUDIT-REPORT-E2E-2026-05-22.md:51`

## Assessment
- r2.dev remains an active dependency for public preview/artwork URL bases and image-host allowlists in both repos.
- No evidence in this pass that runtime has fully abstracted away from r2.dev host dependency.

Evidence index mirrored in `raw/03-r2dev-references.txt`.

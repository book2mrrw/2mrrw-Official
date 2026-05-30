# Phase 4.8 — Remaining Bottlenecks

After Phase 4.8 server fast-path work, these segments still dominate end-user playback startup:

## P0 — CDN first-byte (unchanged)

- **Measured (Phase 4.7):** 954 ms TTFB for first 64 KiB preview range on R2 public CDN
- **Mitigation deferred:** CDN edge caching, object proximity — not in Phase 4.8 scope
- Preview API hop removed/warmed; browser still fetches CDN directly after 302

## P1 — Entitled stream 200 path (unmeasured)

- Phase 4.7/4.8 curl used unauthenticated 401 probes
- Full chain (entitlement + resolve + sign + proxy + CDN) needs session-cookie HAR on staging/prod
- Server-Timing now exposes segments for diagnosis once deployed

## P2 — Catalog preview URL shape

- Tracks with folder-based `preview_path` still route through `/api/media/preview` on first play
- Canonical fast path covers known releases (e.g. hour-glass); catalog could emit direct CDN URLs for all releases with `preview_legacy` — data/catalog change, not done here

## P3 — Client JSON+HEAD refresh path

- Visibility refresh still uses `fetchLibraryStream` JSON + HEAD when src lacks `redirect=1`
- Phase 4.7 recommended preferring redirect on refresh — deferred (client-scoped, med risk)

## P4 — Mobile tap→audible (device)

- Nine dev Performance marks still pending on real iOS device
- Phase 4.8 deferred cover preload on mobile; decode/network still device-bound

## Out of scope (per guardrails)

- WAV transcode / streaming format migration
- Playback queue or resolver architecture rewrite
- Aggressive preload systems

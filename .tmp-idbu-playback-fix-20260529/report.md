# i-dont-believe-you Playback Fix — 2026-05-29

## Production probes (no auth)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/media/preview?folder=previews/features/i-dont-believe-you/` | **404** JSON | Entity folder empty in R2 |
| `GET /api/media/preview?…&legacy=previews/i-dont-believe-you-preview.wav` | **302** → CDN | Legacy key missing on public CDN (**404**) |
| `GET /api/media/visual?releaseType=feature&slug=i-dont-believe-you&meta=1` | **200** | `releaseType=features` also **200** |
| `GET /api/library/stream?slug=i-dont-believe-you&redirect=1` | **401** | Correct for unauthenticated guest |

## Root causes

1. **404 preview** — No objects under `previews/features/i-dont-believe-you/` or flat `previews/i-dont-believe-you-preview.wav` in R2 (public CDN HEAD all **404**). Preview API redirected to a dead flat CDN URL.
2. **403 stream** — Logged-in user without entitlement hits `/api/library/stream` (expected). Client should preview-fallback; fallback then failed because preview CDN was also missing.
3. **Wrong flat CDN URL in console** — `catalogPreviewAudioUrl` / stale `page.js` paths could resolve `/audio/previews/*-preview.wav` to direct `pub-*.r2.dev/previews/…` instead of `/api/media/preview`.
4. **Visual 404** — Not reproduced with `releaseType=feature` or `features` (both 200). Likely transient or wrong query in older build.
5. **Watchdog / PLAYBACK_COMMAND_FAILED** — Stream retry + preview load failure loop; no graceful unavailable state.

## Code fixes (surgical)

- `src/lib/media-urls.js` — Flat `*-preview.*` paths always map to `/api/media/preview` with entity folder + legacy; repair CDN URLs; never bare flat CDN for previews.
- `src/app/api/media/preview/route.js` — Legacy candidate chain (entity nested + flat); verify legacy keys exist in R2 before 302 redirect.
- `src/lib/media/entity-resolver.js` + `src/lib/storage/r2.js` — `headR2ObjectKey` + legacy array support in `resolveWithLegacyFallback`.
- `src/app/page.js` — Feature cards use `previews/features/{slug}/` folders.
- `src/context/AudioContext.js` — Preview src prefers `preview_path`; blocks flat CDN; preview errors → unavailable (no stream retry loop).
- `src/lib/music-playback.js` — Prefer `preview_path` over legacy `preview` field.

## R2 action required (ops)

Upload at least one of:

- `previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav` (preferred)
- `previews/i-dont-believe-you-preview.wav` (legacy flat)
- `digital-assets/features/i-dont-believe-you/audio.wav` (entitled full stream)

Verify: `node scripts/verify-r2-entity-folders.mjs --json`

## User test checklist

- [ ] Guest: play **I Don't Believe You** → preview API 404 JSON or silent unavailable (not infinite spinner / watchdog)
- [ ] Subscriber/admin: stream `/api/library/stream?slug=i-dont-believe-you&redirect=1` → audio after R2 master upload
- [ ] Network tab: preview requests go to `/api/media/preview?folder=previews/features/i-dont-believe-you/` (not flat `*-preview.wav` CDN)
- [ ] Visual: `/api/media/visual?releaseType=feature&slug=i-dont-believe-you&meta=1` → 200

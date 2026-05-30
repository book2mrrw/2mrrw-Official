# Incomplete Media Tolerance — Implementation Report

**Date:** 2026-05-28  
**Scope:** Playback resilience only (no cinematic UI, queue reducer, or AudioContext architecture redesign)

## Summary

Storefront and playback now tolerate missing R2 assets: discovery never blocks the UI, stream API returns structured `MEDIA_UNAVAILABLE` JSON, the queue skips unplayable tracks (max 20), and play controls show disabled states when media is not ready.

## Files changed

| File | Change |
|------|--------|
| `src/lib/media/media-availability.js` | **New** — `checkMediaAvailability`, `formatAvailabilityDiagnostics`, `logAvailabilityDiagnostics` |
| `src/lib/media/canonical-paths.js` | `getArtworkPlaceholderUrl` for visual fallbacks |
| `src/lib/media/entity-resolver.js` | `resolveVisualMedia` returns placeholder URL instead of null |
| `src/lib/playback/resolve-playback-key.js` | Master → preview fallback; DB errors return null |
| `src/lib/music-playback.js` | `filterPlayableQueueItems`, `isQueueTrackPlayable`, `getPlayButtonState`; album queue hydration |
| `src/lib/playback/stream-client.js` | `MEDIA_UNAVAILABLE` on 404/422; no HTML poisoning |
| `src/app/api/library/stream/route.js` | JSON errors with `code: MEDIA_UNAVAILABLE`; no stack traces to client |
| `src/app/api/media/visual/route.js` | Placeholder redirect when discovery misses |
| `src/components/home/catalogMedia.js` | Cover placeholder when URL empty |
| `src/context/AudioContext.js` | `skipToNextPlayableTrack`, playable index helpers, queue filter on hydrate |
| `src/components/music/ReleaseCardPlayButton.js` | Disabled state + label from `getPlayButtonState` |
| `src/components/music/AlbumTracklistSheet.js` | Unavailable row labels; playable queue filter |

## Behavior

### Media availability (`checkMediaAvailability`)

- Resolves master audio (`digital-assets/`), preview (`previews/`), video, and artwork via entity-resolver.
- Never throws; `unavailable` on miss or discovery error.
- Status: `ready` | `preview_only` | `unavailable` | `coming_soon` (future `release_date`).
- Non-fatal `reasons[]`: `missing_audio`, `missing_preview`, `missing_video`, `missing_artwork`.

### Stream resolution order

1. `resolveAudio` (master / entity folder; features → singles remap preserved)
2. `resolvePreview` (previews folder + legacy key)
3. `null` → API `404`/`422` with `{ error, code: "MEDIA_UNAVAILABLE" }`

### Queue skipping (`AudioContext`)

- `skipToNextPlayableTrack()` advances index, `reportPlaybackDiagnostic` (`QUEUE_SKIP_UNPLAYABLE`, `QUEUE_SKIP_LIMIT`).
- Triggered: no `src`, stream `MEDIA_UNAVAILABLE`, failed play after track end, next/prev when current fails.
- Max 20 skips per burst; counter resets on successful play.
- `setQueue` uses `filterPlayableQueueItems` + `isQueueTrackPlayable`.

### Play button states

- `getPlayButtonState(track, accountState)` → label + `disabled` + `canAttemptPlay`.
- Wired on release cards and album track rows (layout unchanged).

### Visual / catalog

- Missing video/artwork: placeholder path via `getArtworkPlaceholderUrl` + `catalogCoverUrl`.
- `/api/media/visual` redirects to placeholder instead of hard 404 when discovery empty.

## Build

```
npm run build — ✓ success (Next.js 16.2.4)
```

## How to test skip on empty track folder

1. **Prepare queue with a gap** — Use an album with at least two tracks where one track’s R2 entity folder has no audio (empty folder or wrong slug). Or temporarily point a catalog track `storage_path` at an empty `digital-assets/.../` folder in admin/DB.

2. **Play album from tracklist** — Open album sheet → Play All or tap the empty track’s row if it still lists (unavailable rows show label, not ▶).

3. **Observe skip** — With entitlement (library stream):
   - First track with no master/preview: console `[playback-diagnostic]` `PLAYBACK_NO_SRC` or `QUEUE_SKIP_UNPLAYABLE`.
   - Player advances to next playable track within ~20 attempts; UI stays responsive (no frozen spinner, queue not cleared).

4. **Stream API probe** — `curl -b cookies 'https://<host>/api/library/stream?slug=<empty-slug>'` → `404` body `{"error":"...","code":"MEDIA_UNAVAILABLE"}` (not HTML).

5. **Dev diagnostics** — In development, import `checkMediaAvailability` / `logAvailabilityDiagnostics` for a slug to see `formatAvailabilityDiagnostics` output.

## Risks / follow-ups

- Server-side availability checks are not yet called on every card render (client uses paths + `getPlayButtonState` heuristics); optional admin UI can use `checkMediaAvailability` later.
- Placeholder image depends on CDN path `images/...` from `legacyCoverPublicPath`; ensure R2 has generic placeholder or accept legacy path.

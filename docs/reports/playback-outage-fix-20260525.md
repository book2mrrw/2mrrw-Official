# Playback Outage Fix — 2026-05-25

## Root cause (full outage / entitled stuck on preview)

Primary breakage was **not** a missing `AudioProvider` or unexported `playTrack`/`playQueue` — those were already correct (`layout.js` wraps app; `useAudioPlayer` exports both; `useMediaEngine` bridges `play()` → `playTrack`).

The effective outage for entitled users was a **wrong first `audio.src`** chain:

1. **Preview-first for everyone** (`AudioContext.js` ~805–808): If a catalog item had a preview path, `playTrack` always set `syncSrc` to the public preview CDN before resolving the library stream — even when `metadata.access.canStream` was true and `resolvePlaybackSrc` returned `/api/library/stream?redirect=1`. Entitled taps sounded like “preview only” or failed to upgrade in time.

2. **Subscriber entitlement gap** (`music-access.js` ~148–151): `canStream` required `permissions.subscriber` in addition to `subscriberActive`, while `playback-gate.js` treated `subscriberActive` alone as sufficient. Account state from `/api/account/state` often set `subscriberActive` without the extra permission flag → **no `canStream`** → preview URL only.

3. **`upgradeToFullStream` no-op** (~1000–1004): Early return when stream meta existed but the element was still on preview CDN, so modal/account-state upgrades never swapped src.

4. **Race on modal open** (`page.js`): `playTrack` ran before `authLoading` finished, using stale guest access; the re-play effect did not call `playTrack` when `canStream` later became true (only `upgradeToFullStream`).

Secondary hardening (Phase A):

- `playTrack` logs `console.error` for invalid track, missing `<audio>` ref, or missing `src`.
- Verified `<audio ref={audioRef}>` in `AudioProvider` and `toPlaybackTrack` / `resolvePlaybackSrc` pipeline.

## All changes (Phases A–C)

| Area | File | Change |
|------|------|--------|
| A | `src/context/AudioContext.js` | Guards + entitled skip preview-first + `upgradeToFullStream` preview detection |
| B | `src/lib/music-access.js` | `subscriberActive` grants subscription access |
| B | `src/lib/playback/stream-client.js` | 401/403 logging + error `status`/`slug` |
| B | `src/app/page.js` | Auth-gated modal play + canStream re-play effect |
| B | `src/components/home/CarouselUI.js` | Listen vs Preview overlay |
| B | `src/components/music/ReleaseCardPlayButton.js` | aria-label + 2s upgrade fallback |

## Playback rules (Phase C)

| User | Tap behavior |
|------|----------------|
| All | Tap assigns `audio.src` and calls `play()` in same `playTrack` turn (preview CDN or redirect fast-path) |
| Visitor | Preview CDN; engine hard-caps at 30s (`PREVIEW_HARD_CAP_SEC`) |
| Entitled | Library redirect URL on element immediately when `canStream`; background JSON resolve upgrades to signed R2 |
| Album | `playAlbumTracks` / `playQueue` starts at requested index (default 0) |

## Verification

```bash
npm run build
```

**Result:** exit 0, compiled successfully.

### Manual test checklist

See `docs/reports/audio-logic-fix-20260525.md` table. Code review + production build green; staging browser pass recommended for stream 401/403 and subscriber-only accounts.

## Source files in zip

- `src/context/AudioContext.js`
- `src/lib/music-access.js`
- `src/lib/music-playback.js`
- `src/lib/playback/stream-client.js`
- `src/lib/playback/playback-gate.js`
- `src/app/layout.js`
- `src/app/page.js`
- `src/components/home/CarouselUI.js`
- `src/components/music/ReleaseCardPlayButton.js`
- `src/media/useMediaEngine.js`
- `docs/reports/playback-outage-fix-20260525.md`

## Build status

**PASS** — `npm run build` (2026-05-25).

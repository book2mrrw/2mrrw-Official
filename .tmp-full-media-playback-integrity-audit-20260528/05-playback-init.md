# 05 — Playback init (code-level)

**Scope:** Read-only trace — no orchestration changes.

## Entry points

| Surface | Path |
|---------|------|
| Home modals / grid | `page.js` → `playTrack` / `playQueue` via `toPlaybackTrack` (`music-playback.js`) |
| Library | `MyMusicTab.js`, `ReleaseCardPlayButton.js` |
| Media engine | `useMediaEngine.js` → `audio.playTrack` |

## `playTrackInternal` (`AudioContext.js`)

1. Abort prior stream fetch; `unlockAudioFromGesture` (iOS)
2. `initWebAudio` + `resumeWebAudioContextIfSuspended`
3. `normalizeTrack` — requires slug/id or src
4. **Failure guards:**
   - Invalid track object → return false
   - Missing slug/id/src → log + `error: Audio source unavailable`
   - `audioRef` null → `error: Audio player unavailable`
   - Empty `nextTrack.src` after presentation resolve → same

## Stream vs preview branch

```
usesLibraryStream = isLibraryStreamSrc(src)
entitledFullStream = metadata.access.canStream
if preview && !entitled → syncSrc = previewSrc (public CDN)
else if redirect=1 → audio.src = /api/library/stream?...&redirect=1
else if entitled → backgroundStreamResolve (JSON prefetch + optional HEAD)
```

## `fetchLibraryStream` (`stream-client.js`)

- 401/403 → logged; throws entitlement errors
- JSON body must include `url`
- `assertSignedAudioUrl` — HEAD presigned URL; fails with `SIGNED_STREAM_UNREACHABLE` / `INVALID_CONTENT_TYPE`

## Known init failure modes (code)

| Code / log | Cause |
|------------|-------|
| `playTrack: no playback src` | `toPlaybackTrack` / `resolvePlaybackSrc` returned empty |
| `SIGNED_STREAM_UNREACHABLE` | Presigned 403/404 or HEAD blocked |
| `library_stream_invalid_content_type` | API returned HTML/error page |
| Stream 404 from API | `resolvePlaybackKey` null (DB path) |
| WebAudio suspended | Mobile Safari until user gesture — mitigated by unlock helper |

## Redirect fast path

`libraryStreamRedirectSrc(slug)` avoids JSON round-trip; relies on entitled session cookie on same-origin `/api/library/stream`.

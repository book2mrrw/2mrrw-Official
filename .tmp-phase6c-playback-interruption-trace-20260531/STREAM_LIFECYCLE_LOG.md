# Stream lifecycle log (Phase 6C)

## Prefix

`[stream-lifecycle]`

Also mirrored as `[playback-event]` with `type: stream:<phase>`.

## Phases

| Phase | Source | When |
|-------|--------|------|
| `start` | `stream-client` | `fetchLibraryStream` begins |
| `abort` | `stream-client` | Fetch `AbortSignal` fired |
| `ready` | `stream-client` | Signed URL validated, JSON returned |
| `replace` | `stream-client` | `clearLibraryStreamSession` |
| `src-swap` | `waitAudioSrcReady` | New `audio.src` assigned |
| `abort` | `waitAudioSrcReady` | Src readiness wait aborted |
| `preview-fallback` | `playTrackInternal` | Library stream failed → preview URL |

## Fields (typical)

- `slug`, `trackSlug`, `force`
- `from` / `to` (truncated URLs on src-swap)
- `hasSession` on `ready`

## Correlation

Pair with `[playback-event]` `trackChange` and `upgradeToFullStream` to see whether a stop followed an abort or src-swap (classification **C**).

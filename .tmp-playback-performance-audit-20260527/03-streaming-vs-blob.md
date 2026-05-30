# 3. Streaming vs blob audit

## Grep summary (production playback path)

| Pattern | Hits | Playback impact |
|---------|------|-----------------|
| `blob()` | `src/lib/offline-cache.js:63` | **Offline download only** — not inline play hot path |
| `createObjectURL` | `offline-cache.js:64` | Offline cached blob URL returned by `getOfflinePlaybackUrl` |
| `fetchLibraryStream` | AudioContext, stream-client, signedUrlRefresher | JSON signed URL; used on retry, resume refresh, visibility, upgrade |
| `getSignedUrl` | `src/lib/storage/r2.js` | **Server-side** presign only |
| `sendControlSystemPlaybackEvent` | AudioContext onPlay/timeupdate/seek; control-system/playback.js | Fire-and-forget fetch |
| `trackPlay` | No matches in `src/` | N/A |

## Primary playback modes

### A. Entitled full stream (default)

- **URL:** `/api/library/stream?slug={slug}&redirect=1` (`music-access.js` `libraryStreamRedirectSrc`)
- **Transport:** HTTP **302** to presigned R2 GET; browser `<audio>` progressive download (not full blob)
- **No** `fetch().blob()` on hot path

### B. Preview / discovery

- **URL:** `catalogPreviewAudioUrl(path)` → public R2 CDN (`media-urls.js`)
- **Transport:** Direct GET; `Accept-Ranges: bytes` confirmed on probes
- **Preload:** `MediaPreloader` uses `<link rel=preload as=fetch>` + ephemeral `new Audio().load()` for non-stream URLs

### C. Offline (optional)

- `queueOfflineDownload` may `fetch(url).blob()` + `createObjectURL`
- `resolvePlaybackSrc` checks `getOfflinePlaybackUrl` **before** stream redirect — blob URL bypasses API if cached

### D. CS mode alternate assets

- `csAudio` / `csCover` as direct CDN URLs; separate preload `Audio()` elements (`preloadCsAssets`)

## Anti-patterns **not** present on hot path

- No `createObjectURL` for stream responses in AudioContext
- No buffering entire track in memory before play (except offline MVP)

## Risk: offline blob in localStorage meta

- Large tracks stored as blob URLs can pressure memory; unrelated to first-play latency unless user has offline entry.

## Double-fetch scenarios

| Scenario | Mechanism |
|----------|-----------|
| Error retry | `fetchLibraryStream` + `waitAudioSrcReady` again |
| `upgradeToFullStream` | JSON fetch + src swap mid-session |
| `swapToSignedStream` | Only if non-redirect library src + background resolve |
| Redirect play | Single chain: API 302 → R2 (no JSON prefetch) |

## Verdict

Playback is **streaming-native** (Media Element + HTTP range). Blob path is isolated to offline tooling.

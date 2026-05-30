# 9. Network waterfall analysis

## Code-based waterfall: entitled first play

```
[parallel possible before tap]
  ReleaseCardPlayButton: link preload + warm Audio (preview only)
  page.js: cover images

[tap]
  playTrack
    → GET /api/library/stream?slug=X&redirect=1  (credentials, same-origin)
         → 307 to www (if apex host)  [observed]
         → 302 to https://*.r2.cloudflarestorage.com/...?X-Amz-...
    → GET signed R2 object (Range: bytes=0-)
    → canplay → play()

[on playing]
  POST /api/media/playback
  POST control-system /api/playback/events (deduped)
  GET artwork (Image) for Media Session
```

**Dominant serial segment:** API auth + sign + R2 TTFB + buffer until `canplay`.

## Code-based waterfall: guest preview

```
[tap]
  playTrack with syncSrc = https://pub-...r2.dev/previews/....mp3|.wav
    → GET CDN (no API)
    → canplay → play()
```

**Feature WAV:** 5–6.5MB → multiple round trips on slow networks even with ranges.

## Code-based waterfall: modal open single

```
openSingleModal
  ├─ playTrack (immediate)
  └─ getControlSystemReleaseDetail (parallel, not blocking audio)
```

## curl TTFB summary (2026-05-28)

| Resource | HTTP | TTFB (HEAD) | Size |
|----------|------|-------------|------|
| idbu preview WAV | 200 | ~0.34s | 5.2 MB |
| 2-heavy preview WAV | 200 | ~0.13s | 6.5 MB |
| hourglass preview MP3 | 200 | ~0.11s | 812 KB |
| w2d preview MP3 | 200 | ~0.19s | 1.2 MB |
| artificial preview MP3 | 200 | ~0.11s | 1.0 MB |
| singles/hour-glass/audio.mp3 (public) | 404 | — | N/A |
| stream redirect (no cookie) | 307 | — | — |

## Server-side waterfall (`buildStreamResponse`)

Serial awaits:

1. `userCanStreamProduct`
2. `resolveProductIdBySlug`
3. Session clear/create
4. `resolvePlaybackKey`
5. `createStreamSession` + `insertStreamEvent`
6. `getOrCreateStreamSignedUrl` (cache hit skips sign)

**Estimated server time (warm):** 80–250ms; cold + DB: 250–600ms+.

## Telemetry overlap

- `timeupdate` → progress persist throttled 15s client-side
- Does not block decode but consumes connection pool on slow networks

## Estimated user-perceived latency bands

| Scenario | Optimistic | Typical mobile | Poor network |
|----------|------------|----------------|--------------|
| Single MP3 preview | 150–400ms | 400–900ms | 1–3s |
| Feature WAV preview | 500ms–1.5s | 1.5–4s | 4–10s+ |
| Entitled stream | 400–800ms | 800ms–2s | 2–5s+ |

(Includes `waitAudioSrcReady` behavior; not lab-measured in this audit.)

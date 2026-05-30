# 03 — Audio Start Latency (Tap → Play → URL → First Byte → Audible)

## End-to-end path diagram

```
User tap
  → playTrack() [AudioContext.js]
  → playTrackInternal()
  → resolvePlaybackSrc() [music-access.js] → libraryStreamRedirectSrc (?redirect=1) OR preview CDN
  → waitAudioSrcReady() → audio.load() → canplay
  → audio.play()
  → onPlaying → perfMark(AUDIO_START_LATENCY_END)
```

## Path A: Entitled full stream (redirect fast-path) — PRIMARY

**Src resolution:** `src/lib/music-access.js` L224–237

```javascript
return libraryStreamRedirectSrc(track.slug, { trackSlug });
// → /api/library/stream?slug=...&redirect=1
```

**Client:** `src/context/AudioContext.js` L1458–1464
- `redirectFastPath = true` → `syncSrc = nextTrack.src` directly
- `backgroundStreamResolve = false` — no upfront JSON fetch

**Server chain** (`src/app/api/library/stream/route.js`):
1. `getFanSessionUser()` / `getGuestUser()` — auth
2. `validateStreamEntitlement()` → `userCanStreamProduct()` — Supabase entitlement query
3. `resolveProductIdBySlug()` — DB
4. Stream session management — DB writes
5. `resolvePlaybackKey()` — R2 key discovery (`src/lib/playback/resolve-playback-key.js`)
6. `getOrCreateStreamSignedUrl()` — R2 presign
7. `proxySignedR2Get()` — streams bytes to client

**Est. server time:** 150–600 ms (cold); 80–200 ms (warm resolver cache 60s TTL in `entity-resolver.js` L21)

**Est. tap→audible:** 300–1200 ms depending on network + audio format + Range request

## Path B: Preview (non-entitled)

**Src:** `catalogPreviewAudioUrl(previewPath)` — direct CDN (`src/lib/media-urls.js`)

**Est. tap→audible:** 150–500 ms — fewer server hops, shorter files

## Path C: JSON stream fetch + HEAD probe (legacy/alternate)

When `isLibraryStreamSrc` but NOT redirect (`src/lib/playback/stream-client.js`):
1. `fetch('/api/library/stream?slug=...')` — JSON with proxy URL
2. `assertSignedAudioUrl(body.url)` — **additional HEAD request** (L25–47, L202)
3. Then client sets audio src

**Extra RTT:** +1 round trip (~50–200 ms mobile)

Used in visibility refresh (`AudioContext.js` L2646) and background resolve paths when non-redirect src present.

## Client timing instrumentation

| Mark | Location | Production? |
|------|----------|-------------|
| `AUDIO_START_LATENCY_START` | `AudioContext.js` L1415 | Dev only |
| `AUDIO_START_LATENCY_END` | `AudioContext.js` L852 (onPlaying) | Dev only |

Measure name: `audio-start-latency` via `perfMeasure()` — logs to console in dev.

## iOS-specific gates

- `unlockAudioFromGesture()` — silent play/pause unlock (L1366–1377)
- `resumeWebAudioContextIfSuspended()` before play (L1393)
- Visibility recover uses `RECOVER` command; iOS may force pause (L2679–2680)

## Web Audio parallel path

`initWebAudio()` creates AnalyserNode chain on first play (L641–662) — small CPU cost at play start, used for atmosphere/visualizer features.

## Findings

1. **Redirect fast-path is correctly wired** for entitled playback via `resolvePlaybackSrc` — avoids JSON+HEAD on normal play.
2. **HEAD probe on JSON path** adds serial latency when that path is hit.
3. **Server-side resolvePlaybackKey** can chain 2–4 Supabase queries + R2 list (`resolve-playback-key.js` L15–55) — dominant server latency.
4. **12s audio ready timeout** (`AUDIO_SRC_READY_TIMEOUT_MS` L67) — long tail before error UX.
5. **No production telemetry** for tap→audible — `reportPlaybackDiagnostic` exists but not aggregated CWV.

## Validation checklist

- [ ] HAR capture: entitled play — count requests before first audio byte
- [ ] Compare redirect=1 vs JSON path latency
- [ ] Server timing headers on `/api/library/stream` (add in validation phase only)
- [ ] iOS: first tap after cold load vs subsequent taps

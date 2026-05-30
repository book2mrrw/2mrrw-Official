# 04 — Streaming Asset Strategy

**Layer:** In-app playback, lock screen, background audio  
**Status:** Proposed — not in production codebase today.

---

## Format selection

| Format | Verdict | Rationale |
|--------|---------|-----------|
| **AAC-LC in .m4a** | **MVP default** | Universal HTML5 `audio` support; Safari + Chrome; smaller than WAV |
| MP3 320 CBR | Fallback tier | Slightly larger; use if AAC tooling constrained |
| FLAC stream | Reject for playback | No mobile win vs master already in bucket |
| **HLS (fMP4)** | Phase 5b optional | Best Safari adaptive startup; more pipeline complexity |
| Opus | Defer | Safari `<audio>` Opus gaps on older iOS |

**Target spec (MVP):**

- Codec: AAC-LC
- Container: MP4 (`.m4a`)
- Sample rate: 48 kHz
- Channels: stereo
- Bitrate: 128 kbps default; 192 kbps “hq” tier for vault/collector marketing optional
- Loudness: −14 LUFS integrated, true peak ≤ −1 dBTP

---

## Key layout

Mirror master entity path under `streaming/`:

```
streaming/singles/hour-glass/hour-glass.m4a
streaming/albums/love-hz-vol-1/track-slug.m4a
```

Aligns with `resolveStoragePath` / `resolvePreviewPath` nesting rules in `canonical-paths.js`.

---

## Startup & decode

| Factor | Master (today) | Stream (proposed) |
|--------|----------------|-------------------|
| Typical file size | 30–80+ MB WAV | 3–5 MB @ 128 kbps / 4 min |
| First 64 KiB decode | PCM header + data | AAC priming frame — **Projection:** faster parse |
| Range requests | Supported via proxy | Same; smaller ranges satisfy startup |
| iOS gapless | Single file OK | HLS optional later for gapless albums |

**Measured baseline to beat:** CDN range TTFB **954 ms** (preview MP3, Phase 4.7). Stream files shrink download volume; TTFB may remain CDN-bound — **Projection:** 20–40% total tap→audible improvement when combined with warm API caches (4.8).

---

## Bandwidth model (projection)

Assume 4-minute track:

| Asset | Est. size | Confidence |
|-------|-----------|------------|
| WAV 44.1/16 stereo | ~42 MB | High (arithmetic) |
| AAC 128 kbps | ~3.8 MB | High |
| Preview MP3 ~832 KB | **Measured** full download 2131 ms total (4.7) | High |

Full listen saves **~90%** egress vs WAV stream at same duration (**Projection**).

---

## Mobile Safari & Android

| Platform | Notes |
|----------|-------|
| iOS Safari | AAC in MP4 — native; keep same-origin proxy until CDN signing proven |
| iOS lock screen | Unchanged Media Session via `AudioContext` |
| Android Chrome | AAC-LC standard |
| Low Power Mode | Smaller files reduce stall risk — **Projection** |
| Bluetooth / CarPlay | No format change vs AAC industry norm |

**Safari constraint:** Do not rely on WebCodecs transcode in browser — all transcoding server-side.

---

## Preview relationship

Previews stay in `previews/` for guests. Optional future: generate preview from stream stem (30–60s) — **not MVP**. Folder preview API (`/api/media/preview`) remains; avoid extra hop by emitting direct CDN URLs in catalog when possible (Phase 4.7 P1 S3).

---

## Cache headers

| Object | Cache-Control |
|--------|---------------|
| Public preview | `public, max-age=300` (current preview route L69) |
| Stream via proxy | `private, no-store` (current proxy L21) |
| CDN signed stream (5b) | `private, max-age=60` + short presign TTL |

---

## Quality tiers (optional)

| Tier | Bitrate | Entitlement gate |
|------|---------|------------------|
| standard | 128 kbps | all stream-entitled |
| hq | 192 kbps | collector / vault tier (marketing) |

Resolver picks tier by entitlement flag — **server-side only**, never client override.

---

## Tooling (implementation phase)

- FFmpeg batch: `ffmpeg -i master.wav -c:a aac -b:a 128k -movflags +faststart out.m4a`
- `faststart` moov atom front — improves Range startup (**Projection** −50–150 ms buffer time)

Validation: golden-ear spot check + automated loudness + duration match ± 50 ms.

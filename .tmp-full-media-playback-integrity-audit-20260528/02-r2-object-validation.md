# 02 — R2 object validation (public CDN)

**CDN:** `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` (from `.env.example`)  
**Origin:** `https://www.2mrrw.com`  
**Raw probes:** `curl-probes.txt`

## Summary

| Category | Result |
|----------|--------|
| All 6 storefront previews | **200** + CORS |
| Single MP3 masters (4) | **200/206** + CORS |
| Feature WAV masters (2) | **404** on public CDN |
| Capital `Singles/` path | **404** |
| `digital-assets/features/` path | **404** |
| Legacy r2.dev host | **401** |

## Previews (public)

| Object | HTTP | Content-Type |
|--------|------|--------------|
| `previews/hourglass-preview.mp3` | 200 | audio/mpeg |
| `previews/i-dont-believe-you-preview.wav` | 200 | audio/wav |
| `previews/2-heavy-preview.wav` | 200 | audio/wav |
| `previews/w2d-preview.mp3` | 200 | audio/mpeg |
| `previews/artificial-preview.mp3` | 200 | audio/mpeg |
| `previews/turntme2dis-preview.mp3` | 200 | audio/mpeg |

## Full masters (public CDN HEAD/Range)

| Key | HTTP | Notes |
|-----|------|-------|
| `digital-assets/singles/hour-glass/audio.mp3` | **206** (Range 0-1023) | CORS + Content-Range |
| `digital-assets/singles/w2d/audio.mp3` | 200 | |
| `digital-assets/singles/artificial/audio.mp3` | 200 | |
| `digital-assets/singles/turnt-me-2-dis/audio.mp3` | 200 | |
| `digital-assets/singles/i-dont-believe-you/audio.wav` | **404** | Preview OK; master not on public CDN |
| `digital-assets/singles/2-heavy/audio.wav` | **404** | Same |

**Interpretation:** Feature WAV masters are either private-only (signed URL only) or **missing from bucket**. Singles MP3 masters are world-readable on public CDN (security note, not a preview blocker).

## Non-canonical paths (expected 404)

- `digital-assets/Singles/hour-glass/audio.mp3` → 404
- `digital-assets/features/i-dont-believe-you/audio.wav` → 404

## CORS / Range

- `Access-Control-Allow-Origin: https://www.2mrrw.com` on 200/206 responses
- `Accept-Ranges: bytes` on previews and single masters

## Signed playback (not probed live)

Presigned GET uses S3 API endpoint, not r2.dev. Public 404 on feature masters does **not** prove signing fails — requires entitled session + bucket HEAD on same keys.

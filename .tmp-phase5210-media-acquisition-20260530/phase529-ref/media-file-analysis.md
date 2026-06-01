# Phase 5.2.9 — Media File Analysis

**Representative assets:** Hour Glass preview MP3, Hour Glass master MP3, IDBU preview WAV (catalog references)

---

## Hour Glass preview MP3 (canonical)

| Property | Value |
|----------|-------|
| **R2 key** | `previews/singles/hour-glass/hourglass-preview.mp3` |
| **Size** | **831,656 bytes** (~812 KiB) |
| **Content-Type** | `audio/mpeg` |
| **Accept-Ranges** | `bytes` |
| **Container** | MP3 with **ID3v2 at byte 0** (`49 44 33` = `ID3`) |
| **Tag footprint** | Large ID3v2 header region before first audio frame (~8 KB+ visible in first 128 KiB hex dump) |
| **Startup friendliness** | **Good** — ID3 at start; no moov atom (MP3). Browser can parse duration/metadata after initial byte window. Not faststart (N/A for MP3). |

**Hex (first bytes):**

```
00000000: 4944 3302 0000 0000 1f76 5453 53 ...  ID3......vTSS...
```

**Implication for src→metadata:** Player must fetch through ID3 region + locate first MPEG frame sync — typically **one small Range** or progressive download. Residual parse **~15–55 ms** after TTFB (estimate).

---

## Hour Glass master MP3 (entitled stream target)

| Property | Value |
|----------|-------|
| **R2 key** | `digital-assets/singles/hour-glass/audio.mp3` (lowercase `singles`) |
| **HEAD** | **200**, `audio/mpeg` (probe 2026-05-31) |
| **Wrong key** | `digital-assets/Singles/...` → **404** |
| **Startup** | MP3 + likely ID3 — similar to preview; file may be larger → slightly longer first-byte window if player buffers more |

---

## IDBU preview WAV (catalog legacy flat path)

| Property | Value |
|----------|-------|
| **Flat CDN** | `/previews/i-dont-believe-you-preview.wav` → **404** (HTML error page in probe) |
| **Entity nested** | `/previews/features/i-dont-believe-you/...` → **404** on probed paths |
| **Historical size** | ~5.2 MB (Phase 5.2.5 curl) when object existed |
| **WAV structure** | RIFF `WAVE` — `fmt` + `data` chunks; metadata often early in file but **no index** like faststart MP4 |
| **Startup vs MP3** | WAV previews **slower** when large: more bytes before decode pipeline stable; **requires-device-run** on live object |

---

## MP3 vs WAV vs MP4 (platform)

| Format | Header for metadata | src→metadata impact |
|--------|---------------------|---------------------|
| MP3 + ID3 front | ID3 size field + sync frame | Low–medium parse after TTFB |
| WAV | RIFF header ~44 B + PCM | Low parse if `data` chunk follows early |
| MP4/AAC | `moov` at end = bad; at start = faststart | Not used for Hour Glass preview |

---

## Range request behavior

| Request | Response | Notes |
|---------|----------|-------|
| `Range: bytes=0-1023` | **206**, 1024 B | TTFB **~195 ms** |
| `Range: bytes=0-65535` | **206**, 65536 B | TTFB **~131 ms**, +28 ms transfer |

Safari/iOS typically issues byte-range media requests — **TTFB on first Range** is the metric that maps to Resource Timing `responseStart`.

---

## Ops checklist (forensic)

- Upload previews only under **entity folders** (`previews/singles/{slug}/…`).
- Avoid flat `previews/{name}-preview.mp3` in catalog URLs (404 on prod).
- Prefer **MP3 previews** over large WAV for guest startup.
- Keep ID3 tags reasonable size (<32 KiB) to minimize bytes-before-audio-frame.

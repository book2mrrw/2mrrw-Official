# Media Header — Preview MP3 / Master / WAV

**Probe date:** 2026-05-31

---

## Hour Glass preview MP3 (canonical)

| Property | Value |
|----------|-------|
| **Key** | `previews/singles/hour-glass/hourglass-preview.mp3` |
| **Size** | **831,656 bytes** |
| **Content-Type** | `audio/mpeg` |
| **Accept-Ranges** | `bytes` |
| **Container** | MP3, **ID3v2 at byte 0** (`49 44 33`) |

**ID3 (Range 0–8191 probe):**

| Field | Value |
|-------|-------|
| synchsafe tag size | **4086** |
| Total skip before frames | **4096** bytes (10 + tag) |

**Hex (first 32 B):**

```
ID3......vTSS... Logic Pro 11.1.
```

**moov / faststart:** N/A (MP3).

**Range efficiency:** `bytes=0-1023` → **206** in **115–210 ms** TTFB — sufficient for ID3 header + start of tag. Safari typically requests small initial Range — maps to `loadedmetadata` network wait.

**Parse residual:** After TTFB, browser scans **~4 KiB ID3** + finds first MPEG sync — **~15–55 ms** (Phase 5.2.9 estimate; confirm via `dumpPlaybackTiming().sourceAcquisitionAttribution.estimatedParseAndDispatchMs`).

---

## Hour Glass master MP3 (entitled)

| Property | Value |
|----------|-------|
| **Key** | `digital-assets/singles/hour-glass/audio.mp3` |
| **HEAD** | **200**, **141 ms** TTFB |
| **Range 0-1023** | **206**, **187 ms** TTFB |

Larger file may increase buffer before metadata on some engines — **requires-device-run**.

---

## WAV preview (catalog)

| Path | Result |
|------|--------|
| `previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav` | **404** HTML (Cloudflare error page) |
| Flat `previews/i-dont-believe-you-preview.wav` | **404** (Phase 5.2.9) |

No live WAV header to analyze on prod — when present, RIFF `WAVE` header ~44 B; large PCM **data** chunk slows startup vs MP3.

---

## MP3 vs WAV vs MP4

| Format | Metadata location | Acquisition note |
|--------|-------------------|------------------|
| MP3 + front ID3 | Bytes 0–4096+ | One Range often enough |
| WAV | RIFF early | Large files hurt if player buffers deep |
| MP4/AAC | `moov` placement | Not used for Hour Glass preview |

---

## Wrong URL impact

Legacy flat redirect → **404 HTML** — parser receives HTML, not audio — **infinite wait** or error, not slow metadata.

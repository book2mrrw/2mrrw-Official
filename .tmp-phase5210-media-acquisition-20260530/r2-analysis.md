# R2 — Edge-to-Origin Latency

**Public CDN:** `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`  
**Code fallback:** `R2_PUBLIC_CDN_FALLBACK` in `src/lib/storage/r2-public-cdn.js`  
**Probe date:** 2026-05-31

---

## Architecture

```
Browser/curl → Cloudflare edge (CF-RAY *-DFW) → R2 public bucket object
```

Entitled **signed** URLs use `*.r2.cloudflarestorage.com` — proxied via Next.js (`r2-stream-proxy.js`) so browser never hits S3 endpoint CORS.

Preview uses **unsigned** public `r2.dev` URL in **302 Location**.

---

## Response latency (first byte)

| Object | Method | TTFB (ms) | Size |
|--------|--------|-----------|------|
| `hourglass-preview.mp3` | HEAD | **110–145** | 831,656 B |
| Same | Range 0-1023 | **115–210** | 1024 B |
| `audio.mp3` (master) | HEAD | **141** | (entitled target) |
| Same | Range 0-1023 | **187** | 1024 B |

**Phase 5.2.9 anchor:** **131–195 ms** on Range 1k — same population, probe variance.

---

## Edge-to-origin indicators

| Header | Value |
|--------|-------|
| `Server` | `cloudflare` |
| `CF-RAY` | `…-DFW` (Dallas POP from probe egress) |
| `ETag` | `"d69eafd8c7b91fd732ef4b1caed614fb"` |
| `Last-Modified` | `Fri, 29 May 2026 18:06:24 GMT` |
| `CF-Cache-Status` | **Absent** on audio |

**Interpretation:** Latency is **edge-terminated fetch to R2**, not a labeled CDN HIT. First-byte **~110–210 ms** is the operational **R2+edge** budget for US-central egress.

---

## Wrong keys (ops)

| Key pattern | Result |
|-------------|--------|
| `digital-assets/Singles/...` (capital S) | **404** |
| `digital-assets/singles/hour-glass/audio.mp3` | **200** |
| Flat `previews/hourglass-preview.mp3` | **404** |

404 still costs **~120 ms** TTFB — failed acquisition, not slow metadata.

---

## Signed vs public

| Access | URL type | Browser sees |
|--------|----------|--------------|
| Preview | Public `r2.dev` | Cross-origin CDN |
| Entitled `redirect=1` | Presigned S3 URL fetched **server-side** | Same-origin `www.2mrrw.com` bytes |

R2 **origin read** latency applies to both; entitled adds **Vercel→R2 proxy hop** (`timing.mark("cdn")`).

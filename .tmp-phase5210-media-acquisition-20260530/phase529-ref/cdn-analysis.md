# Phase 5.2.9 — CDN / Edge Analysis

**Production:** `www.2mrrw.com` (Vercel) → `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` (Cloudflare R2 public)  
**Probe date:** 2026-05-31

---

## Preview discovery path

```
Browser → GET /api/media/preview?folder=previews/singles/hour-glass/
         → 302 Location: https://pub-643…/previews/singles/hour-glass/hourglass-preview.mp3
         → GET CDN (Range or full)
         → audio.src (may skip API if catalog already has CDN URL)
```

| Hop | Status | Cache | Timing |
|-----|--------|-------|--------|
| Vercel API | **302** | `x-vercel-cache: MISS`, `cache-control: public, max-age=300` | redirect ttfb **~362 ms** |
| Full `-L` chain | **200** | — | **~1.21 s** total |
| CDN direct Range 1k | **206** | ETag present; no `cf-cache-status` on R2 dev | ttfb **~131–195 ms** |

---

## CDN cache hit/miss

| Layer | Observation |
|-------|-------------|
| Vercel preview API | **MISS** on probe; 300s max-age — repeat may hit edge |
| R2 public (`pub-643…`) | `Server: cloudflare`, `CF-RAY: …-DFW`; **no `CF-Cache-Status`** header on audio responses |
| Interpretation | Public r2.dev objects served via Cloudflare; treat as **origin-close** latency, not guaranteed edge HIT |

**HEAD/GET headers (nested MP3):**

```
HTTP/1.1 200 OK
Content-Type: audio/mpeg
Content-Length: 831656
Accept-Ranges: bytes
ETag: "d69eafd8c7b91fd732ef4b1caed614fb"
Server: cloudflare
```

**Range 206:**

```
Content-Range: bytes 0-1023/831656
```

Browsers use Range for media — TTFB on small Range is the relevant src→metadata network proxy.

---

## Broken / legacy paths (404)

| Path | curl code |
|------|-----------|
| `/previews/hourglass-preview.mp3` (flat) | **404** |
| `/previews/w2d-preview.mp3` | **404** |
| `/previews/i-dont-believe-you-preview.wav` (flat) | **404** (HTML error body) |
| `/digital-assets/Singles/hour-glass/audio.mp3` (capital S) | **404** |

**Canonical preview:** `/previews/singles/hour-glass/hourglass-preview.mp3` → **200**

**Master (entitled path probe):** `/digital-assets/singles/hour-glass/audio.mp3` → **200**

---

## Stream API (entitled baseline)

```
GET /api/library/stream?slug=hour-glass&redirect=1
→ 401 (unauthenticated guest)
```

Guest gap vs entitled: **401 JSON** is fast; client must fall back to preview CDN. Entitled redirect chain not measured without session cookie — **requires-device-run** with subscriber session.

---

## TTFB contributors (ranked)

1. **Geographic RTT** to DFW edge (CF-RAY suffix) — **~80–120 ms** baseline
2. **R2 origin read** first byte — bundled into TTFB
3. **302 API redirect** (preview path only) — **+200–850 ms** before CDN fetch starts

---

## Recommendations (forensic only — not implemented)

Documented for future phases; **no changes in 5.2.9:**

- Ensure catalog never emits flat 404 CDN URLs.
- Consider embedding final CDN URL in SSR when stable to skip API 302 on hot path.
- Verify `Timing-Allow-Origin` on R2 public bucket for full Resource Timing in dev.

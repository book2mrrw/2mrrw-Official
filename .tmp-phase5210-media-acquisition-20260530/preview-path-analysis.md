# Preview Path — `/api/media/preview`

**Route:** `src/app/api/media/preview/route.js`  
**Probe date:** 2026-05-31  
**Representative:** `?folder=previews/singles/hour-glass/`

---

## Redirect count

| Step | HTTP | Notes |
|------|------|-------|
| 1 | **302** | `Location: https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/previews/singles/hour-glass/hourglass-preview.mp3` |
| 2 | **200/206** | CDN fetch (browser or `curl -L`) |

**Redirect count:** **1** (Vercel → R2 public CDN). No intermediate hops.

Fast path (`tryCanonicalPreviewFastPath`) skips R2 list/discovery when canonical slug matches — still emits **302**, not inline bytes.

---

## Redirect duration (isolated)

| Mode | Metric | ms |
|------|--------|-----|
| API only (no follow), Vercel **STALE** | `time_starttransfer` | **391** |
| API only, Vercel **HIT** | `time_starttransfer` | **141** |
| API only, 5× HIT runs | TTFB | **138–208** (median ~**139**) |
| `-L -r 0-0` (1 redirect, minimal body) | `time_redirect` | **198** |
| Same chain | `time_total` | **315** |
| `-L` full **831,656 B** MP3 | `time_total` | **3485** (download-dominated) |

**Interpretation:** Phase 5.2.9 **~1.21 s** “redirect chain” is the **API+CDN network path** when not conflated with full-file download; this probe’s **315 ms** range-chain is the **metadata-relevant** ceiling. Full `curl -L` without Range measures **transfer**, not tap→`loadedmetadata`.

---

## Asset fetch (CDN)

After 302, browser opens **new origin** (`pub-643…r2.dev`) unless preconnected.

| Request | Code | TTFB (ms) | Body |
|---------|------|-----------|------|
| `Range: bytes=0-1023` | **206** | **115–210** | 1024 B |
| `Range: bytes=0-65535` | **206** | **227** starttransfer | 65536 B |
| HEAD | **200** | **110–145** | 0 |

**Cache ratio (Vercel API):**

| `x-vercel-cache` | Observed TTFB |
|------------------|---------------|
| **HIT** | **~139 ms** (5-run median) |
| **STALE** / **MISS** | **~260–391 ms** |

`cache-control: public, max-age=300, stale-while-revalidate=600` — repeat visitors amortize API hop.

**CDN cache:** No `cf-cache-status` on R2 dev audio; **ETag** + **Accept-Ranges** present. Treat as **per-request origin read** latency.

---

## Code path segments (Server-Timing names)

On origin execution (local Phase 4.8 / uncached): `fastpath` → `resolve` (optional) → `redirect` → `total`.

Production edge-cached 302: **no `Server-Timing` header in response** (probe 5.2.10) — segment breakdown unavailable on HIT.

---

## Legacy / broken redirects

| Query | Location | CDN result |
|-------|----------|------------|
| `?legacy=previews/hourglass-preview.mp3` | Flat `…/previews/hourglass-preview.mp3` | **404** at CDN |
| Canonical folder | Nested `…/previews/singles/hour-glass/hourglass-preview.mp3` | **200/206** |

API still returns **302** for legacy param (**261 ms** TTFB MISS) — client then fails on CDN 404.

---

## Tap → API → Resolver → Signed URL

Preview path uses **public CDN URL** (`getPublicR2Url`) — **no signing**. Resolver:

- Fast path: canonical catalog key (**no R2 list**).
- Slow path: `getOrResolvePreviewMedia` (60s in-memory cache per folder).

Prewarm (Phase 5.2.6) warms **descriptor/URL**, not bytes — saves repeat API only if same discovery URL used.

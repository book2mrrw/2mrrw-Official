# Latency Model — Best / Expected / Worst Case

**Data sources:** Phase 5.2.10 `curl-measurements.txt`, `preview-path-analysis.md`, `play-path-domains.js`  
**Representative asset:** `hourglass-preview.mp3` (831,656 B)  
**Probe host:** `www.2mrrw.com` → `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`

---

## Stage reference (ms)

| Stage | Symbol | HIT / warm | STALE / MISS | Direct CDN |
|-------|--------|------------|--------------|------------|
| DNS+TCP+TLS (API, same-origin) | — | ~75 | ~75 | 0 (skipped) |
| Preview API TTFB | **A** | **141** | **391** | **0** |
| Browser redirect follow | **R** | **198** | **198** | **0** |
| CDN TTFB (Range 1k) | **C** | **115–145** | **210** | **115–210** |
| Cold CDN connect penalty | **T** | 0 (preconnect) | 0–150 | 0–150 |
| ID3 parse (4096 B) | **I** | **15–55** | **15–55** | **15–55** |

---

## Model A — Current path (API → 302 → CDN)

Tap → first CDN byte → metadata-ready

| Case | Formula | ms | Notes |
|------|---------|-----|-------|
| **Best** | A(HIT) + R + C(low) + I | 141 + 198 + 115 + 20 ≈ **474** | Vercel HIT, preconnected CDN, warm TLS |
| **Expected** | A(HIT) + R + C(med) + I | 141 + 198 + 130 + 35 ≈ **504** | Median 5-run API ~139 ms + CDN ~130 ms |
| **Worst** | A(MISS) + R + C(high) + T + I | 391 + 198 + 210 + 150 + 55 ≈ **1004** | STALE API + cold CDN TLS |

**Phase 5.2.10 range chain (metadata only):** **315 ms** (`-L -r 0-0`, redirect 198 ms) — excludes ID3.

---

## Model B — Direct CDN (bypass API)

Tap → CDN first byte → metadata-ready

| Case | Formula | ms | Notes |
|------|---------|-----|-------|
| **Best** | C(low) + I | 115 + 20 ≈ **135** | Preconnect active, CDN warm |
| **Expected** | C(med) + I | 130 + 35 ≈ **165** | Typical mobile |
| **Worst** | C(high) + T + I | 210 + 150 + 55 ≈ **415** | Cold TLS to CDN, no preconnect |

---

## Delta — Expected gain (current vs direct)

| Case | Current (ms) | Direct (ms) | **Saved (ms)** |
|------|-------------|-------------|----------------|
| **Best** | ~474 | ~135 | **~340** |
| **Expected** | ~504 | ~165 | **~340** |
| **Worst** | ~1004 | ~415 | **~590** |

### Decomposed savings

| Removed segment | ms saved (expected) |
|-----------------|---------------------|
| Preview API TTFB alone | **140–390** |
| Redirect hop alone | **~198** |
| Combined (non-additive with overlap) | **~340** typical |

**Conservative headline for recommendation:** **140–390 ms** (API elimination, warm CDN) — matches Phase 5.2.10 primary contributor ranking.

**Optimistic headline with redirect + preconnect:** **~340 ms** tap→first-byte on expected path.

---

## Cache behavior comparison

### Vercel edge (preview API)

```
cache-control: public, max-age=300, stale-while-revalidate=600
```

| `x-vercel-cache` | TTFB observed |
|------------------|---------------|
| HIT | ~138–146 ms (5-run median ~139) |
| STALE | ~391 ms |
| MISS | ~261 ms (legacy param probe) |

**Repeat tap within 5 min:** Amortizes API to ~141 ms — still **141 ms overhead** vs zero.

### In-memory server caches (origin only)

| Cache | TTL | Scope |
|-------|-----|-------|
| `preview-resolution-cache` | 60 s | Per server instance |
| `entity-resolver` discovery | 60 s | R2 list results |

**Edge HIT bypasses origin caches entirely** — direct CDN eliminates both edge and origin from guest path.

### CDN (R2 public)

- No reliable `cf-cache-status` on audio probes
- ETag + Accept-Ranges present
- Treat as **~115–210 ms origin-close latency** per request
- **Unchanged** by API bypass — same object, one fewer hop before fetch starts

---

## Preconnect effect (`PlaybackNetworkHints`)

Documented savings when CDN preconnect runs before first play:

| | ms |
|--|-----|
| Low | 40 |
| Typical | 80 |
| High | 150 |

Direct CDN benefits **more** from preconnect (first request is CDN, not API). API path uses same-origin for step 1 — preconnect only helps post-redirect.

---

## Browser vs curl

| Effect | curl | Mobile Safari |
|--------|------|---------------|
| Redirect follow | Explicit `-L` | Automatic on `audio.src` |
| Connection pool | Separate handles | May reuse if same CDN origin |
| Parallelism | Sequential | API then CDN sequential |
| **Typical delta** | Baseline | +0–50 ms JS/main thread |

Models above use curl TTFB; browser may add **0–50 ms** on tap path.

---

## Scenarios not in guest preview model

| Path | TTFB | Notes |
|------|------|-------|
| Guest `/api/library/stream` | 182–265 (401) | Blocks entitled bytes; triggers preview fallback |
| Entitled stream JSON + signed HEAD | Not probed (auth required) | Separate optimization scope |
| Full MP3 download | 3.5+ s | Not metadata latency |

---

## Summary table (executive)

| Metric | Best | Expected | Worst |
|--------|------|----------|-------|
| **Current tap→CDN byte** | ~335 ms | ~470 ms | ~800 ms |
| **Direct CDN tap→byte** | ~115 ms | ~130 ms | ~360 ms |
| **Gain** | **~220 ms** | **~340 ms** | **~440 ms** |
| **API-only gain** | 141 ms | 141 ms | 391 ms |

**Recommended planning figure:** **~250 ms expected improvement** on first guest preview tap after partial bypass (API + redirect removed, warm CDN with preconnect).

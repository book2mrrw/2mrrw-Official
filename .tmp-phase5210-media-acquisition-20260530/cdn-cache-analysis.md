# CDN Cache Analysis — Vercel Edge vs R2 Public

**Probe date:** 2026-05-31

---

## Layers

| Layer | Host | Cache signal | Role |
|-------|------|--------------|------|
| **Vercel** | `www.2mrrw.com` | `x-vercel-cache: HIT \| MISS \| STALE` | Caches **302 redirect response** for preview API |
| **Cloudflare** | `pub-643…r2.dev` | `Server: cloudflare`, `CF-RAY: …-DFW` | Terminates TLS; **no `CF-Cache-Status`** on probed audio |
| **R2** | Object store behind public bucket | `ETag`, `Last-Modified` | Origin for bytes |

---

## Vercel preview API — hit vs miss TTFB delta

| State | Example TTFB | Δ vs HIT |
|-------|--------------|----------|
| **HIT** | **139 ms** (5-run median) | baseline |
| **STALE** | **391 ms** | **+252 ms** |
| **MISS** (legacy query) | **261 ms** | **+122 ms** |

**Cache ratio:** Under sustained probing, API quickly **HIT**s (`age` increments). First visitor or stale revalidation pays **+120–250 ms**.

`cache-control: public, max-age=300` — redirect target URL stable for 5 minutes per folder.

---

## R2 public CDN — hit vs miss

**Observation:** Audio GET/HEAD/206 responses lack `CF-Cache-Status`. Public `r2.dev` URLs behave as **dynamic origin fetch** per request from curl’s perspective.

| Probe | TTFB spread | Interpretation |
|-------|-------------|----------------|
| Range 1k, 5 runs | **115–210 ms** | Edge variance, not HIT/MISS labeled |
| HEAD | **110–145 ms** | Same band as Phase 5.2.9 **131–195 ms** |

**Estimated cache hit vs miss delta:** **Not measurable** from headers; assume **0–50 ms** edge benefit if object hot at POP — dominated by **RTT + R2 read (~80–130 ms)**.

---

## TTFB contributors at CDN (ranked)

1. **Geographic RTT** to DFW (`CF-RAY` suffix) — **~25–40 ms** TLS+connect when warm
2. **R2 first-byte read** — bulk of **110–210 ms** `time_starttransfer`
3. **Range size** — 64 KiB range **227 ms** vs 1 KiB **120–210 ms** (slightly higher starttransfer)

---

## Broken paths (404 TTFB)

Flat `previews/hourglass-preview.mp3`: **121 ms** TTFB then 404 — same network cost, **zero audio**.

---

## Recommendations (forensic only — not implemented)

- Skip API 302 when SSR/catalog already has nested CDN URL (**−141–391 ms**).
- Do not rely on `cf-cache-status` for R2 dev SLA; measure **Range TTFB** per market.
- Add `Timing-Allow-Origin` on R2 bucket if full cross-origin Resource Timing needed in dev.

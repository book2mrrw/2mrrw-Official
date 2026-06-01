# Phase 5.2.10 — Media Acquisition & CDN Latency Root-Cause Analysis

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Scope:** Forensic only — no playback, resolver, entitlement, queue, or hybrid changes  
**Builds on:** Phase 5.2.9 (`phase529-source-acquisition-20260530.zip`)  
**Zip:** `/Users/recharge/Downloads/phase5210-media-acquisition-20260530.zip`

---

## Executive summary

Phase 5.2.10 isolates **where milliseconds accumulate** from tap through preview redirect, entitled stream API, signed URL issuance, and **R2 public CDN first byte**. Live `curl` probes on `www.2mrrw.com` (2026-05-31T17:31Z) confirm Phase 5.2.9 findings and add **Vercel edge cache state**, **redirect-phase timing**, and **range-only vs full-download** distinction for the “~1.21 s path.”

**Primary explanations:**

| Phenomenon | Root cause | Measured |
|------------|------------|----------|
| **CDN/R2 first-byte 131–195 ms** | Cloudflare edge (DFW, `CF-RAY`) + R2 public object read; no `CF-Cache-Status` on audio — treated as origin-close latency | Direct Range `bytes=0-1023`: **115–210 ms** TTFB (5 runs); Phase 5.2.9: **131–195 ms** |
| **Preview API ~362 ms TTFB** | Vercel function + redirect build on **edge MISS/STALE**; not CDN | API-only 302: **391 ms** (STALE/MISS); **141 ms** when `x-vercel-cache: HIT` |
| **“~1.21 s redirect chain”** | **Two hops** (API 302 + CDN) **plus** often conflated with **full MP3 download** (831 KiB) | `-L` full file: **3.49 s** total (this probe); **metadata-relevant** `-L -r 0-0`: **314 ms** total (`redirect` **198 ms**) |

Production responses **do not emit** `Server-Timing` / `X-Playback-Timing` on cached Vercel 302s (headers only in CORS `expose-headers`). Segment timings from Phase 4.8 apply on **origin MISS** or **local `next start`** — see `signed-url-analysis.md`.

---

## TOP 3 contributors (exact ms)

| Rank | Stage | ms | Evidence |
|------|-------|-----|----------|
| **1** | **Preview API 302 (before `audio.src`)** | **141–391** TTFB; **~198** redirect phase in range chain | `curl-measurements.txt` §1a/1b, §range_chain; Phase 5.2.9 **362 ms** MISS |
| **2** | **CDN/R2 first response byte** (after redirect or direct `src`) | **115–210** (Range 1k); **109–145** HEAD | `curl-measurements.txt` §3; Phase 5.2.9 **131–195** |
| **3** | **Cold DNS/TCP/TLS to CDN** (no preconnect) | **+40–150** documented; **+~220** connect on forced cold | `play-path-domains.js`; curl cold HEAD **332 ms** TTFB vs warm **110 ms** |

**Residual (browser-only):** MP3 **ID3v2 ~4096 B** before first frame → **~15–55 ms** parse/dispatch (`media-header-analysis.md`).

**Not ranked (out of scope or fast):** Guest stream **401** **182–265 ms** TTFB — blocks entitled bytes but preview fallback is separate; entitled signed path **requires-device-run**.

---

## Stage waterfall (guest preview, API discovery path)

```
Tap → (client) → GET /api/media/preview → 302 Location (CDN URL)
     → GET CDN Range → first byte → ID3/frames → loadedmetadata
```

| Stage | Independent probe | ms (2026-05-31) |
|-------|-------------------|-----------------|
| API resolver + redirect | `curl` no follow | **141** (HIT) / **391** (STALE) |
| Redirect hop (client + CDN connect) | `time_redirect` in `-L -r 0-0` | **~198** |
| CDN first byte | Direct Range 1k | **115–210** |
| Metadata parse | ID3 size 4096 B | **~15–55** (estimate) |

**Sum (cold API + warm CDN, metadata path):** ~391 + 198 + 130 ≈ **719 ms** upper bound before parse; **warm Vercel:** ~141 + 198 + 120 ≈ **459 ms**.

Skipping API when catalog embeds CDN URL removes **141–391 ms** from tap→bytes.

---

## Deliverables

| File | Contents |
|------|----------|
| `preview-path-analysis.md` | `/api/media/preview` redirect count, cache, duration |
| `entitled-path-analysis.md` | `/api/library/stream`, 401 guest, entitled gap |
| `cdn-cache-analysis.md` | Vercel vs R2 cache headers, TTFB delta |
| `connection-reuse-analysis.md` | keep-alive, TLS, preconnect |
| `r2-analysis.md` | Edge, DFW, origin latency |
| `signed-url-analysis.md` | Server-Timing segments, stream-url-cache |
| `media-header-analysis.md` | ID3, range, MP3/WAV |
| `platform-comparison.md` | Browser vs curl |
| `curl-measurements.txt` | Raw probes |
| `manifest.txt` | File list |

---

## Validation

| Check | Result |
|-------|--------|
| Source changes | **None** |
| `npm run build` | **Skipped** (no src edits) |
| Device Resource Timing | **requires-device-run** |

---

## STOP

No fixes, commits, push, or deploy.

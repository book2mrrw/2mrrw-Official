# Signed URL — Signing Duration & Cache

**Code:** `createR2SignedGetUrl`, `getOrCreateStreamSignedUrl` (`stream-url-cache.js`)  
**Route:** `src/app/api/library/stream/route.js` — `timing.mark("sign", cacheHit ? "cache_hit" : undefined)`

---

## Server-Timing segments (stream route)

| Segment | When | Production visibility |
|---------|------|----------------------|
| `auth` | Session/guest lookup | **401 only** — no timing header on prod curl |
| `entitlement` | `userCanStreamProduct` | Entitled only |
| `resolve` | `resolvePlaybackKey` | desc: stream/preview/master |
| `product` | `resolveProductIdBySlug` | If needed |
| `session` | Stream session rows | DB |
| `sign` | `createR2SignedGetUrl` | desc `cache_hit` when URL reused |
| `cdn` | `proxySignedR2Get` fetch | `redirect=1` only |
| `total` | Wall clock | — |

**Production curl (2026-05-31):** Responses expose `Server-Timing` in CORS `access-control-expose-headers` but **no `Server-Timing` response header** on Vercel-cached or guest **401** responses. Segment ms require **origin MISS** or **local `next start`** (Phase 4.8).

---

## Phase 4.8 reference (local production build)

| Endpoint | HTTP | TTFB | Server-Timing |
|----------|------|------|---------------|
| stream `redirect=1` hour-glass | 401 | **7 ms** cold | `auth=0.3`, `total=0.5` |
| stream warm | 401 | **3 ms** | `auth=0.3`, `total=0.4` |

Guest **401** is **auth-only** — signing segments **not executed**.

**Preview API (local):** `fastpath=0.1`, `redirect=0`, `total=0.1` ms on warm — signing **N/A** (public URL redirect).

---

## stream-url-cache behavior

| Property | Value |
|----------|-------|
| TTL | `STREAM_SIGNED_URL_TTL_SECONDS - 5min` (min 60s) |
| Key | `userId:slug` or `userId:slug:trackSlug` |
| Inflight dedup | Concurrent sign coalesced |
| `cacheHit` | Passed to `timing.mark("sign", "cache_hit")` |

**Signing duration estimate:**

- **Cache hit:** **<1 ms** (map lookup)
- **Cache miss:** **1–30 ms** typical presign (not measured on prod entitled — **requires-device-run**)

---

## Preview path (no signing)

`/api/media/preview` uses `getPublicR2Url(key)` — **zero signing**. Latency is resolver + **302** only.

`preview-resolution-cache.js`: 60s TTL for resolved R2 keys — reduces R2 list/discovery, not CDN TTFB.

---

## Proxy vs redirect to signed host

| Mode | Client `src` | Signing | CDN TTFB seen by browser |
|------|--------------|---------|--------------------------|
| `redirect=1` | Same-origin stream URL | Yes | Vercel buffers R2; `cdn` segment |
| JSON `url` + proxy src | `/api/library/stream?…` | Yes | Same proxy path |

Browser never loads `*.r2.cloudflarestorage.com` directly (CORS).

---

## Forensic note

To capture `sign` and `cdn` ms in production:

1. Authenticated entitled session.
2. Force cache miss (`force=true` in dev only) or new slug.
3. Inspect **uncached** response `Server-Timing` header (if Vercel forwards it from origin).

Otherwise use **HAR** `waiting` time on stream response minus JSON baseline.

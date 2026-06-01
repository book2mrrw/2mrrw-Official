# Entitled Path — `/api/library/stream`

**Route:** `src/app/api/library/stream/route.js`  
**Proxy:** `proxySignedR2Get` when `redirect=1`  
**Probe date:** 2026-05-31

---

## Guest (unauthenticated / no entitlement)

| Request | HTTP | TTFB (ms) | Body |
|---------|------|-----------|------|
| `?slug=hour-glass&redirect=1` | **401** | **265** | `{"error":"Unauthorized"}` |
| `?slug=hour-glass` (JSON mode) | **401** | **183** | same |

`x-vercel-cache: MISS` — expected (dynamic auth).

**Guest gap:** Client typically attempts stream API first, receives **401 in ~180–265 ms**, then falls back to preview CDN/API. That gap is **client orchestration**, not CDN TTFB. Phase 5.2.9: **401 ~instant** relative to full preview chain.

---

## Entitled path (documented, not curl-probed)

Requires **fan session cookie** or subscriber auth. Stages from code + Phase 4.8 local timings:

```
GET /api/library/stream?slug=…&redirect=1
  → auth (getFanSessionUser / guest)
  → entitlement (userCanStreamProduct)
  → resolvePlaybackKey (Supabase + R2 discovery)
  → productId resolve
  → stream session create/clear
  → createR2SignedGetUrl (sign segment)
  → proxySignedR2Get → marks "cdn"
  → 200/206 audio through same-origin proxy
```

| Segment | Server-Timing name | Phase 4.8 local (401 guest) | Entitled (est.) |
|---------|-------------------|------------------------------|-----------------|
| Session lookup | `auth` | **0.3 ms** | similar |
| Entitlement | `entitlement` | N/A on 401 | **requires-device-run** |
| Resolver | `resolve` | N/A | tens–hundreds ms (DB/R2) |
| Product | `product` | N/A | DB |
| Session row | `session` | N/A | DB writes |
| Presign | `sign` | N/A | **1–20 ms** typical AWS-style; cache_hit skips |
| R2 fetch | `cdn` | N/A | **131–195+ ms** first byte via proxy |

**redirect=1** keeps browser on `www.2mrrw.com` (avoids R2 S3 CORS on `*.cloudflarestorage.com`). TTFB = **sign + Vercel→R2 fetch** stacked in one response.

**redirect=0** (default JSON): returns `libraryStreamRedirectSrc` proxy URL — extra client hop; same signing work server-side when building session.

---

## 401 vs entitled TTFB delta

| Path | Measured TTFB | Bytes |
|------|---------------|-------|
| Guest stream | **183–265 ms** | 24 B JSON |
| Entitled stream + proxy | **Not measured** | Audio Range |

Entitled TTFB should exceed guest JSON by **resolver + sign + CDN `cdn` segment** — expect **≥400–800 ms** cold without stream-url-cache hit (**requires-device-run** with subscriber cookie).

---

## Hybrid / resolver flags

**Not modified** in 5.2.10. `X-Playback-Resolver` only when `R2_STREAM_DEBUG` or `NODE_ENV=development`.

---

## Measurement procedure (operator)

1. Log in as entitled user on `www.2mrrw.com`.
2. DevTools → Network → `library/stream?slug=hour-glass&redirect=1` with Range.
3. Record `Server-Timing` on **MISS** (disable cache or `force=true` if entitled).
4. Compare to guest **401** from same slug.

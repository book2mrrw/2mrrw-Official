# Cloudflare R2 CORS Remediation — Audio Playback (2MRRW)

**Date:** 2026-05-28  
**Platform:** artist-platform (Next.js storefront)  
**Primary blocker:** R2 returns **403** with `Origin https://www.2mrrw.com is not allowed by Access-Control-Allow-Origin` on cross-origin media GET/HEAD from signed URLs and public CDN URLs.

Playback orchestration, entitlements, and `/api/library/stream` redirect flow are in place. **This is an R2 bucket CORS configuration fix**, not a playback-engine rewrite.

---

## 1. Final production-ready CORS JSON (copy-paste)

Apply this **exact** JSON in the Cloudflare dashboard (**R2 → your bucket → Settings → CORS Policy → JSON**) or via Wrangler (see §4).

File: `r2-cors-policy-production.json` (same content as below).

```json
[
  {
    "AllowedOrigins": [
      "https://www.2mrrw.com",
      "https://2mrrw.com",
      "https://artist-platform-silk.vercel.app",
      "https://2mrrw-official.vercel.app",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": [
      "Range",
      "Content-Type",
      "Authorization",
      "Origin",
      "Accept"
    ],
    "ExposeHeaders": [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "Content-Type",
      "ETag",
      "Last-Modified"
    ],
    "MaxAgeSeconds": 86400
  }
]
```

### Exact policy summary

| Field | Value |
|--------|--------|
| **Allowed origins** | `https://www.2mrrw.com`, `https://2mrrw.com`, `https://artist-platform-silk.vercel.app`, `https://2mrrw-official.vercel.app`, `http://localhost:3000`, `http://127.0.0.1:3000` |
| **Allowed methods** | `GET`, `HEAD` |
| **Allowed headers** | `Range`, `Content-Type`, `Authorization`, `Origin`, `Accept` |
| **Exposed headers** | `Accept-Ranges`, `Content-Length`, `Content-Range`, `Content-Type`, `ETag`, `Last-Modified` |
| **Max-Age** | `86400` seconds (24h preflight cache) |

**Optional:** Add Vercel preview URLs only if you actively test playback on them, e.g. `https://artist-platform-*.vercel.app` — R2 CORS does **not** support wildcard origins; each preview hostname must be listed explicitly.

---

## 2. Explanation of each rule

### `AllowedOrigins`

Browsers send `Origin: https://www.2mrrw.com` (or apex / preview / localhost) on cross-origin `<audio>`, `fetch()`, and Web Audio paths. R2 only returns `Access-Control-Allow-Origin` when the origin **exactly** matches an entry (no trailing slash, no path).

- **www + apex:** Production storefront; `next.config.mjs` redirects apex → www, but include both because some clients or deep links may still emit apex origin during transitions.
- **Vercel previews:** Documented in `docs/reports/r2-cors-policy-recommended.json` and Control System CORS allowlists.
- **localhost:** Local dev playback against real R2 objects.

**Does not change security model:** Objects remain behind presigned URLs and entitlement checks; CORS only permits **browser** cross-origin reads from trusted origins.

### `AllowedMethods`: `GET`, `HEAD`

- **GET:** Progressive audio streaming, waveform byte ranges, full file fetch.
- **HEAD:** Duration/metadata probes, readiness checks, Safari media validation, stream-client validation — **required** for timeline and waveform systems.

No `PUT`/`POST` in this rule: playback-only. Upload CORS can be a separate rule if needed later.

### `AllowedHeaders`

| Header | Why |
|--------|-----|
| `Range` | Partial content (206), seeking, Safari buffering |
| `Content-Type` | Preflight for typed requests |
| `Authorization` | Signed URL query params / future auth headers on fetch |
| `Origin` | Standard CORS preflight |
| `Accept` | Content negotiation on metadata fetches |

**Previous gap:** Repo had a minimal policy with `AllowedHeaders: ["*"]` but **incomplete `ExposeHeaders`** (missing `Accept-Ranges`, `Content-Range`, `Last-Modified`). That blocks JS and some media pipelines from reading range metadata even when GET succeeds.

### `ExposeHeaders`

JavaScript and media tooling must read:

- **`Accept-Ranges` / `Content-Range` / `Content-Length`:** Seeking, 206 partial responses, WAV streaming, waveform segment loaders.
- **`Content-Type`:** MIME validation (`audio/wav`, `audio/mpeg`).
- **`ETag` / `Last-Modified`:** Cache validation, conditional requests.

Without these in `ExposeHeaders`, browsers hide them from `fetch()` / media APIs → failed duration parsing and waveform generation.

### `MaxAgeSeconds`: 86400

Caches OPTIONS preflight for up to 24 hours (browsers may cap lower). Reduces preflight storms during album track changes and scrubbing.

---

## 3. Audit: current vs required

| Item | Prior state (repo / audits) | Required | Status after apply |
|------|-----------------------------|----------|---------------------|
| Origins include www | Partial | Yes | ✅ in policy |
| Methods include HEAD | Often GET only | GET + HEAD | ✅ |
| Range in allowed headers | `*` or missing explicit | Explicit | ✅ |
| Expose Accept-Ranges | **Missing** in older `.tmp` policy | Required | ✅ |
| Expose Content-Range | **Missing** | Required | ✅ |
| Signed URLs | Preserved | No public bucket | ✅ unchanged |
| Entitlements | `/api/library/stream` | Unchanged | ✅ |

**Symptom match:** Console `403` + `Access-Control-Allow-Origin` = origin not in bucket policy (or stale cache on custom domain — see §5).

**Code already aligned:** `AudioContext` uses `crossOrigin="anonymous"`; `/api/library/stream` passes `Range` on redirect. Fixing R2 CORS completes the chain.

---

## 4. Cloudflare dashboard steps

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2** → **Overview**.
2. Open the **media bucket** (env: `CLOUDFLARE_R2_BUCKET_NAME`, commonly `2mrrw-media` or your production bucket name).
3. **Settings** → **CORS Policy** → **Add** or **Edit**.
4. Select the **JSON** tab.
5. Paste the policy from §1 (replace any existing rule that omits HEAD or range expose headers).
6. **Save**.
7. Wait up to **30 seconds** for propagation (Cloudflare docs).

### Wrangler CLI (optional)

Dashboard JSON is an **array** of rules. Wrangler 3+ uses a different `cors.json` shape; prefer dashboard for this policy unless you already manage bucket CORS in IaC.

Verify after apply:

```bash
npx wrangler r2 bucket cors list "$CLOUDFLARE_R2_BUCKET_NAME"
```

---

## 5. Cache invalidation steps

### R2 public CDN (`*.r2.dev` or `NEXT_PUBLIC_R2_PUBLIC_URL`)

- CORS applies at bucket; **new** requests should get headers immediately.
- If responses were cached **without** CORS headers at a CDN edge, purge is rarely needed for `r2.dev` — test in a private window first.

### Custom domain on R2 bucket

If you serve objects via a **custom domain** connected to the bucket:

1. After saving CORS, go to **Caching** → **Configuration** → **Purge Cache** for that hostname (or Purge Everything for that zone).
2. Cloudflare docs: cached assets may not reflect new CORS headers until refreshed.

**Signed URL host** (`*.r2.cloudflarestorage.com`): CORS is still governed by the **bucket policy**; no separate CORS file on the URL.

---

## 6. Safari-specific considerations

1. **`crossOrigin="anonymous"`** on the single `<audio>` element (already in `AudioContext.js`) — required with `Access-Control-Allow-Origin` for Web Audio `createMediaElementSource`.
2. **HEAD + Range:** Safari probes metadata aggressively; missing HEAD or blocked `Accept-Ranges` causes “playing” UI with no duration or silent graph.
3. **Gesture / autoplay:** Unrelated to CORS; do not confuse `NotAllowedError` with CORS 403.
4. **Origin exactness:** Safari sends full origin; use `https://www.2mrrw.com` not `https://www.2mrrw.com/`.
5. **WAV:** Stricter about 206 and `Content-Type`; ensure objects are served as `audio/wav` or `audio/wave` from R2 metadata.

---

## 7. Range request compatibility

With this policy:

| Check | Expected |
|--------|----------|
| Browser sends `Range: bytes=0-` | Allowed via `AllowedHeaders` |
| R2 responds `206 Partial Content` | Object + R2 support (already used in audits) |
| JS reads `Accept-Ranges` | Allowed via `ExposeHeaders` |
| `<audio>` seeking | Uses range requests; needs exposed length/range headers for some tooling |
| `/api/library/stream?redirect=1` | Same-origin redirect to signed URL; **subsequent** R2 GET is cross-origin → **bucket CORS required** |

Confirm with curl (replace URL with a real signed or public object URL):

```bash
curl -sI -H "Origin: https://www.2mrrw.com" \
  -H "Range: bytes=0-1023" \
  "https://YOUR-R2-OR-CDN-URL/object.wav"
```

Expect:

- `HTTP/1.1 206` (or 200 for tiny objects)
- `Access-Control-Allow-Origin: https://www.2mrrw.com`
- `Access-Control-Expose-Headers` includes `Accept-Ranges, Content-Length, Content-Range, ...`
- `Accept-Ranges: bytes`

---

## 8. Verification checklist (playback QA)

Test on **iPhone Safari** (primary) and desktop Safari/Chrome.

### Console / network

- [ ] No `Access-Control-Allow-Origin` errors on media host
- [ ] No **403** on R2 GET from `www.2mrrw.com` origin
- [ ] OPTIONS preflight (if any) returns 204/200 with matching ACAO

### Playback

- [ ] **Singles** — play, duration on scrub bar, seek
- [ ] **Features** — “I Don’t Believe You”, “2 Heavy” (WAV)
- [ ] **Albums/EPs** — tracklist play + seek
- [ ] Timeline appears; **waveform** loads (if enabled for track)
- [ ] Lock screen metadata (separate from CORS; sanity check)

### Technical

- [ ] `HEAD` to signed URL with `Origin` returns CORS headers
- [ ] `GET` with `Range` returns **206** + `Content-Range`
- [ ] Web Audio: audible output (not silent with advancing `currentTime`)
- [ ] Entitled path: `/api/library/stream?slug=…&redirect=1` → R2 URL plays

### Regression guards

- [ ] Bucket remains **private** (no blanket public read on `protected-media/`)
- [ ] Unsigned deep links to protected objects still **403/401**

---

## 9. What we did NOT do (by design)

- Did not disable signed URLs
- Did not make the bucket fully public
- Did not bypass `/api/library/stream` entitlements
- Did not change playback orchestration code in this remediation

---

## 10. Repo references

| Path | Notes |
|------|--------|
| `docs/reports/r2-cors-policy-recommended.json` | Prior recommended policy (updated to match production file) |
| `src/lib/storage/r2.js` | `createR2SignedGetUrl` — presigned GET |
| `src/app/api/library/stream/route.js` | 302 redirect + Range passthrough |
| `src/context/AudioContext.js` | `crossOrigin="anonymous"` |
| `.env.example` | `CLOUDFLARE_R2_BUCKET_NAME`, `NEXT_PUBLIC_R2_PUBLIC_URL` |

**IaC:** No `wrangler.toml` bucket CORS in storefront repo; CORS is **dashboard/API managed** on the R2 bucket.

---

## 11. Apply checklist (operator)

1. [ ] Backup current CORS JSON from dashboard (screenshot or export)
2. [ ] Paste §1 policy → Save
3. [ ] Purge custom-domain cache if applicable (§5)
4. [ ] Run curl probe (§7)
5. [ ] Run §8 QA on real device
6. [ ] Confirm no CORS errors in Safari Web Inspector → Network

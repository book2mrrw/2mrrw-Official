# R2 CORS policy audit — 2026-05-29

**Scope:** Verify and fix CORS for Cloudflare R2 bucket `2mrrw-media` and `/api/media/*` routes.  
**Out of scope:** Playback orchestration, AuthContext, UI, AudioContext rewrites.

---

## Executive summary

| Layer | Status | Action |
|-------|--------|--------|
| R2 bucket CORS (`2mrrw-media`) | **Live probes PASS** — origins echoed, Range preflight OK, 206 on video | Confirm policy in dashboard matches `r2-cors-policy.json` (already observed live) |
| `/api/media/*` Next.js routes | **Fixed in working tree** — shared `media-cors.js` helper | Deploy when ready (uncommitted) |
| Signed URL playback (`/api/library/stream`) | **Same-origin** — no API CORS needed | Ensure bucket CORS covers S3 presigned HEAD from browser |
| Public CDN env | **Gap (non-CORS)** — legacy `pub-992d4f5d…` returns **401** | Set `NEXT_PUBLIC_R2_PUBLIC_URL` to public `pub-643e4a94…` |
| Missing preview objects | **Gap (non-CORS)** — `hourglass-preview.mp3` **404** on CDN | Upload object; CORS headers present even on 404 |

**Bottom line:** CORS is not the primary blocker for “nothing rendering.” Live R2 CORS and production `/api/media/*` headers are correct. Remaining breakage is likely **missing R2 objects**, **wrong public CDN env**, or **entitlement/auth** on full streams — not missing `Access-Control-Allow-Origin`.

---

## Step 1 — Audit current CORS config

### Repo inventory

| Location | CORS config | Notes |
|----------|-------------|-------|
| `wrangler.toml` | **None** | Not present in repo (correct — R2 CORS is dashboard-only) |
| R2 config files | **None in wrangler** | Policy documented in `docs/reports/r2-cors-policy-recommended.json` |
| `src/lib/server/media-cors.js` | **Central helper** | Allowlist matches Step 2 origins; Range-aware headers |
| `src/app/api/media/preview/route.js` | Uses `applyMediaCors` + OPTIONS | Redirects to public R2 CDN |
| `src/app/api/media/visual/route.js` | Uses `applyMediaCors` + OPTIONS | Resolves cover/loop; JSON or redirect |
| `src/app/api/media/playback/route.js` | Uses `applyMediaCors` + OPTIONS | POST analytics only |
| `src/app/api/library/stream/route.js` | **No CORS headers** | Intentional — same-origin fetch only |
| `middleware.js` | **No CORS headers** | Session refresh only |
| `next.config.mjs` | **No global CORS** | Image domains include `**.r2.dev` |

### Prior recommended policy (committed baseline)

The committed `docs/reports/r2-cors-policy-recommended.json` used `AllowedHeaders: ["*"]` and included `localhost:5173`. Updated working copy now matches the prompt’s explicit policy (Range header list, no Vite port).

---

## Step 2 — Required R2 CORS policy

Paste into **Cloudflare → R2 → `2mrrw-media` → Settings → CORS policy**.

See `r2-cors-policy.json` in this bundle (identical to updated `docs/reports/r2-cors-policy-recommended.json`).

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

**Do not** add this to `wrangler.toml`.

Dashboard steps: `dashboard-steps.md`.

---

## Step 3 — Verify `/api/media/*` API route CORS

Required response headers (when `Origin` is in allowlist):

```
Access-Control-Allow-Origin: <requesting origin>
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Range, Content-Type
Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range
```

### Code fix applied (working tree, not committed)

Added `src/lib/server/media-cors.js` and wired all three routes:

- `OPTIONS` → `mediaCorsPreflightResponse(req)` (204)
- All responses → `applyMediaCors(req, response)`

### Live production verification (`https://www.2mrrw.com`, 2026-05-29)

| Route | OPTIONS | GET/POST | Result |
|-------|---------|----------|--------|
| `/api/media/preview` | 204 + full CORS | 302 redirect + CORS | **PASS** |
| `/api/media/visual` | 204 + full CORS | 200 JSON + CORS | **PASS** |
| `/api/media/playback` | 204 + full CORS | POST (body omitted in probe) | **PASS** |

Full curl output: `curl-probes.txt`. Repeat: `./verification-curls.sh`.

---

## Step 4 — Signed URL CORS

### How signed URLs work

1. Browser calls **same-origin** `GET /api/library/stream?slug=…` (credentials included).
2. Server signs via `createR2SignedGetUrl(key, 3600)` → S3 presigned URL on `*.r2.cloudflarestorage.com`.
3. Client validates with `HEAD` on signed URL (`stream-client.js`, `credentials: "omit"`).
4. `<audio>` loads signed URL directly.

### CORS implications

| Check | Finding |
|-------|---------|
| Origin on signed request | Browser sends page origin on cross-origin HEAD to R2 S3 endpoint |
| Bucket policy for credentialed requests | Presigned GET uses query auth, not cookies — `Authorization` in AllowedHeaders is sufficient |
| TTL vs load time | `STREAM_SIGNED_URL_TTL_SECONDS = 3600` (1 h) — adequate for full tracks |
| `/api/library/stream` CORS | Not required (same-origin); redirect mode forwards client `Range` header |

**Action:** Keep Step 2 bucket CORS on `2mrrw-media` so presigned HEAD/GET from storefront origins succeed. Cannot live-probe presigned URLs without entitled session + R2 credentials in this pass.

---

## Step 5 — Gaps, fixes, and manual actions

### Fixed in repo (deploy when ready)

1. **`src/lib/server/media-cors.js`** — shared Range-aware CORS for `/api/media/*`.
2. **`src/app/api/media/{preview,visual,playback}/route.js`** — OPTIONS + `applyMediaCors` on all responses.
3. **`docs/reports/r2-cors-policy-recommended.json`** — aligned with prompt (explicit headers, removed `localhost:5173`).

### Already correct on live R2 CDN (probes)

- `Access-Control-Allow-Origin` echoes `https://www.2mrrw.com`, `https://2mrrw.com`, `http://localhost:3000`, Vercel preview origin.
- OPTIONS preflight: **204**, `Allow-Methods: GET, HEAD`, `Allow-Headers: Range`, `Max-Age: 86400`.
- Video `videos/singles/hour-glass/hourglass.mp4`: **200** GET, **206** Range with `Content-Range` + expose headers.

### Non-CORS gaps (still block media)

| Gap | Evidence | Fix |
|-----|----------|-----|
| Preview MP3 missing | `audio/singles/hour-glass/hourglass-preview.mp3` → **404** (CORS present) | Upload preview to R2 or fix resolver path |
| Legacy public CDN host | `pub-992d4f5d…r2.dev` → **401**, no ACAO | Set `NEXT_PUBLIC_R2_PUBLIC_URL` to `pub-643e4a94…` on Vercel |
| Full stream auth | `/api/library/stream` → **401** without session | Expected; not CORS |

### Manual dashboard action

Even though live probes match the required policy, **re-confirm** in Cloudflare R2 → `2mrrw-media` → Settings → CORS policy using `r2-cors-policy.json`. Save if drifted.

---

## Verification commands (quick reference)

```bash
# R2 video (known 200 object) + Range
curl -sSI -H "Origin: https://www.2mrrw.com" \
  "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/videos/singles/hour-glass/hourglass.mp4"
curl -sSI -H "Origin: https://www.2mrrw.com" -H "Range: bytes=0-1023" \
  "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/videos/singles/hour-glass/hourglass.mp4"

# API media preflight
curl -sSI -X OPTIONS \
  -H "Origin: https://www.2mrrw.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range" \
  "https://www.2mrrw.com/api/media/preview?folder=audio/singles/hour-glass/"
```

Full script: `verification-curls.sh` · Captured output: `curl-probes.txt`.

---

## Commit status

Prompt did **not** request a commit. Working tree changes remain uncommitted.

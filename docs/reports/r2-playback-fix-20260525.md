# R2 + Playback Connection Fix — 2026-05-25

**Scope:** Cloudflare R2 public CDN + signed stream path for storefront audio (R2 before React/audio refactors).  
**Repo:** `/Users/recharge/artist-platform`  
**Build:** `npm run build` — **PASS** (Next.js 16.2.4)

---

## Root cause

**`NEXT_PUBLIC_R2_PUBLIC_URL` pointed at a non-public R2 dev hostname** (`pub-992d4f5d45e7c56189a518c2f417fe25.r2.dev`), which returned **HTTP 401** for all catalog paths (`previews/`, `images/`). The app always prefers that env value over the documented fallback, so **every preview and cover URL sent to `<audio>` / `<img>` was unauthorized**.

Signed full-track playback (entitled users via `/api/library/stream` → S3 presigned GET) **was healthy** against the same R2 account (`digital-assets/…` and `previews/…` keys return **206** with Range). Breakage was isolated to **public CDN URL construction**, not signing credentials.

**Local fix applied (not committed):** `.env.local` `NEXT_PUBLIC_R2_PUBLIC_URL` updated to the canonical public CDN documented in code and audits: `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`.

**Production action:** Set the same `NEXT_PUBLIC_R2_PUBLIC_URL` on Vercel (and enable public access on that r2.dev binding), or enable public access on the account-scoped pub domain if you intentionally keep `pub-992d4f5d…`.

---

## Environment variables

| Variable | `.env.example` | `.env.local` (presence) | Runtime role |
|----------|----------------|-------------------------|--------------|
| `CLOUDFLARE_R2_ACCOUNT_ID` | Documented | Present | Account ID for endpoint construction / tooling |
| `CLOUDFLARE_R2_ENDPOINT` | Documented | Present | S3 API endpoint for signing |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Documented | Present | Signed GET/PUT |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Documented | Present | Signed GET/PUT |
| `CLOUDFLARE_R2_BUCKET_NAME` | `2mrrw-media` | Present | Bucket for all keys |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Canonical `pub-643e4a94…` | Present (corrected locally) | Browser previews, covers, motion loops |
| `NEXT_PUBLIC_APP_URL` | — | Missing | App origin (optional for absolute links) |
| `R2_STREAM_DEBUG` | Commented | Unset | Optional `1` → presence-only logs in stream route |

**Note:** Code uses `CLOUDFLARE_R2_*`, not `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` aliases from older audit docs.

**Legacy names (not used in storefront code):** `R2_BUCKET`, `R2_SECRET_ACCESS_KEY`, `NEXT_PUBLIC_*_CDN` — see `docs/SUPABASE_STORAGE_ARCHITECTURE.md`.

---

## curl results

### Public preview CDN (canonical host)

| URL path | HTTP | Content-Type |
|--------|------|--------------|
| `…/previews/hourglass-preview.mp3` | **200** | `audio/mpeg` |
| `…/images/singles/hourglass.jpg` | **200** | (image) |

Example built by `catalogPreviewAudioUrl("/audio/previews/hourglass-preview.mp3")` →  
`https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/previews/hourglass-preview.mp3`

### Misconfigured host (before local env fix)

| Host | `previews/hourglass-preview.mp3` |
|------|----------------------------------|
| `pub-992d4f5d45e7c56189a518c2f417fe25.r2.dev` | **401** |
| `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` (fallback) | **200** |

### Signed R2 GET (presigned, Range `bytes=0-0`)

| Object key | HTTP |
|------------|------|
| `digital-assets/singles/hour-glass/audio.mp3` | **206** |
| `previews/hourglass-preview.mp3` | **206** |
| `digital-assets/singles/hour-glass/preview.mp3` | **404** (object not at manifest path) |

### `/api/library/stream` (local dev)

Dev server was **not running** at `localhost:3000` during this pass. Unauthenticated `GET /api/library/stream?slug=hour-glass` is expected **401** (guest session required). Entitled flow: JSON `{ url, expiresIn }` or `redirect=1` → 302 to presigned URL.

---

## CORS (R2 bucket dashboard — manual)

Browser **uploads** and some `fetch()` paths need bucket CORS. `<audio src="https://…r2.dev/…">` for **public** objects typically works without CORS; **signed** cross-origin URLs may need `Access-Control-Allow-Origin` for XHR/analytics, not always for media element.

Recommended R2 bucket CORS JSON (Cloudflare dashboard → bucket → Settings → CORS):

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://2mrrw.com",
      "https://www.2mrrw.com"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

Add preview deployment origins (`https://*.vercel.app`) if control-system uploads run from preview URLs. **Cannot verify dashboard settings from repo.**

---

## Code changes

| File | Change |
|------|--------|
| `src/lib/storage/r2-public-cdn.js` | **New** — single canonical public CDN base + dev mismatch warning |
| `src/lib/storage/r2.js` | `getPublicR2Url` uses shared CDN base + fallback when env unset |
| `src/lib/media-urls.js` | `catalogPreviewAudioUrl` always maps `audio/previews/` → `previews/` via `toCatalogCdnUrl` |
| `src/app/api/library/stream/route.js` | `R2_STREAM_DEBUG=1` presence-only logging |
| `.env.example` | Documented all `CLOUDFLARE_R2_*` + `NEXT_PUBLIC_R2_PUBLIC_URL` |

**Unchanged:** `next.config.mjs` (already allows `pub-643e4a94…` and `**.r2.dev`), `stream-client.js`, `catalogMedia.js` (wiring correct once URLs resolve).

---

## AudioContext note (Step 6)

With corrected CDN URLs, visitor preview playback uses direct `audio.src` to public MP3 (no stream API). Entitled tracks still use `/api/library/stream` + signed URL (or `redirect=1`). No production test harness added; behavior aligns with `audio-logic-audit-20260525.md`.

---

## 11-point test checklist

| # | Test | Result |
|---|------|--------|
| 1 | `CLOUDFLARE_R2_*` keys present in `.env.local` | **PASS** |
| 2 | `NEXT_PUBLIC_R2_PUBLIC_URL` set to public-access r2.dev host | **PASS** (after local correction) |
| 3 | curl public preview `previews/hourglass-preview.mp3` | **PASS** 200 |
| 4 | curl public cover `images/singles/hourglass.jpg` | **PASS** 200 |
| 5 | `checkR2Connectivity()` HeadBucket | **PASS** `2mrrw-media` |
| 6 | Presigned GET `digital-assets/singles/hour-glass/audio.mp3` | **PASS** 206 |
| 7 | Presigned GET `previews/hourglass-preview.mp3` | **PASS** 206 |
| 8 | `catalogPreviewAudioUrl` maps legacy path → `previews/` | **PASS** (code) |
| 9 | Stream route has signing credentials at runtime | **PASS** |
| 10 | curl `localhost:3000/api/library/stream?slug=hour-glass` | **SKIP** (dev server down) |
| 11 | `npm run build` | **PASS** |

---

## Coordination (agent 43b45579)

R2/public CDN must be fixed **before** AudioContext refactors (preview `src` was 401). Signed stream path is operational; overlap work on stream fetch latency / `redirect=1` fast-path remains separate.

---

## Deliverable zip

`~/Downloads/r2-playback-fix-20260525.zip` — report + touched source files.

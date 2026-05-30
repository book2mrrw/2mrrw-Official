# Platform Read-Only Audit — 2026-05-26

**Mode:** READ-ONLY. No code modified. No commits.

| Repo | Path |
|------|------|
| Artist Platform | `/Users/recharge/artist-platform` |
| Control System | `/Users/recharge/2MRRW-Control-System` |

Full file copies: `files/` (items 5, 6, 15, 21). Raw grep capture: `raw-artist-grep.txt`, `raw-control-grep.txt`.

---

## 1. Safety timer / safety play (`AudioContext.js`)

```bash
grep -n "safetyTimer\|SAFETY PLAY\|safety.*play\|setTimeout.*play" src/context/AudioContext.js
```

**Result:** No matches.

Note: `setTimeout` + `audio.play()` exists at `src/context/AudioContext.js:1226-1227` (AbortError retry), not matched by the safety-timer pattern.

---

## 2. canplay / audio element lifecycle (`AudioContext.js`, head 60)

```bash
grep -n "canplay\|canplaythrough\|audio\.play\|audio\.load\|audio\.pause\|audio\.src\|removeAttribute" src/context/AudioContext.js | head -60
```

| Line | Match |
|------|-------|
| 266 | `audio.paused` |
| 321 | `audio.paused`, `audio.ended` |
| 354 | `audio.playbackRate` |
| 574 | `audio.paused` |
| 576-577 | `audio.paused`, `audio.play()` |
| 579 | `audio.removeEventListener("canplay", resumeAfterInterrupt)` |
| 581 | `audio.addEventListener("canplay", resumeAfterInterrupt)` |
| 600 | `audio.pause()` |
| 677 | `audio.play()` |
| 761-762 | `audio.src`, `audio.load()` |
| 772 | `await audio.play()` |
| 784-786 | `audio.src`, `audio.load()`, `audio.play()` |
| 810 | `audio.pause()` |
| 851 | `audio.addEventListener("canplaythrough", onCanPlayThrough)` |
| 860 | `audio.pause()` |
| 879 | `audio.removeEventListener("canplaythrough", onCanPlayThrough)` |
| 900 | `audio.playbackRate` |
| 1025-1027 | `audio.src`, `audio.load()`, `audio.play()` |
| 1052 | `audio.pause()` |
| 1093-1094 | `audio.src`, `audio.load()` |
| 1103 | `audio.play()` |
| 1192 | `!audio.paused` |
| 1214-1216 | `audio.pause()`, `audio.src`, `audio.load()` |
| 1218-1221 | `canplay` / `canplaythrough` listeners, `audio.play()` |
| 1227 | `audio.play()` (retry) |
| 1237-1238 | `addEventListener("canplay"…)`, `canplaythrough` |
| 1241 | `!audio.paused` |
| 1274 | `audio.play()` |
| 1310 | `audio.currentSrc \|\| audio.src` |
| 1328-1329 | `audio.src`, `audio.load()` |
| 1351 | `audio.paused` |
| 1355 | `audio.play()` |
| 1421 | `audio.currentSrc \|\| audio.src` |
| 1425-1427 | `audio.pause()`, `audio.src`, `audio.load()` |
| 1435 | `updateMediaSession(…, { playing: !audio.paused })` |
| 1462 | `audio.currentSrc \|\| audio.src` |
| 1469-1471 | `audio.pause()`, `audio.src`, `audio.load()` |
| 1480-1482 | `updateMediaSession`, `audio.paused`, `audio.play()` |
| 1593 | `await audio.play()` |
| 1613 | `audio.src` |

**No `removeAttribute` matches** in first 60 lines of this grep.

---

## 3. Hardcoded `https://www.2mrrw.com` in `src/`

| File:Line | Content |
|-----------|---------|
| `src/lib/gifts/email.js:2` | `const BRAND_SITE = "https://www.2mrrw.com";` |

---

## 4. `window.location.origin` in `src/`

| File:Line | Context |
|-----------|---------|
| `src/app/subscribe/page.js:343` | Stripe `return_url` |
| `src/lib/media-session-artwork.js:45` | `new URL(path, window.location.origin)` |
| `src/lib/deep-links.js:23` | base origin fallback |
| `src/lib/playback/stream-client.js:12` | URL parse for library stream |
| `src/lib/playback/stream-client.js:27` | redirect src check |
| `src/lib/playback/stream-client.js:41` | slug parse |

---

## 5. `next.config.mjs` (artist-platform) — FULL

Path: `files/next.config.mjs`

```javascript
/** @type {import('next').NextConfig} */
const r2PublicHost = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

const remotePatterns = [
  {
    protocol: "https",
    hostname: "pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev",
  },
  {
    protocol: "https",
    hostname: "**.r2.dev",
  },
  {
    protocol: "https",
    hostname: "**.r2.cloudflarestorage.com",
  },
];

if (r2PublicHost) {
  remotePatterns.push({
    protocol: "https",
    hostname: r2PublicHost,
  });
}

const nextConfig = {
  images: {
    remotePatterns,
  },
};

export default nextConfig;
```

**Item 18 (same file):** No `ChunkLoadError` or `generateBuildId` — no matches.

**CORS:** Artist-platform `next.config.mjs` has **no** `headers()` / `Access-Control-*` (removed per `docs/reports/cors-fix-ship-20260526.md`).

---

## 6. `src/lib/playback/stream-client.js` — FULL

Path: `files/stream-client.js` (125 lines).

Summary:
- `LIBRARY_STREAM_PATH = "/api/library/stream"`
- Uses `window.location.origin` for relative `/api/` URL parsing (lines 12, 27, 41)
- `fetchLibraryStream` — credentials include; handles 401/403/409
- `endStreamAnalytics` → `POST /api/stream/end`

---

## 7. Range / redirect — `src/app/api/library/stream/route.js`

```bash
grep -n "416\|Range\|range\|Accept-Ranges\|redirect" src/app/api/library/stream/route.js
```

| Line | Content |
|------|---------|
| 76 | `const redirect = req.nextUrl.searchParams.get("redirect") === "1";` |
| 77 | `if (redirect) {` |
| 78 | `const rangeHeader = req.headers.get("range");` |
| 79 | `return NextResponse.redirect(url, {` |
| 82 | `...(rangeHeader ? { "Range": rangeHeader } : {}),` |
| 84 | `"Accept-Ranges": "bytes",` |
| 99 | `const redirect = req.nextUrl.searchParams.get("redirect") === "1";` (GET handler; unused binding) |

**No HTTP 416** handling in this route. Range header forwarded on 302 redirect to signed R2 URL.

---

## 8. API path references (`src/`, excl. node_modules/.next)

| File:Line | Reference |
|-----------|-----------|
| `src/context/AudioContext.js:1321` | `/api/library/stream?slug=…&redirect=1` |
| `src/context/AuthContext.js:94` | `fetch("/api/account/state"` |
| `src/context/AuthContext.js:117` | `[account/state] fetch failed` log |
| `src/app/page.js:832` | `/api/catalog/exclusive-drops` |
| `src/app/page.js:865` | `/api/printful/products` |
| `src/app/api/catalog/hydrate/route.js:9` | library stream URL builder |
| `src/app/api/library/stream/route.js:25,116,153` | stream route logs |
| `src/system/recovery/signedUrlRefresher.js:12` | library stream src check |
| `src/system/recovery/useSessionRecovery.js:10,23` | hydrate comment + fetch |
| `src/system/recovery/useTrackHydration.js:25,64` | hydrate fetch + stream src |
| `src/components/collectors-cards/useCollectorInventory.js:19` | exclusive-drops |
| `src/components/system/AudioPhase10Bridge.js:35` | library stream src |
| `src/lib/control-system/account.js:47` | control-system `/api/account/state` |
| `src/lib/music-access.js:100,206,211` | account state + stream URLs |
| `src/lib/playback/playback-gate.js:5` | account/state comment |
| `src/lib/playback/stream-client.js:1,3,58` | stream client |
| `src/media/preloader/MediaPreloader.js:38` | excludes library stream from rule |

---

## 9. External `fetch`/`axios` https (filtered)

| File:Line | URL |
|-----------|-----|
| `src/app/api/printful/products/route.js:88` | `https://api.printful.com/store/products?limit=100` |
| `src/lib/gifts/email.js:99` | `https://api.resend.com/emails` |
| `src/lib/gifts/email.js:153` | `https://api.resend.com/emails` |

---

## 10. visibility / pause / wasPlaying (`AudioContext.js`)

```bash
grep -n "visibilitychange\|pagehide\|hidden\|pause\|wasPlaying" … | head -30
```

First 30 lines matched mostly `pause` / `paused` (see raw-artist-grep.txt). **Additional lines not in head -30:**

| File:Line | Content |
|-----------|---------|
| `src/context/AudioContext.js:243` | `wasPlayingBeforeHideRef` |
| `src/context/AudioContext.js:1792` | `const onVisibility = async () => {` |
| `src/context/AudioContext.js:1798` | `wasPlayingBeforeHideRef.current = stateRef.current.isPlaying && !audio.paused` |
| `src/context/AudioContext.js:1856` | `const onPageHide = () => {` |
| `src/context/AudioContext.js:1872` | `document.addEventListener("visibilitychange", onVisibility)` |
| `src/context/AudioContext.js:1875` | `window.addEventListener("pagehide", onPageHide)` |
| `src/context/AudioContext.js:1877-1880` | remove listeners on cleanup |
| `src/context/AudioContext.js:1892` | `wasPlaying: !audio.paused` (cs hold) |
| `src/context/AudioContext.js:1909` | `if (csHoldSavedRef.current.wasPlaying) audio.play()` |
| `src/context/AudioContext.js:1949` | `if (saved.wasPlaying && audio.paused) audio.play()` |

**No `document.hidden` string** in grep output; visibility handled via `visibilitychange` handler.

---

## 11. Media Session API (`AudioContext.js`, head 30)

| Line | Match |
|------|-------|
| 339 | `navigator.mediaSession?.setPositionState` |
| 352 | `setPositionState({` |
| 362-364 | `updateMediaSession`, `navigator.mediaSession` |
| 392-394 | `updateMediaSession` in effect |
| 549 | `updateMediaSession(track, { playing: true })` |
| 569-571 | pause + `playbackState = "paused"` |
| 646 | `updateMediaSession(…, { playing: false })` |
| 694-697 | `playbackState = "none"`, updateMediaSession |
| 714-717 | same |
| 888 | dependency array |
| 1278 | updateMediaSession on sync play |
| 1291 | playing: false on error |
| 1296 | dependency |
| 1435 | `!audio.paused` |
| 1437 | applyCsToElement deps |
| 1448 | updateMediaSession |
| 1480 | updateMediaSession |
| 1490 | deps |
| 1594 | playing: true |
| 1647 | deps |
| 1720 | `navigator.mediaSession` |

**No `setActionHandler` matches** in first 30 lines of this grep (may exist below line 1720).

---

## 12. playsinline / preload / airplay (`AudioContext.js`)

| Line | Content |
|------|---------|
| 43 | `import { preloadCoverImage }` |
| 182 | `function preloadCsAssets` |
| 191 | `vid.preload = "auto"` |
| 202-206 | CS audio preload element |
| 960 | `preloadCoverImage` |
| 1185 | `preloadCsAssets` |
| 2037 | `preload="auto"` (JSX) |
| 2039 | `webkit-playsinline`, `x-webkit-airplay="allow"` |

---

## 13. `music-access.js` (head 20)

| Line | Summary |
|------|---------|
| 64-66 | admin check via `permissions.admin` |
| 73 | `adminTrackAccess()` |
| 79-80 | `previewOnly: false`, `canStream: true` |
| 86 | `admin: true` |
| 101 | JSDoc return type |
| 103-109 | `resolveTrackAccess` admin branch → `canStream: true`, `source: "admin"` |
| 120-121 | default previewOnly / canStream false |
| 130 | `adminTrackAccess()` |
| 179 | `canStreamFull` logic |
| 193-194 | previewOnly / canStream |
| 216 | `access?.canStream` |
| 220 | `access?.canStream` |

---

## 14. `account/state/route.js` (head 20)

| Line | Summary |
|------|---------|
| 3 | `createAdminClient` |
| 15 | `isAdminUser` |
| 45 | `admin: isAdminUser(user)` |
| 68 | `ownedSlugs: []` |
| 86-115 | admin client queries |
| 147-150 | collector/vault/entitlements |
| 155-167 | `adminFullLibrary`, source `"admin"` |
| 172 | membership access |

---

## 15. `useCsCoverTransition.js` — FULL

Path: `files/useCsCoverTransition.js` (83 lines).

- `CS_TRANSITION_TOTAL_MS = 1200`, `SWAP_MS = 200`
- Swaps cover on `csMode` toggle with `entering` / `exiting` phases
- Timer cleanup on unmount

---

## 16. OPTIONS / CORS — `library/stream/route.js`

```bash
grep -n "OPTIONS\|Access-Control" src/app/api/library/stream/route.js
```

**Result:** No matches. Stream route does not implement CORS or OPTIONS.

---

## 17. image_load_failed / idbu / features assets

| File:Line | Content |
|-----------|---------|
| `src/app/page.js:147` | feature `idbu.jpg`, slug `i-dont-believe-you` |
| `src/app/page.js:148` | feature `2heavy.jpg` |
| `src/lib/commerce/catalog.js:7-8` | same slugs / cover paths |
| `src/media/imagePipeline/ImagePipeline.js:23` | `reject(new Error("image_load_failed"))` |

**No `features.*mp4` matches** in `src/`.

---

## 18. ChunkLoadError / generateBuildId — `next.config.mjs`

**No matches** (artist-platform).

---

## 19. AbortError / NotAllowedError — `AudioContext.js`

| File:Line | Content |
|-----------|---------|
| `src/context/AudioContext.js:1224` | `if (err.name === "AbortError")` |

**NotAllowedError:** No matches in `AudioContext.js`.

---

## 20. CS mode (`AudioContext.js`, head 20)

| Line | Content |
|------|---------|
| 92 | `csMode: false` |
| 115 | `csAudio` / `cs_audio` |
| 129 | `csAudio: csAudio \|\| null` |
| 154-158 | CS presentation src |
| 185 | `csAudioRef.current = null` |
| 201-206 | preload CS audio |
| 214 | `csAudioRef` |
| 228 | `csModeRef` |
| 370 | title suffix when CS mode |
| 457 | `csModeRef.current = Boolean(state.csMode)` |
| 475 | `csMode: s.csMode` |
| 706 | CS mode track apply |
| 952 | `resolvePlaybackPresentation(…, csModeRef.current, …)` |
| 1181 | `csTrack` |
| 1185 | `preloadCsAssets` |
| 1406 | `if (!csModeRef.current \|\| !track) return` |
| 1440 | `toggleCSMode` |

---

# 2MRRW-CONTROL-SYSTEM

Path: `/Users/recharge/2MRRW-Control-System`

## 21. `next.config.mjs` — FULL

Path: `files/next.config.control-system.mjs`

Key differences vs artist-platform:
- `distDir: ".next"`
- **`async headers()`** on `/api/:path*` with:
  - `Access-Control-Allow-Origin: https://www.2mrrw.com`
  - Methods: `GET, POST, OPTIONS`
  - Headers: `Content-Type, Authorization, x-control-session-id`

---

## 22. OPTIONS handlers

### `src/app/api/playback/events/route.ts`

| Line | Content |
|------|---------|
| 50 | `export async function OPTIONS(request: Request)` |
| 63 | `"Access-Control-Allow-Methods": "GET, POST, OPTIONS"` |

Allowed origins (lines 52-57): `www.2mrrw.com`, `2mrrw.com`, `artist-platform-silk.vercel.app`, `localhost:3000`. Dynamic `Access-Control-Allow-Origin` (line 58-62).

### `src/app/api/releases/[slug]/route.ts`

| Line | Content |
|------|---------|
| 72 | `"Access-Control-Allow-Methods": "GET, OPTIONS"` (publicReadCorsHeaders) |
| 83 | `export async function OPTIONS(request: Request)` |
| 96 | `"Access-Control-Allow-Methods": "GET, POST, OPTIONS"` |

---

## 23. CORS in control-system `next.config.mjs`

| Line | Header key |
|------|------------|
| 40 | `Access-Control-Allow-Origin` → `https://www.2mrrw.com` |
| 44 | `Access-Control-Allow-Methods` |
| 48 | `Access-Control-Allow-Headers` |

---

## 24. `www.2mrrw.com` / allowedOrigins in control-system `src/`

| File:Line | Notes |
|-----------|-------|
| `src/app/api/releases/route.ts:7` | origin allowlist |
| `src/app/api/releases/[slug]/route.ts:9,86,91` | PUBLIC_FRONTEND_ORIGINS + OPTIONS fallback |
| `src/app/api/public/releases/route.ts:8` | |
| `src/app/api/public/audio-visuals/route.ts:6` | |
| `src/app/api/public/hero/route.ts:7` | |
| `src/app/api/playback/events/route.ts:53,58` | OPTIONS allowlist |
| `src/server/http.ts:8` | |
| `src/proxy.ts:14` | |

`releases/[slug]/route.ts` also uses `PUBLIC_FRONTEND_ORIGINS` Set (lines 7-12) with Vercel preview regexes.

---

# 25. Cloudflare R2 CORS

### Live API / Wrangler

```bash
npx wrangler r2 bucket cors list 2mrrw-media
```

**Failed:** `CLOUDFLARE_API_TOKEN` not set (non-interactive). **Manual dashboard required** to confirm live bucket policy.

`wrangler` not installed globally; `npx wrangler@4.95.0` used. Subcommand is `cors list` (not `cors get`).

### Repo-saved policy (documentation)

Source: `docs/reports/cors-fix-ship-20260526.md` (also `docs/reports/r2-playback-fix-20260525.md`)

Saved copy: `files/r2-cors-recommended-from-docs.json`

```json
[
  {
    "AllowedOrigins": [
      "https://www.2mrrw.com",
      "https://2mrrw.com",
      "https://artist-platform-silk.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

Bucket name referenced in docs: **`2mrrw-media`**. No `wrangler.toml` in either repo.

---

# 26. Supabase `products` table

### Live query (SUCCESS)

**Project:** `qvfbgkbgczyqrglvgyqr` (2MRRW-Frontend Project)  
**SQL:** `SELECT slug, product_type, active FROM products ORDER BY product_type, slug;`

| slug | product_type | active |
|------|--------------|--------|
| ad | album | true |
| love-hz | album | true |
| tbh | album | true |
| exc-bundle-lovehz | bundle | true |
| 2-heavy | feature | true |
| i-dont-believe-you | feature | true |
| hat | merch | true |
| hoodie | merch | true |
| shirt | merch | true |
| artificial | single | true |
| hour-glass | single | true |
| turnt-me-2-dis | single | true |
| w2d | single | true |
| exc-card-ad | vault | true |
| exc-card-lovehz | vault | true |
| exc-card-tbh | vault | true |
| exc-signed-vinyl | vault | true |
| vault-pass | vault | true |
| ad-vinyl | vinyl | true |
| love-hz-vinyl | vinyl | true |
| tbh-vinyl | vinyl | true |

**Row count:** 21 (live DB includes `vault-pass`; static `src/lib/commerce/catalog.js` has 20 entries without `vault-pass`).

### Fallback catalog (`src/lib/commerce/catalog.js`)

20 slugs in `PRODUCT_CATALOG` — matches live rows except **`vault-pass`** is DB-only.

---

## Cross-cutting observations (informational only)

1. **CORS split:** Control System sets global API CORS in `next.config.mjs` + per-route OPTIONS; artist-platform removed global CORS from `next.config.mjs`; `/api/account/state` has no CORS headers (same-origin only).
2. **Stream path:** Client uses `redirect=1` for `<audio>` direct load; JSON mode for signed URL refresh (`stream-client.js`).
3. **No safety-timer pattern** in current `AudioContext.js`.
4. **R2 CORS** unverified live — use dashboard or authenticated `wrangler r2 bucket cors list 2mrrw-media`.

---

*End of report.*

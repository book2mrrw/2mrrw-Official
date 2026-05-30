# 06 — Network Waterfall (Duplicates, Serial Chains, Overfetching)

## Initial page load waterfall (estimated order)

```
1. HTML document (/)
2. JS chunks (rootMainFiles from build-manifest — 5+ chunks parallel)
3. /sw.js registration (after load event)
4. Supabase auth session (client SDK)
5. /api/account/state (credentials, no-store) — AuthContext bootstrap
6. /api/catalog/releases?page=1&limit=20 (no-store) — page.js
7. Hero MP4 from R2 CDN (preload=auto, parallel with above)
8. PostHog SDK + ingest (PostHogInit useEffect)
9. Stripe.js (module-level loadStripe in page.js)
10. Cover art / video metadata for visible cards
```

## Serial chains

### Auth bootstrap
```
Supabase getSession → /api/account/state → setAccountState
```
**File:** `src/context/AuthContext.js` L220–280 (session bootstrap effect)

### Entitled playback (redirect path)
```
audio.src = /api/library/stream?redirect=1
  → [server: auth + entitlement + resolvePlaybackKey + sign + proxy]
  → audio bytes (Range)
```
Single client request — **good design**. Server internal steps are serial.

### JSON stream path (alternate)
```
GET /api/library/stream?slug= → JSON
HEAD signed URL (assertSignedAudioUrl)
GET audio (via proxy or signed URL)
```
**File:** `src/lib/playback/stream-client.js` — **3 client round trips**

### Library refresh duplication
`refreshLibrary()` and `refreshAccountState()` both hit overlapping data:
- `/api/library` (L117–118 AuthContext)
- `/api/account/state` includes library (L140)

Page triggers both on library change callbacks (e.g. L1841–1842).

## Overfetching

| Request | When | Issue |
|---------|------|-------|
| `/api/printful/products` | Page mount effect L899 | Fetches even if user never opens Shop tab |
| `/api/catalog/exclusive-drops` | Mount L864 | Not tab-gated |
| Catalog page=1 limit=20 | Always on mount | Blocks singles; inline fallback if fail |

## Caching posture

- Catalog fetches: `cache: "no-store"` — always revalidates
- Account state: `cache: "no-store"` — correct for entitlements
- Entity resolver: 60s server memory cache
- Stream signed URLs: per-user cache in `stream-url-cache.js`
- Image pipeline: in-memory browser cache + link preload hints

## Duplicate media requests

- Same cover may load via `<img>`, `imagePipeline.preload`, and MediaSession artwork resolver
- Video poster + video src both fetch for singles cards (`LatestSinglesStyleRow.js` L105–106)

## Findings

1. **Printful + exclusive-drops eager fetch** — bandwidth on paths users may not visit.
2. **refreshLibrary + refreshAccountState** often paired — duplicate library fetch potential.
3. **HEAD probe on JSON stream path** — unnecessary when redirect proxy already validates content-type server-side.
4. **No HTTP cache on public catalog API** — every visit refetches releases.

## Validation checklist

- [ ] DevTools Network: filter Fetch/XHR on cold load — list all requests before interactive
- [ ] Play entitled track — confirm single audio request with redirect=1
- [ ] Add to library action — count /api/library vs /api/account/state calls

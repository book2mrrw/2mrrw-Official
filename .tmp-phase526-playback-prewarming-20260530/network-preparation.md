# Network Preparation — Phase 5.2.6

## Play-path domain audit

| Domain / route | Source | Used on play path | Preconnect |
|----------------|--------|-------------------|------------|
| Document origin (same-origin) | Next.js app | `/api/library/stream`, `/api/media/preview`, `/api/media/playback` | No — reuses page connection |
| `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` | `R2_PUBLIC_CDN_FALLBACK` / `NEXT_PUBLIC_R2_PUBLIC_URL` | Guest preview bytes, public cover art on preview CDN path | **Yes** |
| R2 signed GET host (dynamic) | `createR2SignedGetUrl` via stream proxy | Entitled full stream after redirect | No — hostname varies; signed at tap |
| Supabase | Auth/session | Account state before play; not first audio byte | No — not on immediate audible path |
| PostHog / Stripe / YouTube | layout / page | Not on music play tap path | Excluded |

### Code references

- **Site API paths:** `src/lib/media/site-api-url.js` — `/api/media/*`, `/api/library/*` stay same-origin.
- **Storage roots:** `src/lib/media/constants/storage-domains.js` — `previews/`, `streaming/`, `digital-assets/`.
- **Preview resolution:** `previewDiscoveryUrl()` → `/api/media/preview?folder=…` (same-origin redirect to R2).
- **Entitled stream:** `libraryStreamRedirectSrc()` → `/api/library/stream?slug=…&redirect=1` (same-origin; signing server-side on tap).
- **Public CDN base:** `getPublicCdnBase()` in `src/lib/storage/r2-public-cdn.js`.

## Implementation

`PlaybackNetworkHints` (server component) injected in `src/app/layout.js` `<head>`:

```html
<link rel="preconnect" href="https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev" crossorigin="anonymous" />
<link rel="dns-prefetch" href="https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev" />
```

Origins are derived from `getPlaybackPreconnectOrigins()` so env override of `NEXT_PUBLIC_R2_PUBLIC_URL` is respected.

## Expected connection setup reduction

| Scenario | Without preconnect | With preconnect (card visible ≥1s before tap) | Savings |
|----------|-------------------|-----------------------------------------------|---------|
| Guest preview (direct R2 CDN file) | TCP + TLS + first byte on tap | Connection warm before tap | **40–150 ms** typical mobile |
| Preview via `/api/media/preview` redirect | Same-origin API only on tap; R2 leg still benefits if redirect target is CDN | Partial — API same-origin; CDN leg warmed | **0–80 ms** on CDN leg |
| Entitled `/api/library/stream` | Same-origin; signed R2 host unknown until server responds | Same-origin only | **~0 ms** from CDN preconnect |

Conservative estimate for home-card guest preview: **~80 ms** median saved on first visible-card play per session.

## Risk

- **Low:** Extra `<link>` tags only; no fetch until user taps play.
- **Rollback:** Remove `PlaybackNetworkHints` import and `<head>` block from `layout.js`.

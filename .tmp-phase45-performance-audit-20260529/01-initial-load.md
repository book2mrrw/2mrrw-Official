# 01 — Initial Load (FCP, LCP, TTI, Hydration, JS Shipped)

## Methodology

- `npm run build` (Next.js 16.2.4 Turbopack) — exit 0, compiled 11.9s
- Chunk analysis: `.next/static/chunks/*.js` (35 files, **2.74 MB** uncompressed)
- Static `"use client"` grep across `src/`
- No `@next/bundle-analyzer` in `package.json` scripts or devDependencies
- Live CWV not measured (no production trace in this audit)

## Route output (build)

| Route | Render | Notes |
|-------|--------|-------|
| `/` | Static ○ | Primary storefront — entire shell is client component |
| `/subscribe`, `/login`, `/join`, `/verify-otp`, `/success` | Static ○ | Auth/checkout satellites |
| `/album/[slug]`, `/song/[slug]`, `/feature/[slug]` | Dynamic ƒ | Release deep links |
| 50+ API routes | Dynamic ƒ | Not in initial JS bundle |

## Client JS shipped (root layout chain)

**Provider tree** (`src/app/layout.js`):
```
PostHogInit → AuthProvider → AppAuthRoot → AuthGateProvider → AudioProvider
  → SessionRecoveryRoot → StripeProvider → {children} + GlobalAudioPlayerBar
```

Every page pays for: Auth bootstrap, full AudioContext (~2,974 lines), Stripe JS loader, PostHog, framer-motion (via `page.js`), Supabase client (auth path).

### Chunk size breakdown (top 10)

| Size | Chunk | Identified libs |
|------|-------|-----------------|
| 407 KB | `01s4v2gur2rv~.js` | React/Next core (minified) |
| 407 KB | `0tyj11_vjpg0n.js` | React/Next core (minified) |
| 329 KB | `0r51.50eo84zj.js` | framer-motion + stripe |
| 222 KB | `0i2mm~z9rffy~.js` | App/shared modules |
| 211 KB | `0k2c51m0ti.7f.js` | supabase |
| 186 KB | `0di3iakjho8lj.js` | Shared UI |
| 184 KB | `0qji6969z_g_l.js` | posthog |
| 137 KB | `0vjl2odh~7nce.js` | Shared |
| 131 KB | `0b3030qv56zb-.js` | framer-motion |
| 110 KB | `03~yq9q893hmn.js` | Shared |

**Total client chunks:** 2.74 MB (pre-gzip). Expect ~700–900 KB gzip for initial navigation (estimate — validate with Network panel).

### Dead weight note

`three` is in `package.json` dependencies but **no `from "three"` imports** in `src/` — not in client chunks (tree-shaken). Still adds install surface; not runtime cost.

## Hydration path

1. **SSR:** `AppAuthRoot` returns `BOOT_PLACEHOLDER` until hydration (`src/components/auth/AppAuthRoot.js` L36–38) — black full-viewport div, `minHeight: 100vh`
2. **After hydration:** Full `page.js` mounts (~2,778 lines client component)
3. **Auth parallel:** `AuthProvider` bootstraps Supabase session + `/api/account/state` (`src/context/AuthContext.js` L220+)
4. **Service worker:** Inline script registers `/sw.js` on load (`src/app/layout.js` L33–36)

### Hydration cost drivers

| Driver | File | Est. impact |
|--------|------|-------------|
| Monolithic Page component | `src/app/page.js` | High — single reconciliation tree |
| framer-motion AnimatePresence | `src/app/page.js` L4 | High — motion feature bundle ~131–329 KB |
| Stripe Elements eager import | `src/app/page.js` L5–6, L69 | Medium — loads even when cart closed |
| AudioContext provider init | `src/context/AudioContext.js` | Medium — event listeners, Web Audio setup on first play |
| PostHog init | `src/components/system/PostHogInit.js` | Low–Medium — deferred to useEffect |

## FCP / LCP / TTI estimates (code-path)

| Metric | Likely LCP candidate | Risk | Evidence |
|--------|---------------------|------|----------|
| **FCP** | Black placeholder → hero shell | Low–Med | AppAuthRoot placeholder then hero |
| **LCP** | Hero MP4 `videos/A2B.mp4` OR "2MRRW" text | **High** | `page.js` L1783 — `preload="auto"` full-bleed video |
| **TTI** | After catalog fetch + auth resolve | **High** | Serial: hydrate → auth → catalog `/api/catalog/releases` |

### Initial network (page mount)

From `src/app/page.js` useEffects:
- `/api/catalog/releases?page=1&limit=20` — `cache: "no-store"` (L703)
- `/api/catalog/exclusive-drops` — tab-gated (L868)
- `/api/public/vault` — innercircle tab only (L887)
- `/api/printful/products` — shop (L901)
- Hero MP4 via `catalogMotionVideoUrl("videos/A2B.mp4")` — CDN, competes with JS

## Findings

1. **No route-level code splitting for storefront** — `/` is one client component importing 40+ modules statically.
2. **Stripe loaded at module scope** — `loadStripe(...)` at L69 executes on chunk parse.
3. **DonateModal only dynamic import** — `dynamic(..., { ssr: false })` at L8; other heavy modals are static.
4. **Performance marks dev-only** — `src/lib/dev/performanceMarks.js` L27–32; no prod hydration timing.
5. **Build does not emit per-route JS sizes** — Next 16 Turbopack build output lacks First Load JS table; manual chunk analysis required.

## Validation checklist

- [ ] Lighthouse mobile on https://www.2mrrw.com — record FCP, LCP, TBT, TTI
- [ ] Network: document transfer size for `/` document + initial JS chunks
- [ ] Compare LCP with hero video disabled (feature flag) vs enabled
- [ ] Measure hydration gap: placeholder visible duration on 3G Fast

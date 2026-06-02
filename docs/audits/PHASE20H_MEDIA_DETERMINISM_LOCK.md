# Phase 20H — Media determinism lock & SSR/client contract freeze

**Date:** 2026-06-02  
**Mode:** Stabilization / regression prevention — no new features, no redesign  
**Repository:** `/Users/recharge/artist-platform`  
**Prior phases:** `PHASE20F_GLOBAL_MEDIA_RENDER_STABILITY_FIX.md`, `PHASE20G_CATALOG_ASSET_HYDRATION_STABILITY.md`

---

## Executive summary

| Field | Result |
|--------|--------|
| **Root cause class** | Post-hydration catalog merges and idempotent re-resolves could still produce new URL strings for the same media identity when API/inline/canonical paths diverged in representation but not asset |
| **Fix strategy** | Formal media determinism contract module; per-slug frozen resolver; block URL rewrites when signature unchanged; SSR/client parity assertions |
| **20F scroll stability** | **Unchanged** — no edits to scroll store, mobile nav, or page IO |
| **20G hydration stability** | **Extended** — 20G patterns formalized and enforced at merge/commit boundaries |

---

## Root cause summary (class-level)

Three interacting classes drove post-first-paint media URL churn (Phase 20D/20G):

1. **Representation drift** — Same asset expressed as inline `/images/…`, discovery `/api/media/visual?…`, or CDN URL; merge/resolver paths could swap representation after render even when React tree did not remount (20F).
2. **Unconditional re-resolution** — Page-1 catalog fetch and card-level `withR2CatalogMedia` re-ran full rewrite pipelines after first paint, producing new strings for unchanged entities (20G).
3. **Missing contract boundary** — No single module enforced “identity → URL” immutability after hydration; merge helpers preserved inline paths but did not lock already-resolved display URLs when signature was stable.

Phase 20H adds an explicit contract layer that freezes resolved URLs per slug once identity is established, and blocks silent src changes at catalog surface commit boundaries.

---

## Media identity contract

```
getMediaSignature(track) = join(slug, cover, video, visual, preview, "\0")

INVARIANT: ∀ track T, after first resolveMedia(T):
  if getMediaSignature(T') === getMediaSignature(T)
  then resolveMedia(T').cover === resolveMedia(T).cover  (and video, visual, preview)
```

| Function | Role |
|----------|------|
| `getMediaSignature(track)` | Canonical identity hash for cover/video/visual/preview fields |
| `resolveMedia(track)` | Pure deterministic resolver → final stable URLs; per-slug memo |
| `resolveStableMediaUrl(track, { field })` | Single-field stable URL accessor |
| `freezeMediaFields(track)` | Shallow-frozen copy with resolved fields locked |
| `mergeCatalogTrackDeterministic(prev, incoming, inline)` | Merge with URL freeze when signature unchanged |
| `commitCatalogSinglesDeterministic(prev, next)` | List commit — no-op or immutable replace only |
| `stabilizeCatalogMediaDeterministic(items)` | Normalize BEFORE render (provider seed) |
| `assertMediaInvariant(prev, next)` | Dev warning when signature matches but field changed |
| `assertSsrClientParity(ssr, client)` | Dev warning on SSR/client URL mismatch at init |

**Contract statement:** Once media is rendered, identity and resolved URL must never change unless the underlying asset truly changes (signature delta).

---

## SSR / client parity

- Home shell is `"use client"`; catalog cards are not SSR-rendered with divergent resolver paths.
- `CatalogSurfaceProvider` seeds `browseSingles` via `stabilizeCatalogMediaDeterministic` — same `resolveMedia` pipeline as post-fetch merge.
- On mount, when both `initialSingles` and `inlineSingles` exist, `assertSsrClientParity` compares resolved URLs per slug (dev / `NEXT_PUBLIC_MEDIA_DETERMINISM_DEBUG=1`).
- No second-pass canonical swap after render: `mergeCatalogTrackDeterministic` and `commitCatalogSinglesDeterministic` preserve prior resolved fields when signature is unchanged.

---

## Affected files

| File | Change |
|------|--------|
| `src/lib/media/media-determinism.js` | **New** — contract module (signature, resolver, freeze, merge, dev invariants) |
| `src/components/storefront/catalog-surface-context.js` | Wired deterministic stabilize/merge/commit; SSR parity check on init |
| `docs/audits/PHASE20H_MEDIA_DETERMINISM_LOCK.md` | This document |

**Not changed (20F/20G preserved):** `home-scroll-section-store.js`, `MobileHomeBottomNav.js`, scroll IO in `page.js`, `CoverArt.js` memo, `r2-catalog-media.js` implementation (20G idempotent rewrite retained as resolver backend), `canonical-catalog.js`, playback, checkout, entitlements.

---

## Enforcement strategy

1. **Resolver layer** — `resolveMedia` delegates to `withR2CatalogMedia` (20G idempotent) plus per-slug frozen cache in contract module. Same input → same output; no network.
2. **Provider seed** — Initial and inline singles stabilized through `stabilizeCatalogMediaDeterministic` before first paint.
3. **Fetch merge** — API tracks merged via `mergeCatalogTrackDeterministic(prev, api, inline)`; prior resolved URLs win when signature unchanged.
4. **State commit** — `setBrowseSingles` uses `commitCatalogSinglesDeterministic` to block silent URL rewrites and return previous array reference when effectively unchanged.
5. **Dev invariants** — Gated by `NEXT_PUBLIC_MEDIA_DETERMINISM_DEBUG=1` or `NODE_ENV=development`.

---

## Invariant rules (13)

1. Identical `getMediaSignature` → identical resolved URLs after first hydration.
2. `resolveMedia` is a pure function — same input always yields same output.
3. No network I/O in resolver after hydration.
4. No mutation of track object after first resolution (immutable copies at merge/commit).
5. Normalize media URLs BEFORE render via `stabilizeCatalogMediaDeterministic`.
6. No second-pass canonical URL swap after first paint when signature unchanged.
7. Server and client share the same `resolveMedia` resolver.
8. Block catalog URL rewrites that do not change media identity.
9. Prevent silent merge from altering `src`/cover/video/visual/preview after first paint.
10. Catalog mutations: immutable replacement only OR no-op when signature unchanged.
11. No in-place mutation of `cover`, `video`, `visual`, or `preview` on existing track objects.
12. Dev: log when signature matches but resolved field value changed (`assertMediaInvariant`).
13. Dev: log when SSR seed URL ≠ client inline URL on provider init (`assertSsrClientParity`).

---

## Validation

```bash
npm run build
npm run check:frontend-guardrails
```

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** (Next.js 16.2.4, compiled ~5.7s) |
| `npm run check:frontend-guardrails` | **PASS** — 0 errors, 3 pre-existing warnings on `page.js` markers |

---

## Follow-ups (out of scope)

- Auth island admin-gift gate flicker (Phase 20D).
- Optional: route `catalogCoverDisplay` through `resolveMedia` for single resolver entry (currently still uses `withR2CatalogMedia` — idempotent via 20G memo).
- Device validation on Mobile Safari with `NEXT_PUBLIC_MEDIA_DETERMINISM_DEBUG=1`.

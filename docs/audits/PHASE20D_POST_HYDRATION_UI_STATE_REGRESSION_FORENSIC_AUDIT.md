# Phase 20D — Post-hydration UI state regression forensic audit

**Date:** 2026-06-01  
**Mode:** Audit only (read-only). No fixes, no trace hooks implemented, no commit.  
**Repository:** `/Users/recharge/artist-platform`  
**Prior audits read:** `PHASE17B_RENDER_ISLAND_VALIDATION.md`, `PHASE17C_PRODUCTION_VALIDATION.md`, `PHASE20C_LIFECYCLE_RECOVERY_ELIMINATION.md`  
**Source:** Subagent forensic pass (`6fadcbd5-3fae-4416-8291-a9e2dd991d95`); citations verified against current tree.

---

## Executive summary

| Field | Answer |
|--------|--------|
| **Root cause (one-liner)** | ~1–3s after refresh, a coalesced async wave (`CatalogSurfaceProvider` page-1 fetch + `AuthContext` bootstrap) rewrites inline catalog media through `withR2CatalogMedia()` (same-origin → R2/CDN URLs) and flips auth/entitlement island props (`sessionHydrated`, `isAdminStable`, entitlement snapshot), forcing a second storefront reconciliation that looks like a “refresh” and can blank cover art; admin gift overlays disappear when `isAdminStable` goes false or when card media collapses. |
| **Q10 classification** | **E** — Phase 17–20 regression (catalog island post-fetch media rewrite + auth island deferred admin gate + entitlement snapshot timing). **Secondary: D** — missing/broken data after async catalog hydration (CDN URL rewrite). |
| **Q8 remount verdict** | **No** island remount on cold home load in first 10s; observed “refresh” is **re-render churn** from auth + catalog state updates. |
| **Trace hooks** | **Not implemented** (documented below for a follow-up pass). |
| **Build / guardrails** | **Not run** as part of this audit-only doc creation. |

---

## User-observed behavior (Mobile Safari)

1. Refresh page → initial render correct for ~1–3s (cover art normal, UI healthy).
2. Then second state transition: cover art disappears, admin gifting icon disappears, portions blank, page appears to “refresh”.
3. **Not** lock-screen return — normal page load after refresh.

---

## Root cause

**~1–3s after refresh, a coalesced async wave (`CatalogSurfaceProvider` page-1 fetch + `AuthContext` bootstrap) rewrites inline catalog media through `withR2CatalogMedia()` (same-origin → R2/CDN URLs) and flips auth/entitlement island props (`sessionHydrated`, `isAdminStable`, entitlement snapshot), forcing a second storefront reconciliation that looks like a “refresh” and can blank cover art; admin gift overlays disappear when `isAdminStable` goes false or when card media collapses.**

### Mechanism (three coupled pipelines)

1. **Catalog surface** — On mount, `CatalogSurfaceProvider` fetches `/api/catalog/releases?page=1`. On completion (or error fallback), page-1 `browseSingles` is set to `inlineSingles.map(withR2CatalogMedia)`, rewriting every inline `cover` / `video` / `visual` URL before `displaySingles` propagates to `LatestSinglesStyleRow` and `CarouselUI`.
2. **Auth surface** — `AuthContext` bootstrap calls `refreshAccountState` then `setSessionHydrated(true)` in `finally`. `AuthSurfaceIsland` computes `isAdminStable` only when `sessionHydrated && (isAdmin || permissions.admin)`. Admin gift UI is suppressed until hydration completes; it can **appear then disappear** if post-bootstrap reconciliation clears admin flags or if cards collapse visually.
3. **Entitlement surface** — `useEntitlementAccountState()` returns `EMPTY_ACCOUNT_STATE` until `sessionHydrated`, then merges entitlement snapshot when `version >= 1`. Contributes to locked/blurred “portions blank” on cards but does not directly own cover `src`.

**Not the primary cause:** `SessionRecoveryRoot` / `useSessionRecovery` (playback queue hydrate only). **Not** classic React hydration mismatch at first paint (symptom is delayed ~1–3s). **Not** island remount (no `key` churn on audited islands).

---

## Timeline (cold refresh, home tab, Mobile Safari)

| Time | Event | UI effect |
|------|--------|-----------|
| **0.0s** | SSR + `AppAuthRoot` `hydrated=false` → boot placeholder | Brief black shell possible |
| **~0.1s** | `AppAuthRoot` sets `hydrated=true`; `Page` mounts | Inline `singles` render with raw `/images/`, `/videos/` paths — covers look correct |
| **~0.1s** | `CatalogSurfaceProvider` mounts; `browseSingles = initialSingles`; fetch starts | `catalogLoading=true`; cards still show inline media |
| **~0.1s** | `AuthContext` bootstrap starts (`bootstrapSession` → `refreshAccountState`) | `sessionHydrated=false` → **`isAdminStable=false`** → no gift overlays yet |
| **~1–3s** | `GET /api/account/state` completes; `setSessionHydrated(true)` in bootstrap `finally` | **`isAdminStable` may become true** for admin; entitlement snapshot v1 commits |
| **~1–3s** | `GET /api/catalog/releases?page=1` completes | **`setBrowseSingles(inlineSingles.map(withR2CatalogMedia))`** — all inline media URL-rewritten |
| **~1–3s** | Islands + `PageStorefront` re-render (no remount) | Cover/video `src` change → broken CDN → blank cards; gift icons vanish (gate or hidden on collapsed cards); “second refresh” feel |

**Parallel (playback only):** If saved playback queue exists, `useSessionRecovery` may fetch `/api/catalog/hydrate` and dispatch `2mrrw:playback-recovery` — does not gate storefront render (`SessionRecoveryRoot.js:5–8`).

---

## Audit scope (components / files)

| Area | Primary files |
|------|----------------|
| Render islands | `AuthSurfaceIsland.js`, `EntitlementSurfaceIsland.js`, `PlaybackChromeIsland.js` |
| Catalog | `catalog-surface-context.js`, `catalogMedia.js`, `r2-catalog-media.js` |
| Home storefront | `HeroIsland.js`, `HomeStorefront.js`, `HomeStorefrontFlowMode.js`, `LatestSinglesStyleRow.js`, `CarouselUI.js` |
| Auth shell | `AppAuthRoot.js`, `AuthContext.js` |
| Recovery | `SessionRecoveryRoot.js`, `useSessionRecovery.js` |
| Page orchestration | `src/app/page.js` (inline singles, island wiring, `displaySingles`) |
| APIs | `src/app/api/account/state/route.js`, `src/app/api/catalog/releases/route.js` |
| Media merge (server) | `src/lib/control-system/releases.js` (`mergeCatalogWithFallback`) |

---

## Phase 17–20 regression assessment

| Phase | Relevant change | Link to this regression |
|-------|-----------------|-------------------------|
| **17A/17B** | Persisted home mount (`display:none` tab panel), render islands split auth/entitlement/catalog | Home shell stays mounted but **re-renders** when island context values change — amplifies second-paint visibility |
| **17C** | Production validation of island boundaries | Confirmed islands; did not eliminate post-fetch catalog rewrite |
| **18+** | Entitlement snapshot gating (`useEntitlementAccountState`, `sessionHydrated`) | Second paint for card access chrome |
| **20C** | Lifecycle recovery elimination (playback) | **Out of scope** for this UI regression |

**Verdict:** Regression class **E** — behavior emerges from **intentional** Phase 17 island + entitlement hardening combined with **unconditional** client-side `withR2CatalogMedia` on page-1 catalog hydration, not from a single new bug in one file.

---

## Q1–Q10 forensic answers

### Q1 — Component rendering admin gifting icon; visibility conditions

**Component:** `GiftOverlayButton` (`src/components/gifts/GiftOverlayButton.js`).

**Home / music surfaces (representative):**

| File | Function | Line | Condition |
|------|----------|------|-----------|
| `LatestSinglesStyleRow.js` | `LatestSinglesStyleRow` (forwardRef) | 111 | `{isAdmin ? <GiftOverlayButton … /> : null}` |
| `CarouselUI.js` | default export | 24 | Same pattern on `currentSingle` |
| `FeaturesRail.js` | render | 18 | Per feature item |
| `CatalogGrid.js` | render | 100 | Per grid item |
| `RadioCarousel.js` | render | 42 | Per slide |

**Admin gate (authoritative for render):** `AuthSurfaceIsland` exposes `isAdminStable`:

```24:27:src/components/storefront/AuthSurfaceIsland.js
  const isAdminStable = useMemo(
    () => Boolean(sessionHydrated && (isAdmin || accountState?.permissions?.admin)),
    [sessionHydrated, isAdmin, accountState?.permissions?.admin]
  );
```

**Wiring:** `page.js` passes `isAdminStable={auth.isAdminStable}` / `isAdmin={auth.isAdminStable}` into `HomeStorefrontFlowMode`, `CarouselUI`, `FeaturesRail`, `CatalogGrid`, etc. (e.g. `page.js:1515`, `1588`, `1591`, `1605`).

**Visibility:** `sessionHydrated === true` **AND** (`isAdmin === true` **OR** `accountState.permissions.admin === true`).

**Note:** `openGiftSheet` uses raw `isAdmin` (`AuthSurfaceIsland.js:29–34`); card overlay render uses `isAdminStable` via props.

---

### Q2 — State change that removes gifting icon after initial render

**Most likely:**

1. **`isAdminStable` flips true → false** while `sessionHydrated` stays true when:
   - `clearAuthenticatedState()` runs (`AuthContext.js:414–422`),
   - `401` on `refreshAccountState` (`AuthContext.js:321–327`),
   - Bootstrap `verifiedResolved` failure path (`AuthContext.js:446–451`).
2. **Collateral:** Card media collapse after catalog URL rewrite hides absolutely positioned `GiftOverlayButton` (overlay still gated on `isAdminStable`, but parent card appears blank).

**Initial render:** Icons absent until `sessionHydrated` — expected suppression, not a “disappear” unless user is admin and saw icons in a pre-hydration dev/Strict Mode edge case.

---

### Q3 — Cover art owner (file, component, data source)

| Surface | Owner component | Data source |
|---------|-----------------|-------------|
| Home “Latest Singles” row | `LatestSinglesStyleRow` | `displaySingles` from `CatalogSurfaceProvider` |
| Video cards | `<video poster={item.cover} src={item.video}>` | `withR2CatalogMedia(rawItem)` — `LatestSinglesStyleRow.js:57`, `113–116` |
| Cover cards | `CoverArt` via `catalogCoverDisplay(item)` | `LatestSinglesStyleRow.js:64`, `133–135` |
| Music tab carousel | `CarouselUI` → `CoverArt` | `catalogCoverDisplay(currentSingle)` — `CarouselUI.js:15`, `30–33`; `currentSingle` from `page.js:835` |

**Pipeline:** Inline constants (`page.js` ~187+) → `CatalogSurfaceProvider` state → `withR2CatalogMedia` (`catalogMedia.js` re-export / `r2-catalog-media.js`) → `catalogCoverDisplay` (`catalogMedia.js:13–34`).

```835:835:src/app/page.js
  const currentSingle = useMemo(() => withR2CatalogMedia(displaySingles[singleIndex]), [singleIndex, displaySingles]);
```

```138:138:src/components/storefront/catalog-surface-context.js
  const displaySingles = browseSingles.length ? browseSingles : inlineSingles;
```

---

### Q4 — Can catalog hydration replace valid artwork with fallback?

**Yes, indirectly.**

- Page-1 fetch always rewrites inline singles on several paths, e.g. success merge:

```92:94:src/components/storefront/catalog-surface-context.js
        setBrowseSingles((prev) => {
          const merged =
            catalogPage === 1 ? [...inlineSingles.map((s) => withR2CatalogMedia(s))] : [...prev];
```

- `catalogCoverDisplay` uses placeholder when resolved `src` is empty (`catalogMedia.js:22–32`).
- Server merge preserves fallback cover when API cover is falsy (`releases.js:351` — `cover: mapped.cover || fallback.cover`).
- **Risk:** API or rewrite returns a **truthy but broken** CDN URL → not replaced by fallback → broken/blank visual (`CoverArt.js:52–65` gray box when `!src`).

---

### Q5 — Can auth hydration cause a second render that removes admin UI?

**Partially yes.**

- Admin UI is **intentionally suppressed** until `sessionHydrated` (`AuthSurfaceIsland.js:24–27`).
- Bootstrap `finally` sets `sessionHydrated=true` (`AuthContext.js:460–464`) ~1–3s after load → island re-render.
- Admin overlays **appear** when `isAdminStable` becomes true; they **disappear** if post-bootstrap auth reconciliation clears `isAdmin` / `permissions.admin`, or if card layout collapses.
- `AppAuthRoot` (`AppAuthRoot.js:38–40`) gates only the initial shell placeholder; it does **not** remount `Page` after first client hydration.

---

### Q6 — Can entitlement hydration cause a second render that removes content?

**Partially yes; not primary for cover art.**

```649:657:src/context/AuthContext.js
export function useEntitlementAccountState() {
  const { accountState, sessionHydrated, getEntitlementSnapshot, entitlementSnapshotVersion } = useAuth();
  return useMemo(() => {
    if (!sessionHydrated) return EMPTY_ACCOUNT_STATE;
    const base = accountState ?? EMPTY_ACCOUNT_STATE;
    const snapshot = getEntitlementSnapshot?.();
    if (!snapshot || snapshot.version < 1) return base;
    return mergeSnapshotIntoAccountState(base, snapshot);
  }, [sessionHydrated, accountState, getEntitlementSnapshot, entitlementSnapshotVersion]);
}
```

`EntitlementSurfaceIsland` passes `entitlementAccountState` to cards — affects access badges, pricing, lock blur — not cover `src` directly. Can contribute to “portions blank” via locked/blurred states.

---

### Q7 — Does `SessionRecoveryRoot` update state on initial load?

**Yes, internal playback recovery only.**

```16:68:src/system/recovery/useSessionRecovery.js
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const playback = store.load("playback");
      if (playback?.queueIds?.length) {
        // … fetch /api/catalog/hydrate …
        window.dispatchEvent(new CustomEvent("2mrrw:playback-recovery", { detail: { … } }));
      }
      if (!cancelled) setIsRecovering(false);
    })();
```

- Sets `isRecovering=true` on mount, false when done.
- **Does not gate storefront render** — `SessionRecoveryRoot.js:5–8` always returns `children`.

---

### Q8 — Component remounts in first 10s? (remount verdict)

| Component | Remount on cold home refresh? | Trigger |
|-----------|-------------------------------|---------|
| `Page` / `PageStorefront` | **First mount** when `AppAuthRoot` hydrates | `AppAuthRoot.js:29–31`, `38–44` |
| `HomeStorefront` / home panel | **No** (persisted `display:none`) | `page.js:1499–1503` |
| `AuthSurfaceIsland` / `EntitlementSurfaceIsland` | **No** | No remount `key` on islands |
| `CatalogSurfaceProvider` | **No** | Stable wrapper `page.js:278–286` |
| `HeroIsland` | **No** | Memo, no key |

**Remount verdict:** **No remount** of audited storefront islands in the first 10s on production cold home load. Observed “refresh” is **re-render churn** from auth + catalog state updates, not unmount/remount (unless React Strict Mode double-effects in dev).

---

### Q9 — Network requests after initial render that mutate UI

| Request | Source | UI mutation |
|---------|--------|-------------|
| `GET /api/catalog/releases?page=1&limit=20` | `catalog-surface-context.js:47–50` | `browseSingles`, `catalogLoading`, `displaySingles` |
| `GET /api/account/state` | `AuthContext.js:316–319` (bootstrap / refresh) | `user`, `isAdmin`, `accountState`, entitlement snapshot |
| `GET /api/guest/session` | `AuthContext.js:364` (if no auth session) | Guest user path |
| `GET /api/catalog/hydrate?ids=…` | `useSessionRecovery.js:24–27` | Playback recovery event only |

Tab-gated fetches (exclusive-drops, vault, printful) **do not run on home** initial load.

All audited fetches use `cache: "no-store"` where applicable — stale HTTP cache is not the dominant mechanism.

---

### Q10 — Classification

| Code | Label | Applies? |
|------|-------|----------|
| **A** | Expected behavior | **No** — second paint degrades admin + media vs first paint |
| **B** | Hydration mismatch | **No** — symptom is ~1–3s **after** hydrate, not at first React hydrate |
| **C** | Stale cache | **Unlikely** — `cache: "no-store"` on account/catalog fetches |
| **D** | Missing / broken data | **Yes (secondary)** — CDN URLs after `withR2CatalogMedia` may 404 or fail load |
| **E** | Phase 17–20 regression | **Yes (primary)** — catalog island rewrite + deferred admin gate + entitlement snapshot timing |

**Final classification: E + D** (Phase 17–20 architectural second paint, exacerbated by broken or swapped media URLs post-rewrite).

---

## Network request table (post–initial render)

| # | Method / path | When | Cancels UI? | Mutates |
|---|---------------|------|-------------|---------|
| 1 | `GET /api/catalog/releases?page=1&limit=20` | `CatalogSurfaceProvider` mount | No | `browseSingles`, loading flags, all cover/video URLs via `withR2CatalogMedia` |
| 2 | `GET /api/account/state` | `AuthContext` bootstrap | No | `sessionHydrated`, `isAdmin`, `accountState`, entitlement snapshot |
| 3 | `GET /api/guest/session` | Bootstrap when no Supabase session | No | Guest `user`, may chain (2) |
| 4 | `GET /api/catalog/hydrate?ids=…` | `useSessionRecovery` if saved queue | No | Playback only (`2mrrw:playback-recovery`) |

---

## Recommended fix plan (no code — audit only)

1. **Defer or skip `withR2CatalogMedia` on page-1** when inline paths already resolve locally; only transform slugs that exist only on API/CDN.
2. **Stabilize admin gate:** Single authoritative admin flag from `/api/account/state` payload; avoid render flicker when JWT hint and server `permissions.admin` disagree during bootstrap.
3. **Catalog fetch merge:** When merging API tracks with inline fallbacks, preserve inline `cover` / `video` if merged CDN fields are empty or known-broken (extend server `mergeCatalogWithFallback` parity on client merge at `catalog-surface-context.js:79–90`).
4. **Reduce “refresh” feel:** Narrow `PageStorefront` `useAuth()` subscription (Phase 17 P3) so catalog/auth updates do not reconcile hero + full shell unnecessarily.
5. **Validate on device:** After trace hooks land, repro on Mobile Safari with `NEXT_PUBLIC_UI_HYDRATION_TRACE=1` plus existing `NEXT_PUBLIC_PLAYBACK_TRACE=1`; confirm ordering: `CATALOG_STATE_CHANGED` → `COVER_ART_SOURCE_CHANGED` → `GIFT_ICON_VISIBILITY_CHANGED`.

---

## Recommended trace hooks (document only — not implemented)

**Gate:** `NEXT_PUBLIC_UI_HYDRATION_TRACE=1` (new) or extend `playback-trace.js` / `state-churn-log.js` pattern. **No rendering logic changes.**

| Event | File | Hook point |
|-------|------|------------|
| `AUTH_STATE_CHANGED` | `AuthContext.js` | After `setSessionHydrated`, `setUser`, `setIsAdmin` |
| `ADMIN_STATE_CHANGED` | `AuthSurfaceIsland.js` | `useEffect` on `isAdminStable`, `isAdmin`, `permissions.admin` |
| `ENTITLEMENT_STATE_CHANGED` | `EntitlementSurfaceIsland.js` | `useEffect` on `entitlementAccountState`, `accountStateReady` |
| `CATALOG_STATE_CHANGED` | `catalog-surface-context.js` | Extend existing churn effect ~119–131; log `browseSingles` slug + cover hash |
| `GIFT_ICON_VISIBILITY_CHANGED` | `LatestSinglesStyleRow.js` | Log when `isAdmin` prop changes per slug |
| `COVER_ART_SOURCE_CHANGED` | `LatestSinglesStyleRow.js`, `CarouselUI.js` | Log `coverDisplay.src` per slug |
| `COMPONENT_REMOUNT_DETECTED` | `HomeStorefront.js`, `AuthSurfaceIsland.js` | Pattern from `useBlackscreenMountTrace.js` |

**Existing related instrumentation:** `logUiChurn` in `AuthSurfaceIsland.js:42–47`, `catalog-surface-context.js:119–131` (playback trace gated).

---

## Validation note

Per original Phase 20D brief: `npm run build && npm run check:frontend-guardrails` should pass before merging any **future** trace-hook PR. This audit document creation did not run those commands.

---

## Return summary (parent agent)

| Field | Value |
|-------|--------|
| **Audit doc** | `docs/audits/PHASE20D_POST_HYDRATION_UI_STATE_REGRESSION_FORENSIC_AUDIT.md` |
| **Root cause** | Coalesced catalog media rewrite + auth/entitlement island second paint ~1–3s post-load |
| **Q1** | `GiftOverlayButton` in `LatestSinglesStyleRow.js:111` (also `CarouselUI.js:24`); gated by `AuthSurfaceIsland.isAdminStable` |
| **Q3** | `LatestSinglesStyleRow` / `CarouselUI` → `catalogCoverDisplay(withR2CatalogMedia(item))`; data from `CatalogSurfaceProvider.displaySingles` |
| **Q10** | **E + D** |
| **Q8** | **No** island remount; re-renders only |
| **Trace files** | None (documented above) |
| **Commit** | N/A — audit only |

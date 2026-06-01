# Admin Hydration Audit (B1–B9)

**Re-verified:** `AuthContext.js`, `useEntitlementAccountState`, `page.js`, `/api/account/state/route.js`, Phase 5A artifacts

---

## B1 — Auth timeline initial load → admin

See `AUTH_TIMELINE.md`.

**Admin path:** Supabase session resolves → `setUser` + `setIsAdmin` → `refreshAccountState` → server `permissions.admin` + `finalOwnedSlugs` expansion.

---

## B2 — Guest → admin transition

| Phase | UI | Mechanism |
|-------|-----|-----------|
| T0 SSR/hydration | Black placeholder | `AppAuthRoot` `!hydrated` L38–39 |
| T1 `loading: true` | Guest-like entitlements | `useEntitlementAccountState` returns `EMPTY_ACCOUNT_STATE` L441–446 |
| T2 Session known | `isAdmin` may be true from JWT | `resolveUserFromSession` / `isAdminUser` |
| T3 Account state lands | Catalog unlocks, gift overlays, admin panel | `applyAccountPayload` + admin slug expansion |

**Prices:** Derived from `resolveContentAccess(item, accountState)` in `CatalogGrid.js` L31 — recomputes when `accountState` object changes.

**Gift:** `isAdmin ? <GiftOverlayButton />` L100 — appears when `isAdmin` prop true (from `page.js`).

**Collector admin:** `accountStateReady && isAdmin` → `CollectorCardAdminPanel` L2525 — **stricter** than gift overlay (`accountStateReady = !authLoading` L1687).

**Mismatch (C2):** Gift can show when `isAdmin` true but `accountState` still EMPTY during loading flip.

---

## B3 — State field map

| Field | Source | Consumers |
|-------|--------|-----------|
| `user` / `currentUser` | Supabase session + `/api/account/state` user | Playback `listeningUserIdRef`, profile UI |
| `isAdmin` | `isAdminUser(user)` + server `permissions.admin` | Gift, rails, gating |
| `accountState` | `applyAccountPayload` | `resolveContentAccess`, vault, collector |
| `ownedSlugs` | Set from account state + library | `owns(slug)` |
| `library` | Account payload items | My Music, purchase UI |
| `permissions` | Server + admin flag merge | Feature flags |
| `loading` | Bootstrap finally | Gates `useEntitlementAccountState` |
| `authStatus` | Derived L384–391 | `AppAuthRoot` AuthGate overlay |
| `entitlementAccountState` | `loading ? EMPTY : accountState` | Catalog, AudioContext, modals |

**Admin server expansion:** `route.js` L192–202 — all digital product slugs in `finalOwnedSlugs`.

---

## B4 — null/empty → populated UI effects

| Surface | Empty behavior | Populated behavior |
|---------|----------------|-------------------|
| Catalog locks/CTAs | `resolveContentAccess` → locked/preview | Owned/stream badges |
| Subscribe CTA | `showSubscribeCta` may show | May hide |
| Gift overlays | Hidden (`!isAdmin`) | Visible |
| CollectorCardAdminPanel | Not mounted | Mounted L2525 |
| GlobalAudioPlayerBar | Stream vs preview chrome | Updates with entitlements |
| Audio play resolution | Preview-first in `playTrackInternal` | Full stream paths |

**High visibility:** Entire catalog grid repaints — locks, play buttons, badges change in one commit when `loading` → false.

---

## B5 — refreshAccountState dependents

| Caller type | Examples |
|-------------|----------|
| Bootstrap | `AuthProvider` mount L272 |
| Sign-in | `applySessionUser` L234 |
| Guest enter | `enterGuest` L324 |
| Manual | `page.js` checkout success, library change lambdas |
| Subscribe/success polls | `subscribe/page.js`, `success/page.js` |

**Cost:** New `AuthContext` value → all `useAuth()` subscribers re-render; `AudioProvider` is **child** of AuthProvider in layout — **re-renders on every account update** even when only home catalog needed.

**Guards:** `accountStateFetchingRef` drops concurrent fetches L161–162; shallow equal skips noop `setAccountState` L124.

**Does not:** pause audio, `setQueue`, or remount `<audio>`.

---

## B6 — Admin UI gating

| Gate | Condition | Location |
|------|-----------|----------|
| Gift overlay | `isAdmin` prop | `CatalogGrid.js` L100, `FeaturesRail.js` |
| Collector admin panel | `accountStateReady && isAdmin` | `page.js` L2525 |
| `isAdminAccount(accountState)` | Server + client flags | `lib/music-access.js` L65+ |
| AuthGate overlay | `authStatus === "unauthenticated"` after hydrate | `AppAuthRoot.js` L27–46 |
| API routes | `isAdminUser(user)` | gifts, admin APIs |

---

## B7 — Hydration mismatch / placeholders

| Issue | Severity |
|-------|----------|
| `AppAuthRoot` black frame until `hydrated` | Low — one frame |
| `EMPTY_ACCOUNT_STATE` while `loading` | **High** — false "guest" entitlements |
| Strict Mode second mount | Dev-only extra effects |
| `authStatus` for real admin | Should be `authenticated` — not guest |

---

## B8 — Top 10 rerender hotspots

See `RERENDER_HOTSPOTS.md` (from Phase 5A, line numbers re-checked).

---

## B9 — Connection playback vs guest→admin

See `EXECUTIVE_SUMMARY.md` §Connection verdict.

**Verdict B:** Same session can show **both** hydration flicker and scroll-pause stop; **different mechanisms**. Auth hydration does **not** call `pause()` on scroll repro.

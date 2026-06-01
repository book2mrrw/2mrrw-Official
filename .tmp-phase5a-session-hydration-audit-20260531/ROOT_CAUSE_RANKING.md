# Root Cause Probability Ranking

Scale: **Confidence** = likelihood this explains reported symptoms in production (not severity).

---

## A) Playback stop / stall

| Rank | Root cause | Confidence | Rationale |
|------|------------|------------|-----------|
| A1 | **`entitlements:updated` → `upgradeToFullStream`** during active preview playback | **Medium (55%)** | Only auth-adjacent path that intentionally changes stream while `isPlaying`; checkout/success dispatch paired with refresh |
| A2 | **Stream access 401/403 after entitlement refresh** on next segment or retry | **Medium (40%)** | `refreshAccountState` does not pause, but `ownedSlugs`/permissions change may affect signed URL resolution |
| A3 | **Session recovery `setQueue` race** (abandoned session + empty in-memory queue) | **Low–Medium (30%)** | Guarded by `hasStarted` and queue length; rare if fan was actively playing |
| A4 | **Bootstrap `refreshAccountState` clearing state on 401** mid-session | **Low (20%)** | Requires session invalidation during play |
| A5 | **AuthProvider re-render unmounting audio** | **Very Low (5%)** | Single persistent `<audio>` ref; disproven by structure |

**Top 3 for playback stop:** A1, A2, A3

---

## B) UI refresh / perceived reload

| Rank | Root cause | Confidence | Rationale |
|------|------------|------------|-----------|
| B1 | **`useEntitlementAccountState` EMPTY → full flip** when `loading` clears | **High (75%)** | All catalog components see entitlement reset then populate — locks, CTAs, subscribe banners |
| B2 | **`page.js` monolith re-render** on each `accountState`/`library` update | **High (70%)** | 2900+ line page; many children receive new `accountState` prop |
| B3 | **Admin catalog expansion** (`ownedSlugs` all digital) after `/api/account/state` | **High (65%)** | Dramatic change in access-derived UI for admin |
| B4 | **`AppAuthRoot` placeholder → shell** on first hydration | **Medium (45%)** | Single black frame; not full reload |
| B5 | **Commerce polling** (`success`, `subscribe`) triggering multiple refresh + library | **Medium (40%)** | Only on those routes, not home cold load |
| B6 | **Strict Mode double mount** (dev only) | **Medium (35%)** | Extra effects; production single mount |

**Top 3 for UI refresh:** B1, B2, B3

---

## C) Guest → admin flash

| Rank | Root cause | Confidence | Rationale |
|------|------------|------------|-----------|
| C1 | **Initial `user: null` + `loading: true`** before bootstrap completes | **High (80%)** | Unavoidable client-only session; short window |
| C2 | **`isAdmin` true before `accountStateReady`** — partial admin chrome | **Medium (60%)** | Gift vs `CollectorCardAdminPanel` gating mismatch in `page.js` |
| C3 | **Guest cookie + Supabase session overlap** cleared async | **Low–Medium (35%)** | `clearGuestSessionCookie` on signed-in path; brief wrong guest state if ordering wrong |
| C4 | **`authStatus: unauthenticated`** shown to real fan | **Low (15%)** | Only if no session after `loading: false`; admin with session should be `authenticated` |
| C5 | **AuthGate overlay** for admin | **Very Low (5%)** | Requires `authStatus === "unauthenticated"` after load |

**Top 3 for guest→admin:** C1, C2, C3

---

## Combined top 3 (cross-symptom)

| # | Root cause | Primary symptom | Confidence |
|---|------------|-----------------|------------|
| 1 | **Entitlement snapshot flip (`loading` gate + `applyAccountPayload`)** | UI refresh, lock flicker, admin catalog populate | **High (78%)** |
| 2 | **`page.js` + catalog children tied to full `accountState`** | Perceived page reload, heavy React commit | **High (72%)** |
| 3 | **`entitlements:updated` stream upgrade during preview** | Playback glitch/stop during purchase return | **Medium (55%)** |

---

## Not primary causes (documented negatives)

- `TOKEN_REFRESHED` re-fetching entitlements — **disabled**
- `refreshAccountState` calling `setQueue` — **not present**
- Provider remount on auth change — **not present**
- Double `bootstrapSession` fetch — **guarded** (module + ref)

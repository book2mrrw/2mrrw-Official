# refreshAccountState() — Complete Call Map

**Definition:** `src/context/AuthContext.js` — `refreshAccountState` (L135–176)

**Behavior:** `GET /api/account/state` with `cache: "no-store"`. Guarded by `accountStateFetchingRef` (concurrent calls coalesce to one in-flight fetch; overlapping callers get `null` without queueing).

**Side effects on success:** `setUser`, `setIsAdmin`, `applyAccountPayload` → updates `library`, `ownedSlugs`, `accountState` (full entitlement snapshot). Triggers `AuthContext` `useMemo` value rebuild → **all `useAuth()` consumers re-render**. Does **not** call `AudioContext.stop()` on 401.

**Does not dispatch** `entitlements:updated` (only explicit checkout/success paths do).

---

## Internal (AuthContext) — lifecycle triggers

| # | File | Function / hook | Caller | Trigger | Freq. | Required? | Redundant? | Auth churn | Entitlement | AudioContext |
|---|------|-----------------|--------|---------|-------|-----------|------------|------------|-------------|----------------|
| I1 | `AuthContext.js` | `refreshAccountState` | — | Definition | — | Yes | — | Source | Yes | Indirect via re-render |
| I2 | `AuthContext.js` | `refreshGuest` | Bootstrap / guest path | No Supabase user after `bootstrapSession` | Once per cold load | Yes | — | High | Yes | Provider re-render |
| I3 | `AuthContext.js` | `applySessionUser` | `subscribeAuthState` SIGNED_IN, OTP flows | New signed-in user id | Per sign-in | Yes | Often paired with explicit refresh (duplicate) | High | Yes | `user`, `authLoading`, `entitlementAccountState` |
| I4 | `AuthContext.js` | Mount `useEffect` | `bootstrapSession` | App cold start / first provider mount | Once (Strict Mode: bootstrap singleton; remount skips re-fetch) | Yes | — | High | Yes | Yes |
| I5 | `AuthContext.js` | `enterGuest` | Guest POST success | Guest checkout / identity | Per guest entry | Yes | — | High | Yes | Yes |

---

## External call sites (src only)

| # | File | Function | Trigger | Freq. estimate | Required? | Redundant / duplicate? | AuthContext | Entitlements | AudioContext |
|---|------|----------|---------|----------------|-----------|------------------------|-------------|--------------|--------------|
| E1 | `app/page.js` | `handlePreviewLibraryChange` | Preview modal library mutation | Rare | Yes | — | Yes | Yes | Re-render only |
| E2 | `app/page.js` | `handleCheckoutSuccess` | Inline Stripe checkout on home | Per purchase | Yes | Often + `refreshLibrary` duplicate library fetch | Yes | Yes + **`entitlements:updated`** | `upgradeToFullStream` if preview playing |
| E3–E12 | `app/page.js` | `onLibraryChange` (10 inline handlers) | Catalog/features/carousel/mymusic library edits | Per user library action | Yes | Same pattern ×10; could be one stable callback | Yes | Yes | Re-render |
| E13 | `app/success/page.js` | `load()` initial | Stripe success page mount | Once per visit | Yes | — | Yes | Yes + event on first batch | Upgrade path |
| E14 | `app/success/page.js` | `load()` poll loop | Webhook lag until `ownedSlugs` match | **Up to 7×** (2s apart) | Partial | **Storm** if webhook slow | Yes ×7 | Yes | Repeated re-renders |
| E15 | `app/subscribe/page.js` | `useEffect` `?subscribed=1` | Return from Stripe subscription | **5×** @ 2.5s interval | Partial | Polling until UI unlocks | Yes ×5 | Yes | Re-renders |
| E16 | `app/subscribe/page.js` | `handleSubscriptionSuccess` | In-page subscription confirm | **5×** @ 2.5s | Partial | Same as E15 | Yes ×5 | Yes | Re-renders |
| E17 | `app/verify-otp/page.js` | `verifyOtp` | OTP success | Per verify | Partial | **Duplicate** after `applySessionUser` (I3) | Yes ×2 | Yes | Yes |
| E18 | `components/auth/AuthGate.js` | `verifyOtp` | Root gate OTP | Per verify | Partial | **Triple** with I3 + E19 | Yes ×2–3 | Yes | Yes |
| E19 | `components/auth/AppAuthRoot.js` | `handleVerified` | `AuthGate` `onVerified` | After E18 | Partial | **Third** refresh same flow | Yes | Yes | Yes |
| E20 | `components/collectors-cards/CollectorCardModal.js` | `handleCheckoutSuccess` | Collector card purchase | Per purchase | Yes | + `refreshLibrary` duplicate | Yes | Yes | Re-render |
| E21 | `components/collectors-cards/CollectorsCardsGrid.js` | `handlePurchaseComplete` | Grid purchase callback | Per purchase | Yes | May stack with E20 | Yes | Yes | Re-render |
| E22 | `app/collector/activate/page.js` | claim handler | Serial activation | Per claim | Yes | — | Yes | Yes | Re-render |
| E23 | `app/gift/[token]/page.js` | claim flow | Gift redeem | Per redeem | Yes | — | Yes | Yes | Re-render |
| E24 | `hooks/useMusicLibrary.js` | `refresh` | My Music tab refresh | On demand | Yes | Always pairs `refreshLibrary` | Yes | Yes | Re-render |

---

## Summary counts

| Metric | Value |
|--------|------:|
| Grep matches in `src/` (refs + deps + destructure) | **58** |
| Distinct external invocation patterns | **24** |
| Internal lifecycle invocations | **5** |
| Max `refreshAccountState` per **success page** visit | **8** (1 initial + up to 7 poll) |
| Max per **subscribe** unlock path | **5** (interval) |
| Max per **OTP verify** (AuthGate on home) | **3** (`applySessionUser` + verify + `onVerified`) |

---

## Cross-cutting answers

| Question | Answer |
|----------|--------|
| Triggers AuthContext rebuild? | **Always** when fetch completes (multi `setState`) |
| Triggers entitlement UI? | Yes via `accountState`, `ownedSlugs`, `library` |
| Triggers AudioContext logic? | Only indirectly: provider re-render; `entitlements:updated` is separate |
| In-flight dedup? | Yes — second caller while fetching returns `null` immediately |

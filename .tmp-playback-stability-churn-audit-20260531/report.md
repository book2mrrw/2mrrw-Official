# Playback Stability & State Churn Audit

**Project:** 2MRRW Artist Platform (`/Users/recharge/artist-platform`)  
**Date:** 2026-05-31  
**Mode:** READ-ONLY — no code changes  
**Auditor scope:** `refreshAccountState`, AuthContext churn, AudioContext cross-deps, `entitlements:updated`, polling, `page.js` rerenders, recovery, routes, mobile lifecycle  

---

## Executive summary

Playback infrastructure is **architecturally sound**: one global `<audio>` in `AudioProvider`, layout-wrapped across routes, and explicit opt-out from auth refresh on `TOKEN_REFRESHED`. Stability issues cluster around **entitlement synchronization churn**, not missing audio APIs.

**Top findings:**

1. **Commerce polling** drives up to **8** `refreshAccountState` calls on `/success` and **5** on `/subscribe` every 2.5s — each completion re-renders `AuthProvider` and **`AudioProvider`** (which subscribes to auth).
2. **`page.js`** binds the full auth context and **61 local `useState` hooks** — entitlement updates during listening re-render the entire cinematic shell.
3. **iOS** intentionally maps lock/app-switch return to **paused UI** without auto-`RECOVER` — fans experience this as “music stopped.”
4. **Session recovery** can **`setQueue` over active playback** on cold load.
5. **`entitlements:updated`** fires only from home checkout and success page — other purchase paths may leave **preview stream** until user interacts.

**Metrics:**

| Metric | Value |
|--------|------:|
| `refreshAccountState` grep matches in `src/` | **58** |
| Distinct external invocation patterns | **24** |
| `entitlements:updated` dispatch sites | **2** |
| `entitlements:updated` listeners | **1** |
| `setInterval` registrations in `src/` | **12** |
| Account/entitlement polling patterns | **3** |

Deliverables: see `manifest.txt` in this folder.

---

## A) refreshAccountState — call map

Full table: [`refresh-account-state-call-map.md`](./refresh-account-state-call-map.md)

**Implementation notes (`AuthContext.js`):**

- In-flight guard: overlapping calls return `null` immediately.  
- 401 clears user + `EMPTY_ACCOUNT_STATE` — does not stop audio.  
- `applyAccountPayload` updates `library`, `ownedSlugs`, and nested `accountState` in one functional update (good) but still replaces context value.

---

## B) Refresh storm analysis

### Login / OTP

| Step | refreshAccountState count | Chain |
|------|---------------------------|--------|
| Cold boot (existing session) | 1 | bootstrap → `refreshAccountStateRef` |
| `verify-otp` page | **2** | `applySessionUser` → refresh + explicit refresh |
| AuthGate on home | **3** | same + `AppAuthRoot.onVerified` |
| + `router.refresh()` | 0 account | Soft RSC refresh |

### Purchase — `/success`

| Step | Count | Notes |
|------|------:|-------|
| Initial batch | 1 | + `refreshLibrary` + **`entitlements:updated`** |
| Poll loop (owned pending) | up to **7** | Each: `refreshAccountState` + `refreshLibrary`, 2s sleep |
| **Max per visit** | **8** | Plus duplicate library API |

### Purchase — inline on `page.js`

| Step | Count | Notes |
|------|------:|-------|
| `handleCheckoutSuccess` | 1 | + library + **`entitlements:updated`** |

### Subscription — `/subscribe`

| Step | Count | Notes |
|------|------:|-------|
| `?subscribed=1` | **5** | 2.5s interval |
| In-modal success handler | **5** | Same pattern (second path if both run) |

### Collector

| Step | Count | Notes |
|------|------:|-------|
| `CollectorCardModal` checkout | 1 | + `refreshLibrary` |
| `CollectorsCardsGrid` callback | 1 | May follow modal |
| `collector/activate` claim | 1 | |

### Gift

| Step | Count |
|------|------:|
| Redeem flow | 1 |

### Duplicate / unnecessary assessment

| Pattern | Verdict |
|---------|---------|
| OTP triple refresh | **Unnecessary** ×2 |
| success 7× poll | **Partially necessary** (webhook lag); **excessive** count/interval |
| subscribe 5× poll | **Partially necessary**; could stop on `subscriberActive` |
| 10× inline `onLibraryChange` on page | **Required** for UI sync; **implementation redundant** (unstable callbacks) |
| refresh + refreshLibrary | **Redundant** network (overlapping data) |

### Broad rerender triggers

Every completed `refreshAccountState` → `setUser` / `setLibrary` / `setOwnedSlugs` / `setAccountState` → new Auth context object → **AudioProvider** + **page.js** + any `useAuth` child.

---

## C) AuthContext churn

See [`auth-context-dependency-map.md`](./auth-context-dependency-map.md).

**Can updates be narrowed?** Yes — recommend split context, stable callbacks, and deduped refresh helper (report-only).

**Affects playback?** Indirectly via AudioProvider re-render and `authLoading` / `mediaProgress` effect deps — not via explicit pause.

---

## D) AudioContext impact

See [`audio-context-dependency-map.md`](./audio-context-dependency-map.md).

---

## E) entitlements:updated

See [`entitlement-event-map.md`](./entitlement-event-map.md).

---

## F) Polling inventory

See [`polling-inventory.md`](./polling-inventory.md).

---

## G) page.js rerender audit

| Factor | Finding |
|--------|---------|
| Contexts | `useAuth()`, `useEntitlementAccountState()`, `useAudioPlayer()` |
| `useState` count | **61** |
| Auth full-page rerender? | **Yes** — any auth context dep change re-renders entire `Page` default export |
| Inline handlers | 10× `onLibraryChange` lambdas → child memoization ineffective |
| Visibility | Pauses carousel videos only |
| Live countdown | 1s `setInterval` → perpetual page re-renders while on home |

---

## H) Recovery

See [`recovery-system-findings.md`](./recovery-system-findings.md).

---

## I) Route refresh

See [`route-refresh-inventory.md`](./route-refresh-inventory.md).

---

## J) Mobile playback

See [`mobile-playback-findings.md`](./mobile-playback-findings.md).

---

## Ranked root causes

See [`ranked-root-causes.md`](./ranked-root-causes.md).

### Top 3 (one-liners)

1. **Success/subscribe entitlement polling** fires up to 8+5 `refreshAccountState` calls, re-rendering AudioProvider during playback.  
2. **`page.js` full `useAuth` subscription** re-renders the entire home shell on every entitlement sync.  
3. **iOS visibility handler** forces paused state after lock/app switch without auto-recover.

---

## Recommended fixes

See [`recommended-fixes.md`](./recommended-fixes.md).

---

## Lowest-risk implementation plan

See [`lowest-risk-implementation-plan.md`](./lowest-risk-implementation-plan.md).

---

## Recovery system integration

Existing assets under `docs/foundation/`, `scripts/recovery/`, and `npm run recover:foundation` were **not modified**. Findings align with prior audits (`.tmp-auth-stability-audit-20260530`, `.tmp-playback-entitlement-teardown-audit-20260527`) — integrate fixes via selective changes, not new recovery frameworks.

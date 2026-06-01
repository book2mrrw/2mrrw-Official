# Auth / App Reload Root-Cause Audit

**Project:** `/Users/recharge/artist-platform`  
**Date:** 2026-05-31  
**Mode:** READ-ONLY forensic (no code changes)  
**Goal:** Determine whether playback interruption is caused by full reloads, `AudioProvider` remount, app shell remount, auth resets, root unmount cycles, hydration mismatches, error boundaries, service worker, visibility handlers, or guest-then-admin UI flash.

**Prior audits re-verified with fresh grep:** Phase 5A session hydration, playback interruption forensic, Phase 524 refresh-path audit.

**Deliverables:** See `MANIFEST.txt`. Detail splits: `auth-bootstrap-trace.md`, `audioprovider-stability.md`, `reload-inventory.md`, `playback-interruption-chains.md`, `final-verdict.md`.

---

## Executive summary

| User-visible symptom | Primary cause (in-repo) | Category | Confidence |
|---------------------|-------------------------|----------|------------|
| Music stops after modal close + scroll | `page.js` `handleAudioVisualsFocused` → `pause()` | playback bug | 92% |
| Page “reloads” / locks flash | Entitlement EMPTY→full + `page.js` re-render | rerender / auth gate | 78% |
| Guest pricing then admin | `loading` + `useEntitlementAccountState` gate | auth gate / rerender | 80% |
| Actual browser full reload while playing on home | **Not explained by app code** | — | <5% |

---

## Part 1 — Auth bootstrap trace

See **`auth-bootstrap-trace.md`**.

**Short answers:**

- **Guest pricing first?** Yes — while `loading`, `useEntitlementAccountState()` forces `EMPTY_ACCOUNT_STATE` (guest-like locks/CTAs).
- **Admin later?** Yes — after `bootstrapSession` + `GET /api/account/state` + `loading: false`.
- **`user` null initially?** Yes (`useState(null)`).
- **`ownedSlugs` empty initially?** Yes; populated in `applyAccountPayload`.
- **Intentional clear?** Yes on 401, sign-out, failed guest; EMPTY gate during bootstrap.

**Key chain:** `AuthProvider` mount → `bootstrapSession()` → `refreshAccountState()` or `refreshGuest()` → `applyAccountPayload` → `setLoading(false)`.

**Silent auth:** `TOKEN_REFRESHED` / `INITIAL_SESSION` do not re-fetch entitlements (`AuthContext.js` L296–298).

---

## Part 2 — AudioProvider stability

See **`audioprovider-stability.md`**.

**Short answers:**

- **Can unmount?** Only on full document navigation or root layout remount — not on auth updates.
- **`audioRef` recreated?** No — single `useRef` + one `<audio>` for provider lifetime.
- **Keys change?** No `key` on providers.
- **Route/auth recreate tree?** No — providers live in root `layout.js` only; `AudioProvider` wraps `AppAuthRoot`, not vice versa.

---

## Part 3 — Root remount detection

See **`reload-inventory.md`** (Part 3 section).

- **`location.reload`:** 0 in `src/`.
- **`router.refresh`:** 1 — `src/app/verify-otp/page.js` L124 (OTP route only).
- **`window.location` navigation on home:** user buttons (subscribe, collectors) — not scroll/modal/sync.
- **Account sync:** `fetch` + React state only.

---

## Part 4 — Error recovery

| Mechanism | Present? | Playback / reload impact |
|-----------|----------|---------------------------|
| `MediaErrorBoundary` | Yes — wraps `{children}` in `layout.js` L49–51 | On error: `fallback` null for page subtree; **does not** unmount `AudioProvider` or `<audio>` (`MediaErrorBoundary.js` L17–18, L52–56) |
| `ModalErrorBoundary` | Yes — modals on `page.js` | Isolated modal stacks; `resetKey` on open/close |
| `ErrorBoundary` / `AsyncBoundary` | `src/system/errors/` | Not wrapping audio engine |
| `ImmersiveErrorBoundary` | Player shell | Modal-scoped |
| `window.onerror` | **Not registered** in app | — |
| `unhandledrejection` | **Not registered** in app | — |
| `componentDidCatch` | Boundaries only | Logs + optional telemetry; no `location.reload` |

**Conclusion:** Error boundaries can blank UI sections but are **not** a documented cause of global playback element destruction or full app reload.

---

## Part 5 — Hydration

| Topic | Finding | Evidence |
|-------|---------|----------|
| Server guest vs client admin on `page.js` | **N/A for entitlements** | `page.js` L1 `"use client"` — no SSR entitlement split on home |
| `AppAuthRoot` | SSR/hydration: `BOOT_PLACEHOLDER` until `useEffect` sets `hydrated` | `AppAuthRoot.js` L38–40 — **does not** block `AudioProvider` |
| Pricing/admin from unresolved auth | **Yes** — EMPTY snapshot while `loading` | `useEntitlementAccountState` L440–446 |
| `authStatus` during load | `"loading"` → then authenticated or gate | L384–391 |
| Hydration mismatch warnings | Not investigated in runtime logs; structurally client-only auth | — |

**Guest-then-admin flash:** High confidence from intentional EMPTY entitlement gate + `isAdmin` appearing before `accountStateReady` for some chrome (`page.js` L1687, L2525).

---

## Part 6 — Playback interruption trace

See **`playback-interruption-chains.md`**.

**Confirmed chain (modal → scroll → stop):**  
`AudioVisualsSection` IO → `triggerFocus` → `handleAudioVisualsFocused` → `pause()` → `AudioContext` pause pipeline.

**Not causal for that chain:** reload, provider remount, auth refresh, scroll-only parallax.

---

## Part 7 — Reload detection (ranked)

See **`reload-inventory.md`** (Part 7 section).

**For “site visibly reloads while music playing” on home:**

1. React entitlement + catalog re-render (**high**)
2. Hero parallax DOM + 1s countdown re-render (**medium** — feels like refresh)
3. External tab/OS lifecycle (**medium**, out of repo)
4. In-repo full reload (**negligible**)

---

## Part 8 — Final verdict

See **`final-verdict.md`** (no fix recommendations).

---

## Investigation methods

- Source read: `AuthContext.js`, `AudioContext.js`, `layout.js`, `AppAuthRoot.js`, `page.js` (auth + AV + modal sections), `authService.js`, `AudioPhase10Bridge.js`, `useSessionRecovery.js`, `public/sw.js`, error boundary modules.
- Fresh ripgrep: `location.reload`, `router.refresh|push|replace`, `window.location`, `serviceWorker`, `visibilitychange`, `ErrorBoundary`, `notifyEntitlementsUpdated`.
- Cross-check: `.tmp-playback-interruption-forensic-20260531/event-chain.md`, `.tmp-phase5a-session-hydration-audit-20260531/`.

---

## File index

| Path | Role |
|------|------|
| `src/context/AuthContext.js` | Session bootstrap, account state, entitlement hook |
| `src/context/AudioContext.js` | Single audio element, pause, visibility |
| `src/app/layout.js` | Provider tree |
| `src/components/auth/AppAuthRoot.js` | Hydration placeholder, auth gate |
| `src/app/page.js` | AV pause hook, catalog, modals |
| `src/components/system/AudioPhase10Bridge.js` | Recovery queue guard |
| `src/lib/diagnostics/state-churn-log.js` | `notifyEntitlementsUpdated` |
| `public/sw.js` | Minimal SW |

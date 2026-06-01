# Part 8 — Final Verdict

READ-ONLY audit. **No fix recommendations** (per scope).

---

## Symptom A — Playback stops after closing modal and scrolling (home, single/album)

| Field | Value |
|-------|-------|
| **Most likely root cause** | `handleAudioVisualsFocused` calls `pause()` when Audio Visuals section enters viewport (`page.js` L760–762), triggered by `IntersectionObserver` in `AudioVisualsSection` (L408–421) |
| **Confidence** | **92%** |
| **Category** | **playback bug** (intentional focus handoff behavior) |
| **Primary files** | `src/app/page.js` |
| **Primary functions** | `handleAudioVisualsFocused`, `AudioVisualsSection` `triggerFocus` / IO callback |
| **Ruled out for this symptom** | Full reload, `AudioProvider` remount, auth reset, hydration mismatch, service worker, `router.refresh`, account sync |

---

## Symptom B — Site “visibly reloads” / UI flash while music may still be playing

| Field | Value |
|-------|-------|
| **Most likely root cause** | Entitlement snapshot flip (`useEntitlementAccountState` returns `EMPTY_ACCOUNT_STATE` while `loading`, then full `accountState`) plus large `page.js` re-renders propagating new `accountState` / `isAdmin` to catalog children — **not** a browser document reload |
| **Confidence** | **78%** |
| **Category** | **rerender** + **auth reset** (intentional loading gate, not session loss) |
| **Primary files** | `src/context/AuthContext.js`, `src/app/page.js` |
| **Primary functions** | `useEntitlementAccountState`, `applyAccountPayload`, `refreshAccountState`; secondary: `liveCountdown` interval L1078–1092 |
| **Ruled out as primary** | `location.reload`, home `router.refresh`, SW-driven reload, `AudioProvider` unmount |

---

## Symptom C — Guest / subscribe UI then admin (cold load, signed-in admin)

| Field | Value |
|-------|-------|
| **Most likely root cause** | Initial `loading: true` + EMPTY entitlement hook before `/api/account/state` completes; partial admin chrome (`isAdmin`) before `accountStateReady` |
| **Confidence** | **80%** |
| **Category** | **auth reset** (loading gate) + **rerender** |
| **Primary files** | `src/context/AuthContext.js`, `src/app/page.js` |
| **Ruled out** | `AuthGate` overlay for valid admin session after T5 (`authStatus: authenticated`) |

---

## Symptom D — Playback stop during checkout return / preview upgrade

| Field | Value |
|-------|-------|
| **Most likely root cause** | `notifyEntitlementsUpdated` → `entitlements:updated` → `upgradeToFullStream` while preview track playing |
| **Confidence** | **55%** (route-specific) |
| **Category** | **playback bug** / entitlement transition |
| **Primary files** | `src/context/AudioContext.js`, `src/app/success/page.js`, `src/app/page.js` |

---

## Cross-cutting negatives (documented)

| Hypothesis | Status |
|------------|--------|
| Full app reload loop in repo | **Disproven** — zero `location.reload` in `src/` |
| `AudioProvider` / `<audio>` remount on auth hydrate | **Disproven** — stable in `layout.js` |
| `AppAuthRoot` unmounts audio tree | **Disproven** — placeholder scoped to children |
| Global `window.onerror` / `unhandledrejection` recovery reload | **Not present** |
| `MediaErrorBoundary` resets player | **No** — children fallback only |
| Service worker forces refresh | **No** — minimal SW, no reload on update |

---

## One-line verdict (executive)

**Playback stop on home scroll after modal close is caused by the Audio Visuals focus handler calling `pause()`, not by auth reload or provider remount; perceived “site reload” is React entitlement hydration and catalog re-render without a document reload.**

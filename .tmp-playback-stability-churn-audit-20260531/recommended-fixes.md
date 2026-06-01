# Recommended Fixes (by impact — report only)

## Tier 1 — High impact, low behavioral risk

| Fix | Addresses | Approach |
|-----|-----------|----------|
| **F1** | RC-1, RC-7 | Replace success/subscribe polling with exponential backoff + max 3 attempts; stop when `ownedSlugs` unchanged between fetches |
| **F2** | RC-5 | Remove redundant `refreshAccountState` after `applySessionUser` in `verify-otp`, `AuthGate`, `AppAuthRoot` (one source of truth) |
| **F3** | RC-7 | Add `refreshAccountAndLibrary()` in AuthContext that fetches once and applies payload once |
| **F4** | RC-6 | Dispatch `entitlements:updated` from shared post-purchase helper (collector, gift, library) when `ownedSlugs` gains slug |

## Tier 2 — Structural churn reduction

| Fix | Addresses | Approach |
|-----|-----------|----------|
| **F5** | RC-2 | Split Auth context or pass `entitlementAccountState` only into catalog leaves via memoized props + `React.memo` on rails/grids |
| **F6** | RC-2 | Extract stable `onLibraryChange` callback at page level (one `useCallback`) instead of 10 inline lambdas |
| **F7** | RC-4 | Gate recovery: if `hasStarted && queue.length`, skip `setQueue` or only restore seek position |
| **F8** | RC-3 | Product decision: optional iOS `RECOVER` after unlock with user gesture fallback |

## Tier 3 — Polish

| Fix | Addresses | Approach |
|-----|-----------|----------|
| **F9** | RC-9 | Isolate live countdown into child component so 1s tick doesn’t re-render page |
| **F10** | RC-8 | Queue refresh callers while in-flight (microtask retry) instead of silent `null` |
| **F11** | RC-10 | Merge admin flags into `applyAccountPayload` to avoid second `setAccountState` |

## Explicit non-goals (per audit scope)

- No auth model rewrite  
- No entitlement source-of-truth change (still webhook → Supabase → `/api/account/state`)  
- No cinematic UI changes  
- No dependency bumps

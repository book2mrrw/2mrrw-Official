# Duplication Matrix

| Business rule | Backend implementation | Frontend implementation | Risk |
|---|---|---|---|
| Admin full access | `userCanStreamProduct`, `/api/account/state` admin projection | `isAdminAccount`, `adminTrackAccess`, `permissions.admin` checks | Medium |
| Subscriber active logic | `membershipHasPremiumAccess`, entitlement flag checks in account route | `subscriptionActive`, `permissions.subscriber`, `subscriberActive` conjunctions | High |
| Collector access | collector ownership + entitlement flags + legacy fallbacks | collector card boolean + ownership rows + library source + status parsing | High |
| Vault tiering | `vaultTierFor`, entitlement+collector+membership composition | consumed as flags in UI, sometimes reinterpreted indirectly | Medium |
| Permanent ownership | `library_items`, entitlements fallback, owned slug composition | `library-ownership` helpers + `ownedSlugs` + library source inference | Medium |
| Preview fallback | stream deny/failure handling in API/client pipeline | `resolvePlaybackSrc`, `AudioContext` runtime fallback and preview cap | Medium |
| Playback eligibility | `/api/library/stream` authoritative `userCanStreamProduct` | pre-checks in `resolveTrackAccess` before requesting stream | High |
| Feature/single/album digital eligibility | `isDigitalProduct` in backend selectors | mixed item-type assumptions in UI and access helpers | Medium |
| Session user resolution | `getFanSessionUser`, guest cookie fallback | AuthContext session bootstrap + localStorage recovery + listeners | Medium |
| Entitlement refresh triggers | account route fetch + route consumers | many per-component manual refresh calls + window event | Medium |

## Duplicate Decision Hotspots

- `resolveTrackAccess` reproduces business rules already available from account-state backend payload.
- `permissionsFor` in account route and frontend helper logic both derive entitlement semantics.
- Collector status normalization repeats in backend (`active|verified|granted`) and frontend filters.
- Multiple ownership derivations (`ownedSlugs`, library sources, collector ledger rows) used concurrently.

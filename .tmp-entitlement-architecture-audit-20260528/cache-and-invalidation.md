# Cache and Invalidation

## Account State / Entitlement Cache Behavior

- `AuthContext.refreshAccountState()` uses `cache: "no-store"` for `/api/account/state`.
- Local React state remains the active cache between refresh calls.
- Many components trigger manual refresh sequences (`refreshAccountState` + `refreshLibrary`) after entitlement-affecting actions.

## Stream URL Cache Behavior

- Client stream metadata tracks `fetchedAt`/`expiresIn`; refresh threshold is 5 minutes before expiry.
- Signed URL validity is checked (`HEAD`) before use.
- Stream sessions are created/cleared per slug flow; resume path refreshes expiring stream URLs.

## Invalidation Triggers Observed

- Post-checkout success
- Gift-related flows
- Collector activation flows
- Auth sign-in and OTP verification paths
- App-auth root startup refresh
- Explicit `entitlements:updated` custom event

## Hydration / Race Notes

- `accountStateFetchingRef` prevents parallel account-state fetches (good).
- Session bootstrap may perform localStorage session restore before account fetch (mobile resilience).
- Potential stale window remains when entitlement changes server-side without a client-triggered refresh.

## Gaps

- No global entitlement version number in payload to force stale-state detection.
- No websocket/realtime invalidation channel for cross-device entitlement changes.
- Invalidation is heavily action-path dependent (manual calls dispersed across UI).

# Account State Debounce Flow

```mermaid
sequenceDiagram
  participant UI as Caller
  participant AC as AuthContext
  participant Gate as evaluateRefreshGate
  participant API as /api/account/state
  participant Snap as entitlementSnapshotRef

  UI->>AC: refreshAccountState({ reason, force })
  AC->>Gate: normalize + evaluate
  alt blocked
    Gate-->>AC: blocked + blockReason
    AC-->>UI: snapshotToAccountPayload(snap)
    Note over AC: [ENTITLEMENT-REFRESH-BLOCKED]
  else in-flight
    AC-->>UI: existing Promise
  else allowed
    AC->>API: GET (no-store)
    API-->>AC: JSON
    AC->>AC: applyAccountPayload (shallow equal)
    AC->>Snap: commitEntitlementSnapshot
    AC-->>UI: fresh data
  end
```

## Invalidate before high-signal events

`invalidateEntitlementSnapshot(reason)` sets `lastUpdated = 0` so the next refresh is not blocked by the 10s debounce window.

| Flow | Invalidate | Refresh |
|------|------------|---------|
| Bootstrap | `auth:bootstrap` | `force: true` |
| OTP login | `auth:login` | `force: true` |
| Inline checkout | `purchase:completed` | `force: true` |
| `/success` poll | attempt 0 only | `force: true` each attempt |
| Subscribe poll | — | `force: true` each attempt |

## Library change (debounced path)

`library:change` from home catalog / `useMusicLibrary` does **not** pass `force`. Repeated taps within 10s coalesce to cached snapshot — same entitlement outcome until window expires or user forces via commerce/login paths.

## In-flight coalescing

Concurrent callers share one fetch promise (`accountStateInFlightRef`). Second caller logs `duplicate-in-flight` and awaits the same result.

# Playback Impact Analysis

## Constraints honored

- No changes to `AudioContext` playback commands (`pause`, `setQueue`, `upgradeToFullStream`).
- No UI-visible entitlement logic changes — same `/api/account/state` source of truth.
- `useEntitlementAccountState` still returns `EMPTY_ACCOUNT_STATE` while `loading` (no stale partial entitlements during bootstrap).

## Expected playback behavior

| Scenario | Before | After |
|----------|--------|-------|
| Fan playing during library debounced refresh | No audio APIs in auth path | Unchanged — blocked refresh returns cached snapshot; no React churn if shallow-equal |
| Purchase success | Poll + `entitlements:updated` | Same polls with `force: true`; invalidate on first attempt |
| Preview → full upgrade | `entitlements:updated` listener | Unchanged — not gated by snapshot debounce |
| OTP login | Single refresh via `applySessionUser` | Same + `force: true` |

## Risk: blocked refresh during active play

If UI calls `refreshAccountState` without allowlisted reason or within 10s debounce:

- Network skipped
- Cached snapshot returned to caller
- `accountState` React tree unchanged if payload shallow-equal

Playback continues on prior stream URL until a forced commerce/auth refresh updates entitlements.

## Diagnostics

- `[ENTITLEMENT-REFRESH-BLOCKED]` — skipped fetch
- `[state-churn] refreshAccountState` — includes `blocked`, `blockReason`, `force`

## Verification commands

```bash
npm run build
npm run test:playback-resolver-fallback
```

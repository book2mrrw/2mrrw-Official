# Refresh Gating Rules

## Signature

```js
refreshAccountState(options?: {
  reason?: string;
  force?: boolean;
  source?: string;
})
```

## Allowed reasons (canonical)

| Reason | Typical trigger |
|--------|-----------------|
| `auth:login` | OTP / `applySessionUser` / guest enter |
| `auth:bootstrap` | Cold session bootstrap / guest session |
| `purchase:completed` | Checkout success, `/success`, gift redeem |
| `subscription:updated` | Subscribe return URL / modal success poll |
| `collector:updated` | Collector card activate / modal |
| `manual` | Legacy `invoke` mapping |
| `library:change` | Catalog / library UI mutations |

Legacy strings (`checkout-success`, `initial`, `poll-N`) normalize via `normalizeRefreshReason()` in `entitlement-refresh-gating.js`.

## Block conditions (unless `force: true`)

| Block | `blockReason` | Behavior |
|-------|---------------|----------|
| Unknown / non-allowlisted reason | `reason-not-allowlisted` | Skip fetch; return cached snapshot payload |
| Last success &lt; 10s | `debounce-10s` | Skip fetch; return cached |
| Same canonical reason within 800ms | `render-loop` | Skip fetch; return cached |
| Request already in flight | `duplicate-in-flight` | Return existing promise |

## Force bypass

`force: true` skips debounce and render-loop blocks (not in-flight coalescing). Used for:

- Bootstrap / login
- Commerce poll loops (`purchase:completed`, `subscription:updated`)
- Collector activation

## Dev log

```
[ENTITLEMENT-REFRESH-BLOCKED] { source, reason, blockReason, ts }
```

Enabled with `NODE_ENV=development` or `NEXT_PUBLIC_STATE_CHURN_LOG=1`.

## Constants

| Constant | Value |
|----------|-------|
| `ENTITLEMENT_REFRESH_DEBOUNCE_MS` | 10_000 |
| `ENTITLEMENT_RENDER_LOOP_MS` | 800 |

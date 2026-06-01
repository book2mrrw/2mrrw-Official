# Rollback Validation — `DIRECT_PREVIEW_ENABLED=0`

**Section result: PASS** (feasible; **not yet implemented**)

---

## Proposed flag

| Name | Scope | Default |
|------|-------|---------|
| `DIRECT_PREVIEW_ENABLED` or `NEXT_PUBLIC_DIRECT_PREVIEW_CDN` | `catalogPreviewAudioUrl` only | `0` / unset |

**Not present in codebase today** — rollback is a **design** requirement for activation, not a current feature.

---

## Rollback behavior (`=0`)

```javascript
// Pseudocode — single change point
export function catalogPreviewAudioUrl(previewPath) {
  // ... existing normalization ...
  if (process.env.NEXT_PUBLIC_DIRECT_PREVIEW_CDN === "1") {
    const direct = tryDirectPreviewCdn(previewPath); // concrete key only
    if (direct) return direct;
  }
  // existing: previewDiscoveryUrl / catalogPublicMediaUrl
}
```

| Setting | Guest preview URL | API route |
|---------|-------------------|-----------|
| `0` / unset | `/api/media/preview?...` | Used |
| `1` | CDN for concrete keys | Fallback for discovery |

**Instant rollback:** Set env to `0` on Vercel → redeploy (or runtime env without code revert).

---

## What rollback restores

| System | Restored behavior |
|--------|-------------------|
| All storefront surfaces | API redirect path |
| Prewarm `previewSrc` | API URLs |
| `MediaPreloader` | API URLs |
| Queue / Media Session | Unchanged (URL shape only) |
| Analytics | Unchanged |
| Entitled stream | Never affected |

---

## Code revert alternative

Git revert of `catalogPreviewAudioUrl` branch — API route **unchanged** in repo, so old clients immediately use 302 again. **No database migration.**

---

## Dual-path maintenance risk (MEDIUM)

Fast path logic duplicated in:

- `api/media/preview/route.js` → `tryCanonicalPreviewFastPath`
- Future client → `tryDirectPreviewCdn`

**Mitigation:** Share helper (e.g. `resolveConcretePreviewKey(slug, folder, legacy)`) in `canonical-paths.js` or `entity-resolver.js` — recommended during B1 implementation.

---

## Prewarm / session stale URLs

After rollback, in-memory prewarm cache may hold CDN URLs until eviction (max 96 entries). **Low risk** — user navigation refreshes; worst case one play uses CDN until cache miss (still valid bytes).

---

## Feature flag vs full revert

| Strategy | Time to rollback | Risk |
|----------|------------------|------|
| Env flag `=0` | Minutes (deploy) | Low |
| Git revert | Minutes | Low |
| Remove API route | ❌ Not recommended | High |

---

## Verdict

**PASS** — `DIRECT_PREVIEW_ENABLED=0` restoring API path is **feasible** with single-resolver gating. Implement flag as part of blocker **B1**.

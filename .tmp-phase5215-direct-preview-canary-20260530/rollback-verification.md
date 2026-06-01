# Rollback Verification — Phase 5.2.15 Direct Preview Canary

**Run date:** 2026-05-31

---

## Rollback mechanism (implemented 5.2.13)

**File:** `src/lib/feature-flags/direct-preview.js`

| Env var | Default | Effect when `0` / unset |
|---------|---------|-------------------------|
| `NEXT_PUBLIC_DIRECT_PREVIEW_CDN` | OFF | Client SSR flag false |
| `DIRECT_PREVIEW_ENABLED` | OFF | Server supplement false |

`isDirectPreviewCdnEnabled()` → **false** → `catalogPreviewAudioUrl` uses `previewDiscoveryUrl` (pre-5.2.13 behavior).

**No code revert required** — env-only rollback.

---

## Automated rollback tests

### `npm run test:direct-preview-cdn` (flag-off cases)

| Test | Result |
|------|--------|
| Flag off by default | **PASS** |
| `catalogPreviewAudioUrl` flag off uses API discovery | **PASS** — matches `/api/media/preview?` |

### Build verification

| Check | Result |
|-------|--------|
| `/api/media/preview` route in build | **PASS** — always available for rollback path |
| No code deletes API route | **PASS** |

---

## Rollback behavior matrix

| System | `DIRECT_PREVIEW_ENABLED=0` |
|--------|------------------------------|
| Guest preview URL | `/api/media/preview?…` (302 chain) |
| Prewarm cache | New resolves use API URLs; stale CDN entries expire (max 96) |
| Queue / Media Session | Unchanged semantics |
| Entitled stream | Never affected |
| Analytics | Unchanged |

---

## Rollback procedures

| Strategy | Time | Risk |
|----------|------|------|
| Vercel env `=0` + redeploy | Minutes | **Low** |
| Git revert 5.2.13 resolver branch | Minutes | **Low** |
| Remove `/api/media/preview` | ❌ Not recommended | High |

---

## Stale prewarm cache note

After rollback, in-memory cache may hold CDN URLs until eviction. **Low risk** — same bytes, valid playback; refreshed on navigation.

---

## Canary config documented (local/staging only)

```bash
# Enable (measurement)
DIRECT_PREVIEW_ENABLED=1
NEXT_PUBLIC_DIRECT_PREVIEW_CDN=1

# Rollback (instant)
DIRECT_PREVIEW_ENABLED=0
NEXT_PUBLIC_DIRECT_PREVIEW_CDN=0
# or unset both
```

**Do NOT set in Vercel production globally** per phase scope.

---

## Overall rollback verification

**PASS** — Flag-off restores API discovery path; automated tests confirm; API route retained.

# Activation Config — Phase 5.3.4

**Run date:** 2026-05-31  
**Activation type:** Deployment-ready documentation + local validation env

---

## Flags enabled for validation

| Flag | Value | Purpose |
|------|-------|---------|
| `HYBRID_STREAMING_ENABLED` | `1` | Master switch for hybrid resolver paths |
| `STREAM_PLAYBACK_PREFERRED` | `1` | Stream-first in `resolvePlaybackKey` |
| `AUTO_GENERATE_STREAM_ASSETS` | `0` | **OFF** — upload pipeline unchanged |
| `DIRECT_PREVIEW_ENABLED` | `0` | **OFF** — hybrid-only activation |
| `NEXT_PUBLIC_DIRECT_PREVIEW_CDN` | `0` | **OFF** — guest preview unchanged |

---

## Where configured

### 1. `.env.example` (committed — staging/canary documentation)

Added staging/canary block with recommended values:

```
# Staging / canary (Phase 5.3.4 — hybrid activation validation):
#   HYBRID_STREAMING_ENABLED=1
#   STREAM_PLAYBACK_PREFERRED=1
#   AUTO_GENERATE_STREAM_ASSETS=0
```

Production defaults remain `0` in the example file.

### 2. `.env.local` (gitignored — local validation only)

Appended for this run:

```
HYBRID_STREAMING_ENABLED=1
STREAM_PLAYBACK_PREFERRED=1
AUTO_GENERATE_STREAM_ASSETS=0
DIRECT_PREVIEW_ENABLED=0
NEXT_PUBLIC_DIRECT_PREVIEW_CDN=0
```

**Not deployed.** Vercel staging/production require manual env update after approval.

---

## Effective runtime (post-activation, local)

| Function | Value |
|----------|-------|
| `isHybridStreamingEnabled()` | **true** |
| `isStreamPlaybackPreferred()` | **true** |
| `isAutoGenerateStreamAssetsEnabled()` | **false** |
| `isDirectPreviewCdnEnabled()` | **false** |

---

## Requirements checklist

| Requirement | Status |
|-------------|--------|
| Prefer stream assets when registered | ✅ `isStreamPlaybackPreferred()` gates resolver |
| Preserve guest preview | ✅ Direct preview OFF; `/api/media/preview` unchanged |
| All entitlements preserved | ✅ `validateStreamEntitlement` before resolver |
| Collector / purchase / subscriber / admin | ✅ Same `/api/library/stream` contract |
| Master fallback on miss | ✅ 21/21 resolver tests + 1 catalog fallback |

---

## Staging deployment steps (post-approval)

1. Vercel → Project → Settings → Environment Variables
2. Set for **Preview** and/or **Production**:
   - `HYBRID_STREAMING_ENABLED=1`
   - `STREAM_PLAYBACK_PREFERRED=1`
3. Redeploy
4. Verify `X-Playback-Resolver: stream` on entitled probes
5. Monitor fallback rate for `01-roll-call`

---

## Not in scope

- Direct preview activation (orthogonal; can enable separately)
- `AUTO_GENERATE_STREAM_ASSETS=1` (upload pipeline only)
- Roll Call master upload (blocks 100% coverage)

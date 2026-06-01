# Pre-Activation Audit — Phase 5.3.4

**Run date:** 2026-05-31  
**Repo:** artist-platform (2MRRW)  
**Scope:** State BEFORE hybrid activation changes

---

## Primary flags (effective runtime)

| Flag | `.env.example` (pre) | `.env.local` (pre) | Effective runtime (pre) | Code default |
|------|----------------------|--------------------|-------------------------|--------------|
| `HYBRID_STREAMING_ENABLED` | `0` | unset | **false** | false |
| `STREAM_PLAYBACK_PREFERRED` | `0` | unset | **false** | false |
| `AUTO_GENERATE_STREAM_ASSETS` | `0` | unset | **false** | false |
| `PLAYBACK_RESOLVER_MODE` | — | — | **N/A — flag does not exist** | — |

### Effective resolver behavior (pre-activation)

With all hybrid flags OFF:

- `isHybridStreamingEnabled()` → **false**
- `isStreamPlaybackPreferred()` → **false** (short-circuits on hybrid OFF)
- `resolvePlaybackKey` → master discovery only; stream branch never entered
- `tryResolveStreamPlaybackKey` → never invoked for entitled playback

---

## Direct preview flags (pre-activation)

| Flag | `.env.example` | `.env.local` (pre) | Effective runtime |
|------|--------------|--------------------|-------------------|
| `DIRECT_PREVIEW_ENABLED` | `0` | unset | **false** |
| `NEXT_PUBLIC_DIRECT_PREVIEW_CDN` | `0` | unset | **false** |

Guest preview path: `/api/media/preview` redirect chain (baseline).

---

## Feature flag module inventory

### `src/lib/feature-flags/hybrid-streaming.js`

| Export | Pre-activation value |
|--------|---------------------|
| `isHybridStreamingEnabled()` | false |
| `isStreamPlaybackPreferred()` | false |
| `isAutoGenerateStreamAssetsEnabled()` | false |
| `getHybridStreamingFeatureFlags()` | all false |

Gating: `STREAM_PLAYBACK_PREFERRED` and `AUTO_GENERATE_STREAM_ASSETS` require `HYBRID_STREAMING_ENABLED=1`.

### `src/lib/feature-flags/direct-preview.js`

| Export | Pre-activation value |
|--------|---------------------|
| `isDirectPreviewCdnEnabled()` | false |
| `getDirectPreviewFeatureFlags()` | all false |

Orthogonal to hybrid — no cross-reads.

### `src/lib/feature-flags/index.js`

Re-exports hybrid streaming only (direct preview imported separately).

---

## Catalog stream readiness (pre-activation context)

From Phase 5.3.3B (unchanged at activation time):

| Metric | Value |
|--------|------:|
| Total playable assets | 36 |
| Stream registered | 35 (97.2%) |
| Resolver stream hits (flags ON locally) | 35 (97.2%) |
| Resolver fallbacks | 1 (2.8%) — `love-hz-vol-1/01-roll-call` |
| Missing master | Roll Call intentionally unavailable |

---

## Production deployment state (pre-activation)

- Vercel production: hybrid flags **OFF** (defaults)
- No code changes required for activation — env-only toggle
- Stream assets exist in R2 + DB from 5.3.1/5.3.3/5.3.3B backfill runs

---

## Audit conclusion

Pre-activation state is **master-only playback** with stream infrastructure ready but inactive. Activation is a **configuration-only** change documented in `.env.example` + local `.env.local` for validation.

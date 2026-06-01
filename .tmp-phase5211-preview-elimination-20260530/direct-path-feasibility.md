# Direct CDN Path Feasibility

**Primary question:** Can preview playback safely bypass `/api/media/preview` redirect?

**Short answer:** **Yes for known keys; no for discovery-only releases.**

---

## Resolution chain today

```
previewPath (DB / page.js / canonical)
        │
        ▼
catalogPreviewAudioUrl()          ← src/lib/media-urls.js
        │
        ├─ entity folder path? ──▶ previewDiscoveryUrl() ──▶ /api/media/preview
        ├─ flat legacy file?   ──▶ previewDiscoveryUrl(null, legacy)
        └─ else                  ──▶ catalogPublicMediaUrl() ──▶ DIRECT CDN ✅ (rare)
```

Almost all storefront previews take the **API branch**. Direct CDN already exists as fallback when path doesn't match folder/legacy patterns.

---

## Direct CDN building blocks (already in codebase)

| Function | File | Output |
|----------|------|--------|
| `getPublicR2Url(path)` | `src/lib/storage/r2.js` | `https://pub-*.r2.dev/{key}` |
| `catalogPublicMediaUrl(path)` | `src/lib/media-urls.js` | CDN URL or site API path |
| `legacyPreviewPublicPath(type, slug, stem, ext)` | `canonical-paths.js` | `previews/{folder}/{slug}/{stem}-preview.{ext}` |
| `getCanonicalReleaseBySlug(slug).preview_legacy` | `canonical-catalog.js` | Concrete key per release |
| `isConcreteMediaKey(path)` | `entity-resolver.js` | Validates file extension present |

**Proposed partial bypass (not implemented):** In `catalogPreviewAudioUrl`, when canonical or DB provides a concrete `preview_legacy` key that passes `isConcreteMediaKey`, return `getPublicR2Url(key)` instead of `previewDiscoveryUrl`.

---

## Canonical path coverage

From `canonical-catalog.js` — all canonical storefront releases define **both**:

- `preview_path` — entity folder (e.g. `previews/singles/hour-glass/`)
- `preview_legacy` — concrete file (e.g. `previews/singles/hour-glass/hourglass-preview.mp3`)

| Release type | Default ext | Example key |
|--------------|-------------|-------------|
| Singles | mp3 | `previews/singles/hour-glass/hourglass-preview.mp3` |
| Features | wav | `previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav` |
| Albums | mp3 | `previews/albums/{slug}/{stem}-preview.mp3` |
| Mixtapes/EPs | mp3 | `previews/mixtapes-and-eps/{slug}/…` |

Preview API fast path (`tryCanonicalPreviewFastPath`) already resolves to these same keys server-side — direct CDN serves **identical bytes**.

---

## Entity-resolver role

Slow path when fast path misses:

1. `resolvePreviewFile(entityFolder)` → `listR2Objects` + extension scan
2. `resolveWithLegacyFallback` → try legacy flat candidates

**Bypass impact:** Releases depending on R2 list (new uploads, mis-keyed DB rows, empty canonical) **still need API or server-side hydrate** until `preview_legacy` is materialized in catalog/DB.

`resolve-playback-key.js` is **entitled playback only** (full master/stream) — orthogonal to guest preview CDN bypass.

---

## Security analysis

| Concern | Assessment |
|---------|------------|
| **Exposure of full masters** | ❌ Not possible — bypass only applies to `previews/` public prefix |
| **Entitlement bypass** | ❌ Not applicable — preview API never checked entitlements |
| **Signed URL leakage** | ❌ Preview path uses unsigned public CDN |
| **Scraping / hotlinking** | ⚠️ Same as today — public bucket; API added latency not access control |
| **Path enumeration** | ⚠️ Predictable keys (`{slug}-preview.mp3`); already inferable from API 302 Location |
| **CORS** | Preview API applies `applyMediaCors`; direct CDN relies on R2/Cloudflare CORS for `audio` element (already works post-302) |

**Conclusion:** Direct CDN does **not weaken** the security model. Previews are intentionally public discovery assets.

---

## Legacy / migration hazards

| Hazard | Evidence | Mitigation |
|--------|----------|------------|
| Flat legacy 404 | Phase 5.2.10: `previews/hourglass-preview.mp3` → 404; nested path → 200 | Always use entity-folder keys |
| page.js `/audio/previews/*.mp3` | Maps to API via slug extraction | Resolve to canonical `preview_legacy` before CDN embed |
| WAV vs MP3 per type | Features default `.wav` | Respect `DEFAULT_PREVIEW_EXT` per release type |
| DB `preview_path` as folder only | Requires discovery | Keep API fallback or hydrate at sync |

---

## Bypass modes compared

| Mode | Description | Latency | Safety |
|------|-------------|---------|--------|
| **Full bypass** | Remove API; all clients use embedded CDN URLs | Maximum | Requires 100% concrete key coverage |
| **Partial bypass** | CDN for canonical; API for unknown | High for catalog | **Recommended** |
| **Resolver-only** | Client caches 302 target after first fetch | Moderate (repeat plays) | No first-tap gain |
| **Status quo** | Always API discovery | Baseline | Safe |

---

## `isFlatPreviewCdnSrc` signal

`AudioContext.js` defines:

```javascript
function isFlatPreviewCdnSrc(src) {
  return /\/previews\/[^/]+-preview\.(wav|mp3|…)(\?|$)/i.test(src);
}
```

`getTrackPreviewSrc` **rejects** flat CDN URLs (forces API path). Any direct-CDN rollout must **update this guard** or preview fallback logic will ignore direct URLs.

---

## Phase 5.3A / hybrid flags

`isStreamPlaybackPreferred()` → **false** (flags OFF). Entitled path uses master via `/api/library/stream`. Preview bypass is **independent** of hybrid streaming — no flag interaction.

---

## Feasibility verdict

| Scope | Feasible | Notes |
|-------|----------|-------|
| Canonical storefront catalog | ✅ **Yes** | ~6 singles + 2 features + albums/EPs with `preview_legacy` |
| DB-synced products with concrete `preview_path` | ✅ **Yes** | When key is file not folder |
| Discovery-only / new uploads | ❌ **No** | Retain API |
| Full API removal | ❌ **Not yet** | After catalog audit + legacy retirement |

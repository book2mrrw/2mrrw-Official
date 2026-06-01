# Phase 5.2.11 — Preview Path Elimination Feasibility Study

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Scope:** Investigation only — no code changes  
**Builds on:** Phase 5.2.10 curl probes + Phase 4.8 preview fast path  
**Phase 5.3A:** Hybrid streaming flags **OFF** (`HYBRID_STREAMING_ENABLED` unset)

---

## Executive summary

Guest and discovery-tier preview playback **can safely bypass** `/api/media/preview` for releases with **known concrete R2 preview keys** (canonical catalog `preview_legacy`, DB `preview_path` when already a file key). The preview API performs **no entitlement enforcement**, **no signing**, and **no analytics** — it only resolves folder → file and emits a **302** to the same public CDN URL that direct embedding would use.

**Full elimination** of the preview API is **not yet safe** for the entire catalog: slow-path releases still require R2 list/discovery when folder contents are unknown or legacy flat keys 404 at CDN.

| Question | Answer |
|----------|--------|
| **Can preview safely bypass redirect?** | **Yes — partial.** Canonical + concrete-key releases (~storefront catalog). **No — full catalog** until discovery fallback retained. |
| **Expected latency reduction** | **140–390 ms** (API TTFB eliminated); **~200 ms** additional when redirect hop removed; **~340–590 ms** combined tap→CDN-first-byte vs cold API path. |
| **Removable?** | **Partial bypass recommended now.** API retained as discovery fallback. |
| **Implementation complexity** | **M** (partial canonical direct CDN in `catalogPreviewAudioUrl`); **L** (full elimination + migration audit). |

---

## Recommendation (one-liner)

**Implement partial direct-CDN preview URLs for canonical releases with concrete `preview_legacy` keys; keep `/api/media/preview` as discovery fallback — expect ~140–390 ms tap→first-byte gain on guest preview path.**

---

## Key findings

### 1. Preview API adds latency without adding protection

Measured (Phase 5.2.10, `hour-glass`):

| Segment | ms |
|---------|-----|
| `/api/media/preview` TTFB (Vercel HIT) | **141** |
| Same (STALE/MISS) | **391** |
| Browser redirect phase (`time_redirect`) | **~198** |
| CDN Range first byte (direct) | **115–210** |

The API hop is **pure overhead** for releases where the target key is already known at build/catalog time.

### 2. Security model unchanged by bypass

- Previews live under **public R2 prefixes** (`previews/`, resolved via `getPublicR2Url`).
- Full masters remain behind `/api/library/stream` (session + entitlement + signed URL).
- `music-access.js` gates UI and stream requests; preview route never checked entitlements.

### 3. Analytics unaffected

Playback telemetry flows from **client** (`control-system/playback.js` → `/api/playback/events`) and **entitled stream** (`media_stream_events` via `/api/library/stream`). Preview API records **nothing**.

### 4. All storefront preview taps converge on one resolver

Every guest preview path calls `catalogPreviewAudioUrl()` → `previewDiscoveryUrl()` → `/api/media/preview`. Surfaces: home singles row, features, albums/mixtapes/EPs grid, immersive modals, card play buttons, prewarm cache. Library/collector entitled playback uses `/api/library/stream`, not preview API.

### 5. Legacy flat keys are a rollout blocker for full bypass

Phase 5.2.10: `?legacy=previews/hourglass-preview.mp3` → 302 → CDN **404**. Canonical nested path works. Direct CDN must use **entity-folder keys**, not page.js `/audio/previews/*.mp3` stubs.

---

## Redirect elimination scenarios

| Scenario | Approach | Safe? | Gain |
|----------|----------|-------|------|
| **Canonical singles/features** | Embed `getPublicR2Url(preview_legacy)` in `catalogPreviewAudioUrl` | ✅ | **140–390 ms** |
| **Canonical albums (first track)** | Same via `legacyPreviewPublicPath` / track `preview_path` | ✅ | Same |
| **DB-only releases (no concrete key)** | Keep API or server-side hydrate | ✅ required | 0 until keyed |
| **Legacy flat `/audio/previews/` page data** | Map via slug → canonical `preview_legacy` first | ⚠️ | Fixes 404 + gain |
| **Full API removal** | Delete route after 100% concrete coverage | ❌ now | Max gain, high risk |

---

## Latency model summary

| Case | Current (ms) | Direct CDN (ms) | Δ saved |
|------|-------------|-----------------|---------|
| **Best** (Vercel HIT + preconnect) | ~141 + ~198 + ~115 ≈ **454** | ~115 | **~340** |
| **Expected** (Vercel HIT, warm CDN) | ~141 + ~198 + ~130 ≈ **469** | ~130 | **~340** |
| **Worst** (Vercel STALE/MISS, cold CDN) | ~391 + ~198 + ~210 ≈ **799** | ~210–330 | **~470–590** |

*Browser-only ID3 parse (~15–55 ms) applies to both paths.*

---

## Risk ranking (summary)

| Rank | Category | Severity | Mitigation |
|------|----------|----------|------------|
| 1 | **Rollout / path drift** | Medium | Canonical key audit; API fallback |
| 2 | **Architectural** | Low–Med | Single resolver change in `catalogPreviewAudioUrl` |
| 3 | **Security** | Low | Never embed `protected-media/` keys |
| 4 | **Analytics** | Negligible | Client events unchanged |

---

## Deliverables

| File | Contents |
|------|----------|
| `current-preview-flow.md` | Step-by-step flow with ms |
| `direct-path-feasibility.md` | CDN bypass mechanics |
| `playback-flow-inventory.md` | Surface-by-surface API vs CDN |
| `protection-analysis.md` | Entitlements, ownership, collector |
| `analytics-impact.md` | What preview API does/doesn't record |
| `latency-model.md` | Best/expected/worst ms tables |
| `risk-analysis.md` | Ranked risks + rollout |
| `manifest.txt` | File list |

---

## Validation

| Check | Result |
|-------|--------|
| Read `src/app/api/media/preview/route.js` | ✅ |
| Read `music-access.js`, `resolve-playback-key.js`, `stream-client.js` | ✅ |
| Read page.js, ImmersivePreviewModal, LatestSinglesStyleRow | ✅ |
| Phase 5.2.10 curl data incorporated | ✅ |
| No src changes | ✅ |

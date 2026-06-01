# Fallback Validation — Missing Asset, Invalid CDN, Catalog Mismatch

**Section result: PASS** (API fallback **must remain** in design — not optional)

---

## Existing fallback layers

| Layer | Mechanism | Direct CDN impact |
|-------|-----------|-------------------|
| **1. API discovery route** | `/api/media/preview` — fast path + R2 list + legacy candidates | **Retained** for class **A** releases |
| **2. `catalogPreviewAudioUrl` fallthrough** | `catalogPublicMediaUrl` for non-folder patterns | Unchanged |
| **3. Stream → preview fallback** | `AudioContext` on 401/404/403 → `getTrackPreviewSrc` | Uses resolver (CDN or API) |
| **4. Availability cache** | `writeAvailabilityCache` on preview error | Slug-based — URL agnostic |
| **5. Play button gating** | `getPlayButtonState` / `filterPlayableQueueItems` | Path-based, not API |

---

## API route fallback (server)

**File:** `src/app/api/media/preview/route.js`

| Step | Behavior |
|------|----------|
| Fast path | `tryCanonicalPreviewFastPath` → 302 CDN (same key as proposed client embed) |
| Slow path | `getOrResolvePreviewMedia` → R2 list / legacy scan |
| Failure | 404 JSON / log `[media/preview] discovery failed` |

**Activation design:** When client has concrete `preview_legacy`, use CDN directly. When key unknown or CDN 404, **client should fall back to API** (recommended implementation):

```
if (DIRECT_PREVIEW_ENABLED && isConcreteMediaKey(key))
  return getPublicR2Url(key);
return previewDiscoveryUrl(folder, legacy);
```

Optional enhancement (not required for authorization): on audio `error` with CDN src, retry once via API URL — improves resilience.

---

## Failure scenarios

| Scenario | Today | After partial activation |
|----------|-------|--------------------------|
| **Missing R2 object** | API 302 → CDN 404 OR slow-path miss | Client CDN 404; **keep API path for discovery** |
| **Wrong extension (WAV vs MP3)** | API legacy candidates | Must use canonical `preview_legacy` ext (features = wav) |
| **Flat legacy key** | API may 302 to 404 CDN | **Blocker B2** — never embed flat CDN |
| **Folder-only `preview_path`** | API lists R2 | Class **A** — API only |
| **Catalog slug mismatch** | API canonical fast path by folder slug | Client should mirror `getCanonicalReleaseBySlug` |
| **CDN outage** | API still fails similarly | Same — public bucket |
| **Entitled stream denied** | Fallback to `getTrackPreviewSrc` | CDN preview if resolver returns CDN |

---

## `getTrackPreviewSrc` as client fallback hub

Re-resolves from `preview_path` — not from stale broken CDN URL in `track.src` alone. Ensures second chance via updated resolver/API when implementer adds error retry.

---

## `isSiteApiMediaPath` passthrough

If `preview` field is already `/api/media/preview?...` (from `canonical-catalog` merge), `catalogPreviewAudioUrl` returns it unchanged via `isSiteApiMediaPath` — safe during mixed rollout.

---

## Protected / wrong prefix

**Risk:** Embedding non-`previews/` key → critical security failure.

**Mitigation:** Allowlist prefix `previews/` in direct branch (same as API fast path). `resolve-playback-key` stays entitled-only.

---

## Verdict

**PASS** — Fallback **exists in design** via retained API route + resolver branching. Implementation must **not** remove `/api/media/preview` (blocker B3). Optional client CDN-error → API retry improves UX but is not required for authorization.

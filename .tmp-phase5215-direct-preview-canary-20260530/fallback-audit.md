# Fallback Audit — Phase 5.2.15 Direct Preview Canary

**Run date:** 2026-05-31

---

## Design: fallback layers (implemented 5.2.13)

| Layer | Mechanism | Status |
|-------|-----------|--------|
| 1 | Unknown folder → `previewDiscoveryUrl` (API) | **PASS** — test: `unknown-release-xyz` → `/api/media/preview?` |
| 2 | Flat legacy keys blocked from CDN embed | **PASS** — `isEligibleDirectPreviewR2Key` rejects flat root |
| 3 | Flat legacy remapped to nested canonical | **PASS** — hour-glass slug resolution |
| 4 | API route slow-path discovery retained | **PASS** — route.js unchanged |
| 5 | Stream 401/404 → `getTrackPreviewSrc` in AudioContext | **PASS** — re-resolves via `catalogPreviewAudioUrl` |

---

## Automated test evidence

### `test:direct-preview-cdn`

| Scenario | Expected | Result |
|----------|----------|--------|
| Flag ON, unknown slug folder | API discovery URL | **PASS** |
| Flag ON, flat `/audio/previews/` path | Nested CDN, not flat 404 | **PASS** |
| Flag OFF | Always API discovery | **PASS** |

### Runtime probe (2026-05-31)

| Probe | HTTP | Behavior |
|-------|------|----------|
| `folder=previews/singles/unknown-release-xyz/` | **404** | API discovery fails safely — no bogus CDN URL emitted client-side |
| Flat CDN `previews/hourglass-preview.mp3` | **404** | Confirms flat keys must not be direct-embedded |

---

## Failure scenario matrix

| Scenario | Flag ON behavior | Fallback |
|----------|------------------|----------|
| Missing R2 object | Client CDN 404 on play | API route still available for discovery; optional error-retry (not implemented) |
| Wrong extension (WAV vs MP3) | `resolveConcretePreviewR2Key` uses canonical `preview_legacy` ext | **PASS** — feature wav test |
| Folder-only `preview_path` (class A) | No concrete key → API URL | **PASS** |
| Catalog slug mismatch | Canonical lookup in resolver | Mirrors API fast path |
| CDN outage | CDN unreachable | Same as today post-302 |
| Entitled stream denied | `getTrackPreviewSrc` | Uses resolver (CDN or API per flag) |
| Mixed rollout (`isSiteApiMediaPath`) | Passthrough unchanged | **PASS** |

---

## Security: allowlist

- `isEligibleDirectPreviewR2Key` requires `previews/(singles|features|albums|mixtapes-and-eps)/` prefix
- Flat root keys explicitly rejected
- Entitled `/api/library/stream` path never uses direct preview

**PASS**

---

## Gap / recommendation

Optional enhancement (not required for canary): client `audio` `error` handler retry once via API URL when direct CDN fails. Not implemented; API route remains authoritative for discovery.

---

## Overall fallback audit

**PASS** — Fallback to API discovery verified in unit tests and runtime 404 probes. `/api/media/preview` must remain deployed (confirmed in build output).

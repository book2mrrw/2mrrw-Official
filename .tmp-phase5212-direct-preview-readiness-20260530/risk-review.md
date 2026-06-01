# Risk Review — Ranked LOW / MEDIUM / HIGH

Builds on Phase 5.2.11 risk matrix; re-ranked for **activation readiness** (partial direct CDN).

---

## Ranked risks

| Rank | Risk | Level | Likelihood | Impact | Mitigation |
|------|------|-------|------------|--------|------------|
| 1 | Wrong/stale `preview_legacy` embedded → CDN 404 on tap | **HIGH** | Medium | Guest silent / "Preview unavailable" | Canonical audit; API fallback (B3); optional CDN-error retry |
| 2 | Flat legacy path direct-embedded (`previews/foo-preview.mp3`) | **HIGH** | Medium if careless | 404 (Phase 5.2.10 proven) | Blocker B2; slug→canonical map |
| 3 | Client/server fast-path drift | **MEDIUM** | Medium | Wrong file or bypass miss | Shared resolver helper; keep API fast path |
| 4 | New release folder-only (no concrete key) | **MEDIUM** | Low–Med | Broken preview if API removed | Class **A** — never remove API (B3) |
| 5 | `isFlatPreviewCdnSrc` rejects wrong shape | **MEDIUM** | Low for nested keys | Fallback ignores preview | Only emit entity-folder keys; test `getTrackPreviewSrc` |
| 6 | Entitled error path `onPreviewPlayback` without API substring | **LOW** | Low | Wrong error copy | Set `source: "preview"` on fallback (existing) |
| 7 | Dual maintenance (API + client CDN) | **MEDIUM** | Certain | Drift | Single key resolver + flag |
| 8 | Loss of Vercel preview API logs | **LOW** | Certain | Ops visibility | Client play events by slug |
| 9 | Public preview scraping / hotlink | **LOW** | Unchanged | Same bytes as 302 Location |
| 10 | Accidental `protected-media/` embed | **HIGH** (if occurs) | Very low | Critical leak | `previews/` prefix allowlist only |
| 11 | CDN CORS regression | **LOW** | Very low | Element error | Validated post-302; QA on activation |
| 12 | Prewarm stale CDN URL after rollback | **LOW** | Low | One play oddity | LRU cache; flag off → API URLs on rebuild |

---

## By category

### Architectural — **MEDIUM** overall

- Single activation point (`catalogPreviewAudioUrl`) limits blast radius.
- Queue / MediaSession / AudioContext require **no** changes for happy path.
- Prewarm inherits resolver automatically.

### Security — **LOW** overall

- Preview API never enforced entitlements; bypass does not weaken model.
- Masters remain on signed stream path.
- **HIGH** only if allowlist discipline fails.

### Analytics — **LOW** (negligible)

- No preview API telemetry today; client events sufficient.

### Rollout — **MEDIUM** overall

- Partial activation + flag + API fallback = acceptable.
- Full API removal = **HIGH** rollout risk — **not authorized**.

---

## Go / no-go (readiness)

| Question | Verdict |
|----------|---------|
| Safe to activate partial direct CDN? | **GO** |
| Safe without B1–B3 remediation? | **NO-GO** |
| Safe to remove preview API? | **NO-GO** |
| Queue / session / analytics regression expected? | **NO** |
| Worth ~250–340 ms guest tap improvement? | **YES** |

---

## Risk summary chart

```
HIGH   │ ● Wrong key CDN 404
       │ ● Flat legacy CDN 404
       │ ● Protected prefix (if bug)
MEDIUM │ ● Fast-path drift
       │ ● Folder-only releases
       │ ● Dual-path maintenance
LOW    │ ● Analytics logs
       │ ● CORS
       │ ● Rollback cache staleness
```

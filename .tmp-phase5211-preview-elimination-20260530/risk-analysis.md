# Risk Analysis — Preview Path Elimination

---

## Risk matrix (ranked)

| Rank | Risk | Category | Severity | Likelihood | Mitigation |
|------|------|----------|----------|------------|------------|
| **1** | Wrong/stale R2 key embedded → CDN 404 | Rollout | **High impact** | Medium | Canonical audit; API fallback; `isConcreteMediaKey` guard |
| **2** | Legacy flat paths (`/audio/previews/`) served direct → 404 | Rollout | **High** | Medium | Map slug → `preview_legacy` before CDN embed |
| **3** | `getTrackPreviewSrc` rejects flat CDN URLs | Architectural | **Medium** | Certain if unchanged | Update `isFlatPreviewCdnSrc` logic |
| **4** | New releases without `preview_legacy` break | Rollout | **Medium** | Low–Med | Keep API for folder-only paths |
| **5** | WAV/MP3 extension mismatch (features) | Rollout | **Medium** | Low | Use `DEFAULT_PREVIEW_EXT` per type |
| **6** | Dual code paths increase maintenance | Architectural | **Low–Med** | Certain | Single change point: `catalogPreviewAudioUrl` |
| **7** | Loss of API access-log preview metrics | Analytics | **Low** | Certain | Client play events sufficient |
| **8** | Hotlink/scrape exposure | Security | **Low** | Unchanged | Already public via 302 Location |
| **9** | Accidental embed of protected key | Security | **Critical if occurs** | Very low | Prefix allowlist `previews/` only |
| **10** | CDN CORS edge case | Rollout | **Low** | Very low | Already works post-302 today |

---

## Category deep dive

### Architectural

| Concern | Detail |
|---------|--------|
| **Resolver duplication** | Fast path logic exists in both API (`tryCanonicalPreviewFastPath`) and potential client (`catalogPreviewAudioUrl`) — must stay in sync |
| **Prewarm cache** | `playback-prewarm-cache` stores `previewSrc` — must store CDN URL after change |
| **Feature flags** | Phase 5.3A hybrid OFF — no interaction; future stream preference unaffected |
| **Rollback** | Revert `catalogPreviewAudioUrl` to always use `previewDiscoveryUrl` — API unchanged |

**Complexity:** **M** for partial (one resolver + guard update); **L** for full API removal + catalog migration.

### Security

| Concern | Assessment |
|---------|------------|
| Entitlement bypass | **Not a risk** — previews intentionally public |
| Master leakage | **Risk if implementation sloppy** — enforce prefix allowlist |
| Signed URL exposure | **Not applicable** |
| GDPR / PII in URLs | **None** — object keys are slugs |

**Overall security risk:** **Low** with allowlist discipline.

### Analytics

| Concern | Assessment |
|---------|------------|
| Lost preview API logs | Low — play events retain slug-level engagement |
| Stream analytics | Unchanged |
| Latency regression detection | Need client marks or RUM — API Server-Timing already absent on HIT |

**Overall analytics risk:** **Negligible**.

### Rollout

| Phase | Action | Risk |
|-------|--------|------|
| **5.2.11** | Feasibility only | None |
| **5.2.12 (proposed)** | Partial bypass canonical only | Low with fallback |
| **Future** | Retire API after 100% keys | Medium — discovery gap |
| **Never without audit** | Full removal | High |

**Recommended rollout:**

1. Audit all `preview_path` / page.js legacy entries → canonical `preview_legacy`
2. Change `catalogPreviewAudioUrl` to prefer direct CDN when concrete key known
3. Keep `/api/media/preview` for `type=video`, `type=artwork`, and discovery
4. Measure `PLAYBACK_FIRST_BYTE` delta on iOS Safari
5. Feature-flag optional (`NEXT_PUBLIC_DIRECT_PREVIEW_CDN=1`) for staged rollout

---

## Scenario risk: elimination modes

| Mode | Architectural | Security | Analytics | Rollout | **Overall** |
|------|---------------|----------|-----------|---------|-------------|
| **Full bypass (catalog only)** | Med | Low | Neg | Low | ✅ **Acceptable** |
| **Full API removal** | High | Low | Low | High | ❌ **Defer** |
| **Resolver-only (cache 302)** | Low | Low | Neg | Low | ⚠️ **Low gain** |
| **Status quo** | None | None | None | None | Safe baseline |

---

## Dependencies & blockers

| Blocker | Status |
|---------|--------|
| Phase 5.2.10 latency baseline | ✅ Complete |
| Canonical `preview_legacy` for storefront | ✅ Present |
| Legacy flat 404 fix | ⚠️ Required before direct embed of flat paths |
| `isFlatPreviewCdnSrc` guard | ⚠️ Must update |
| Protected path audit | Recommended before ship |

---

## Go / no-go

| Question | Verdict |
|----------|---------|
| Safe to bypass for canonical releases? | **GO** |
| Safe to remove API entirely? | **NO-GO** (now) |
| Worth implementing? | **YES** — ~250 ms expected guest tap improvement |
| Requires entitlement/analytics changes? | **NO** |

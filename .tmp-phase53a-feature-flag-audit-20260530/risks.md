# Phase 5.3A — Risk Analysis

**Audit date:** 2026-05-30  
**Context:** Phase 5.2 hybrid streaming flags default OFF; activation not approved.

---

## Risk matrix

| ID | Risk | Severity | Likelihood | Mitigation | Status |
|----|------|----------|------------|------------|--------|
| R1 | Supabase migration not applied before backfill/sync | **High** | High (checklist unchecked) | Apply `20260530160000_*` before any flag=1 | **Open** |
| R2 | ffmpeg unavailable on Vercel serverless | **Medium** | High | Use local/CI backfill CLI; non-blocking sync failures | **Open** |
| R3 | Accidental prod flag enablement before staging canary | **High** | Low | Explicit Vercel env audit; all defaults `0` | **Open** |
| R4 | Stream asset missing but PREFERRED=1 | **Low** | Medium | Master fallback (21 tests); adds resolver latency | **Mitigated** |
| R5 | Transcode failure on catalog sync | **Low** | Medium | Non-blocking; master always available | **Mitigated** |
| R6 | Partial flag confusion (HYBRID=1, PREFERRED=0, AUTO=1) | **Low** | Medium | Documented safe staging state; streams generated but not served | **Mitigated** |
| R7 | Larger R2 storage from stream copies | **Low** | Certain if backfill runs | Operator controls scope via `--limit`; optional delete of `streaming/` | **Accepted** |
| R8 | Client entitlement bypass via flags | **None** | None | Server-only env; no `NEXT_PUBLIC_` | **Mitigated** |
| R9 | Cinematic UI / AudioContext regression | **None** | None | No client changes in Phase 5.2 | **Mitigated** |
| R10 | Recovery anchor drift | **Low** | None observed | HEAD = `bac9eb7`; selective restore available | **Mitigated** |
| R11 | Pre-existing lint debt blocks full verify | **Low** | Certain | `--quick` verify passes; unrelated to flags | **Accepted** |
| R12 | Vercel prod env state unknown | **Medium** | Unknown | Operator manual dashboard check required | **Open** |

---

## Detailed risks

### R1 — Migration pending

**Impact:** `persistStreamRegistrationForProduct` / catalog track updates fail when writing `stream_path`/`stream_key`. Backfill records failures per item.

**Detection:** Backfill `failed[]` entries; Supabase error messages in sync `streamResults`.

**Remediation:** Apply migration; re-run backfill with `--force` for affected slugs.

---

### R2 — ffmpeg on serverless

**Impact:** `maybeGenerateStreamAfterCatalogSync` returns `{ ok: false, error: "ffmpeg unavailable" }` — master unaffected.

**Detection:** `[stream-upload-pipeline] stream generation failed` logs; admin sync response `streamResults`.

**Remediation:** Run transcode on operator machine via `npm run backfill:stream-assets`; keep `AUTO=0` on Vercel if no ffmpeg.

---

### R3 — Premature production activation

**Impact:** If PREFERRED=1 before assets exist, every resolve attempts stream then falls back — added latency, no playback break.

**Detection:** Elevated `fallbacksByReason.no_stream_registration` or `r2_missing` in diagnostics.

**Remediation:** Set `PREFERRED=0`; complete backfill; re-enable.

---

### R4 — Stream miss fallback latency

**Impact:** Extra DB lookup + R2 HEAD on entitled master resolves when stream preferred but asset missing.

**Mitigation:** Backfill before PREFERRED=1; monitor `resolverDurationMs` in Server-Timing.

---

### R7 — Storage growth

**Impact:** ~192 kbps AAC copy per track alongside existing master in `digital-assets/`.

**Mitigation:** `--limit`, checkpoint resume, optional R2 lifecycle policy on `streaming/` prefix.

---

## Rollback risk assessment

| Rollback action | Risk | Notes |
|-----------------|------|-------|
| Set all flags to `0` | **None** | Proven 21/21 |
| Delete `streaming/` objects | **Low** | Playback uses masters when flags OFF |
| Revert migration columns | **Not recommended** | Additive columns harmless when ignored |
| Full foundation recover | **High disruption** | Only if code rollback needed — anchor intact |

---

## Audit-specific risks (this phase)

| Risk | Mitigation taken |
|------|------------------|
| Accidental flag enable during audit | Read-only audit; no Vercel/env writes |
| Secret exposure in reports | `.env.local` not logged |
| Functional code change | `git diff src/` empty; only `.env.example` template |

---

## Sign-off requirement

Do not accept R1, R2, R12 as resolved until operator confirms migration applied, ffmpeg path chosen, and Vercel env audited.

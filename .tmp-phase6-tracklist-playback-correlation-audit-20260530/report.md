# Phase 6 — Tracklist Playback Correlation Audit

**Project:** artist-platform (2MRRW)  
**Run date:** 2026-05-31  
**Mode:** Read-only audit (no code changes, no production flags enabled)  
**Zip:** `/Users/recharge/Downloads/phase6-tracklist-playback-correlation-audit-20260530.zip`

---

## Executive summary

User-reported **inconsistent Mixtapes & EPs tracklist playback** for `ad`, `love-hz-vol-1`, and `tbh` is **strongly correlated** with Phase 5.3.3A R2 master path mismatches against canonical `storage_path` / track slugs — not with separate tracklist routing bugs.

**Correlation verdict: PARTIAL (primary cause: related; residual: unrelated)**

| Layer | Finding |
|-------|---------|
| **Track metadata / slug resolution** | Client uses canonical `trackSlug` + release `slug` correctly (`music-playback.js` → `/api/library/stream?slug={album}&trackSlug={track}`). |
| **Master resolution** | Pre-533B: 9/10 failures were R2 folder slug mismatches; post-533B: 9/9 remediated masters resolve. |
| **Stream registration** | Pre-533B: 72.2% catalog hit rate; post-533B: **97.2%** (35/36). |
| **Entitled tracklist playback** | Failed when stream resolver had no registration (path mismatch blocked backfill). Remediated tracks now resolve `streaming/.../{track}_192.m4a`. |
| **Guest / preview tracklist** | Largely **independent** of master paths (`previews/mixtapes-and-eps/...`); rows show `ready` with preview CDN. |
| **Remaining entitled failure** | `love-hz-vol-1/01-roll-call` only — **unrelated** to path mismatch (`MASTER_ABSENT`, no R2 object). |

Phase 5.2.3 metadata fixes (per-track titles, modal continuity) addressed **display/UX** issues that could accompany tracklist confusion but did not cause stream lookup failures.

---

## Overall result: **CONDITIONAL PASS**

| Gate | Result |
|------|--------|
| Correlation question answered | **PASS** — path mismatches caused entitled stream gaps; tracklist code path is sound |
| Post-remediation playable validation | **CONDITIONAL** — 35/36 streams; 1 master absent |
| Build | **PASS** |
| Resolver unit tests | **PASS** — 21/21 |
| Production flags | **PASS** — not enabled |
| Browser entitled E2E | **Not run** (read-only scope) |

---

## Key metrics (live re-validation 2026-05-31)

| Metric | Pre-533B | Post-533B (this audit) |
|--------|----------|-------------------------|
| DB + R2 stream registration | 26/36 (72.2%) | **35/36 (97.2%)** |
| Resolver stream hits (flags on, local) | 26 | **35** |
| Unregistered | 10 tracks | **1** (`love-hz-vol-1/01-roll-call`) |
| Sample tracklist server keys (15 tracks) | 9 would fail | **14/15 PASS**, 1 FAIL (`01-roll-call`) |

---

## Recommendations (report only)

1. Upload master for `love-hz-vol-1/01-roll-call` → single-track backfill → 36/36.
2. Optional hardening: mark entitled rows `unavailable` when stream registration missing (client currently always assigns `/api/library/stream` for subscribers).
3. Device spot-check Play All / track tap on `ad`, `love-hz-vol-1`, `tbh` after deploy (not re-run here).

**STOP** — Phase 6 audit complete. No implementation performed.

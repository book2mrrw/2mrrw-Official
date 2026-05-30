# 11 — Risk Analysis

**Ranked by severity × likelihood, with mitigations.**

---

## Risk register

| Rank | ID | Risk | Severity | Likelihood | Score | Mitigation |
|-----:|----|------|----------|------------|------:|------------|
| 1 | R7 | Public `streaming/` ACL exposes entitled bytes | Critical | Low | **High** | Proxy + signed only; no public ACL without security review |
| 2 | R8 | Entitlement bypass via guessed CDN URL | Critical | Low | **High** | Same gates as today; no public stream prefix |
| 3 | R2 | Collector download serves stream not master | High | Low | **Med** | Token route hardcoded to `DIGITAL_ASSETS` + `storage_path` |
| 4 | R9 | Missing stream + missing master → outage | High | Medium | **High** | Master fallback; 90-day dual-read; never delete masters |
| 5 | R1 | Wrong stream file mapped to slug | High | Low | **Med** | Duration checksum; shadow logging; slug denylist |
| 6 | R10 | Cache serves stale key after master swap | Medium | Medium | **Med** | Cache key hash; invalidate on admin sync |
| 7 | R4 | Dual-path confusion in ops | Medium | High | **Med** | Runbook: master upload → auto transcode diagram |
| 8 | R3 | Transcode quality regression | Medium | Medium | **Med** | Golden master QA; AB on 5 tracks |
| 9 | R13 | Regression of Phase 4.8 warm paths | Medium | Low | **Low** | Hybrid changes key only; keep caches + Server-Timing |
| 10 | R6 | HLS scope creep delays MVP | Medium | Medium | **Med** | Defer HLS to 5e; ship AAC first |
| 11 | R14 | Engineer capacity for backfill | Medium | Medium | **Med** | P0 slugs first (hour-glass, love-hz-vol-1) |
| 12 | R12 | Legal/metadata loss in transcode | Medium | Low | **Low** | Copy ID3/metadata in FFmpeg template |
| 13 | R5 | Increased storage cost | Low | High | **Low** | ~9% incremental; monitor bucket |
| 14 | R11 | iOS AAC edge (mono/stems) | Low | Low | **Low** | Stereo downmix in template |
| 15 | R15 | Future Supabase Storage migration | Low | Certain | **Low** | Design paths compatible; separate phase |

---

## Technical debt interaction

| Debt | Hybrid interaction | Risk |
|------|-------------------|------|
| `digital-assets` vs `protected-media` | Stream uses single `streaming/` convention | Low if enforced |
| Master-first discovery | Inverted for play only | Medium — ops education |
| JSON+HEAD refresh path (4.7 P2) | Still slower than redirect | Low — orthogonal fix |
| No transcode pipeline today | Must build before flip | **High** — blocks 5c |
| Entitled 200 stream not measured prod | Validation gap | Medium — pre-canary gate |

---

## Pre-implementation gates

1. **Security review:** Stream object access model (signed + proxy)
2. **QA matrix:** 5 slugs × {guest, entitled, collector, purchase download}
3. **Rollback drill:** `STREAM_PLAYBACK_PREFERRED=0` in staging
4. **Metrics baseline:** Phase 4.7 HAR captured before canary
5. **R2 inventory script:** Replace estimated storage with measured counts

---

## Risk acceptance (stakeholder)

### Accept for MVP

- +9% storage (**estimated**)
- Transcode ops overhead
- 90-day dual-maintenance
- Temporary master fallback latency for entities missing stream

### Do **not** accept

- Entitlement weakening
- Master deletion
- UI/cinematic changes bundled in same deploy
- Public unauthenticated stream URLs

---

## Residual risks after mitigation

| Risk | Residual level |
|------|----------------|
| CDN TTFB still bound (~954 ms measured preview) | Medium — stream reduces bytes, not always first-byte |
| iOS entitled tap→audible pending measurement | Medium — 11/20 Phase 4.7 checkpoints pending |
| Overlapping single/album masters (4 slugs) | Low — duplicate transcode cost |

---

## Open questions (implementation kickoff)

1. HQ tier for collector — marketing yes/no?
2. Regenerate previews from stream stems?
3. Transcode worker host (CF Worker vs external)?
4. Timeline for Supabase Storage alignment?

**Not blockers** for conditional GO on design + migration plan.

---

## Verdict

**Risk profile:** **Manageable** with flag-gated rollout, master fallback, and download route isolation. Critical risks (R7/R8) mitigated by keeping stream layer private same as masters today.

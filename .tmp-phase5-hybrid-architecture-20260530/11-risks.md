# 11 — Risks

| ID | Risk | Severity | Likelihood | Mitigation |
|----|------|----------|------------|------------|
| R1 | Wrong stream file mapped to slug | High | Low | Duration checksum; shadow logging; slug denylist rollback |
| R2 | Collector download serves stream not master | High | Low | Token route hardcoded to master; separate `masterKey` |
| R3 | Transcode quality regression (artifacts) | Medium | Medium | Golden master QA; AB listening on 5 tracks |
| R4 | Dual path confusion in ops | Medium | High | Runbook: upload master → auto transcode; folder diagram |
| R5 | Increased storage cost | Low | High | ~10% incremental; monitor bucket growth |
| R6 | HLS scope creep delays MVP | Medium | Medium | Defer HLS to 5e; ship AAC first |
| R7 | Public `streaming/` ACL mistake | Critical | Low | Keep proxy + signed; no public ACL without review |
| R8 | Entitlement bypass via direct CDN guess | Critical | Low | No public stream prefix; same gates as today |
| R9 | Fallback missing stream file outage | High | Medium | Master fallback in resolver; 90-day dual-read |
| R10 | Cache serves stale key after master swap | Medium | Medium | Invalidate caches on admin sync (`cache-invalidation.js`) |
| R11 | iOS AAC edge case (mono/stems) | Low | Low | Stereo downmix in FFmpeg template |
| R12 | Legal/distribution metadata loss | Medium | Low | Copy ID3/metadata in transcode job |
| R13 | Regression of 4.8 warm paths | Medium | Low | Keep Server-Timing + caches; hybrid only changes key |
| R14 | Engineer capacity for backfill | Medium | Medium | Prioritize top 20 storefront slugs first |
| R15 | Platform rule: Supabase Storage future | Low | Certain | Design paths compatible; migration separate |

---

## Technical debt interaction

| Debt | Hybrid interaction |
|------|-------------------|
| `digital-assets` vs `protected-media` | Stream prefix must use one convention — propose `streaming/` only |
| Master-first discovery order | Inverted for play; preserved for download |
| JSON+HEAD refresh path | Still slower — fix in client (4.7 P2) independent |
| Monolithic page.js | Unrelated; 4.6 mitigated main-thread |

---

## Risk acceptance (stakeholder)

Accept for MVP:

- +10% storage
- Transcode ops overhead
- 90-day dual-maintenance

Do **not** accept:

- Entitlement weakening
- Master deletion
- UI/cinematic changes bundled in same deploy

---

## Pre-implementation gates

1. Security review: stream object access model  
2. QA: 5 slugs × {guest, entitled, collector, purchase download}  
3. Rollback drill: `STREAM_PLAYBACK_PREFERRED=0` in staging  
4. Metrics: baseline HAR captured (Phase 4.7 P0)

---

## Open questions

1. HQ tier for collector — marketing yes/no?  
2. Re-generate previews from stream stems? (cost vs consistency)  
3. Worker host for transcode (CF Worker vs external)?  
4. Timeline for Supabase Storage alignment?

Resolve in implementation kickoff; not blockers for Phase 5 design approval.

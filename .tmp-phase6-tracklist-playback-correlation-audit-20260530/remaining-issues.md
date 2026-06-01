# Remaining Issues

## Blocking (entitled full stream)

| ID | Release | Track | Issue | Related to 533A path mismatch? |
|----|---------|-------|-------|-------------------------------|
| R6-001 | love-hz-vol-1 | 01-roll-call | No master in R2; no `stream_key` in DB; `resolvePlaybackKey` returns null | **No** — absent upload |

**Fix (ops):** Upload master to `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/` → run single-track backfill → register stream.

---

## Medium (UX / observability)

| ID | Issue | Impact |
|----|-------|--------|
| R6-002 | Entitled tracklist rows get `src` from `libraryStreamRedirectSrc` without checking DB stream registration | Track 1 on Love Hz shows Play enabled but API fails |
| R6-003 | Browser entitled E2E not re-run in Phase 6 | Deploy confidence relies on script + unit tests |

---

## Informational (pre-existing)

| ID | Issue | Notes |
|----|-------|-------|
| R6-004 | `npm run test:foundation` anchor drift | Not playback-related; unchanged across 5.2.x / 5.3.x |
| R6-005 | Production flags not enabled | By design for this audit |

---

## Cleared by 533B (no longer open)

- ad/03, ad/04, ad/08 master path mismatches  
- love-hz-vol-1/02, 07, 08, 09 path/number mismatches  
- tbh/03, tbh/08 path mismatches  
- 72.2% → 97.2% stream registration  

---

## Deployment gate

| Gate | Status |
|------|--------|
| Tracklist correlation understood | Ready |
| 100% entitled catalog stream | **Blocked** on R6-001 |
| `STREAM_PLAYBACK_PREFERRED=1` production | **Near-ready** after roll-call upload (2.8% fallback) |

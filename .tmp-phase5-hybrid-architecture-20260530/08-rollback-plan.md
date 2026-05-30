# 08 — Rollback Plan

Fast recovery without data loss — masters and stream objects both remain in R2.

---

## Instant rollback (runtime)

| Control | Action | Effect |
|---------|--------|--------|
| `STREAM_PLAYBACK_PREFERRED=0` | Vercel env toggle | Resolver skips stream discovery; master-only behavior |
| Remove stream discovery code path | Redeploy previous resolver | Same as env off if flag not implemented |
| `clearPlaybackKeyCache()` + deploy | Force cold resolve | Picks master after flag off |

**Time to effect:** < 5 min after env propagate (Vercel).

---

## Partial rollback (per slug)

- Maintain denylist env `STREAM_PLAYBACK_SLUG_DENYLIST=slug-a,slug-b`
- Resolver falls back to master for listed slugs only
- Use when one transcode artifact is corrupt

---

## Data rollback

| Action | Required? |
|--------|-----------|
| Delete `streaming/` objects | **No** — leave orphaned; no runtime reference when flag off |
| Restore masters | **No** — masters never deleted in migration |
| Revert Supabase `media_assets` stream rows | Optional cleanup; ignored when flag off |

---

## Phase 4.8 server cache rollback

If stream-first causes unexpected 404s:

1. Set `STREAM_PLAYBACK_PREFERRED=0`
2. Call existing cache clears via deploy hook or dev `clearMediaResolverCaches`
3. Stream URL cache (`stream-url-cache.js`) auto-expires ≤ 55 min

Phase 4.8 preview fast path and Server-Timing — **keep**; independent of hybrid.

---

## Failure modes & response

| Symptom | Likely cause | Rollback |
|---------|--------------|----------|
| 404 `MEDIA_UNAVAILABLE` spike | Bad stream key | Denylist slug or global flag off |
| Audible glitches / wrong track | Wrong transcode mapping | Denylist + re-transcode |
| Download serves AAC | Token route bug | Hotfix token to use `masterKey` only |
| Higher latency | CDN misconfig on streaming prefix | Flag off; investigate CDN |

---

## Verification after rollback

- [ ] Guest preview unchanged (CDN)
- [ ] Entitled play uses master WAV/FLAC — higher latency acceptable temporarily
- [ ] `git` deploy matches known-good resolver commit
- [ ] Server-Timing `resolve` segment stable
- [ ] No entitlement 403 regression

---

## Communication

- Internal: “Stream layer disabled; masters active; no fan data impact.”
- Fans: no message required if rollback < 1 hr; otherwise status page optional.

---

## Post-mortem triggers

- p95 tap→audible **worse** than master baseline for 24h
- Error rate > 0.5% on `library/stream`
- Collector download serves wrong format

Document in implementation phase runbook; link Phase 4.8 `rollback-paths.md` for server-timing-only rollback.

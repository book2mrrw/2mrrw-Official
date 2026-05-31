# Hybrid Readiness Assessment — Would Flags Improve Tap→Audible?

**Phase:** 5.2.4  
**Date:** 2026-05-31  
**Constraint:** **NO flag activation** in this phase.

---

## Flags (current production assumption)

Per Phase 5.3A audit: all default **OFF** unless operator set in Vercel.

| Flag | Default | Effect when ON |
|------|---------|----------------|
| `HYBRID_STREAMING_ENABLED` | false | Enables hybrid code paths |
| `STREAM_PLAYBACK_PREFERRED` | false | Stream-first resolver (requires HYBRID) |
| `AUTO_GENERATE_STREAM_ASSETS` | false | Upload/backfill transcode (requires HYBRID) |

---

## Would enabling all three improve measured startup latency?

### Short answer

| Segment | Flags OFF (today) | Flags ON + assets present | Flags ON without backfill |
|---------|-------------------|---------------------------|---------------------------|
| API resolve/sign | Master key, full file proxy **[M]** prod ~174–258 ms (401) | Stream AAC, smaller payload **[P]** 50–200 ms entitled | Extra HEAD attempt **[P]** +5–30 ms then **fallback** to master |
| CDN first byte | Large master MP3 | Smaller AAC `-faststart` **[P]** faster TTFB | Same as OFF (fallback) |
| Client path | Unchanged | Unchanged | Unchanged |

**Projected benefit:** **[P]** meaningful only when `STREAM_PLAYBACK_PREFERRED=1` **and** stream objects exist in R2 + DB.  
**Without backfill:** resolver falls back to master (Stage 5 tests **21/21 PASS**) — **~0 ms improvement**, possible small regression on miss.

**AUTO_GENERATE_STREAM_ASSETS alone** does not speed playback until assets exist and PREFERRED routes to them.

---

## Evidence table

| Source | Finding | Label |
|--------|---------|-------|
| Phase 4.7 prod curl | Preview 602 ms, stream redirect 513–804 ms | **[M]** baseline (pre-4.8 deploy) |
| Phase 4.8 local | Preview warm 4 ms, stream 401 warm 3–9 ms | **[M]** local only |
| **Phase 5.2.4 prod curl** | Preview 215 ms, stream redirect 174–192 ms, CDN range 182 ms | **[M]** current prod |
| Phase 5.2 Stage 7 | Flags OFF → **0 ms** runtime delta | **[M/U]** |
| Phase 5 hybrid `10-performance-projections.md` | Entitled stream hit **50–200 ms [P]** API + smaller CDN | **[P]** |
| Phase 5.3A activation readiness | **FAIL** — migration/backfill/operator gates | **[M]** audit |
| Phase 5.2.2 | Metadata defect blocks continuity sign-off | **[M]** — orthogonal to latency |

---

## Measured vs projected (tap → audible)

| Bottleneck today (5.2.4) | Hybrid helps? |
|--------------------------|---------------|
| `waitAudioSrcReady` / decode | **[P]** slightly (smaller file) |
| API resolve+proxy | **[P]** yes if stream hit |
| Cross-track fade 300 ms | No |
| AppAuthRoot hydration | No |
| JSON+HEAD non-redirect path | No (client should use redirect) |
| First-listen swell | No |

**Dominant remaining gap is client decode + optional JSON path**, not absence of stream renditions alone.

---

## Activation readiness vs latency

Phase 5.3A: code **ready**, operator prerequisites **incomplete** (migration, backfill, ffmpeg on ingest, Vercel env verification).

**STOP — do not activate Phase 5.3** per user directive. Even if activated, **measure first** on staging with:

1. Entitled cookie + `Server-Timing` on 200 stream  
2. A/B master vs stream slug with known stream asset  
3. iOS `dumpPlaybackTiming` on redirect path  

---

## Recommendation

| Priority | Action |
|----------|--------|
| P0 | Confirm prod deploy includes Phase 4.8 `Server-Timing`; measure entitled 200 **[M]** |
| P1 | Ensure catalog emits `redirect=1` stream URLs for entitled taps (avoid JSON+HEAD) |
| P2 | After D-522-001 metadata fix + backfill: staging canary `PREFERRED=1` **[P]** validation |
| P3 | Phase 5.3 activation sequence per 5.3A — **not** before P0–P2 |

**Hybrid flags are not a substitute** for init/hydration and decode-time work; they narrow CDN/API bytes for entitled streams once assets exist.

# 10 — Performance Projections

Label key: **[M]** measured, **[P]** projection, **[E]** estimate from prior audit code-path.

---

## Scorecard template

| Scenario | Metric | Current baseline | Projected (hybrid) | Confidence |
|----------|--------|------------------|-------------------|------------|
| Guest preview cold | Preview API TTFB | **602 ms [M]** prod | **4 ms [M]** warm (4.8) / 50–150 ms direct CDN [P] | High |
| Guest preview | CDN first-byte 64KiB | **954 ms [M]** | **700–900 ms [P]** (format unchanged MVP) | Medium |
| Guest preview | tap→audible | **150–500 ms [E]** | **120–400 ms [P]** | Medium |
| Entitled cold | Stream API TTFB 401 | **279–804 ms [M]** | **50–200 ms [P]** prod entitled 200 | Medium |
| Entitled warm | Stream API (4.8) | **3–9 ms [M]** local | **3–15 ms [P]** prod with cache | High |
| Entitled | Server resolve chain | **150–600 ms [E]** cold | **80–400 ms [P]** (smaller sign payload) | Medium |
| Entitled | CDN/proxy first-byte | dominated by WAV size | **−30–60% [P]** vs master | Medium |
| Entitled | tap→audible | **300–1200 ms [E]** | **180–700 ms [P]** | Medium |
| Entitled repeat | Second play same track | browser + URL cache | **−40–70% [P]** tap→audible | Medium |
| Mobile Safari | Decode to canplay | WAV heavy **[P]** | AAC faster **[P]** | Medium |
| Android Chrome | Same | **[P]** | **[P]** similar | Medium |
| Collector browse | Queue skip next track | master cold each | stream smaller **[P]** | High |
| Vault audio | signed master | stream optional 5c | **−20–40% [P]** | Low |

---

## Measured anchors (do not regress)

From Phase 4.7–4.8:

| Checkpoint | Value |
|------------|-------|
| Preview API prod TTFB | 602 ms |
| Preview API warm local | ~4 ms |
| Stream redirect 401 prod | 279–804 ms |
| Stream redirect warm local | 3–9 ms |
| CDN range TTFB preview | 954 ms |
| CDN full preview download | 2131 ms total |

Phase 4.6 improved **main-thread** responsiveness during play — does not replace hybrid byte savings.

---

## Projection methodology

### First-byte (entitled)

```
T_total ≈ T_api + T_sign + T_proxy_first_byte

T_proxy_first_byte ∝ min(bytes_needed, object_size)
```

AAC ~3.8 MB vs WAV ~42 MB → fewer bytes for initial buffer (**P**, High arithmetic confidence).

### tap→audible

Dev sample (instrumentation doc, localhost, not re-captured):

```json
"playback-src-to-first-byte": 412.0
```

**Projection:** stream cuts this stage 30–50% → **~200–290 ms** for that segment alone (**P**, Medium).

### Repeat play

- Stream URL cache TTL ~55 min (`stream-url-cache.js`)
- Playback key cache 60s
- Browser media cache

**Projection:** repeat tap→audible **< 200 ms** warm **[P]** High on desktop, Medium iOS (Safari cache policy).

---

## Targets (proposed SLOs — implementation phase)

| SLO | Target | Measurement |
|-----|--------|-------------|
| Entitled p50 tap→audible | < 500 ms | RUM + `dumpPlaybackTiming` |
| Entitled p95 tap→audible | < 900 ms | RUM |
| Preview p95 tap→audible | < 600 ms | RUM |
| Stream API p95 (200) | < 250 ms | Server-Timing + curl |

---

## Validation plan

| # | Test | Replaces projection with |
|---|------|--------------------------|
| 1 | Prod HAR entitled hour-glass | [M] full pipeline |
| 2 | iOS 375px before/after hybrid | [M] tap→audible |
| 3 | `Server-Timing` cdn segment compare | [M] proxy bytes/time |
| 4 | Lighthouse during playback | main-thread (4.6 retained) |

---

## Scenarios not improved by hybrid

| Scenario | Why |
|----------|-----|
| Cold preview API without direct URL | Still needs API hop — fix via catalog URL (4.7 S3) |
| Guest session 484–7877 ms | Auth/session — unrelated |
| React churn during play | Fixed 4.6 — unrelated |
| Hero MP4 contention | Unrelated |

---

## Confidence summary

| Projection | Confidence |
|------------|------------|
| Byte reduction −80–90% | **High** |
| tap→audible −30–50% entitled | **Medium** |
| Preview unchanged MVP | **High** |
| HLS further −200 ms mobile | **Low** until built |

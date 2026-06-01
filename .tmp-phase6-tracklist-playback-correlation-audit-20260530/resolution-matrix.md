# Resolution Matrix — Tracklist Sample Tracks

**Legend**

- **Resolved asset:** Master R2 (post-533B) + stream key registration  
- **Playback source (entitled):** `/api/library/stream?slug={album}&trackSlug={track}`  
- **Playback source (guest):** `catalogPreviewAudioUrl` → `previews/mixtapes-and-eps/...`  
- **Server key:** Live `resolvePlaybackKey` with `HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1` (local `.env.local`, 2026-05-31)

---

## ad (11 tracks) — samples: 1, 3, 5, 7, 11

| Release | Track # | Track slug | Resolved asset | Playback source (entitled) | Server stream key | Result |
|---------|---------|------------|----------------|-----------------------------|-------------------|--------|
| ad | 1 | 01-2mrrws-ntro | stream registered | library stream + trackSlug | `streaming/mixtapes-and-eps/ad/01-2mrrws-ntro/01-2mrrws-ntro_192.m4a` | **PASS** |
| ad | 3 | 03-said-n-done | stream registered (remediated) | library stream + trackSlug | `streaming/mixtapes-and-eps/ad/03-said-n-done/03-said-n-done_192.m4a` | **PASS** |
| ad | 5 | 05-perspective | stream registered | library stream + trackSlug | `streaming/mixtapes-and-eps/ad/05-perspective/05-perspective_192.m4a` | **PASS** |
| ad | 7 | 07-a2b | stream registered | library stream + trackSlug | `streaming/mixtapes-and-eps/ad/07-a2b/07-a2b_192.m4a` | **PASS** |
| ad | 11 | 11-like-me-or-not | stream registered | library stream + trackSlug | `streaming/mixtapes-and-eps/ad/11-like-me-or-not/11-like-me-or-not_192.m4a` | **PASS** |

**Guest preview (all five):** PASS — preview_path present, `playbackStatus: ready`

---

## love-hz-vol-1 (10 tracks) — samples: 1, 3, 5, 7, 10

| Release | Track # | Track slug | Resolved asset | Playback source (entitled) | Server stream key | Result |
|---------|---------|------------|----------------|-----------------------------|-------------------|--------|
| love-hz-vol-1 | 1 | 01-roll-call | **no master** | library stream URL issued client-side | `null` | **FAIL** — `MASTER_ABSENT`; no stream registration |
| love-hz-vol-1 | 3 | 03-guarded-heart | stream registered | library stream + trackSlug | `streaming/.../03-guarded-heart_192.m4a` | **PASS** |
| love-hz-vol-1 | 5 | 05-like-u-do | stream registered | library stream + trackSlug | `streaming/.../05-like-u-do_192.m4a` | **PASS** |
| love-hz-vol-1 | 7 | 07-stayed-2-long | stream registered (remediated) | library stream + trackSlug | `streaming/.../07-stayed-2-long_192.m4a` | **PASS** |
| love-hz-vol-1 | 10 | 10-turnt-me-2-dis | stream registered | library stream + trackSlug | `streaming/.../10-turnt-me-2-dis_192.m4a` | **PASS** |

**Guest preview (all five):** PASS for preview rows (including `01-roll-call` preview folder)

---

## tbh (9 tracks) — samples: 1, 3, 5, 7, 9

| Release | Track # | Track slug | Resolved asset | Playback source (entitled) | Server stream key | Result |
|---------|---------|------------|----------------|-----------------------------|-------------------|--------|
| tbh | 1 | 01-glass-full | stream registered | library stream + trackSlug | `streaming/mixtapes-and-eps/tbh/01-glass-full/01-glass-full_192.m4a` | **PASS** |
| tbh | 3 | 03-unxpcted | stream registered (remediated) | library stream + trackSlug | `streaming/mixtapes-and-eps/tbh/03-unxpcted/03-unxpcted_192.m4a` | **PASS** |
| tbh | 5 | 05-locomotive | stream registered | library stream + trackSlug | `streaming/mixtapes-and-eps/tbh/05-locomotive/05-locomotive_192.m4a` | **PASS** |
| tbh | 7 | 07-was-wrong | stream registered | library stream + trackSlug | `streaming/mixtapes-and-eps/tbh/07-was-wrong/07-was-wrong_192.m4a` | **PASS** |
| tbh | 9 | 09-artificial | stream registered | library stream + trackSlug | `streaming/mixtapes-and-eps/tbh/09-artificial/09-artificial_192.m4a` | **PASS** |

**Guest preview (all five):** PASS

---

## Summary counts (sampled 15 tracks)

| Result | Count |
|--------|------:|
| PASS (entitled stream) | 14 |
| FAIL (entitled stream) | 1 (`love-hz-vol-1/01-roll-call`) |
| PASS (guest preview) | 15 |

---

## Pre-remediation vs post-remediation (path-mismatch tracks only)

| Track | Pre-533B entitled | Post-533B entitled | Root cause if FAIL |
|-------|-------------------|--------------------|--------------------|
| ad/03-said-n-done | FAIL | PASS | Was trailing-space R2 folder |
| ad/04-a-d-d | FAIL | PASS | Was `04-a.d.d` folder |
| ad/08-life-changes-ft-gwendolyn | FAIL | PASS | Was spaced folder name |
| love-hz-vol-1/02-w-2-d | FAIL | PASS (not in sample; validated in catalog) | Was `02-w2d` |
| love-hz-vol-1/07-stayed-2-long | FAIL | PASS | Was `09-stayed-2-long` folder |
| love-hz-vol-1/08-knock-on-wood | FAIL | PASS (catalog) | Was `07-knock-on-wood` |
| love-hz-vol-1/09-hour-glass | FAIL | PASS (catalog) | Was `08-hour-glass` |
| tbh/03-unxpcted | FAIL | PASS | Was `03-unxpected` |
| tbh/08-2late | FAIL | PASS (catalog) | Was `08-2late?` |
| love-hz-vol-1/01-roll-call | FAIL | FAIL | No master uploaded |

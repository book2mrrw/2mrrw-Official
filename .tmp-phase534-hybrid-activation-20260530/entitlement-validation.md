# Entitlement Validation — Phase 5.3.4

**Run date:** 2026-05-31  
**Flags:** `HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1`

---

## Asset resolution by user type

| User type | Client access | Server route | Hybrid flags ON |
|-----------|---------------|--------------|-----------------|
| **Guest** | `previewOnly: true`, `canStream: false` | `/api/media/preview` or CDN preview | **No change** — never hits stream resolver |
| **Subscriber** | `canStream: true` | `/api/library/stream` | Stream if registered, else master |
| **Collector** | `canStream: true` via collector card | Same | Same |
| **Purchaser** | `canStream: true` via `ownedSlugs` | Same | Same |
| **Admin** | `adminTrackAccess()` | Same + admin bypass | Same |

---

## Guest → Preview (isolation)

| Check | Status | Evidence |
|-------|--------|----------|
| Guest `canStream: false` | ✅ | `playback-gate.js` → `catalogItemAllowsFullPlayback` |
| No `libraryStreamRedirectSrc` for guest | ✅ | `resolvePlaybackSrc` preview branch |
| Server 401/403 on stream without entitlement | ✅ | `validateStreamEntitlement` |
| Preview path independent of hybrid flags | ✅ | No hybrid reads in preview URL builders |
| Direct preview OFF | ✅ | Guest uses API redirect baseline |

**Result: PASS** — guest preview preserved.

---

## Entitled → Stream

| Check | Status | Evidence |
|-------|--------|----------|
| Flags ON + registration → stream key | ✅ | `gate-stream-replaces-master` test |
| Flags ON + miss → master fallback | ✅ | `gate-master-kept-on-r2-miss` test |
| Entitlement checked before resolver | ✅ | `/api/library/stream` handler order |
| Client contract unchanged | ✅ | Same redirect URL shape |
| 35/36 catalog stream hits | ✅ | Phase 533 validation |

**Result: PASS** — entitled stream path active for registered assets.

---

## Entitled → Master (fallback)

| Path | When | Verified |
|------|------|----------|
| Stream miss | No registration / R2 404 | ✅ Automatic |
| Roll Call | `MASTER_ABSENT` — no master in R2 | ✅ Resolver returns null or preview safety net |
| Rollback | `STREAM_PLAYBACK_PREFERRED=0` | ✅ 21/21 tests |
| Offline download | Client blob cache | ✅ Hybrid bypassed client-side |

**Result: PASS** — fallback safe for 2.8% of catalog.

---

## Resolver layering (server-only)

```
/api/library/stream
  → validateStreamEntitlement(user, product)
  → resolvePlaybackKey(admin, slug, { trackSlug })
      → master discovery
      → [if isStreamPlaybackPreferred] tryResolveStreamPlaybackKey
      → sign + proxy
```

`isStreamPlaybackPreferred()` = `HYBRID_STREAMING_ENABLED=1` **AND** `STREAM_PLAYBACK_PREFERRED=1`.

Client never reads hybrid flags — server decides stream vs master.

---

## Entitlement verdict

**PASS** — All user types route correctly; hybrid affects entitled server resolver only.

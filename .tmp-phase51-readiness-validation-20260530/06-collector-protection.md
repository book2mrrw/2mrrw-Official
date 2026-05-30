# 06 — Collector Protection

**Ensures:** WAV/FLAC ownership, downloads, vault, and purchases remain master-authoritative under hybrid architecture.

---

## Ownership model (unchanged)

```mermaid
flowchart LR
  WH[Stripe webhook]
  SB[(Supabase entitlements library_items)]
  AS[/api/account/state]
  UI[AuthContext display only]
  WH --> SB --> AS --> UI
```

**Rule:** UI never grants access — `platform-architecture.mdc`, `music-access.js`.

Stream renditions are **delivery optimization**, not a new entitlement class.

---

## Master vs stream authority

| Asset | Authority | Consumer |
|-------|-----------|----------|
| WAV / FLAC / AIFF master | **Ownership artifact** | Download, collector fulfillment, archival |
| AAC stream | **Playback convenience** | In-app listen, lock screen |
| Preview MP3/WAV | **Marketing sample** | Guests, `previewOnly` fallback |

**Marketing copy:** Collectors own **masters**, not AAC transcodes.

---

## Download & purchase flows

### Purchase download token

```22:25:src/app/api/access/[token]/route.js
  const key = buildR2Key(R2_PREFIX.DIGITAL_ASSETS, product.storage_path);
  const url = await createR2SignedGetUrl(key, 900);
  return NextResponse.redirect(url);
```

| Check | Status |
|-------|--------|
| Uses `DIGITAL_ASSETS` prefix | ✅ Master path |
| Does not call `resolvePlaybackKey` | ✅ Isolated from stream |
| 15-min presign TTL | ✅ |

**Implementation gate:** Stream-first resolver must **never** feed this route. Optional explicit `masterKey` in resolver for future download UI — token route stays on `products.storage_path`.

### Purchase / gift pipeline

| Step | File | Hybrid impact |
|------|------|---------------|
| Checkout | `checkout/session/route.js` | None |
| Webhook grant | entitlements + library | None |
| Library UI | `useMusicLibrary.js` | None |
| Play | `resolvePlaybackSrc` | Stream at resolve layer only |

---

## Collector card guarantees

| Guarantee | Mechanism | Hybrid |
|-----------|-----------|--------|
| Full-catalog stream | `userCanStreamProduct` + collector path | Same gate; fewer bytes |
| Card verification | `collector-card/verify`, `collector/cards/verify` | No R2 coupling |
| NFC / activation | DB-driven | None |
| Physical + digital narrative | Masters in R2 | Masters preserved |

`isCollectorCardOwner()` — `music-access.js` L57–62 — unchanged.

### Optional HQ stream tier

Phase 5 design allows 192 kbps stream for collector marketing — **entitlement-gated server-side**, never client override.

---

## Vault protection

| Surface | Route / lib | Storage |
|---------|-------------|---------|
| Vault media | `GET /api/vault/media` | `buildR2Key(DIGITAL_ASSETS, storagePath)` |
| Tier gate | `src/lib/vault/access.js` | Server-side |
| Preview vs full | `preview_storage_path` vs `media_storage_path` | Preserved |

Vault stream renditions optional in later phase — entitlement checks before sign remain mandatory.

---

## WAV / FLAC ownership semantics

| Scenario | Expected behavior |
|----------|-------------------|
| Purchased single download | Lossless master file |
| Collector bundle "digital album — instant download" | Master archive (page.js bundle copy) |
| Entitled in-app play | AAC stream (after hybrid) |
| Stream file only, master deleted | **Forbidden** — migration rule |
| Master replaced (remaster) | Re-transcode stream; invalidate caches |

---

## Anti-patterns (forbidden)

1. Client `localStorage` to pick stream vs master
2. Public ACL on `digital-assets/` masters
3. Replacing purchase download with stream-only file
4. Separate guest identity with different resolver
5. Removing WAV from bucket after stream upload

---

## Cache invalidation on ownership change

Existing hooks (`stream-url-cache.js`, `resolve-playback-key.js`, `cache-invalidation.js`) must extend to:

- Revoke stream presign when entitlement removed
- Invalidate playback key when master remastered
- Clear stream rendition cache when transcode replaced

---

## Pre-deploy audit checklist

- [ ] Entitled fan without stream file → master fallback (no outage)
- [ ] Guest cannot `library/stream` 200 without entitlement
- [ ] Purchase token fetches master from `digital-assets/`, not `streaming/`
- [ ] Collector deactivate removes stream access same as today
- [ ] Download Content-Type reflects master (audio/wav, audio/flac)

---

## Verdict

**Collector protection:** **Pass** — download and ownership paths are isolated from playback resolver today. Implementation must preserve token route master-only semantics (Phase 5 risk R2).

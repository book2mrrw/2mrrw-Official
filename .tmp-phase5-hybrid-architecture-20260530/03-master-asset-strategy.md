# 03 — Master Asset Strategy

**Layer:** Archival / ownership / download authority  
**Status:** Design — preserves current production behavior as source of truth.

---

## Formats

| Format | Role | Current code |
|--------|------|--------------|
| WAV | Primary master in entity folders | First in `AUDIO_EXTENSIONS` — `entity-resolver.js` L16 |
| FLAC | Alternate lossless | Second in discovery order |
| AIFF | Acceptable master interchange | Treat as WAV sibling at ingest |
| MP3 in `digital-assets/` | Legacy master | Discovered after lossless |

**Policy:** Ingest **one canonical master per entity folder** (WAV or FLAC preferred). Avoid multiple lossless variants in the same folder (discovery picks first extension match — nondeterministic if both present).

---

## Storage location

- **Canonical path:** `digital-assets/{releaseType}/{slug}/` or nested album track paths per `resolveStoragePath` — `canonical-paths.js` L72–88.
- **Legacy:** `protected-media/masters/…` via `normalizePlaybackR2Key` — `normalize-r2-key.js` L18–24.
- **DB authority:** `products.storage_path`, `catalog_tracks.storage_path`, `media_assets` with roles `full_audio`, `master_audio`, `audio`, etc. — `resolve-playback-key.js` L17–50.

---

## Ownership & collector semantics

| Access type | Master use | Reference |
|-------------|------------|-----------|
| Purchase | Download / permanent library proof | `grantLibraryItems` — `entitlements.js` L125+ |
| Collector card | Full-catalog stream + ownership narrative | `getCollectorAccessState`, `music-access.js` L56–62 |
| Subscription | Stream entitlement, not necessarily download | `membershipHasPremiumAccess` |
| Gift | Same as purchase via library_items | `music-access.js` L22–28 |

**Collector promise:** Physical card + digital ownership — master files remain the **artifact** fans receive on download bundles (e.g. Love Hz launch bundle copy on `page.js` L236). Hybrid design must **never** replace master with stream-only for purchase fulfillment.

---

## Download paths (current)

1. **Tokenized access:** `GET /api/access/[token]/route.js` — signs `buildR2Key(DIGITAL_ASSETS, product.storage_path)` (900s).
2. **Future collector “download collection”** — should resolve **master key**, not stream key.

Proposed: explicit `masterKey` in resolver response for UI/download routes (design field only).

---

## Archival & ops

| Concern | Approach |
|---------|----------|
| Retention | Indefinite in R2; lifecycle rules optional for non-canonical duplicates |
| Versioning | New master upload → version suffix or replace + invalidate caches (`cache-invalidation.js`) |
| Checksum | Store SHA-256 in `media_assets.metadata` at ingest (implementation phase) |
| Backup | R2 replication / bucket versioning (ops config, out of app scope) |

---

## Upload workflow (proposed discipline)

1. Upload master to entity folder (flat, no `audio/` subfolder — `canonical-paths.js` L26–27 strips wrong nesting).
2. Run transcode job → writes `streaming/…` (see `04-streaming-asset-strategy.md`).
3. Admin sync updates `products` + optional `media_assets` master row.
4. Do **not** delete master when stream appears.

---

## Risks if masters-only playback continues

| Risk | Evidence |
|------|----------|
| High first-byte latency | **Measured** CDN 954 ms TTFB on preview range; masters often larger |
| Mobile decode cost | **Projection** Safari WAV decode slower than AAC |
| Bandwidth cost | **Projection** 5–10× bytes vs 128 kbps AAC for same listen duration |

Masters remain; streaming layer mitigates playback path only.

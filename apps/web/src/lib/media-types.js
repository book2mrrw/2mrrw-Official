/**
 * @file Canonical type definitions for the 2MRRW media engine.
 *
 * Three normalization layers transform raw catalog data into the engine's
 * internal Track shape:
 *
 *   1. normalizeTrackForPlayback (music-playback.js) — resolves CDN URLs,
 *      access grants, and preview paths from raw catalog/API data.
 *   2. mapMediaTrackToPlayInput (useMediaEngine.js) — remaps the media-engine
 *      subscriber shape back to AudioContext's play() input.
 *   3. normalizeTrack (AudioContext.js) — final normalization into the internal
 *      engine state; the canonical Track lives here.
 *
 * Only fields emitted by normalizeTrack are canonical. Anything else is an
 * intermediate alias that should not be read after normalization.
 */

/**
 * Resolved artwork for a track — static image or motion video.
 *
 * @typedef {Object} TrackArtwork
 * @property {string|null} base  Resolved CDN URL for the primary artwork.
 *   Always a static image (safe for <img>). Used by Media Session and
 *   fallback display when CS mode is inactive.
 * @property {"image"|"video"|null} baseArtType  MIME category of `base`.
 * @property {string|null} cs   Resolved CDN URL for the Cinematic Sound
 *   artwork. May be a motion video URL. Null when CS content is absent.
 * @property {"image"|"video"|null} csArtType  MIME category of `cs`.
 */

/**
 * Access grant resolved by resolveTrackAccess().
 *
 * @typedef {Object} AccessGrant
 * @property {boolean} canStream   User holds an active entitlement for full playback.
 * @property {boolean} canPreview  User may play the preview clip.
 * @property {boolean} previewOnly Track is limited to preview regardless of entitlement.
 * @property {boolean} [locked]   Track is gated and no play path is available.
 */

/**
 * Track metadata bag stored inside the engine state.
 * Extended by normalizeTrackForPlayback; preserved verbatim by normalizeTrack.
 *
 * @typedef {Object} TrackMetadata
 * @property {AccessGrant|null}   access         Resolved access grant.
 * @property {string|null}        previewSrc     Fully-resolved preview CDN URL
 *   (catalogPreviewAudioUrl applied). Authoritative — prefer over `track.preview`.
 * @property {string|null}        albumSlug      Parent album slug, if track belongs to one.
 * @property {string|null}        trackSlug      Per-track slug inside an album.
 * @property {number|null}        trackIndex     Zero-based position inside the album.
 * @property {number|null}        [price]        Storefront price in cents.
 */

/**
 * Canonical Track shape — the internal representation stored in AudioContext
 * state after normalizeTrack() runs.
 *
 * All fields are guaranteed present; nullable fields are never `undefined`.
 *
 * @typedef {Object} Track
 * @property {string}             id            Unique identifier. Falls back to slug, then src.
 * @property {string|null}        slug          URL-safe slug.
 * @property {string}             title         Display title (slowed suffix stripped).
 * @property {string}             artist        Display artist. Defaults to "2MRRW".
 * @property {string}             src           Resolved audio URL for playback.
 *   For preview-only tracks this is the preview CDN URL.
 * @property {string|null}        baseSrc       Original non-CS src; restored when
 *   CS mode is toggled off.
 * @property {string|null}        cover         Primary artwork URL. Equals baseCover
 *   unless a motion cover is active.
 * @property {string|null}        baseCover     Static image artwork URL. Always safe
 *   for <img> — never a video URL.
 * @property {"image"|"video"}    coverArtType  MIME category of `cover`.
 * @property {string|null}        csAudio       Cinematic Sound audio URL.
 * @property {string|null}        csCover       Cinematic Sound artwork URL.
 * @property {"image"|"video"}    csCoverType   MIME category of `csCover`.
 * @property {boolean}            hasCs         True when csAudio or csCover is present.
 * @property {number|null}        gainDb        Per-track loudness offset in dB to reach
 *   −14 LUFS target. Applied as gainLinear = 10^(gainDb/20) on mainGain.gain.
 *   Null until populated server-side; engine treats null as 0 dB (unity).
 * @property {string}             source        Origin identifier ("library", "catalog", …).
 * @property {TrackMetadata}      metadata      Access grant + preview URL + album context.
 * @property {string|null}        preview       Raw preview storage path. Use
 *   `metadata.previewSrc` for the resolved CDN URL instead.
 */

/**
 * Input shape accepted by playTrack() / mapMediaTrackToPlayInput().
 * A subset of Track; normalizeTrack() fills in the rest.
 *
 * @typedef {Object} PlayInput
 * @property {string}          [id]
 * @property {string}          [slug]
 * @property {string}          [src]
 * @property {string}          [title]
 * @property {string}          [artist]
 * @property {string|null}     [cover]
 * @property {number|null}     [gainDb]
 * @property {string}          [source]
 * @property {TrackMetadata}   [metadata]
 */

/**
 * Shape emitted by mapContextTrackToMediaTrack() and consumed by media-engine
 * subscribers. Intentionally narrower than Track — callers outside the audio
 * context should not depend on internal engine fields.
 *
 * @typedef {Object} MediaTrack
 * @property {string|null}  id
 * @property {string|null}  slug
 * @property {string}       title
 * @property {string}       artist
 * @property {string|null}  artwork    Resolved cover URL (mapped from Track.cover).
 * @property {string|null}  audioUrl   Resolved audio URL (mapped from Track.src).
 * @property {TrackMetadata|null} metadata
 */

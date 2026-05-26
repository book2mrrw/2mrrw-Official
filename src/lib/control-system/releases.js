import {
  extractControlSystemArray,
  extractControlSystemRecord,
  fetchControlSystemJson,
  getControlSystemApiUrl,
  isPublishedControlRecord,
} from "./client";
import {
  absolutizeControlSystemMediaUrl,
  firstString,
  mediaAssetFromFields,
  mediaAssetMetadata,
  resolveMediaAssetUrl,
  resolvePublicArtworkUrl,
} from "./media";

const DEFAULT_RELEASE_LIMIT = 4;
const RELEASE_TYPES = new Set(["single", "album", "ep", "feature", "deluxe", "remix_pack"]);

function fallbackForRelease(release, fallbackSingles, index) {
  if (!Array.isArray(fallbackSingles) || fallbackSingles.length === 0) return {};

  const slug = String(release?.slug || "");
  const title = String(release?.title || "");
  return fallbackSingles.find((item) => item.slug === slug || item.title === title) || fallbackSingles[index % fallbackSingles.length] || {};
}

async function resolveControlSystemMediaUrls(release, apiBaseUrl) {
  if (!release) return release;

  const artworkAsset = release.artworkAsset || mediaAssetFromFields(release, [], ["artworkAssetId", "artwork_asset_id", "assetId", "asset_id"], apiBaseUrl);
  const resolvedCover = await resolvePublicArtworkUrl(artworkAsset, apiBaseUrl, release.cover);
  const resolvedTracks = Array.isArray(release.tracks)
    ? await Promise.all(release.tracks.map(async (track) => {
        const previewAsset = track?.assets?.preview || mediaAssetFromFields(track, [], ["previewAssetId", "preview_asset_id"], apiBaseUrl);
        const loopAsset = track?.assets?.loop || mediaAssetFromFields(track, [], ["loopAssetId", "loop_asset_id"], apiBaseUrl);
        const resolvedPreview = await resolveMediaAssetUrl(
          previewAsset,
          apiBaseUrl,
          track?.src || track?.preview || track?.audio || track?.url
        );
        const resolvedLoop = await resolveMediaAssetUrl(loopAsset, apiBaseUrl, track?.video);
        const playbackUrl = resolvedPreview || track?.preview || track?.src || "";

        return {
          ...track,
          src: playbackUrl,
          preview: resolvedPreview || track?.preview || "",
          full: "",
          audio: playbackUrl,
          video: resolvedLoop || track?.video || "",
          signedMediaReady: Boolean(resolvedPreview),
          playbackAccess: "preview",
          fullAssetId: track?.fullAssetId || track?.assets?.full?.assetId || track?.assets?.full?.id || null,
        };
      }))
    : release.tracks;
  const firstResolvedTrack = Array.isArray(resolvedTracks) ? resolvedTracks[0] : null;

  return {
    ...release,
    cover: resolvedCover || release.cover,
    preview: firstResolvedTrack?.preview || firstResolvedTrack?.src || release.preview,
    full: "",
    audio: firstResolvedTrack?.preview || firstResolvedTrack?.src || release.preview,
    video: firstResolvedTrack?.video || release.video,
    tracks: resolvedTracks,
    signedMediaReady: Boolean(resolvedCover || firstResolvedTrack?.signedMediaReady || firstResolvedTrack?.video),
  };
}

function firstTrack(release) {
  return Array.isArray(release?.tracks) ? release.tracks[0] : null;
}

function releaseTypeFor(release) {
  const rawType = release?.releaseType || release?.type || release?.category;
  if (RELEASE_TYPES.has(rawType)) return rawType;
  return null;
}

function immediateAssetUrl(asset, apiBaseUrl) {
  return absolutizeControlSystemMediaUrl(
    asset?.signedUrl ||
      asset?.signed_url ||
      asset?.playbackUrl ||
      asset?.playback_url ||
      asset?.url ||
      asset?.publicUrl ||
      asset?.public_url ||
      asset?.src ||
      asset?.href,
    apiBaseUrl
  );
}

function immediatePublicCoverUrl(asset, apiBaseUrl, fallback = "") {
  return absolutizeControlSystemMediaUrl(
    asset?.publicUrl ||
      asset?.public_url ||
      asset?.url ||
      asset?.src ||
      asset?.href ||
      fallback,
    apiBaseUrl
  );
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function numberFromCents(value) {
  const cents = Number(value);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

function formatPriceLabel(priceCents, currency = "usd") {
  if (!Number.isFinite(priceCents)) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "usd" }).format(priceCents / 100);
  } catch {
    return `$${(priceCents / 100).toFixed(2)}`;
  }
}

function mapControlSystemProducts(release) {
  const products = firstArray(release?.products, release?.productOptions, release?.product_options);
  return products.map((product) => {
    const priceCents = numberFromCents(product?.priceCents ?? product?.price_cents);
    const currency = product?.currency || "usd";
    const slug = product?.productSlug || product?.product_slug || product?.slug || null;

    return {
      id: product?.id || slug,
      slug,
      productSlug: slug,
      title: product?.title || product?.name || slug || "Untitled",
      priceCents,
      priceLabel: product?.priceLabel || product?.price_label || formatPriceLabel(priceCents, currency),
      currency,
      stripePriceId: product?.stripePriceId || product?.stripe_price_id || null,
    };
  }).filter((product) => product.slug || product.id);
}

function mergeTrackMedia(track, mediaTrack) {
  if (!mediaTrack) return track;
  return {
    ...track,
    ...mediaTrack,
    assets: {
      ...(track?.assets || {}),
      ...(mediaTrack?.assets || {}),
    },
  };
}

function mergeReleaseMedia(release, mediaRecord) {
  if (!release || !mediaRecord) return release;
  const mediaTracks = firstArray(mediaRecord.tracks, mediaRecord.mediaTracks, mediaRecord.media_tracks, mediaRecord.items);
  const tracks = Array.isArray(release.tracks) && mediaTracks.length > 0
    ? release.tracks.map((track, index) => {
        const mediaTrack = mediaTracks.find((item) => (
          item?.id === track?.id ||
          item?.trackId === track?.id ||
          item?.track_id === track?.id ||
          item?.slug === track?.slug ||
          item?.trackSlug === track?.slug ||
          item?.track_slug === track?.slug
        )) || mediaTracks[index];
        return mergeTrackMedia(track, mediaTrack);
      })
    : release.tracks || mediaTracks;

  return {
    ...release,
    ...mediaRecord,
    tracks,
    assets: {
      ...(release.assets || {}),
      ...(mediaRecord.assets || {}),
    },
  };
}

function directMediaUrl(record, keys, apiBaseUrl) {
  return absolutizeControlSystemMediaUrl(firstString(...keys.map((key) => record?.[key])), apiBaseUrl);
}

function mapTrackToFrontendTrack(track, release, fallbackTrack, apiBaseUrl) {
  const previewAsset = mediaAssetFromFields(track, ["assets.preview", "previewAsset", "preview_asset"], ["previewAssetId", "preview_asset_id"], apiBaseUrl) || mediaAssetMetadata(track?.assets?.preview, apiBaseUrl);
  const fullAsset = mediaAssetFromFields(track, ["assets.full", "fullAsset", "full_asset"], ["fullAssetId", "full_asset_id", "assetId", "asset_id"], apiBaseUrl) || mediaAssetMetadata(track?.assets?.full, apiBaseUrl);
  const loopAsset = mediaAssetFromFields(track, ["assets.loop", "loopAsset", "loop_asset"], ["loopAssetId", "loop_asset_id"], apiBaseUrl) || mediaAssetMetadata(track?.assets?.loop, apiBaseUrl);
  const lyricsAsset = mediaAssetFromFields(track, ["assets.lyrics", "lyricsAsset", "lyrics_asset"], ["lyricsAssetId", "lyrics_asset_id"], apiBaseUrl) || mediaAssetMetadata(track?.assets?.lyrics, apiBaseUrl);
  const directPreview = directMediaUrl(track, ["preview", "previewUrl", "preview_url", "preview_audio_url", "previewAudioUrl", "src", "audio", "audioUrl", "audio_url", "url", "playbackUrl", "playback_url"], apiBaseUrl);
  const directLoop = directMediaUrl(track, ["video", "videoUrl", "video_url", "motion_cover_url", "motionCoverUrl", "loop", "loopUrl", "loop_url"], apiBaseUrl);
  const preview = immediateAssetUrl(previewAsset, apiBaseUrl) || directPreview || fallbackTrack?.src || fallbackTrack?.preview || "";
  const video = immediateAssetUrl(loopAsset, apiBaseUrl) || directLoop || fallbackTrack?.video || "";

  return {
    id: track?.id || fallbackTrack?.id || `${release?.slug || "release"}-${track?.position || 0}`,
    releaseId: track?.releaseId || release?.id || null,
    slug: track?.slug || fallbackTrack?.slug || release?.slug,
    title: track?.title || fallbackTrack?.title || release?.title || "Untitled",
    position: track?.position,
    durationSeconds: track?.durationSeconds,
    src: preview,
    preview,
    video,
    previewAssetId: track?.previewAssetId || previewAsset?.assetId || previewAsset?.id || null,
    fullAssetId: track?.fullAssetId || fullAsset?.assetId || fullAsset?.id || null,
    loopAssetId: track?.loopAssetId || loopAsset?.assetId || loopAsset?.id || null,
    lyricsAssetId: track?.lyricsAssetId || lyricsAsset?.assetId || lyricsAsset?.id || null,
    lyricsMode: track?.lyricsMode || track?.lyrics_mode || "static",
    lyricsText: track?.lyricsText || track?.lyrics_text || track?.lyrics || null,
    lyricsLrc: track?.lyricsLrc || track?.lyrics_lrc || track?.lrc || null,
    assets: {
      preview: previewAsset,
      full: fullAsset,
      loop: loopAsset,
      lyrics: lyricsAsset,
    },
    entitlement: track?.entitlement || null,
    playback: track?.playback || null,
  };
}

export function mapControlSystemRelease(release, fallbackRelease = {}, index = 0, apiBaseUrl = getControlSystemApiUrl()) {
  if (!release?.slug || !release?.title) return null;

  const fallback = fallbackRelease || {};
  const primaryTrack = firstTrack(release);
  const artworkAsset = mediaAssetFromFields(release, ["artworkAsset", "artwork", "coverAsset", "cover_asset"], ["artworkAssetId", "artwork_asset_id"], apiBaseUrl);
  const directCover = directMediaUrl(release, ["cover", "coverUrl", "cover_url", "cover_art_url", "coverArtUrl", "artworkUrl", "artwork_url", "image", "imageUrl", "image_url"], apiBaseUrl);
  const directMotion = directMediaUrl(release, ["motion_cover_url", "motionCoverUrl", "motionCover", "motion_cover"], apiBaseUrl);
  const directPreview =
    directMediaUrl(primaryTrack, ["preview", "previewUrl", "preview_url", "preview_audio_url", "previewAudioUrl", "src", "audio", "audioUrl", "audio_url", "url", "playbackUrl", "playback_url"], apiBaseUrl) ||
    directMediaUrl(release, ["preview", "previewUrl", "preview_url", "preview_audio_url", "previewAudioUrl", "audio", "audioUrl", "audio_url", "url"], apiBaseUrl);
  const directVideo =
    directMediaUrl(primaryTrack, ["video", "videoUrl", "video_url", "motion_cover_url", "motionCoverUrl", "loop", "loopUrl", "loop_url"], apiBaseUrl) ||
    directMediaUrl(release, ["video", "videoUrl", "video_url", "motion_cover_url", "motionCoverUrl", "loop", "loopUrl", "loop_url"], apiBaseUrl) ||
    directMotion;
  const cover = immediatePublicCoverUrl(artworkAsset, apiBaseUrl, directCover || fallback.cover || "");
  const preview = immediateAssetUrl(primaryTrack?.assets?.preview, apiBaseUrl) || directPreview || fallback.preview || "";
  const video = immediateAssetUrl(primaryTrack?.assets?.loop, apiBaseUrl) || directVideo || fallback.video || "";
  const coverArtType = release?.coverArtType || release?.cover_art_type || (directMotion || directVideo ? "video" : "image");
  const fallbackTracks = Array.isArray(fallback.tracks)
    ? fallback.tracks.map((track, trackIndex) => (typeof track === "string" ? { title: track, position: trackIndex + 1 } : track))
    : [];
  const mappedTracks = Array.isArray(release.tracks)
    ? release.tracks.map((track, trackIndex) => mapTrackToFrontendTrack(track, release, fallbackTracks[trackIndex], apiBaseUrl))
    : fallback.tracks;
  const products = mapControlSystemProducts(release);
  const firstPricedProduct = products.find((product) => Number.isFinite(product.priceCents));
  const releasePriceCents = numberFromCents(release.priceCents ?? release.price_cents);
  const priceCents = firstPricedProduct?.priceCents ?? releasePriceCents;
  const price = Number.isFinite(release.price)
    ? release.price
    : Number.isFinite(priceCents)
      ? priceCents / 100
      : fallback.price ?? 2.99;
  const priceLabel = firstPricedProduct?.priceLabel || release.priceLabel || release.price_label || formatPriceLabel(priceCents);
  const productSlug = release.productSlug || release.product_slug || firstPricedProduct?.productSlug || products[0]?.productSlug || null;
  const pricingTier = release.pricingTier || release.pricing_tier || null;
  const giftingEnabled = Boolean(release.giftingEnabled ?? release.gifting_enabled);

  return {
    ...fallback,
    slug: release.slug,
    title: release.title,
    artist: release.artist?.name || fallback.artist || "2MRRW",
    cover,
    cover_art_url: directCover || cover,
    motion_cover_url: directMotion || directVideo || video,
    coverArtType,
    preview,
    video,
    price,
    priceCents,
    priceLabel,
    productSlug,
    pricingTier,
    giftingEnabled,
    deluxePriceInCents: numberFromCents(release.deluxePriceInCents ?? release.deluxe_price_in_cents),
    bundlePriceInCents: numberFromCents(release.bundlePriceInCents ?? release.bundle_price_in_cents),
    products,
    type: releaseTypeFor(release) || fallback.type,
    releaseDate: release.releaseDate || fallback.releaseDate,
    controlSystemReleaseId: release.id,
    controlSystemReleaseStatus: release.status,
    controlSystemTrackCount: release.playback?.trackCount ?? release.tracks?.length,
    controlSystemDurationSeconds: release.playback?.totalDurationSeconds,
    credits: release.credits ?? [],
    giftingEnabled: release.giftingEnabled ?? release.gifting_enabled ?? false,
    tracks: mappedTracks,
    artworkAssetId: release.artworkAssetId || release.artwork_asset_id || artworkAsset?.assetId || artworkAsset?.id || null,
    artworkAsset,
    entitlement: release.entitlement || null,
    playback: release.playback || null,
  };
}

function mapReleaseToSingle(release, fallbackSingles, index, apiBaseUrl) {
  return mapControlSystemRelease(release, fallbackForRelease(release, fallbackSingles, index), index, apiBaseUrl);
}

function mapReleaseToAlbum(release, fallbackAlbums, index, apiBaseUrl) {
  const fallback = fallbackForRelease(release, fallbackAlbums, index);
  const mapped = mapControlSystemRelease(release, fallback, index, apiBaseUrl);
  if (!mapped) return null;

  const trackTitles = Array.isArray(mapped.tracks)
    ? mapped.tracks.map((track) => (typeof track === "string" ? track : track?.title)).filter(Boolean)
    : fallback.tracks;

  return {
    ...mapped,
    date: mapped.releaseDate || fallback.date,
    vinyl: Number.isFinite(mapped.vinyl) ? mapped.vinyl : fallback.vinyl ?? 47.99,
    trackTitles,
  };
}

function mapReleaseToFeature(release, fallbackFeatures, index, apiBaseUrl) {
  const fallback = fallbackForRelease(release, fallbackFeatures, index);
  const mapped = mapControlSystemRelease(release, fallback, index, apiBaseUrl);
  if (!mapped) return null;

  return {
    ...mapped,
    featuring: release.featureLabel || release.featuring || fallback.featuring || "FT. 2MRRW",
  };
}

function mergeCatalogWithFallback(fallback, mapped) {
  if (!fallback) return mapped;
  if (!mapped) return fallback;
  return {
    ...fallback,
    ...mapped,
    preview: mapped.preview || fallback.preview,
    video: mapped.video || fallback.video,
    cover: mapped.cover || fallback.cover,
    audio: mapped.audio || fallback.audio,
    csAudio: mapped.csAudio || fallback.csAudio,
    csCover: mapped.csCover || fallback.csCover,
  };
}

function mergeWithFallback(mappedReleases, fallbackItems, limit) {
  const fallbackBySlug = new Map();
  (Array.isArray(fallbackItems) ? fallbackItems : []).forEach((item) => {
    if (item?.slug) fallbackBySlug.set(item.slug, item);
  });

  const unique = new Map();

  mappedReleases.forEach((item) => {
    if (!item?.slug) return;
    const fb = fallbackBySlug.get(item.slug);
    unique.set(item.slug, mergeCatalogWithFallback(fb, item));
  });

  (Array.isArray(fallbackItems) ? fallbackItems : []).forEach((item) => {
    if (item?.slug && !unique.has(item.slug)) unique.set(item.slug, item);
  });

  const targetCount = Math.max(mappedReleases.length, Array.isArray(fallbackItems) ? fallbackItems.length : 0);
  return [...unique.values()].slice(0, Math.max(limit || DEFAULT_RELEASE_LIMIT, targetCount));
}

async function fetchControlSystemReleases({ limit = DEFAULT_RELEASE_LIMIT, type } = {}) {
  const params = { limit };
  if (RELEASE_TYPES.has(type)) params.type = type;

  const { apiBaseUrl, ok, payload } = await fetchControlSystemJson("/api/public/releases", { params });
  if (!ok) return { apiBaseUrl, releases: [] };

  return {
    apiBaseUrl,
    releases: extractControlSystemArray(payload, ["releases", "items"]).filter(isPublishedControlRecord),
  };
}

async function fetchControlSystemReleaseMedia(slug) {
  if (!slug) return { apiBaseUrl: getControlSystemApiUrl(), media: null };
  const { apiBaseUrl, ok, payload } = await fetchControlSystemJson(`/api/releases/${encodeURIComponent(slug)}/media`);
  if (!ok) return { apiBaseUrl, media: null };
  return {
    apiBaseUrl,
    media: extractControlSystemRecord(payload, ["media", "releaseMedia", "assets"]) || payload,
  };
}

export async function getControlSystemLatestReleases({ fallbackReleases = [], limit = DEFAULT_RELEASE_LIMIT, type } = {}) {
  const { apiBaseUrl, releases } = await fetchControlSystemReleases({ limit, type });
  const mappedReleases = (await Promise.all(
    releases.map(async (release, index) => {
      const mapped = mapControlSystemRelease(release, fallbackForRelease(release, fallbackReleases, index), index, apiBaseUrl);
      return resolveControlSystemMediaUrls(mapped, apiBaseUrl);
    })
  )).filter(Boolean);

  if (mappedReleases.length === 0) return fallbackReleases;
  return mergeWithFallback(mappedReleases, fallbackReleases, limit);
}

export async function getLatestControlSystemSingles({ fallbackSingles = [], limit = DEFAULT_RELEASE_LIMIT } = {}) {
  const { apiBaseUrl, releases } = await fetchControlSystemReleases({ limit, type: "single" });
  const mappedReleases = (await Promise.all(
    releases.map(async (release, index) => {
      const mapped = mapReleaseToSingle(release, fallbackSingles, index, apiBaseUrl);
      return resolveControlSystemMediaUrls(mapped, apiBaseUrl);
    })
  )).filter(Boolean);

  if (mappedReleases.length === 0) return fallbackSingles;
  return mergeWithFallback(mappedReleases, fallbackSingles, limit);
}

export async function getControlSystemAlbums({ fallbackAlbums = [], limit = DEFAULT_RELEASE_LIMIT } = {}) {
  const albumLimit = Math.max(limit, Array.isArray(fallbackAlbums) ? fallbackAlbums.length : 0);
  const albumResults = await Promise.all([
    fetchControlSystemReleases({ limit: albumLimit, type: "album" }),
    fetchControlSystemReleases({ limit: albumLimit, type: "ep" }),
  ]);
  const mappedReleases = (await Promise.all(
    albumResults.flatMap(({ apiBaseUrl, releases }) => releases.map(async (release, index) => {
      const mapped = mapReleaseToAlbum(release, fallbackAlbums, index, apiBaseUrl);
      return resolveControlSystemMediaUrls(mapped, apiBaseUrl);
    }))
  )).filter(Boolean);

  if (mappedReleases.length === 0) return fallbackAlbums;
  return mergeWithFallback(mappedReleases, fallbackAlbums, albumLimit);
}

export async function getControlSystemFeatures({ fallbackFeatures = [], limit = DEFAULT_RELEASE_LIMIT } = {}) {
  const featureLimit = Math.max(limit, Array.isArray(fallbackFeatures) ? fallbackFeatures.length : 0);
  const { apiBaseUrl, releases } = await fetchControlSystemReleases({ limit: featureLimit, type: "feature" });
  const mappedReleases = (await Promise.all(
    releases.map(async (release, index) => {
      const mapped = mapReleaseToFeature(release, fallbackFeatures, index, apiBaseUrl);
      return resolveControlSystemMediaUrls(mapped, apiBaseUrl);
    })
  )).filter(Boolean);

  if (mappedReleases.length === 0) return fallbackFeatures;
  return mergeWithFallback(mappedReleases, fallbackFeatures, featureLimit);
}

export async function getControlSystemReleaseDetail({ slug, fallbackRelease = null } = {}) {
  if (!slug) return fallbackRelease;
  const { apiBaseUrl, ok, payload } = await fetchControlSystemJson(`/api/releases/${encodeURIComponent(slug)}`);
  if (!ok) return fallbackRelease;

  const release = extractControlSystemRecord(payload, ["release"]);
  if (!isPublishedControlRecord(release)) return fallbackRelease;

  const { media } = await fetchControlSystemReleaseMedia(slug);
  const mapped = mapControlSystemRelease(mergeReleaseMedia(release, media), fallbackRelease || {}, 0, apiBaseUrl);
  return (await resolveControlSystemMediaUrls(mapped, apiBaseUrl)) || fallbackRelease;
}

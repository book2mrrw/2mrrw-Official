import {
  extractControlSystemArray,
  fetchControlSystemJson,
  isPublishedControlRecord,
} from "./client";
import { absolutizeControlSystemMediaUrl } from "./media";

const DEFAULT_AUDIO_VISUAL_LIMIT = 12;

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function youtubeIdFromUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";

  try {
    const url = new URL(value);
    if (url.hostname.includes("youtu.be")) return url.pathname.replace(/^\/+/, "");
    if (url.searchParams.get("v")) return url.searchParams.get("v");

    const embedMatch = url.pathname.match(/\/(?:embed|shorts)\/([^/?#]+)/);
    return embedMatch?.[1] || "";
  } catch {
    return "";
  }
}

function youtubeUrlFromId(youtubeId) {
  return youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : "";
}

function normalizeUploadedAsset(visual, apiBaseUrl = "") {
  const asset = visual?.videoAsset || visual?.video_asset || visual?.asset || {};
  const videoAssetId =
    visual?.videoAssetId ||
    visual?.video_asset_id ||
    visual?.assetId ||
    visual?.asset_id ||
    asset?.id ||
    asset?.assetId ||
    "";
  const videoUrl = absolutizeControlSystemMediaUrl(firstValue(
    visual?.videoUrl,
    visual?.video_url,
    visual?.uploadedVideoUrl,
    visual?.uploaded_video_url,
    asset?.url,
    asset?.publicUrl,
    asset?.public_url,
    asset?.src
  ), apiBaseUrl);
  const mimeType = firstValue(visual?.mimeType, visual?.mime_type, asset?.mimeType, asset?.mime_type, asset?.contentType, asset?.content_type);

  return {
    videoAssetId: videoAssetId || null,
    videoUrl: videoUrl || "",
    mimeType: mimeType || null,
    videoAsset: videoAssetId || videoUrl || mimeType
      ? {
          id: videoAssetId || null,
          url: videoUrl || "",
          mimeType: mimeType || null,
        }
      : null,
  };
}

function mergeWithFallback(mappedVisuals, fallbackVisuals, limit) {
  const unique = new Map();

  [...mappedVisuals, ...(Array.isArray(fallbackVisuals) ? fallbackVisuals : [])].forEach((visual) => {
    const key = visual?.youtubeId || visual?.embedUrl || visual?.id || visual?.slug;
    if (key && !unique.has(key)) unique.set(key, visual);
  });

  const targetCount = Math.max(mappedVisuals.length, Array.isArray(fallbackVisuals) ? fallbackVisuals.length : 0);
  return [...unique.values()].slice(0, Math.max(limit || DEFAULT_AUDIO_VISUAL_LIMIT, targetCount));
}

export function mapControlSystemAudioVisual(visual, fallbackVisual = {}, apiBaseUrl = "") {
  const rawYoutubeUrl = firstValue(visual?.youtubeUrl, visual?.youtube_url, visual?.url);
  const youtubeId =
    visual?.youtubeVideoId ||
    visual?.youtube_video_id ||
    visual?.youtube_id ||
    visual?.youtubeId ||
    visual?.videoId ||
    visual?.video_id ||
    visual?.embedId ||
    visual?.embed_id ||
    youtubeIdFromUrl(rawYoutubeUrl || visual?.embedUrl || visual?.embed_url) ||
    fallbackVisual?.youtubeId;
  const youtubeUrl = rawYoutubeUrl || visual?.metadata?.youtubeUrl || fallbackVisual?.youtubeUrl || youtubeUrlFromId(youtubeId);
  const uploadedAsset = normalizeUploadedAsset(visual, apiBaseUrl);
  const embedUrl = visual?.embedUrl || visual?.embed_url || fallbackVisual?.embedUrl || (youtubeId ? `https://www.youtube.com/embed/${youtubeId}` : "");
  if (!youtubeId && !embedUrl && !uploadedAsset.videoUrl) return null;
  const linkedRelease =
    visual?.release ||
    visual?.linkedRelease ||
    visual?.linked_release ||
    (visual?.releaseId || visual?.release_id || visual?.releaseSlug || visual?.release_slug
      ? {
          id: visual?.releaseId || visual?.release_id || null,
          slug: visual?.releaseSlug || visual?.release_slug || null,
          title: visual?.releaseTitle || visual?.release_title || null,
        }
      : null);
  const linkedTrack =
    visual?.track ||
    visual?.linkedTrack ||
    visual?.linked_track ||
    (visual?.trackId || visual?.track_id || visual?.trackSlug || visual?.track_slug
      ? {
          id: visual?.trackId || visual?.track_id || null,
          slug: visual?.trackSlug || visual?.track_slug || null,
          title: visual?.trackTitle || visual?.track_title || null,
        }
      : null);

  return {
    ...fallbackVisual,
    id: visual?.slug || visual?.id || fallbackVisual?.id || `visual-${youtubeId || uploadedAsset.videoAssetId || "embed"}`,
    slug: visual?.slug || fallbackVisual?.slug || null,
    title: visual?.title || fallbackVisual?.title || "Audio Visual",
    youtubeId,
    youtubeVideoId: youtubeId,
    youtubeUrl,
    embedUrl,
    thumbnailUrl: visual?.thumbnailUrl || visual?.thumbnail_url || fallbackVisual?.thumbnailUrl || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : ""),
    description: visual?.description || visual?.metadata?.description || visual?.subtitle || fallbackVisual?.description || "Official Visual",
    linkedRelease,
    linkedTrack,
    releaseId: visual?.releaseId || visual?.release_id || linkedRelease?.id || null,
    releaseSlug: visual?.releaseSlug || visual?.release_slug || linkedRelease?.slug || null,
    trackId: visual?.trackId || visual?.track_id || linkedTrack?.id || null,
    trackSlug: visual?.trackSlug || visual?.track_slug || linkedTrack?.slug || null,
    sortOrder: visual?.sortOrder ?? visual?.sort_order ?? visual?.position ?? fallbackVisual?.sortOrder ?? null,
    status: visual?.status || fallbackVisual?.status || null,
    ...uploadedAsset,
    controlSystemVisualId: visual?.id || null,
    controlSystemVisualStatus: visual?.status || null,
  };
}

export async function getControlSystemAudioVisuals({ fallbackVisuals = [], limit = DEFAULT_AUDIO_VISUAL_LIMIT } = {}) {
  const visualLimit = Math.max(limit, fallbackVisuals.length || 0);
  const { apiBaseUrl, ok, payload } = await fetchControlSystemJson("/api/audio-visuals", { params: { limit: visualLimit } });
  if (!ok) return fallbackVisuals;

  const visuals = extractControlSystemArray(payload, ["audioVisuals", "visuals", "items"])
    .filter(isPublishedControlRecord)
    .sort((a, b) => Number(a?.sortOrder ?? a?.sort_order ?? a?.position ?? 0) - Number(b?.sortOrder ?? b?.sort_order ?? b?.position ?? 0));
  const mappedVisuals = visuals
    .map((visual, index) => mapControlSystemAudioVisual(visual, fallbackVisuals[index] || {}, apiBaseUrl))
    .filter(Boolean);

  if (mappedVisuals.length === 0) return fallbackVisuals;
  return mergeWithFallback(mappedVisuals, fallbackVisuals, limit);
}

import {
  ensureRelativeSiteApiPath,
  isR2PublicCdnBaseUrl,
  isSiteApiMediaPath,
  repairMisboundR2ApiUrl,
} from "@/lib/media/site-api-url";
import { catalogItemAllowsFullPlayback } from "@/lib/playback/playback-gate";

const ASSET_ID_KEYS = ["assetId", "asset_id", "id"];
const SIGNED_URL_KEYS = ["signedUrl", "signed_url", "playbackUrl", "playback_url"];
const PUBLIC_URL_KEYS = ["url", "publicUrl", "public_url", "src", "href"];
const R2_PUBLIC_CDN_BASE =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_R2_PUBLIC_URL) ||
  "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev";

function isPublicCdnUrl(value) {
  const raw = firstString(value);
  if (!raw) return false;
  return raw.startsWith(R2_PUBLIC_CDN_BASE) || /^https?:\/\/pub-[a-z0-9]+\.r2\.dev\//i.test(raw);
}

function publicArtworkUrlFromPath(storagePath) {
  const normalized = firstString(storagePath)?.replace(/^\//, "");
  if (!normalized) return "";
  if (isPublicCdnUrl(normalized)) return normalized;
  return `${R2_PUBLIC_CDN_BASE.replace(/\/$/, "")}/${normalized}`;
}
const FULL_ACCESS_VALUES = new Set(["full", "owned", "purchased", "subscribed", "subscriber", "vault", "collector", "granted", "unlocked"]);

/** Client-side signed URL cache (P4.1 — 50m TTL, below typical 3600s server expiry). */
const SIGNED_URL_CACHE_TTL_MS = 50 * 60 * 1000;
const signedUrlCache = new Map();

function cacheKeyForEndpoint(endpoint) {
  return endpoint || "";
}

function readSignedUrlCache(endpoint) {
  const key = cacheKeyForEndpoint(endpoint);
  const entry = signedUrlCache.get(key);
  if (!entry) return "";
  if (Date.now() >= entry.expiresAt) {
    signedUrlCache.delete(key);
    return "";
  }
  return entry.url;
}

function writeSignedUrlCache(endpoint, url) {
  if (!endpoint || !url) return;
  signedUrlCache.set(cacheKeyForEndpoint(endpoint), {
    url,
    expiresAt: Date.now() + SIGNED_URL_CACHE_TTL_MS,
  });
}

export function clearSignedUrlCache() {
  signedUrlCache.clear();
}

export function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

export function absolutizeControlSystemMediaUrl(value, apiBaseUrl = "") {
  const rawUrl = firstString(repairMisboundR2ApiUrl(value));
  if (!rawUrl) return "";
  if (rawUrl.startsWith("blob:") || rawUrl.startsWith("data:")) return rawUrl;
  if (isSiteApiMediaPath(rawUrl)) return ensureRelativeSiteApiPath(rawUrl);
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/") && apiBaseUrl && !isR2PublicCdnBaseUrl(apiBaseUrl)) {
    return `${apiBaseUrl}${rawUrl}`;
  }
  return rawUrl.startsWith("/") ? rawUrl : "";
}

export function signedUrlEndpointForAsset(asset, apiBaseUrl = "") {
  const assetId = firstString(asset?.assetId, asset?.asset_id, asset?.id);
  const endpoint = firstString(
    asset?.signedUrlEndpoint,
    asset?.signed_url_endpoint,
    asset?.signedUrlPath,
    asset?.signed_url_path,
    assetId ? `/api/media/${encodeURIComponent(assetId)}/signed-url` : ""
  );
  if (!endpoint) return "";
  if (isSiteApiMediaPath(endpoint)) return ensureRelativeSiteApiPath(endpoint);
  if (/^https?:\/\//i.test(endpoint)) return repairMisboundR2ApiUrl(endpoint);
  if (endpoint.startsWith("/") && apiBaseUrl && !isR2PublicCdnBaseUrl(apiBaseUrl)) {
    return `${apiBaseUrl}${endpoint}`;
  }
  return endpoint.startsWith("/") ? endpoint : "";
}

function valueFromKeys(record, keys) {
  for (const key of keys) {
    const value = String(key).split(".").reduce((current, part) => current?.[part], record);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeAssetLike(value) {
  if (!value) return null;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("blob:") || value.startsWith("data:")) {
      return { url: value };
    }
    return { assetId: value };
  }
  if (typeof value === "object") return value;
  return null;
}

export function mediaAssetMetadata(asset, apiBaseUrl = "") {
  const normalized = normalizeAssetLike(asset);
  if (!normalized) return null;

  const assetId = firstString(...ASSET_ID_KEYS.map((key) => normalized?.[key]));
  const publicUrl = firstString(...PUBLIC_URL_KEYS.map((key) => normalized?.[key]));
  const signedUrl = firstString(...SIGNED_URL_KEYS.map((key) => normalized?.[key]));
  const hasStorageRef = Boolean(
    normalized?.bucket ||
      normalized?.path ||
      normalized?.storagePath ||
      normalized?.storage_path ||
      normalized?.sourcePath ||
      normalized?.source_path
  );
  if (!assetId && !publicUrl && !signedUrl && !hasStorageRef) return null;

  return {
    id: assetId || null,
    assetId: assetId || null,
    kind: normalized?.kind || normalized?.type || "unknown",
    access: normalized?.access || normalized?.visibility || "entitled",
    signedUrl: signedUrl || null,
    url: publicUrl || null,
    signedUrlRequired: normalized?.signedUrlRequired ?? normalized?.signed_url_required ?? Boolean(assetId || hasStorageRef),
    signedUrlEndpoint: signedUrlEndpointForAsset(normalized, apiBaseUrl) || null,
    signedUrlExpiresIn: normalized?.signedUrlExpiresIn || normalized?.signed_url_expires_in || null,
    mimeType: normalized?.mimeType || normalized?.mime_type || normalized?.contentType || normalized?.content_type || null,
  };
}

export function mediaAssetFromFields(record, assetKeys = [], assetIdKeys = [], apiBaseUrl = "") {
  const asset = normalizeAssetLike(valueFromKeys(record, assetKeys));
  const explicitAssetId = firstString(...assetIdKeys.map((key) => record?.[key]));
  const mergedAsset = asset || explicitAssetId ? { ...(asset || {}), assetId: explicitAssetId || asset?.assetId || asset?.asset_id || asset?.id } : null;
  return mediaAssetMetadata(mergedAsset, apiBaseUrl);
}

function parseSignedUrlPayload(payload) {
  return firstString(
    payload?.data?.signedUrl,
    payload?.data?.signed_url,
    payload?.data?.url,
    payload?.signedUrl,
    payload?.signed_url,
    payload?.url
  );
}

async function fetchSignedUrl(endpoint) {
  if (!endpoint) return "";
  const cached = readSignedUrlCache(endpoint);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return "";
    const payload = await response.json();
    const url = parseSignedUrlPayload(payload);
    if (url) writeSignedUrlCache(endpoint, url);
    return url;
  } catch (err) {
    if (err?.name === "AbortError") {
      console.warn("[ControlSystem] Request timed out:", endpoint);
    }
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Batch-resolve signed URLs via control POST /api/media/signed-urls (P4.2).
 * Falls back to per-endpoint GET when batch is unavailable.
 */
export async function fetchSignedUrlsBatch(endpoints, apiBaseUrl = "") {
  const unique = [...new Set(endpoints.filter(Boolean))];
  const out = new Map();
  const uncached = [];

  for (const endpoint of unique) {
    const cached = readSignedUrlCache(endpoint);
    if (cached) {
      out.set(endpoint, cached);
    } else {
      uncached.push(endpoint);
    }
  }

  if (!uncached.length) return out;

  const batchUrl =
    apiBaseUrl && !isR2PublicCdnBaseUrl(apiBaseUrl)
      ? `${apiBaseUrl.replace(/\/+$/, "")}/api/media/signed-urls`
      : "/api/media/signed-urls";
  if (batchUrl) {
    const assetIds = uncached
      .map((endpoint) => {
        const match = endpoint.match(/\/api\/media\/([^/]+)\/signed-url/);
        return match?.[1] ? decodeURIComponent(match[1]) : null;
      })
      .filter(Boolean);

    if (assetIds.length === uncached.length) {
      try {
        const response = await fetch(batchUrl, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ assetIds }),
        });
        if (response.ok) {
          const payload = await response.json();
          const results = payload?.data?.results || payload?.results || [];
          for (const row of results) {
            if (!row?.assetId || !row.ok) continue;
            const endpoint = uncached.find((e) => e.includes(encodeURIComponent(row.assetId)));
            const url = row.signedUrl || row.url;
            if (endpoint && url) {
              writeSignedUrlCache(endpoint, url);
              out.set(endpoint, url);
            }
          }
        }
      } catch {
        // fall through to per-endpoint fetch
      }
    }
  }

  await Promise.all(
    uncached
      .filter((endpoint) => !out.has(endpoint))
      .map(async (endpoint) => {
        const url = await fetchSignedUrl(endpoint);
        if (url) out.set(endpoint, url);
      })
  );

  return out;
}

export async function resolveMediaAssetUrl(asset, apiBaseUrl = "", fallbackUrl = "", options = {}) {
  const normalized = mediaAssetMetadata(asset, apiBaseUrl);
  if (!normalized) return absolutizeControlSystemMediaUrl(fallbackUrl, apiBaseUrl);

  const preferPublic = options.preferPublic === true;
  const directPublic = absolutizeControlSystemMediaUrl(normalized.url, apiBaseUrl);
  if (preferPublic && (isPublicCdnUrl(directPublic) || isPublicCdnUrl(fallbackUrl))) {
    return directPublic || absolutizeControlSystemMediaUrl(fallbackUrl, apiBaseUrl);
  }

  const storagePath =
    asset?.storagePath ||
    asset?.storage_path ||
    asset?.sourcePath ||
    asset?.source_path ||
    asset?.path;
  if (preferPublic && storagePath) {
    const mapped = publicArtworkUrlFromPath(storagePath);
    if (mapped) return mapped;
  }

  const signedUrl = absolutizeControlSystemMediaUrl(normalized.signedUrl, apiBaseUrl);
  if (!preferPublic && signedUrl) return signedUrl;

  if (!preferPublic && (normalized.assetId || normalized.signedUrlEndpoint)) {
    const fetchedSignedUrl = await fetchSignedUrl(normalized.signedUrlEndpoint);
    if (fetchedSignedUrl) return absolutizeControlSystemMediaUrl(fetchedSignedUrl, apiBaseUrl);
  }

  return directPublic || absolutizeControlSystemMediaUrl(fallbackUrl, apiBaseUrl);
}

export async function resolvePublicArtworkUrl(asset, apiBaseUrl = "", fallbackUrl = "") {
  return resolveMediaAssetUrl(asset, apiBaseUrl, fallbackUrl, { preferPublic: true });
}

export async function resolveEntitledMediaAssetUrl(asset, apiBaseUrl = "") {
  const normalized = mediaAssetMetadata(asset, apiBaseUrl);
  if (!normalized) return "";

  const signedUrl = absolutizeControlSystemMediaUrl(normalized.signedUrl, apiBaseUrl);
  if (signedUrl) return signedUrl;

  if (normalized.assetId || normalized.signedUrlEndpoint) {
    const fetchedSignedUrl = await fetchSignedUrl(normalized.signedUrlEndpoint);
    if (fetchedSignedUrl) return absolutizeControlSystemMediaUrl(fetchedSignedUrl, apiBaseUrl);
  }

  return "";
}

function hasBackendFullAccess(item, track, accountState = null) {
  if (accountState) {
    return catalogItemAllowsFullPlayback(item, track, accountState);
  }

  const releaseRequiredGrant = item?.entitlement?.requiredGrant || item?.entitlement?.required_grant;
  const trackRequiredGrant = track?.entitlement?.requiredGrant || track?.entitlement?.required_grant;
  const releaseAllowsStream = item?.entitlement?.canStream === true && (!releaseRequiredGrant || releaseRequiredGrant === "none");
  const trackAllowsStream = track?.entitlement?.canStream === true && (!trackRequiredGrant || trackRequiredGrant === "none");
  const candidates = [
    item?.entitlement?.access,
    item?.entitlement?.level,
    item?.entitlement?.status,
    item?.playback?.access,
    item?.playback?.mode,
    track?.entitlement?.access,
    track?.entitlement?.level,
    track?.entitlement?.status,
    track?.playback?.access,
    track?.playback?.mode,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  return Boolean(
    item?.entitlement?.unlocked ||
      item?.entitlement?.owned ||
      item?.entitlement?.fullAccess ||
      releaseAllowsStream ||
      item?.playback?.fullAccess ||
      track?.entitlement?.unlocked ||
      track?.entitlement?.owned ||
      track?.entitlement?.fullAccess ||
      trackAllowsStream ||
      track?.playback?.fullAccess ||
      candidates.some((value) => FULL_ACCESS_VALUES.has(value))
  );
}

export function mapItemToAudioTrack(item, source = "single", accountState = null) {
  const primaryTrack = Array.isArray(item?.tracks) ? item.tracks.find((track) => typeof track === "object") || item.tracks[0] : null;
  const canUseFull = hasBackendFullAccess(item, primaryTrack, accountState);
  const fullSrc = canUseFull ? firstString(
    primaryTrack?.full,
    primaryTrack?.fullUrl,
    primaryTrack?.full_url,
    primaryTrack?.audio,
    item?.full,
    item?.fullUrl,
    item?.full_url,
    item?.audio
  ) : "";
  const src = firstString(
    fullSrc,
    primaryTrack?.preview,
    primaryTrack?.src,
    primaryTrack?.url,
    item?.preview,
    item?.src,
    item?.url
  );

  return {
    id: primaryTrack?.id || item?.slug || item?.title || src,
    slug: item?.slug || primaryTrack?.slug || item?.title || src,
    title: primaryTrack?.title || item?.title || "Untitled",
    artist: item?.artist || primaryTrack?.artist || "2MRRW",
    cover: item?.cover || item?.coverArt || item?.image || null,
    src,
    source,
    metadata: {
      price: item?.price,
      priceCents: item?.priceCents ?? item?.price_cents ?? null,
      priceLabel: item?.priceLabel || item?.price_label || null,
      productSlug: item?.productSlug || item?.product_slug || item?.slug || null,
      video: item?.video || primaryTrack?.video || null,
      controlSystemReleaseId: item?.controlSystemReleaseId || primaryTrack?.releaseId || null,
      controlSystemTrackId: primaryTrack?.id || null,
      controlSystemAssets: primaryTrack?.assets || null,
      playbackAccess: canUseFull ? "full" : "preview",
    },
  };
}

const ASSET_ID_KEYS = ["assetId", "asset_id", "id"];
const SIGNED_URL_KEYS = ["signedUrl", "signed_url", "playbackUrl", "playback_url"];
const PUBLIC_URL_KEYS = ["url", "publicUrl", "public_url", "src", "href"];
const FULL_ACCESS_VALUES = new Set(["full", "owned", "purchased", "subscribed", "subscriber", "vault", "collector", "granted", "unlocked"]);

export function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

export function absolutizeControlSystemMediaUrl(value, apiBaseUrl = "") {
  const rawUrl = firstString(value);
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith("blob:") || rawUrl.startsWith("data:")) return rawUrl;
  if (rawUrl.startsWith("/") && apiBaseUrl) return `${apiBaseUrl}${rawUrl}`;
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
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return endpoint.startsWith("/") && apiBaseUrl ? `${apiBaseUrl}${endpoint}` : "";
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
  const hasStorageRef = Boolean(normalized?.bucket || normalized?.path || normalized?.storagePath || normalized?.storage_path);
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

async function fetchSignedUrl(endpoint) {
  if (!endpoint) return "";
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return "";
    const payload = await response.json();
    return firstString(
      payload?.data?.signedUrl,
      payload?.data?.signed_url,
      payload?.data?.url,
      payload?.signedUrl,
      payload?.signed_url,
      payload?.url
    );
  } catch {
    return "";
  }
}

export async function resolveMediaAssetUrl(asset, apiBaseUrl = "", fallbackUrl = "") {
  const normalized = mediaAssetMetadata(asset, apiBaseUrl);
  if (!normalized) return absolutizeControlSystemMediaUrl(fallbackUrl, apiBaseUrl);

  const signedUrl = absolutizeControlSystemMediaUrl(normalized.signedUrl, apiBaseUrl);
  if (signedUrl) return signedUrl;

  if (normalized.assetId || normalized.signedUrlEndpoint) {
    const fetchedSignedUrl = await fetchSignedUrl(normalized.signedUrlEndpoint);
    if (fetchedSignedUrl) return absolutizeControlSystemMediaUrl(fetchedSignedUrl, apiBaseUrl);
  }

  return absolutizeControlSystemMediaUrl(normalized.url, apiBaseUrl) || absolutizeControlSystemMediaUrl(fallbackUrl, apiBaseUrl);
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

function hasBackendFullAccess(item, track) {
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

export function mapItemToAudioTrack(item, source = "single") {
  const primaryTrack = Array.isArray(item?.tracks) ? item.tracks.find((track) => typeof track === "object") || item.tracks[0] : null;
  const canUseFull = hasBackendFullAccess(item, primaryTrack);
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

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
  resolveMediaAssetUrl,
} from "./media";

const DEFAULT_VAULT_ACCENTS = {
  public: "#ff6b35",
  inner_circle: "#00ffff",
  vault_pass: "#a259ff",
};

function fallbackForContent(content, fallbackSections, index) {
  if (!Array.isArray(fallbackSections) || fallbackSections.length === 0) return {};
  const slug = String(content?.slug || content?.id || "");
  const title = String(content?.title || "");
  return fallbackSections.find((item) => item.id === slug || item.slug === slug || item.title === title) || fallbackSections[index % fallbackSections.length] || {};
}

function directMediaUrl(record, keys, apiBaseUrl) {
  return absolutizeControlSystemMediaUrl(firstString(...keys.map((key) => record?.[key])), apiBaseUrl);
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

async function resolveVaultMediaUrls(section, apiBaseUrl) {
  if (!section) return section;

  const [cover, previewUrl, mediaUrl] = await Promise.all([
    resolveMediaAssetUrl(section.coverAsset, apiBaseUrl, section.cover),
    resolveMediaAssetUrl(section.previewAsset, apiBaseUrl, section.previewUrl),
    resolveMediaAssetUrl(section.mediaAsset, apiBaseUrl, section.mediaUrl),
  ]);

  return {
    ...section,
    cover: cover || section.cover,
    previewUrl: previewUrl || section.previewUrl,
    mediaUrl: mediaUrl || section.mediaUrl,
    hasPreview: section.hasPreview || Boolean(previewUrl),
    hasMedia: section.hasMedia || Boolean(mediaUrl),
  };
}

export function mapControlSystemVaultContent(content, fallbackSection = {}, apiBaseUrl = getControlSystemApiUrl()) {
  if (!content) return null;
  const accessTier = content.accessTier || content.access_tier || fallbackSection.accessTier || "public";
  const requiredTier = content.requiredTier || content.required_tier || content.entitlement?.requiredTier || content.entitlement?.required_tier || accessTier;
  const slug = content.slug || content.id || fallbackSection.slug || fallbackSection.id;
  if (!slug || !content.title) return null;
  const coverAsset = mediaAssetFromFields(content, ["coverAsset", "cover_asset", "artworkAsset", "artwork_asset"], ["coverAssetId", "cover_asset_id", "artworkAssetId", "artwork_asset_id"], apiBaseUrl);
  const previewAsset = mediaAssetFromFields(content, ["previewAsset", "preview_asset"], ["previewAssetId", "preview_asset_id"], apiBaseUrl);
  const mediaAsset = mediaAssetFromFields(content, ["mediaAsset", "media_asset", "fullAsset", "full_asset"], ["mediaAssetId", "media_asset_id", "fullAssetId", "full_asset_id"], apiBaseUrl);
  const cover = immediateAssetUrl(coverAsset, apiBaseUrl) || directMediaUrl(content, ["cover", "coverUrl", "cover_url", "artworkUrl", "artwork_url", "image", "imageUrl", "image_url"], apiBaseUrl) || fallbackSection.cover || "";
  const previewUrl = immediateAssetUrl(previewAsset, apiBaseUrl) || directMediaUrl(content, ["previewUrl", "preview_url", "preview", "previewMediaUrl", "preview_media_url"], apiBaseUrl) || null;
  const mediaUrl = immediateAssetUrl(mediaAsset, apiBaseUrl) || directMediaUrl(content, ["mediaUrl", "media_url", "url", "src", "playbackUrl", "playback_url"], apiBaseUrl) || null;

  return {
    ...fallbackSection,
    id: slug,
    slug,
    category: content.category || fallbackSection.category || "Vault",
    title: content.title,
    desc: content.desc || content.description || content.summary || fallbackSection.desc || "",
    description: content.description || content.desc || fallbackSection.description || fallbackSection.desc || "",
    teaser: content.teaser || content.previewTeaser || content.preview_teaser || fallbackSection.teaser || "",
    atmosphere: content.atmosphere || fallbackSection.atmosphere || "",
    order: content.order ?? content.position ?? fallbackSection.order ?? null,
    accessTier,
    requiredTier,
    accessLabel: content.accessLabel || content.access_label || fallbackSection.accessLabel || null,
    locked: Boolean(content.locked ?? content.entitlement?.locked ?? !(content.unlocked ?? content.entitlement?.unlocked ?? fallbackSection.unlocked)),
    unlocked: Boolean(content.unlocked ?? content.entitlement?.unlocked ?? fallbackSection.unlocked),
    canPreview: Boolean(content.canPreview ?? content.can_preview ?? content.previewAvailable ?? content.preview_available ?? content.hasPreview ?? content.has_preview ?? true),
    entitlement: content.entitlement || null,
    feature: Boolean(content.feature ?? content.featured ?? fallbackSection.feature),
    cover,
    accent: content.accent || fallbackSection.accent || DEFAULT_VAULT_ACCENTS[accessTier] || "#00ffff",
    behavior: content.behavior || content.mediaType || content.media_type || fallbackSection.behavior || "mixed",
    mediaType: content.mediaType || content.media_type || fallbackSection.mediaType || null,
    durationSeconds: content.durationSeconds || content.duration_seconds || fallbackSection.durationSeconds || null,
    hasPreview: Boolean(content.hasPreview ?? content.has_preview ?? content.previewAvailable ?? content.preview_available ?? previewUrl),
    hasMedia: Boolean(content.hasMedia ?? content.has_media ?? content.mediaAvailable ?? content.media_available ?? mediaUrl),
    previewUrl,
    mediaUrl,
    coverAsset,
    previewAsset,
    mediaAsset,
    controlSystemVaultContentId: content.id || null,
    controlSystemVaultStatus: content.status || content.visibility || null,
  };
}

function mergeVaultWithFallback(mappedContent, fallbackSections) {
  const unique = new Map();
  [...mappedContent, ...(Array.isArray(fallbackSections) ? fallbackSections : [])].forEach((section) => {
    const key = section?.slug || section?.id || section?.title;
    if (key && !unique.has(key)) unique.set(key, section);
  });
  return [...unique.values()];
}

export async function getControlSystemVaultContent({ fallbackSections = [] } = {}) {
  const { apiBaseUrl, ok, payload } = await fetchControlSystemJson("/api/vault/content");
  if (!ok) return { sections: fallbackSections, vaultAccess: null, source: "fallback" };

  const mappedContent = extractControlSystemArray(payload, ["sections", "content", "items"])
    .filter(isPublishedControlRecord)
    .map((section, index) => mapControlSystemVaultContent(section, fallbackForContent(section, fallbackSections, index), apiBaseUrl))
    .filter(Boolean);
  const content = await Promise.all(mappedContent.map((section) => resolveVaultMediaUrls(section, apiBaseUrl)));
  const vaultAccess = extractControlSystemRecord(payload, ["vaultAccess", "access", "entitlement"]);

  if (content.length === 0) return { sections: fallbackSections, vaultAccess, source: "fallback" };
  return {
    sections: mergeVaultWithFallback(content, fallbackSections),
    vaultAccess,
    source: "control-system",
  };
}

export async function getControlSystemVaultMedia({ id, slug, mode = "media" } = {}) {
  const contentId = id || slug;
  if (!contentId) return null;
  const { ok, payload } = await fetchControlSystemJson(`/api/vault/content/${encodeURIComponent(contentId)}/media`, { params: { mode } });
  if (!ok) return null;
  return extractControlSystemRecord(payload, ["media", "content"]) || payload;
}

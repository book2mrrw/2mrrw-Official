"use client";

import { useCallback } from "react";
import { fetchControlSystemJson, extractControlSystemRecord } from "@/lib/control-system/client";
import { absolutizeControlSystemMediaUrl, firstString } from "@/lib/control-system/media";
import { getControlSystemAudioVisuals } from "@/lib/control-system/audio-visuals";
import { getControlSystemVaultContent } from "@/lib/control-system/vault";
import { useSyncEngine } from "@/hooks/sync/useSyncEngine";

const MEDIA_EVENTS = ["media.uploaded", "media.replaced"];
const HERO_EVENTS = ["hero.updated", ...MEDIA_EVENTS];
const VAULT_EVENTS = ["vault.updated", ...MEDIA_EVENTS];
const AUDIO_VISUAL_EVENTS = ["audio_visuals.updated", ...MEDIA_EVENTS];

function normalizeHeroConfig(payload, fallbackHero) {
  const record = extractControlSystemRecord(payload, ["hero", "config"]) || payload?.data || payload;
  const data = record?.data && !record?.title ? record.data : record;
  const backgroundMediaUrl = firstString(
    data?.backgroundMediaUrl,
    data?.background_media_url,
    data?.mediaUrl,
    data?.media_url,
    data?.url,
    data?.src,
    fallbackHero?.backgroundMediaUrl,
    fallbackHero?.src
  );
  const backgroundMediaType = data?.backgroundMediaType || data?.background_media_type || fallbackHero?.backgroundMediaType || fallbackHero?.type || (backgroundMediaUrl.endsWith(".mp4") ? "mp4" : "image");
  if (!backgroundMediaUrl) return fallbackHero;

  return {
    ...fallbackHero,
    title: data?.title || fallbackHero?.title || "2MRRW",
    subtitle: data?.subtitle || fallbackHero?.subtitle || "",
    ctaLabel: data?.ctaLabel || data?.cta_label || fallbackHero?.ctaLabel || "",
    ctaHref: data?.ctaHref || data?.cta_href || fallbackHero?.ctaHref || "",
    backgroundMediaUrl: absolutizeControlSystemMediaUrl(backgroundMediaUrl),
    backgroundMediaType,
    updatedAt: data?.updatedAt || data?.updated_at || fallbackHero?.updatedAt || null,
  };
}

export function useHeroMedia({ fallbackHero } = {}) {
  const fetcher = useCallback(async () => {
    const { apiBaseUrl, ok, payload } = await fetchControlSystemJson("/api/hero");
    if (!ok) return { data: fallbackHero, source: "fallback" };
    const hero = normalizeHeroConfig(payload, fallbackHero);
    return {
      data: {
        ...hero,
        backgroundMediaUrl: absolutizeControlSystemMediaUrl(hero?.backgroundMediaUrl, apiBaseUrl),
      },
      source: hero === fallbackHero ? "fallback" : "control-system",
    };
  }, [fallbackHero]);

  return useSyncEngine({
    resourceKey: "media:hero",
    fetcher,
    fallbackData: fallbackHero,
    eventTypes: HERO_EVENTS,
  });
}

export function useVaultMedia({ fallbackSections = [] } = {}) {
  const fetcher = useCallback(async () => {
    const result = await getControlSystemVaultContent({ fallbackSections });
    return { data: result.sections, source: result.source || "control-system" };
  }, [fallbackSections]);

  return useSyncEngine({
    resourceKey: "media:vault",
    fetcher,
    fallbackData: fallbackSections,
    eventTypes: VAULT_EVENTS,
  });
}

export function useAudioVisuals({ fallbackVisuals = [], limit } = {}) {
  const fetcher = useCallback(async () => ({
    data: await getControlSystemAudioVisuals({ fallbackVisuals, limit: limit ?? fallbackVisuals.length }),
    source: "control-system",
  }), [fallbackVisuals, limit]);

  return useSyncEngine({
    resourceKey: "media:audio-visuals",
    fetcher,
    fallbackData: fallbackVisuals,
    eventTypes: AUDIO_VISUAL_EVENTS,
  });
}

export function useMediaAssets(options = {}) {
  return useSyncEngine({
    resourceKey: options.resourceKey || "media:assets",
    fetcher: options.fetcher,
    fallbackData: options.fallbackData || [],
    eventTypes: options.eventTypes || MEDIA_EVENTS,
    enabled: options.enabled !== false,
  });
}

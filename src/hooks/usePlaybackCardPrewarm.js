"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  buildReleasePrewarmBundle,
  warmReleasePrewarmBundle,
} from "@/lib/playback/playback-prewarm-cache";
import { probeRedirectUrl } from "@/lib/playback/redirect-resolve-cache";

const DEFAULT_THRESHOLD = 0.15;
const DEFAULT_ROOT_MARGIN = "80px 0px";

/**
 * When a release card enters the viewport, warm playback descriptors in memory.
 * No autoplay, no audio bytes, no signed URL fetch, no entitlement consumption.
 */
export function usePlaybackCardPrewarm(
  containerRef,
  {
    releaseItem,
    playItem = null,
    catalogLookup = null,
    accountState = null,
    userId = null,
    source = "home_card",
    isAlbumCard = false,
    enabled = true,
  } = {}
) {
  const warmedRef = useRef(false);
  const configRef = useRef(null);

  configRef.current = {
    releaseItem,
    playItem,
    catalogLookup,
    accountState,
    userId,
    source,
    isAlbumCard,
  };

  useEffect(() => {
    warmedRef.current = false;
  }, [releaseItem?.slug, playItem?.slug, userId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = containerRef?.current;
    if (!el || !releaseItem) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || warmedRef.current) return;
        const cfg = configRef.current;
        if (!cfg?.releaseItem) return;
        warmedRef.current = true;
        const bundle = buildReleasePrewarmBundle(cfg.releaseItem, {
          catalogLookup: cfg.catalogLookup,
          accountState: cfg.accountState || {},
          userId: cfg.userId,
          source: cfg.source,
          playItem: cfg.playItem,
          isAlbumCard: cfg.isAlbumCard,
        });
        if (bundle) {
          warmReleasePrewarmBundle(bundle);
          // Probe the redirect URL to resolve 302 → CDN URL before the user taps.
          // Stores result in the module-level cache AudioContext reads on play.
          const { releaseSlug, urlDescriptor } = bundle;
          if (urlDescriptor?.streamPath && urlDescriptor.accessSnapshot?.canStream) {
            probeRedirectUrl(releaseSlug, urlDescriptor.streamPath);
          }
        }
      },
      { threshold: DEFAULT_THRESHOLD, rootMargin: DEFAULT_ROOT_MARGIN }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, enabled, releaseItem]);

  const warmOnInteraction = useCallback(() => {
    if (!enabled) return;
    const cfg = configRef.current;
    if (!cfg?.releaseItem) return;
    const bundle = buildReleasePrewarmBundle(cfg.releaseItem, {
      catalogLookup: cfg.catalogLookup,
      accountState: cfg.accountState || {},
      userId: cfg.userId,
      source: cfg.source,
      playItem: cfg.playItem,
      isAlbumCard: cfg.isAlbumCard,
    });
    if (bundle) {
      if (!warmedRef.current) {
        warmedRef.current = true;
        warmReleasePrewarmBundle(bundle);
      }
      // Always re-probe on interaction — covers cases where viewport probe was throttled.
      const { releaseSlug, urlDescriptor } = bundle;
      if (urlDescriptor?.streamPath && urlDescriptor.accessSnapshot?.canStream) {
        probeRedirectUrl(releaseSlug, urlDescriptor.streamPath);
      }
    }
  }, [enabled]);

  return { warmOnInteraction };
}

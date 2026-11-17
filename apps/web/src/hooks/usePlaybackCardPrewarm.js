"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  buildReleasePrewarmBundle,
  warmReleasePrewarmBundle,
} from "@/lib/playback/playback-prewarm-cache";
import {
  probeRedirectUrl,
  eagerPrimeFirstCard,
  cancelEagerPrime,
} from "@/lib/playback/redirect-resolve-cache";
import { prewarmHLS } from "@/lib/audio/HLSEngine";
import { warmHlsStart } from "@/lib/audio/hls-start-warm";
import { parseStreamSlugFromSrc, parseStreamTrackSlugFromSrc } from "@/lib/playback/stream-client";

const DEFAULT_THRESHOLD = 0.15;
const DEFAULT_ROOT_MARGIN = "80px 0px";

/**
 * Warms the HLS first-play chain (master, starting variant, key, opening
 * encrypted segment) for an entitled card, so a tap starts from memory.
 * Bounded and free of server side effects -- see hls-start-warm.js.
 */
function warmHlsStartFor(streamPath, intent) {
  const slug = parseStreamSlugFromSrc(streamPath);
  const trackSlug = parseStreamTrackSlugFromSrc(streamPath);
  if (slug) warmHlsStart(slug, trackSlug !== slug ? trackSlug : null, { intent });
}

/**
 * When a release card enters the viewport, warm playback descriptors in memory
 * and, for entitled listeners, the HLS first-play chain (warmHlsStartFor).
 * No autoplay, no stream session, no entitlement consumption.
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
    isFirstCard = false,
    enabled = true,
  } = {}
) {
  const warmedRef = useRef(false);
  const configRef = useRef(null);
  const eagerPrimeSlugRef = useRef(null);

  useLayoutEffect(() => {
    configRef.current = {
      releaseItem,
      playItem,
      catalogLookup,
      accountState,
      userId,
      source,
      isAlbumCard,
      isFirstCard,
    };
  }, [accountState, catalogLookup, isAlbumCard, isFirstCard, playItem, releaseItem, source, userId]);

  useEffect(() => {
    warmedRef.current = false;
  }, [releaseItem?.slug, playItem?.slug, userId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = containerRef?.current;
    if (!el || !releaseItem) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const cfg = configRef.current;
        if (!cfg?.releaseItem) return;

        if (!entry.isIntersecting) {
          // Card left viewport — release eager buffer if we own it.
          if (eagerPrimeSlugRef.current) {
            cancelEagerPrime(eagerPrimeSlugRef.current);
          }
          return;
        }

        if (!warmedRef.current) {
          // First intersection: warm descriptors + start probe/eager-prime.
          const bundle = buildReleasePrewarmBundle(cfg.releaseItem, {
            catalogLookup: cfg.catalogLookup,
            accountState: cfg.accountState || {},
            userId: cfg.userId,
            source: cfg.source,
            playItem: cfg.playItem,
            isAlbumCard: cfg.isAlbumCard,
          });
          if (!bundle) return;
          warmedRef.current = true;
          warmReleasePrewarmBundle(bundle);
          const { releaseSlug, urlDescriptor } = bundle;
          if (urlDescriptor?.streamPath && urlDescriptor.accessSnapshot?.canStream) {
            // Warm hls.js module now so there is no parse/compile freeze when
            // the user taps play. No-op after the first call (module is cached).
            prewarmHLS();
            warmHlsStartFor(urlDescriptor.streamPath, false);
            if (cfg.isFirstCard) {
              // First card: buffer audio bytes, not just the redirect URL.
              eagerPrimeFirstCard(releaseSlug, urlDescriptor.streamPath);
              eagerPrimeSlugRef.current = releaseSlug;
            } else {
              // Other cards: resolve redirect URL into cache (no byte buffering).
              probeRedirectUrl(releaseSlug, urlDescriptor.streamPath);
            }
          }
        } else if (cfg.isFirstCard) {
          // Card re-entered viewport after leaving — restore eager prime.
          // Descriptors are already warm; just re-buffer bytes.
          const bundle = buildReleasePrewarmBundle(cfg.releaseItem, {
            catalogLookup: cfg.catalogLookup,
            accountState: cfg.accountState || {},
            userId: cfg.userId,
            source: cfg.source,
            playItem: cfg.playItem,
            isAlbumCard: cfg.isAlbumCard,
          });
          if (bundle?.urlDescriptor?.streamPath && bundle.urlDescriptor.accessSnapshot?.canStream) {
            prewarmHLS();
            eagerPrimeFirstCard(bundle.releaseSlug, bundle.urlDescriptor.streamPath);
            eagerPrimeSlugRef.current = bundle.releaseSlug;
          }
        }
      },
      { threshold: DEFAULT_THRESHOLD, rootMargin: DEFAULT_ROOT_MARGIN }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      // Release the eager buffer when component unmounts or enabled/releaseItem changes.
      if (eagerPrimeSlugRef.current) {
        cancelEagerPrime(eagerPrimeSlugRef.current);
        eagerPrimeSlugRef.current = null;
      }
    };
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
      const { releaseSlug, urlDescriptor } = bundle;
      if (urlDescriptor?.streamPath && urlDescriptor.accessSnapshot?.canStream) {
        prewarmHLS();
        warmHlsStartFor(urlDescriptor.streamPath, true);
        if (cfg.isFirstCard) {
          // Keep the eager-prime warm on interaction (deduped internally).
          eagerPrimeFirstCard(releaseSlug, urlDescriptor.streamPath);
          eagerPrimeSlugRef.current = releaseSlug;
        } else {
          // Always re-probe on interaction — covers cases where viewport probe was throttled.
          probeRedirectUrl(releaseSlug, urlDescriptor.streamPath);
        }
      }
    }
  }, [enabled]);

  return { warmOnInteraction };
}

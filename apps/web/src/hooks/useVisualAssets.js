"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveVisualEntitlementTier } from "@/lib/media/visual-asset-schema";

const _cache = new Map(); // slug → { data, ts }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch and cache visual assets for a release.
 * Returns [] immediately if the release has no visual assets.
 *
 * @param {string|null} releaseSlug
 * @param {object} [accountState] — from AuthContext; used for entitlement filtering
 * @returns {{ assets: object[], isLoading: boolean, primaryAsset: object|null }}
 */
export function useVisualAssets(releaseSlug, accountState = null) {
  const [assets, setAssets]     = useState(() => _readCache(releaseSlug) ?? []);
  const [isLoading, setLoading] = useState(false);
  const slugRef                 = useRef(releaseSlug);

  useEffect(() => {
    slugRef.current = releaseSlug;
  }, [releaseSlug]);

  const fetch_ = useCallback(async (slug) => {
    if (!slug) return;

    const cached = _readCache(slug);
    if (cached) { setAssets(cached); return; }

    setLoading(true);
    try {
      const tier = resolveVisualEntitlementTier(accountState);
      const res  = await fetch(`/api/media/visual-assets/${encodeURIComponent(slug)}?tier=${tier}`, {
        credentials: 'include',
        cache:       'no-store',
      });
      if (!res.ok) { setAssets([]); return; }
      const { assets: rows = [] } = await res.json();
      _writeCache(slug, rows);
      if (slugRef.current === slug) setAssets(rows);
    } catch {
      setAssets([]);
    } finally {
      if (slugRef.current === slug) setLoading(false);
    }
  }, [accountState]);

  useEffect(() => {
    if (!releaseSlug) { setAssets([]); return; }
    fetch_(releaseSlug);
  }, [releaseSlug, fetch_]);

  const primaryAsset = assets.find(a => a.asset_type === 'music_video_moment')
    ?? assets.find(a => a.asset_type === 'animated_cover')
    ?? assets.find(a => a.interaction === 'hold' || a.interaction === 'hold_swipe')
    ?? assets[0]
    ?? null;

  return { assets, isLoading, primaryAsset };
}

function _readCache(slug) {
  if (!slug) return null;
  const entry = _cache.get(slug);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(slug); return null; }
  return Array.isArray(entry.data) ? entry.data : [];
}

function _writeCache(slug, data) {
  if (!slug) return;
  _cache.set(slug, { data, ts: Date.now() });
}

/** Invalidate cache for a specific slug (call after admin saves). */
export function invalidateVisualAssetsCache(slug) {
  if (slug) _cache.delete(slug);
  else _cache.clear();
}

"use client";

import { useCallback } from "react";
import {
  getControlSystemAlbums,
  getControlSystemFeatures,
  getControlSystemLatestReleases,
  getLatestControlSystemSingles,
} from "@/lib/control-system/releases";
import { useSyncEngine } from "@/hooks/sync/useSyncEngine";

const RELEASE_EVENTS = [
  "release.created",
  "release.updated",
  "release.published",
  "release.deleted",
  "media.uploaded",
  "media.replaced",
];

export function useReleases({ fallbackReleases = [], limit, type } = {}) {
  const fetcher = useCallback(async () => ({
    data: await getControlSystemLatestReleases({ fallbackReleases, limit: limit ?? fallbackReleases.length, type }),
    source: "control-system",
  }), [fallbackReleases, limit, type]);

  return useSyncEngine({
    resourceKey: type ? `releases:${type}` : "releases",
    fetcher,
    fallbackData: fallbackReleases,
    eventTypes: RELEASE_EVENTS,
  });
}

export function useSingles({ fallbackSingles = [], limit } = {}) {
  const fetcher = useCallback(async () => ({
    data: await getLatestControlSystemSingles({ fallbackSingles, limit: limit ?? fallbackSingles.length }),
    source: "control-system",
  }), [fallbackSingles, limit]);

  return useSyncEngine({
    resourceKey: "releases:singles",
    fetcher,
    fallbackData: fallbackSingles,
    eventTypes: RELEASE_EVENTS,
  });
}

export function useAlbums({ fallbackAlbums = [], limit } = {}) {
  const fetcher = useCallback(async () => ({
    data: await getControlSystemAlbums({ fallbackAlbums, limit: limit ?? fallbackAlbums.length }),
    source: "control-system",
  }), [fallbackAlbums, limit]);

  return useSyncEngine({
    resourceKey: "releases:albums",
    fetcher,
    fallbackData: fallbackAlbums,
    eventTypes: RELEASE_EVENTS,
  });
}

export function useFeatures({ fallbackFeatures = [], limit } = {}) {
  const fetcher = useCallback(async () => ({
    data: await getControlSystemFeatures({ fallbackFeatures, limit: limit ?? fallbackFeatures.length }),
    source: "control-system",
  }), [fallbackFeatures, limit]);

  return useSyncEngine({
    resourceKey: "releases:features",
    fetcher,
    fallbackData: fallbackFeatures,
    eventTypes: RELEASE_EVENTS,
  });
}

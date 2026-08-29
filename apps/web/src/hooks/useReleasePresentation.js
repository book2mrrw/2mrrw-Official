"use client";

import { useCallback, useEffect, useMemo } from "react";
import { getMediaSignature } from "@/lib/media/media-determinism";
import {
  getReleasePresentation,
  recordReleasePresentationEvent,
} from "@/lib/storefront/release-presentation-registry";

export function createReleasePresentationIdentity(item, surface, coverAssetIdentity) {
  const releaseId = String(item?.slug || item?.id || "").trim();
  const stableSurface = String(surface || "release-card");
  return {
    key: releaseId ? `${releaseId}::${stableSurface}` : "",
    releaseId,
    surface: stableSurface,
    revision: getMediaSignature(item),
    coverAssetIdentity: coverAssetIdentity || null,
  };
}

export function useReleasePresentationLifecycle({
  identity,
  entitlementIdentity,
  controlsReady = true,
}) {
  const identityKey = identity?.key;
  const releaseId = identity?.releaseId;
  const surface = identity?.surface;
  const revision = identity?.revision;
  const coverAssetIdentity = identity?.coverAssetIdentity;
  const stableIdentity = useMemo(
    () => (identityKey ? {
      key: identityKey,
      releaseId,
      surface,
      revision,
      coverAssetIdentity,
    } : null),
    [identityKey, releaseId, surface, revision, coverAssetIdentity]
  );
  useEffect(() => {
    if (!stableIdentity?.key) return undefined;
    recordReleasePresentationEvent(stableIdentity, "MOUNT");
    return () => recordReleasePresentationEvent(stableIdentity, "UNMOUNT");
  }, [stableIdentity]);

  useEffect(() => {
    if (!stableIdentity?.key) return;
    recordReleasePresentationEvent(stableIdentity, "RENDER");
    recordReleasePresentationEvent(stableIdentity, "METADATA_READY");
    recordReleasePresentationEvent(stableIdentity, "ENTITLEMENT_RESOLUTION", {
      entitlementIdentity,
    });
    if (controlsReady) {
      recordReleasePresentationEvent(stableIdentity, "CONTROLS_READY");
    }
  });
}

export function useReleaseCoverLifecycle(identity, url) {
  const coverIdentityKey = identity?.key;
  const coverReleaseId = identity?.releaseId;
  const coverSurface = identity?.surface;
  const coverRevision = identity?.revision;
  const initialCoverAssetIdentity = identity?.coverAssetIdentity;
  const stableIdentity = useMemo(
    () => (coverIdentityKey ? {
      key: coverIdentityKey,
      releaseId: coverReleaseId,
      surface: coverSurface,
      revision: coverRevision,
      coverAssetIdentity: url || initialCoverAssetIdentity,
    } : null),
    [
      coverIdentityKey,
      coverReleaseId,
      coverSurface,
      coverRevision,
      initialCoverAssetIdentity,
      url,
    ]
  );

  useEffect(() => {
    if (!stableIdentity?.key || !url) return;
    const snapshot = getReleasePresentation(stableIdentity);
    if (!snapshot?.coverReady) {
      recordReleasePresentationEvent(stableIdentity, "COVER_REQUEST", { url });
    }
  }, [stableIdentity, url]);

  const onImageLoad = useCallback(
    (event, resolvedUrl = url) => {
      if (!stableIdentity?.key) return;
      recordReleasePresentationEvent(stableIdentity, "COVER_LOAD", { url: resolvedUrl });
      const element = event?.currentTarget;
      if (typeof element?.decode === "function") {
        Promise.resolve(element.decode())
          .catch(() => {})
          .finally(() => {
            recordReleasePresentationEvent(stableIdentity, "COVER_DECODE", { url: resolvedUrl });
          });
      } else {
        recordReleasePresentationEvent(stableIdentity, "COVER_DECODE", { url: resolvedUrl });
      }
    },
    [stableIdentity, url]
  );

  const onVideoLoadedMetadata = useCallback(() => {
    if (!stableIdentity?.key) return;
    recordReleasePresentationEvent(stableIdentity, "COVER_LOAD", { url });
  }, [stableIdentity, url]);

  const onVideoLoadedData = useCallback(() => {
    if (!stableIdentity?.key) return;
    recordReleasePresentationEvent(stableIdentity, "COVER_DECODE", { url });
  }, [stableIdentity, url]);

  return { onImageLoad, onVideoLoadedMetadata, onVideoLoadedData };
}

export function entitlementPresentationIdentity({ accountState, userId, isAdmin, access }) {
  return [
    userId || "guest",
    isAdmin ? "admin" : "member",
    accountState?.subscriberActive ? "subscriber" : "standard",
    accountState?.collectorCard ? "collector" : "non-collector",
    access?.canStream ? "stream" : "no-stream",
    access?.showCart ? "cart" : "no-cart",
    access?.lifecycle?.phase || "live",
  ].join(":");
}

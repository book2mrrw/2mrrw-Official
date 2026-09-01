"use client";

import { memo, useEffect, useMemo } from "react";
import { useAuth, useEntitlementAccountState } from "@/context/AuthContext";
import { resolveSubscriptionEntitlements } from "@/lib/commerce/entitlements";
import { isAdminAccount } from "@/lib/music-access";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
} from "@/lib/diagnostics/playback-trace";

const EntitlementSurfaceIsland = memo(function EntitlementSurfaceIsland({
  children,
  islandId = "entitlement",
}) {
  const { membership, loading: authLoading } = useAuth();
  const entitlementAccountState = useEntitlementAccountState();

  const showSubscribeCta = useMemo(
    () => resolveSubscriptionEntitlements(entitlementAccountState, membership).showSubscribe,
    [entitlementAccountState, membership]
  );

  const accountStateReady = !authLoading;
  const showOwnTrackConversion =
    accountStateReady && !isAdminAccount(entitlementAccountState);

  useEffect(() => {
    if (!isPlaybackTraceEnabled()) return;
    logUiChurn("entitlement-surface-island", {
      islandId,
      showSubscribeCta,
      showOwnTrackConversion,
    });
  }, [islandId, showSubscribeCta, showOwnTrackConversion]);

  return children({
    entitlementAccountState,
    showSubscribeCta,
    showOwnTrackConversion,
    accountStateReady,
  });
});

export default EntitlementSurfaceIsland;

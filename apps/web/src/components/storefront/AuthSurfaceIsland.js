"use client";

import { memo, useCallback, useEffect, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
} from "@/lib/diagnostics/playback-trace";

const AuthSurfaceIsland = memo(function AuthSurfaceIsland({
  children,
  islandId = "auth",
  onGiftRequest,
}) {
  const {
    currentUser,
    accountState,
    isAdmin,
    sessionHydrated,
    refreshLibrary,
    refreshAccountState,
  } = useAuth();

  const isAdminStable = useMemo(
    () => Boolean(sessionHydrated && (isAdmin || accountState?.permissions?.admin)),
    [sessionHydrated, isAdmin, accountState?.permissions?.admin]
  );

  const openGiftSheet = useCallback(
    (release) => {
      if (!isAdmin) return;
      onGiftRequest?.(release);
    },
    [isAdmin, onGiftRequest]
  );

  const handleLibraryChange = useCallback(() => {
    void refreshAccountState({ reason: "library:change", source: "auth-surface-island" });
    void refreshLibrary({ reason: "library:change", source: "auth-surface-island" });
  }, [refreshAccountState, refreshLibrary]);

  useEffect(() => {
    if (!isPlaybackTraceEnabled()) return;
    logUiChurn("auth-surface-island", {
      islandId,
      userId: currentUser?.id ?? null,
      isAdminStable,
    });
  }, [islandId, currentUser?.id, isAdminStable]);

  return children({
    currentUser,
    accountState,
    isAdminStable,
    userId: currentUser?.id,
    openGiftSheet,
    handleLibraryChange,
  });
});

export default AuthSurfaceIsland;

"use client";

import { useEffect, useLayoutEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { setPageAuthRef } from "@/lib/storefront/page-auth-ref";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";

/**
 * Phase R1 — sync auth snapshot to module ref; does not wrap children (no ancestor re-render leak).
 */
export default function PageAuthRefSync() {
  const auth = useAuth();
  const {
    currentUser,
    library,
    accountState,
    membership,
    sessionHydrated,
    owns,
    signOut,
    refreshLibrary,
    refreshAccountState,
    invalidateEntitlementSnapshot,
    loading,
  } = auth;

  useLayoutEffect(() => {
    setPageAuthRef({
      currentUser,
      library,
      accountState,
      membership,
      sessionHydrated,
      owns,
      signOut,
      refreshLibrary,
      refreshAccountState,
      invalidateEntitlementSnapshot,
      loading,
    });
  });

  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    if (sessionHydrated && !loading) {
      logUiHydrationTrace("AUTH_BOOTSTRAP_COMPLETE", {
        userId: currentUser?.id ?? null,
      });
    }
  }, [sessionHydrated, loading, currentUser?.id]);

  return null;
}

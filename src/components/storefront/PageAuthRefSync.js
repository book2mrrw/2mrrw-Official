"use client";

import { useEffect, useLayoutEffect } from "react";
import { useAuth, useEntitlementAccountState } from "@/context/AuthContext";
import { setPageAuthRef } from "@/lib/storefront/page-auth-ref";
import { commitStorefrontCardChrome } from "@/lib/storefront/storefront-card-chrome-store";
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
    isAdmin,
  } = auth;
  const entitlementAccountState = useEntitlementAccountState();

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
    const isAdminStable = Boolean(
      sessionHydrated && (isAdmin || accountState?.permissions?.admin)
    );
    commitStorefrontCardChrome({
      entitlementAccountState,
      userId: currentUser?.id ?? null,
      isAdminStable,
    });
  }, [
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
    isAdmin,
    entitlementAccountState,
  ]);

  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    if (sessionHydrated && !loading) {
      logUiHydrationTrace("AUTH_BOOTSTRAP_COMPLETE", {
        userId: currentUser?.id ?? null,
      });
      logUiHydrationTrace("PROVIDER_RECONSTRUCTED", {
        provider: "AuthContext",
        phase: "bootstrap-complete",
      });
    }
  }, [sessionHydrated, loading, currentUser?.id]);

  return null;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import AuthGate from "@/components/auth/AuthGate";

const BOOT_PLACEHOLDER = (
  <div
    aria-busy="true"
    aria-label="Loading"
    style={{
      minHeight: "100vh",
      background: "#050508",
    }}
  />
);

/**
 * SSR keeps a minimal placeholder (auth useEffect does not run on server).
 * After hydration, always mount children so the cinematic shell is visible while auth resolves.
 * OTP gate overlays the shell when authStatus is unauthenticated.
 */
export default function AppAuthRoot({ children }) {
  const { authStatus, refreshAccountState } = useAuth();
  const [hydrated, setHydrated] = useState(false);
  const showAuthGate = authStatus === "unauthenticated";

  useEffect(() => {
    setHydrated(true);
  }, []);

  const handleVerified = useCallback(async () => {
    await refreshAccountState();
  }, [refreshAccountState]);

  if (!hydrated) {
    return BOOT_PLACEHOLDER;
  }

  return (
    <>
      {children}
      {showAuthGate ? (
        <AuthGate variant="root" open onVerified={handleVerified} />
      ) : null}
    </>
  );
}

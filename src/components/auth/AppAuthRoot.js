"use client";

import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { isOtpAuthenticated } from "@/context/AuthGateContext";
import AuthGate from "@/components/auth/AuthGate";

export default function AppAuthRoot({ children }) {
  const { user, loading, refreshAccountState } = useAuth();
  const authenticated = isOtpAuthenticated(user);

  const handleVerified = useCallback(async () => {
    await refreshAccountState();
  }, [refreshAccountState]);

  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading"
        style={{
          minHeight: "100vh",
          background: "#050508",
        }}
      />
    );
  }

  if (!authenticated) {
    return <AuthGate variant="root" open onVerified={handleVerified} />;
  }

  return children;
}

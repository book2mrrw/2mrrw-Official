"use client";

import { createContext, useContext, useMemo } from "react";

const AuthGateContext = createContext(null);

export function isOtpAuthenticated(user) {
  if (!user?.id) return false;
  if (user.isGuest === true) return false;
  if (user.isGuest === false) return true;
  const email = String(user?.email || "").trim().toLowerCase();
  return Boolean(email && !email.endsWith("@guest.2mrrw.local"));
}

export function AuthGateProvider({ children }) {
  const value = useMemo(
    () => ({
      open: false,
      openGate: () => {},
      requireAuth: (action) => {
        if (typeof action === "function") action();
      },
      closeGate: () => {},
      isAuthenticated: true,
    }),
    []
  );

  return <AuthGateContext.Provider value={value}>{children}</AuthGateContext.Provider>;
}

export function useAuthGate() {
  const ctx = useContext(AuthGateContext);
  if (!ctx) throw new Error("useAuthGate must be used within AuthGateProvider");
  return ctx;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "@/components/auth/AuthGate";
import { useAuth } from "@/context/AuthContext";

const AuthGateContext = createContext(null);

export function isOtpAuthenticated(user) {
  return Boolean(user?.id && user.isGuest === false);
}

export function AuthGateProvider({ children }) {
  const { user, refreshAccountState } = useAuth();
  const [open, setOpen] = useState(false);
  const pendingRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined" || isOtpAuthenticated(user)) return;
    const flag = sessionStorage.getItem("openAuthGate");
    if (!flag) return;
    sessionStorage.removeItem("openAuthGate");
    setOpen(true);
  }, [user]);

  const closeGate = useCallback(() => {
    setOpen(false);
  }, []);

  const runPending = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    if (typeof action === "function") {
      action();
    }
  }, []);

  const openGate = useCallback((action) => {
    if (isOtpAuthenticated(user)) {
      if (typeof action === "function") action();
      return;
    }
    pendingRef.current = typeof action === "function" ? action : null;
    setOpen(true);
  }, [user]);

  const requireAuth = useCallback(
    (action) => {
      openGate(action);
    },
    [openGate]
  );

  const handleVerified = useCallback(async () => {
    await refreshAccountState();
    closeGate();
    runPending();
  }, [closeGate, refreshAccountState, runPending]);

  const value = useMemo(
    () => ({
      open,
      openGate,
      requireAuth,
      closeGate,
      isAuthenticated: isOtpAuthenticated(user),
    }),
    [closeGate, open, openGate, requireAuth, user]
  );

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <AuthGate open={open} onClose={closeGate} onVerified={handleVerified} />
    </AuthGateContext.Provider>
  );
}

export function useAuthGate() {
  const ctx = useContext(AuthGateContext);
  if (!ctx) throw new Error("useAuthGate must be used within AuthGateProvider");
  return ctx;
}

"use client";

import { createContext, useContext, useMemo, useState, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import AuthGate from "@/components/auth/AuthGate";

const AuthGateContext = createContext(null);

export function isOtpAuthenticated(user) {
  if (!user?.id) return false;
  if (user.isGuest === true) return false;
  if (user.isGuest === false) return true;
  const email = String(user?.email || "").trim().toLowerCase();
  return Boolean(email && !email.endsWith("@guest.2mrrw.local"));
}

export function AuthGateProvider({ children }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const pendingActionRef = useRef(null);

  const isAuthenticated = isOtpAuthenticated(user);

  const openGate = useCallback(() => setOpen(true), []);

  const closeGate = useCallback(() => {
    setOpen(false);
    pendingActionRef.current = null;
  }, []);

  const requireAuth = useCallback(
    (action) => {
      if (isAuthenticated) {
        if (typeof action === "function") action();
      } else {
        pendingActionRef.current = typeof action === "function" ? action : null;
        setOpen(true);
      }
    },
    [isAuthenticated]
  );

  const handleVerified = useCallback(async () => {
    setOpen(false);
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    if (typeof pending === "function") {
      pending();
    }
  }, []);

  const value = useMemo(
    () => ({ open, openGate, requireAuth, closeGate, isAuthenticated }),
    [open, openGate, requireAuth, closeGate, isAuthenticated]
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

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import AuthGate from "@/components/auth/AuthGate";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";

const AUTH_ROUTE_PREFIXES = ["/login", "/join", "/verify-otp", "/forgot-password", "/reset-password", "/gift"];

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
 * OTP gate overlays the shell only after session bootstrap when unauthenticated.
 */
export default function AppAuthRoot({ children }) {
  const { authStatus, sessionHydrated } = useAuth();
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const isAuthRoute = AUTH_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname?.startsWith(`${prefix}/`)
  );
  const showAuthGate =
    sessionHydrated && authStatus === "unauthenticated" && !isAuthRoute;

  useEffect(() => {
    perfMark(MARKS.HYDRATION_START);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) perfMark(MARKS.HYDRATION_END);
  }, [hydrated]);

  return (
    <>
      {children}
      {!hydrated ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 8999,
            pointerEvents: "none",
          }}
        >
          {BOOT_PLACEHOLDER}
        </div>
      ) : null}
      {showAuthGate ? (
        <AuthGate variant="root" open />
      ) : null}
    </>
  );
}

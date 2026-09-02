"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Server-verified admin gate for /admin/* pages.
 *
 * Replaces the old per-page pattern of spinning up a throwaway browser
 * Supabase client and calling `auth.getSession()` client-side to read the
 * session cookie directly. That pattern only works when the real auth
 * cookie is readable by JavaScript — exactly the property a security
 * hardening pass wants to remove from it. /api/auth/mfa-session already
 * resolves admin status server-side against the real session; this hook is
 * a thin, shared wrapper so every admin page reads the same source of truth
 * instead of re-deriving it from a client-readable cookie.
 *
 * @param {{ redirectOnDenied?: string|null }} [options]
 *   Where to send a non-admin visitor. Pass null to handle denial yourself
 *   (render your own state) instead of an automatic redirect.
 * @returns {"loading"|"unauthenticated"|"forbidden"|"ok"}
 */
export function useAdminGate({ redirectOnDenied = "/" } = {}) {
  const router = useRouter();
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/mfa-session", { credentials: "include", cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (!body.authenticated) {
          setStatus("unauthenticated");
          if (redirectOnDenied) router.replace(redirectOnDenied);
          return;
        }
        if (!body.admin) {
          setStatus("forbidden");
          if (redirectOnDenied) router.replace(redirectOnDenied);
          return;
        }
        setStatus("ok");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("unauthenticated");
        if (redirectOnDenied) router.replace(redirectOnDenied);
      });
    return () => { cancelled = true; };
  }, [router, redirectOnDenied]);

  return status;
}

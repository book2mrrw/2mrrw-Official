"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isAdminUser } from "@/lib/auth/constants";

const EMPTY_ACCOUNT_STATE = {
  library: [],
  ownedSlugs: [],
  membership: null,
  collectorOwnerships: [],
  mediaProgress: [],
  permissions: {},
  vaultAccess: null,
};

const AuthContext = createContext(null);

export function resolveUserFromSession(session) {
  const user = session?.user;
  if (!user?.email || user.email.endsWith("@guest.2mrrw.local")) return null;
  return { user, isAdmin: isAdminUser(user) };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [library, setLibrary] = useState([]);
  const [ownedSlugs, setOwnedSlugs] = useState(new Set());
  const [accountState, setAccountState] = useState(EMPTY_ACCOUNT_STATE);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const applyAccountPayload = useCallback((data = {}) => {
    const items = data.library || data.items || [];
    const slugs = data.ownedSlugs || items.map((i) => i.slug).filter(Boolean);
    setLibrary(items);
    setOwnedSlugs(new Set(slugs));
    setAccountState({
      library: items,
      ownedSlugs: slugs,
      membership: data.membership || null,
      collectorOwnerships: data.collectorOwnerships || [],
      mediaProgress: data.mediaProgress || [],
      permissions: data.permissions || {},
      vaultAccess: data.vaultAccess || null,
      syncedAt: data.syncedAt || null,
    });
  }, []);

  const refreshLibrary = useCallback(async () => {
    const res = await fetch("/api/library", { credentials: "include" });
    if (!res.ok) {
      setLibrary([]);
      setOwnedSlugs(new Set());
      return;
    }
    const data = await res.json();
    const items = data.items || [];
    setLibrary(items);
    setOwnedSlugs(new Set(data.ownedSlugs || []));
    setAccountState((prev) => ({
      ...prev,
      library: items,
      ownedSlugs: data.ownedSlugs || [],
    }));
  }, []);

  const refreshAccountState = useCallback(async () => {
    const res = await fetch("/api/account/state", { credentials: "include", cache: "no-store" });
    if (!res.ok) {
      if (res.status === 401) {
        setUser(null);
        setIsAdmin(false);
        setLibrary([]);
        setOwnedSlugs(new Set());
        setAccountState(EMPTY_ACCOUNT_STATE);
      }
      return null;
    }
    const data = await res.json();
    if (data.user) {
      const resolved = resolveUserFromSession({ user: data.user });
      setUser(data.user);
      setIsAdmin(Boolean(data.permissions?.admin) || resolved?.isAdmin);
    }
    applyAccountPayload(data);
    return data;
  }, [applyAccountPayload]);

  const refreshGuest = useCallback(async () => {
    const res = await fetch("/api/guest/session", { credentials: "include" });
    if (!res.ok) {
      setUser(null);
      setLibrary([]);
      setOwnedSlugs(new Set());
      setAccountState(EMPTY_ACCOUNT_STATE);
      return null;
    }
    const data = await res.json();
    setUser(data.user || null);
    if (data.user) {
      setIsAdmin(isAdminUser(data.user));
      await refreshAccountState();
    } else {
      setIsAdmin(false);
      setLibrary([]);
      setOwnedSlugs(new Set());
      setAccountState(EMPTY_ACCOUNT_STATE);
    }
    return data.user || null;
  }, [refreshAccountState]);

  const applySessionUser = useCallback(
    async (session) => {
      const resolved = resolveUserFromSession(session);
      if (!resolved) return null;
      setUser(resolved.user);
      setIsAdmin(resolved.isAdmin);
      await refreshAccountState();
      return resolved.user;
    },
    [refreshAccountState]
  );

  useEffect(() => {
    let mounted = true;
    let authSubscription = null;

    const clearAuthenticatedState = () => {
      setUser(null);
      setIsAdmin(false);
      setLibrary([]);
      setOwnedSlugs(new Set());
      setAccountState(EMPTY_ACCOUNT_STATE);
    };

    (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();

        const { data: sessionData } = await supabase.auth.getSession();
        if (!mounted) return;

        const resolved = resolveUserFromSession(sessionData?.session);
        if (resolved) {
          setUser(resolved.user);
          setIsAdmin(resolved.isAdmin);
          await refreshAccountState();
        } else {
          await refreshGuest();
        }

        const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (!mounted) return;
          if (event === "SIGNED_OUT") {
            clearAuthenticatedState();
            return;
          }
          if (event === "SIGNED_IN" && session) {
            await applySessionUser(session);
          }
        });
        authSubscription = authListener?.subscription;
      } catch {
        /* session restore optional */
      }
    })().finally(() => {
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      authSubscription?.unsubscribe();
    };
  }, [applySessionUser, refreshAccountState, refreshGuest]);

  const enterGuest = useCallback(async ({ email, phone, name }) => {
    const res = await fetch("/api/guest/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, phone, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not enter");
    setUser(data.user);
    setIsAdmin(isAdminUser(data.user));
    await refreshAccountState();
    if (typeof window !== "undefined") {
      const redirect = sessionStorage.getItem("postAuthRedirect");
      if (redirect) {
        sessionStorage.removeItem("postAuthRedirect");
        window.location.href = redirect;
        return data.user;
      }
    }
    return data.user;
  }, [refreshAccountState]);

  const signOut = useCallback(async () => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    try {
      await fetch("/api/guest/session", { method: "DELETE", credentials: "include" });
    } catch {
      /* ignore */
    }
    setUser(null);
    setIsAdmin(false);
    setLibrary([]);
    setOwnedSlugs(new Set());
    setAccountState(EMPTY_ACCOUNT_STATE);
  }, []);

  const markAdmin = useCallback((nextUser) => {
    if (isAdminUser(nextUser)) setIsAdmin(true);
  }, []);

  const owns = useCallback((slug) => ownedSlugs.has(slug), [ownedSlugs]);

  const value = useMemo(() => ({
    user,
    profile: user,
    currentUser: user,
    library,
    ownedSlugs,
    accountState,
    owns,
    isAdmin,
    markAdmin,
    loading,
    enterGuest,
    signOut,
    refreshGuest,
    refreshLibrary,
    refreshAccountState,
    applySessionUser,
  }), [
    user,
    library,
    ownedSlugs,
    accountState,
    owns,
    isAdmin,
    markAdmin,
    loading,
    enterGuest,
    signOut,
    refreshGuest,
    refreshLibrary,
    refreshAccountState,
    applySessionUser,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [library, setLibrary] = useState([]);
  const [ownedSlugs, setOwnedSlugs] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const refreshLibrary = useCallback(async () => {
    const res = await fetch("/api/library", { credentials: "include" });
    if (!res.ok) {
      setLibrary([]);
      setOwnedSlugs(new Set());
      return;
    }
    const data = await res.json();
    setLibrary(data.items || []);
    setOwnedSlugs(new Set(data.ownedSlugs || []));
  }, []);

  const refreshGuest = useCallback(async () => {
    const res = await fetch("/api/guest/session", { credentials: "include" });
    if (!res.ok) {
      setUser(null);
      setLibrary([]);
      setOwnedSlugs(new Set());
      return null;
    }
    const data = await res.json();
    setUser(data.user || null);
    if (data.user) await refreshLibrary();
    return data.user || null;
  }, [refreshLibrary]);

  useEffect(() => {
    let mounted = true;
    refreshGuest().finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [refreshGuest]);

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
    await refreshLibrary();
    return data.user;
  }, [refreshLibrary]);

  const signOut = useCallback(async () => {
    await fetch("/api/guest/session", { method: "DELETE", credentials: "include" });
    setUser(null);
    setLibrary([]);
    setOwnedSlugs(new Set());
  }, []);

  const owns = useCallback((slug) => ownedSlugs.has(slug), [ownedSlugs]);

  const value = useMemo(() => ({
    user,
    profile: user,
    currentUser: user,
    library,
    ownedSlugs,
    owns,
    loading,
    enterGuest,
    signOut,
    refreshGuest,
    refreshLibrary,
  }), [user, library, ownedSlugs, owns, loading, enterGuest, signOut, refreshGuest, refreshLibrary]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

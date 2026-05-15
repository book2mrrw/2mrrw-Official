"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ownedSlugs, setOwnedSlugs] = useState(new Set());
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);

  const mapUser = useCallback((authUser, prof) => {
    if (!authUser) return null;
    return {
      id: authUser.id,
      email: authUser.email || prof?.email || "",
      name: prof?.full_name || authUser.user_metadata?.full_name || "Fan",
      phone: prof?.phone || authUser.user_metadata?.phone || "",
    };
  }, []);

  const refreshLibrary = useCallback(async () => {
    const res = await fetch("/api/library", { credentials: "include" });
    if (!res.ok) {
      setLibrary([]);
      setOwnedSlugs(new Set());
      return;
    }
    const data = await res.json();
    setLibrary(data.items || []);
    setOwnedSlugs(new Set((data.ownedSlugs || [])));
  }, []);

  const refreshProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
    setProfile(data || null);
  }, [supabase]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        await refreshProfile(u);
        await refreshLibrary();
      }
      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        await refreshProfile(u);
        await refreshLibrary();
      } else {
        setProfile(null);
        setLibrary([]);
        setOwnedSlugs(new Set());
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, refreshProfile, refreshLibrary]);

  const signUp = useCallback(async ({ email, password, fullName, phone }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone: phone || null },
      },
    });
    if (error) throw error;
    if (data.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id,
        full_name: fullName,
        email,
        phone: phone || null,
      });
    }
    return data;
  }, [supabase]);

  const signIn = useCallback(async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, [supabase]);

  const signInWithPhone = useCallback(async (phone) => {
    const { data, error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw error;
    return data;
  }, [supabase]);

  const verifyPhoneOtp = useCallback(async ({ phone, token }) => {
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: "sms",
    });
    if (error) throw error;
    return data;
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setLibrary([]);
    setOwnedSlugs(new Set());
  }, [supabase]);

  const owns = useCallback((slug) => ownedSlugs.has(slug), [ownedSlugs]);

  const value = useMemo(() => ({
    user,
    profile,
    currentUser: mapUser(user, profile),
    library,
    ownedSlugs,
    owns,
    loading,
    signUp,
    signIn,
    signInWithPhone,
    verifyPhoneOtp,
    signOut,
    refreshLibrary,
    supabase,
  }), [user, profile, mapUser, library, ownedSlugs, owns, loading, signUp, signIn, signInWithPhone, verifyPhoneOtp, signOut, refreshLibrary, supabase]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

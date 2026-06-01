"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { bootstrapSession, signOut as authSignOut, subscribeAuthState } from "@/auth/authService";
import { isAdminUser } from "@/lib/auth/constants";

const EMPTY_ACCOUNT_STATE = {
  library: [],
  ownedSlugs: [],
  subscriberActive: false,
  collectorCard: false,
  vaultAccess: false,
  membership: null,
  collectorOwnerships: [],
  mediaProgress: [],
  permissions: {},
  vaultAccessDetail: null,
  user: null,
  isAdmin: false,
};

const noop = () => {};
const noopAsync = async () => null;

/** Safe pre-provider / SSR default — never treat as authenticated entitlements. */
export const DEFAULT_AUTH_CONTEXT = {
  user: null,
  profile: null,
  currentUser: null,
  library: [],
  ownedSlugs: new Set(),
  accountState: EMPTY_ACCOUNT_STATE,
  membership: null,
  owns: () => false,
  isAdmin: false,
  markAdmin: noop,
  loading: true,
  authStatus: "loading",
  enterGuest: noopAsync,
  signOut: noopAsync,
  refreshGuest: noopAsync,
  refreshLibrary: noopAsync,
  refreshAccountState: noopAsync,
  applySessionUser: noopAsync,
};

const AuthContext = createContext(DEFAULT_AUTH_CONTEXT);

async function clearGuestSessionCookie() {
  try {
    await fetch("/api/guest/session", { method: "DELETE", credentials: "include" });
  } catch {
    /* optional */
  }
}

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

  const sessionBootstrappedRef = useRef(false);
  const accountStateFetchingRef = useRef(false);
  const signedInUserIdRef = useRef(null);
  const applySessionUserRef = useRef(null);
  const refreshAccountStateRef = useRef(null);
  const refreshGuestRef = useRef(null);

  const applyAccountPayload = useCallback((data = {}) => {
    const items = data.library || data.items || [];
    const slugs = data.ownedSlugs || items.map((i) => i.slug).filter(Boolean);
    setLibrary(items);
    setOwnedSlugs(new Set(slugs));
    const vaultDetail =
      data.vaultAccessDetail ||
      (typeof data.vaultAccess === "object" && data.vaultAccess !== null ? data.vaultAccess : null);
    const serverIsGuest = Boolean(data.user?.isGuest);
    const adminFromServer =
      Boolean(data.permissions?.admin) ||
      (data.user && !serverIsGuest ? isAdminUser(data.user) : false);

    setAccountState((prev) => {
      const isAdminFlag = adminFromServer || (serverIsGuest && prev.isAdmin ? prev.isAdmin : false);
      const permissions = { ...(data.permissions || {}) };
      if (isAdminFlag) permissions.admin = true;

      return {
        library: items,
        ownedSlugs: slugs,
        subscriberActive: Boolean(data.subscriberActive),
        collectorCard: Boolean(data.collectorCard),
        vaultAccess: Boolean(
          typeof data.vaultAccess === "boolean" ? data.vaultAccess : vaultDetail?.fullAccess || vaultDetail?.hasVaultPass
        ),
        membership: data.membership || null,
        collectorOwnerships: data.collectorOwnerships || [],
        mediaProgress: data.mediaProgress || [],
        permissions,
        vaultAccessDetail: vaultDetail,
        userEntitlements: data.userEntitlements || null,
        user: serverIsGuest && prev.user && !prev.user.isGuest ? prev.user : data.user || null,
        isAdmin: isAdminFlag,
        syncedAt: data.syncedAt || null,
      };
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
    if (accountStateFetchingRef.current) return null;
    accountStateFetchingRef.current = true;

    try {
      const res = await fetch("/api/account/state", {
        credentials: "include",
        cache: "no-store",
      });
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
        const serverIsGuest = Boolean(data.user.isGuest);
        const adminFromServer = Boolean(data.permissions?.admin) || Boolean(resolved?.isAdmin);

        if (serverIsGuest) {
          setUser((prev) => (prev && !prev.isGuest ? prev : data.user));
          setIsAdmin((prev) => (prev && !adminFromServer ? prev : adminFromServer));
        } else {
          setUser((prev) => (prev?.id === data.user.id ? prev : data.user));
          setIsAdmin(adminFromServer);
        }
      }
      applyAccountPayload(data);
      return data;
    } catch (err) {
      console.error("[account/state] fetch failed:", err);
      return null;
    } finally {
      accountStateFetchingRef.current = false;
    }
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
      signedInUserIdRef.current = resolved.user.id;
      setUser(resolved.user);
      setIsAdmin(resolved.isAdmin);
      await clearGuestSessionCookie();
      await refreshAccountState();
      return resolved.user;
    },
    [refreshAccountState]
  );


  applySessionUserRef.current = applySessionUser;
  refreshAccountStateRef.current = refreshAccountState;
  refreshGuestRef.current = refreshGuest;

  useEffect(() => {
    let mounted = true;

    const clearAuthenticatedState = () => {
      signedInUserIdRef.current = null;
      setUser(null);
      setIsAdmin(false);
      setLibrary([]);
      setOwnedSlugs(new Set());
      setAccountState(EMPTY_ACCOUNT_STATE);
    };

    // Bootstrap once per provider lifetime; authService.bootstrapSession is module-singleton.
    if (!sessionBootstrappedRef.current) {
      sessionBootstrappedRef.current = true;
      (async () => {
        try {
          const { session: resolvedSession } = await bootstrapSession();
          if (!mounted) return;

          // SAFETY: user state only from Supabase session (authService) — never device-trust localStorage.
          const resolved = resolveUserFromSession(resolvedSession);
          if (resolved) {
            signedInUserIdRef.current = resolved.user.id;
            setUser(resolved.user);
            setIsAdmin(resolved.isAdmin);
            await clearGuestSessionCookie();
            await refreshAccountStateRef.current?.();
          } else {
            signedInUserIdRef.current = null;
            await refreshGuestRef.current?.();
          }
        } catch {
          /* session restore optional */
        }
      })().finally(() => {
        if (mounted) setLoading(false);
      });
    } else if (mounted) {
      // Strict Mode remount: bootstrap already ran; restore loading gate without re-fetch storm.
      setLoading(false);
    }

    // Always subscribe — Strict Mode cleanup must not leave the app without auth listeners.
    const unsubscribe = subscribeAuthState(async (event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        clearAuthenticatedState();
        return;
      }
      // Silent reauth: background token refresh must not flash login or re-fetch entitlements.
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        return;
      }
      if (event === "SIGNED_IN" && session) {
        const nextResolved = resolveUserFromSession(session);
        if (!nextResolved) return;
        if (signedInUserIdRef.current === nextResolved.user.id) return;
        await applySessionUserRef.current?.(session);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

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
      await authSignOut();
    } catch {
      /* ignore */
    }
    try {
      await fetch("/api/guest/session", { method: "DELETE", credentials: "include" });
    } catch {
      /* ignore */
    }
    signedInUserIdRef.current = null;
    setUser(null);
    setIsAdmin(false);
    setLibrary([]);
    setOwnedSlugs(new Set());
    setAccountState(EMPTY_ACCOUNT_STATE);
  }, []);

  const markAdmin = useCallback((nextUser) => {
    if (isAdminUser(nextUser)) setIsAdmin(true);
  }, []);

  const userId = user?.id ?? null;
  const membership = accountState?.membership ?? null;

  useEffect(() => {
    if (!isAdmin && !userId) return;
    setAccountState((prev) => {
      const adminFlag = isAdmin || (user ? isAdminUser(user) : false);
      if (
        prev.isAdmin === adminFlag &&
        prev.permissions?.admin === adminFlag &&
        (prev.user?.id ?? null) === userId
      ) {
        return prev;
      }
      return {
        ...prev,
        user: user || prev.user,
        isAdmin: adminFlag,
        permissions: { ...(prev.permissions || {}), admin: adminFlag || prev.permissions?.admin },
      };
    });
  }, [isAdmin, userId, user]);

  const owns = useCallback((slug) => ownedSlugs.has(slug), [ownedSlugs]);

  const authStatus = useMemo(() => {
    if (loading) return "loading";
    if (!user?.id) return "unauthenticated";
    if (user.isGuest === true) return "unauthenticated";
    if (user.isGuest === false) return "authenticated";
    const email = String(user?.email || "").trim().toLowerCase();
    return email && !email.endsWith("@guest.2mrrw.local") ? "authenticated" : "unauthenticated";
  }, [loading, user]);

  const value = useMemo(() => ({
    user,
    profile: user,
    currentUser: user,
    library,
    ownedSlugs,
    accountState,
    membership,
    owns,
    isAdmin,
    markAdmin,
    loading,
    authStatus,
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
    membership,
    owns,
    isAdmin,
    markAdmin,
    loading,
    authStatus,
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

/** Empty entitlements while session bootstrap runs — avoids stale guest/partial state. */
export function useEntitlementAccountState() {
  const { accountState, loading } = useAuth();
  return useMemo(
    () => (loading ? EMPTY_ACCOUNT_STATE : accountState),
    [loading, accountState]
  );
}

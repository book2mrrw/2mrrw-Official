"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { bootstrapSession, signOut as authSignOut, subscribeAuthState } from "@/auth/authService";
import { isAdminUser } from "@/lib/auth/constants";
import {
  accountStateShallowEqual,
  libraryItemsShallowEqual,
  ownedSlugsArraysEqual,
  slugSetsEqual,
} from "@/lib/auth/state-equality";
import {
  buildEntitlementSnapshot,
  ENTITLEMENT_REFRESH_DEBOUNCE_MS,
  ENTITLEMENT_RENDER_LOOP_MS,
  normalizeRefreshReason,
  snapshotToAccountPayload,
} from "@/lib/auth/entitlement-refresh-gating";
import { logEntitlementRefreshBlocked, logStateChurn } from "@/lib/diagnostics/state-churn-log";

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

/** Immutable empty snapshot for SSR / pre-provider — not authenticated entitlements. */
export const EMPTY_ENTITLEMENT_SNAPSHOT = Object.freeze({
  userId: null,
  subscriberActive: false,
  collectorCard: false,
  ownedSlugs: [],
  permissions: {},
  vaultAccess: false,
  lastUpdated: 0,
  version: 0,
});

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
  sessionHydrated: false,
  authStatus: "checking",
  enterGuest: noopAsync,
  signOut: noopAsync,
  refreshGuest: noopAsync,
  refreshLibrary: noopAsync,
  refreshAccountState: noopAsync,
  applySessionUser: noopAsync,
  getEntitlementSnapshot: () => EMPTY_ENTITLEMENT_SNAPSHOT,
  invalidateEntitlementSnapshot: noop,
  entitlementSnapshotVersion: 0,
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
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [entitlementSnapshotVersion, setEntitlementSnapshotVersion] = useState(0);

  const sessionBootstrappedRef = useRef(false);
  const accountStateFetchingRef = useRef(false);
  const accountStateInFlightRef = useRef(null);
  const signedInUserIdRef = useRef(null);
  const applySessionUserRef = useRef(null);
  const refreshAccountStateRef = useRef(null);
  const refreshGuestRef = useRef(null);
  const accountStateRef = useRef(EMPTY_ACCOUNT_STATE);

  const entitlementSnapshotRef = useRef(null);
  const lastRefreshReasonRef = useRef({ reason: null, at: 0 });

  useEffect(() => {
    accountStateRef.current = accountState;
  }, [accountState]);

  const applyAccountPayload = useCallback((data = {}) => {
    const items = data.library || data.items || [];
    const slugs = data.ownedSlugs || items.map((i) => i.slug).filter(Boolean);
    const nextOwned = new Set(slugs);

    setLibrary((prev) => (libraryItemsShallowEqual(prev, items) ? prev : items));
    setOwnedSlugs((prev) => (slugSetsEqual(prev, nextOwned) ? prev : nextOwned));

    const vaultDetail =
      data.vaultAccessDetail ||
      (typeof data.vaultAccess === "object" && data.vaultAccess !== null ? data.vaultAccess : null);
    const serverIsGuest = Boolean(data.user?.isGuest);
    const adminFromServer =
      Boolean(data.permissions?.admin) ||
      (data.user && !serverIsGuest ? isAdminUser(data.user) : false);

    setAccountState((prev) => {
      const isAdminFlag = serverIsGuest ? false : adminFromServer;
      const permissions = { ...(data.permissions || {}) };
      if (isAdminFlag) permissions.admin = true;

      const next = {
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
      return accountStateShallowEqual(prev, next) ? prev : next;
    });
  }, []);

  const commitEntitlementSnapshot = useCallback((data, userId) => {
    const prev = entitlementSnapshotRef.current;
    const prevVersion = prev?.version ?? 0;
    const next = buildEntitlementSnapshot(data, userId, prevVersion);
    if (
      prev &&
      prev.userId === next.userId &&
      prev.subscriberActive === next.subscriberActive &&
      prev.collectorCard === next.collectorCard &&
      prev.vaultAccess === next.vaultAccess &&
      ownedSlugsArraysEqual(prev.ownedSlugs, next.ownedSlugs) &&
      JSON.stringify(prev.permissions || {}) === JSON.stringify(next.permissions || {})
    ) {
      return;
    }
    entitlementSnapshotRef.current = next;
    setEntitlementSnapshotVersion(next.version);
  }, []);

  const getEntitlementSnapshot = useCallback(() => {
    const snap = entitlementSnapshotRef.current;
    if (!snap) return EMPTY_ENTITLEMENT_SNAPSHOT;
    return {
      ...snap,
      ownedSlugs: [...(snap.ownedSlugs || [])],
      permissions: { ...(snap.permissions || {}) },
    };
  }, []);

  const invalidateEntitlementSnapshot = useCallback((reason = "manual") => {
    logStateChurn("invalidateEntitlementSnapshot", {
      source: "AuthContext",
      reason: reason || "manual",
    });
    if (entitlementSnapshotRef.current) {
      entitlementSnapshotRef.current = {
        ...entitlementSnapshotRef.current,
        lastUpdated: 0,
      };
    }
    lastRefreshReasonRef.current = { reason: null, at: 0 };
  }, []);

  const clearEntitlementSnapshot = useCallback(() => {
    entitlementSnapshotRef.current = null;
    lastRefreshReasonRef.current = { reason: null, at: 0 };
    setEntitlementSnapshotVersion(0);
  }, []);

  const refreshLibrary = useCallback(async (meta = {}) => {
    logStateChurn("refreshLibrary", {
      source: meta.source || "AuthContext",
      reason: meta.reason || "invoke",
    });
    const res = await fetch("/api/library", { credentials: "include" });
    if (!res.ok) {
      setLibrary((prev) => (prev.length === 0 ? prev : []));
      setOwnedSlugs((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const data = await res.json();
    const items = data.items || [];
    const nextSlugs = data.ownedSlugs || [];
    const nextOwned = new Set(nextSlugs);

    setLibrary((prev) => (libraryItemsShallowEqual(prev, items) ? prev : items));
    setOwnedSlugs((prev) => (slugSetsEqual(prev, nextOwned) ? prev : nextOwned));
    setAccountState((prev) => {
      const next = {
        ...prev,
        library: items,
        ownedSlugs: nextSlugs,
      };
      return accountStateShallowEqual(prev, next) ? prev : next;
    });
  }, []);

  const evaluateRefreshGate = useCallback((meta = {}) => {
    const source = meta.source || "AuthContext";
    const force = Boolean(meta.force);
    const canonicalReason = normalizeRefreshReason(meta);

    if (!canonicalReason) {
      return {
        blocked: true,
        blockReason: "reason-not-allowlisted",
        canonicalReason: null,
        source,
      };
    }

    if (force) {
      return { blocked: false, blockReason: null, canonicalReason, source };
    }

    const now = Date.now();
    const snap = entitlementSnapshotRef.current;
    if (snap?.lastUpdated && now - snap.lastUpdated < ENTITLEMENT_REFRESH_DEBOUNCE_MS) {
      return {
        blocked: true,
        blockReason: "debounce-10s",
        canonicalReason,
        source,
      };
    }

    const last = lastRefreshReasonRef.current;
    if (
      last.reason === canonicalReason &&
      now - last.at < ENTITLEMENT_RENDER_LOOP_MS
    ) {
      return {
        blocked: true,
        blockReason: "render-loop",
        canonicalReason,
        source,
      };
    }

    return { blocked: false, blockReason: null, canonicalReason, source };
  }, []);

  const refreshAccountState = useCallback(
    async (options = {}) => {
      const meta =
        options && typeof options === "object"
          ? options
          : { reason: typeof options === "string" ? options : undefined };

      const gate = evaluateRefreshGate(meta);
      const logReason = gate.canonicalReason || meta.reason || "invoke";

      logStateChurn("refreshAccountState", {
        source: meta.source || "AuthContext",
        reason: logReason,
        force: Boolean(meta.force),
        blocked: gate.blocked,
        blockReason: gate.blockReason,
      });

      if (gate.blocked) {
        logEntitlementRefreshBlocked({
          source: gate.source,
          reason: logReason,
          blockReason: gate.blockReason,
        });
        return snapshotToAccountPayload(entitlementSnapshotRef.current, accountStateRef.current);
      }

      if (accountStateInFlightRef.current) {
        logEntitlementRefreshBlocked({
          source: meta.source || "AuthContext",
          reason: logReason,
          blockReason: "duplicate-in-flight",
        });
        return accountStateInFlightRef.current;
      }

      lastRefreshReasonRef.current = {
        reason: gate.canonicalReason,
        at: Date.now(),
      };

      accountStateFetchingRef.current = true;

      const fetchPromise = (async () => {
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
              clearEntitlementSnapshot();
            }
            return snapshotToAccountPayload(entitlementSnapshotRef.current, accountStateRef.current);
          }
          const data = await res.json();
          if (data.user) {
            const resolved = resolveUserFromSession({ user: data.user });
            const serverIsGuest = Boolean(data.user.isGuest);
            const adminFromServer = Boolean(data.permissions?.admin) || Boolean(resolved?.isAdmin);

            if (serverIsGuest) {
              setUser((prev) => (prev && !prev.isGuest ? prev : data.user));
              setIsAdmin((prev) => (prev === adminFromServer ? prev : adminFromServer));
            } else {
              setUser((prev) => (prev?.id === data.user.id ? prev : data.user));
              setIsAdmin((prev) => (prev === adminFromServer ? prev : adminFromServer));
            }
          }
          applyAccountPayload(data);
          commitEntitlementSnapshot(data, data.user?.id ?? signedInUserIdRef.current);
          return data;
        } catch (err) {
          console.error("[account/state] fetch failed:", err);
          return snapshotToAccountPayload(entitlementSnapshotRef.current, accountStateRef.current);
        } finally {
          accountStateFetchingRef.current = false;
          accountStateInFlightRef.current = null;
        }
      })();

      accountStateInFlightRef.current = fetchPromise;
      return fetchPromise;
    },
    [applyAccountPayload, clearEntitlementSnapshot, commitEntitlementSnapshot, evaluateRefreshGate]
  );

  const refreshGuest = useCallback(async () => {
    const res = await fetch("/api/guest/session", { credentials: "include" });
    if (!res.ok) {
      setUser(null);
      setLibrary([]);
      setOwnedSlugs(new Set());
      setAccountState(EMPTY_ACCOUNT_STATE);
      clearEntitlementSnapshot();
      return null;
    }
    const data = await res.json();
    setUser(data.user || null);
    if (data.user) {
      setIsAdmin(false);
      await refreshAccountState({ reason: "auth:bootstrap", source: "AuthContext:refreshGuest" });
    } else {
      setIsAdmin(false);
      setLibrary([]);
      setOwnedSlugs(new Set());
      setAccountState(EMPTY_ACCOUNT_STATE);
      clearEntitlementSnapshot();
    }
    return data.user || null;
  }, [clearEntitlementSnapshot, refreshAccountState]);

  const applySessionUser = useCallback(
    async (session) => {
      const resolved = resolveUserFromSession(session);
      if (!resolved) return null;
      signedInUserIdRef.current = resolved.user.id;
      setUser(resolved.user);
      setIsAdmin(resolved.isAdmin);
      await clearGuestSessionCookie();
      invalidateEntitlementSnapshot("auth:login");
      await refreshAccountState({
        reason: "auth:login",
        source: "AuthContext:applySessionUser",
        force: true,
      });
      return resolved.user;
    },
    [invalidateEntitlementSnapshot, refreshAccountState]
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
      clearEntitlementSnapshot();
    };

    if (!sessionBootstrappedRef.current) {
      sessionBootstrappedRef.current = true;
      (async () => {
        try {
          const { session: resolvedSession } = await bootstrapSession();
          if (!mounted) return;

          const resolved = resolveUserFromSession(resolvedSession);
          if (resolved) {
            signedInUserIdRef.current = resolved.user.id;
            await clearGuestSessionCookie();
            invalidateEntitlementSnapshot("auth:bootstrap");
            const accountData = await refreshAccountStateRef.current?.({
              reason: "auth:bootstrap",
              source: "AuthContext:bootstrap",
              force: true,
            });
            if (!mounted) return;
            const verifiedUser = accountData?.user;
            const verifiedResolved = verifiedUser
              ? resolveUserFromSession({ user: verifiedUser })
              : null;
            if (verifiedResolved) {
              setUser(verifiedResolved.user);
              setIsAdmin(verifiedResolved.isAdmin);
            } else {
              signedInUserIdRef.current = null;
              clearAuthenticatedState();
            }
          } else {
            signedInUserIdRef.current = null;
            await refreshGuestRef.current?.();
          }
        } catch {
          /* session restore optional */
        }
      })().finally(() => {
        if (mounted) {
          setSessionHydrated(true);
          setLoading(false);
        }
      });
    } else if (mounted) {
      setSessionHydrated(true);
      setLoading(false);
    }

    const unsubscribe = subscribeAuthState(async (event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        clearAuthenticatedState();
        return;
      }
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
  }, [clearEntitlementSnapshot, invalidateEntitlementSnapshot]);

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
    invalidateEntitlementSnapshot("auth:login");
    await refreshAccountState({
      reason: "auth:login",
      source: "AuthContext:enterGuest",
      force: true,
    });
    if (typeof window !== "undefined") {
      const redirect = sessionStorage.getItem("postAuthRedirect");
      if (redirect) {
        sessionStorage.removeItem("postAuthRedirect");
        window.location.href = redirect;
        return data.user;
      }
    }
    return data.user;
  }, [invalidateEntitlementSnapshot, refreshAccountState]);

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
    clearEntitlementSnapshot();
  }, [clearEntitlementSnapshot]);

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
    if (!sessionHydrated) return "checking";
    if (!user?.id) return "unauthenticated";
    if (user.isGuest === true) return "unauthenticated";
    if (user.isGuest === false) return "authenticated";
    const email = String(user?.email || "").trim().toLowerCase();
    return email && !email.endsWith("@guest.2mrrw.local") ? "authenticated" : "unauthenticated";
  }, [sessionHydrated, user]);

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
    sessionHydrated,
    authStatus,
    enterGuest,
    signOut,
    refreshGuest,
    refreshLibrary,
    refreshAccountState,
    applySessionUser,
    getEntitlementSnapshot,
    invalidateEntitlementSnapshot,
    entitlementSnapshotVersion,
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
    sessionHydrated,
    authStatus,
    enterGuest,
    signOut,
    refreshGuest,
    refreshLibrary,
    refreshAccountState,
    applySessionUser,
    getEntitlementSnapshot,
    invalidateEntitlementSnapshot,
    entitlementSnapshotVersion,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

function mergeSnapshotIntoAccountState(accountState, snapshot) {
  if (!snapshot) return accountState;
  const next = {
    ...accountState,
    ownedSlugs: snapshot.ownedSlugs,
    subscriberActive: snapshot.subscriberActive,
    collectorCard: snapshot.collectorCard,
    vaultAccess: snapshot.vaultAccess,
    permissions: { ...snapshot.permissions },
  };
  return accountStateShallowEqual(accountState, next) ? accountState : next;
}

/** Empty entitlements while session bootstrap runs — avoids stale guest/partial state. */
export function useEntitlementAccountState() {
  const { accountState, sessionHydrated, getEntitlementSnapshot, entitlementSnapshotVersion } = useAuth();
  return useMemo(() => {
    if (!sessionHydrated) return EMPTY_ACCOUNT_STATE;
    const base = accountState ?? EMPTY_ACCOUNT_STATE;
    const snapshot = getEntitlementSnapshot?.();
    if (!snapshot || snapshot.version < 1) return base;
    return mergeSnapshotIntoAccountState(base, snapshot);
  }, [sessionHydrated, accountState, getEntitlementSnapshot, entitlementSnapshotVersion]);
}

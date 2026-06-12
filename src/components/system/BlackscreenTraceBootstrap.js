"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  initBlackscreenTrace,
  isBlackscreenTraceEnabled,
  logBlackscreenAuth,
  logBlackscreenMount,
  logBlackscreenNav,
  logBlackscreenUnmount,
  logBlackscreenPlayback,
} from "@/lib/diagnostics/blackscreen-trace";
import { registerBlackscreenPlaybackCorrelation } from "@/lib/diagnostics/playback-trace";

export default function BlackscreenTraceBootstrap() {
  const pathname = usePathname();
  const { user, loading, authStatus, entitlementSnapshotVersion } = useAuth();
  const prevRouteRef = useRef(null);
  const prevAuthRef = useRef(null);

  useEffect(() => {
    if (!isBlackscreenTraceEnabled()) return undefined;
    logBlackscreenMount("RootLayout");
    const getRoute = () => {
      if (typeof window === "undefined") return "";
      const { pathname: p, search } = window.location;
      return `${p}${search}`;
    };
    const teardown = initBlackscreenTrace({ getRoute });
    registerBlackscreenPlaybackCorrelation((payload) => {
      logBlackscreenPlayback(payload.commandType ?? payload.type, payload);
    });
    return () => {
      registerBlackscreenPlaybackCorrelation(null);
      logBlackscreenUnmount("RootLayout");
      teardown?.();
    };
  }, [pathname]);

  useEffect(() => {
    if (!isBlackscreenTraceEnabled()) return;
    const search =
      typeof window !== "undefined" && window.location.search ? window.location.search : "";
    const route = `${pathname || ""}${search}`;
    const prev = prevRouteRef.current;
    if (prev !== null && prev !== route) {
      logBlackscreenNav({
        previousRoute: prev,
        newRoute: route,
        trigger: "next-pathname",
      });
    }
    prevRouteRef.current = route;
  }, [pathname]);

  useEffect(() => {
    if (!isBlackscreenTraceEnabled()) return;
    const snapshot = {
      userId: user?.id ?? null,
      loading,
      authStatus,
      entitlementSnapshotVersion,
    };
    const prev = prevAuthRef.current;
    if (prev === null) {
      logBlackscreenAuth("auth:initial", { reason: "bootstrap", ...snapshot });
    } else if (
      prev.userId !== snapshot.userId ||
      prev.loading !== snapshot.loading ||
      prev.authStatus !== snapshot.authStatus ||
      prev.entitlementSnapshotVersion !== snapshot.entitlementSnapshotVersion
    ) {
      let reason = "state-change";
      if (prev.loading && !snapshot.loading) reason = "bootstrap-complete";
      if (prev.entitlementSnapshotVersion !== snapshot.entitlementSnapshotVersion) {
        reason = "entitlement-snapshot";
      }
      if (prev.userId !== snapshot.userId) reason = "session-change";
      logBlackscreenAuth("auth:update", { reason, ...snapshot, previous: prev });
    }
    prevAuthRef.current = snapshot;
  }, [user?.id, loading, authStatus, entitlementSnapshotVersion]);

  return null;
}

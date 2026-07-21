"use client";

import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { parseDeepLink, consumePendingDeepLink, setPostAuthRedirect } from "@/lib/deep-links";
import HelpSupportSection from "@/components/support/HelpSupportSection";

function resolveUserStatus(currentUser, myPurchases, circleSubmissions, accountCircleByline) {
  if (!currentUser) return null;
  const hasCollector = myPurchases.some((p) => p.slug?.startsWith("exc-card"));
  const hasBundle = myPurchases.some((p) => p.slug?.startsWith("exc-bundle"));
  const subs = circleSubmissions.filter(
    (s) => s.by === accountCircleByline || s.by === currentUser?.name
  ).length;
  if ((hasCollector || hasBundle) && subs >= 1) {
    return { label: "INNER CIRCLE", color: "#a259ff", glow: "rgba(162,89,255,0.5)" };
  }
  if (hasCollector || hasBundle) {
    return { label: "COLLECTOR", color: "#ff6b35", glow: "rgba(255,107,53,0.5)" };
  }
  if (subs >= 3) {
    return { label: "VISIONARY", color: "#00ffff", glow: "rgba(0,255,255,0.5)" };
  }
  return { label: "EARLY SUPPORTER", color: "#aaa", glow: "rgba(170,170,170,0.3)" };
}

/**
 * Phase R1 — auth-subscribed leaf: desktop sidebar user badge only.
 */
export function PageAuthSidebarBadge({ circleSubmissions, accountCircleByline }) {
  const { currentUser, library } = useAuth();
  const myPurchases = library || [];
  const userStatus = useMemo(
    () => resolveUserStatus(currentUser, myPurchases, circleSubmissions, accountCircleByline),
    [currentUser, myPurchases, circleSubmissions, accountCircleByline]
  );

  if (!currentUser || !userStatus) return null;
  return (
    <div
      style={{
        fontSize: 9,
        color: userStatus.color,
        letterSpacing: 2.5,
        fontWeight: 700,
        opacity: 0.85,
      }}
    >
      {userStatus.label}
    </div>
  );
}

/** Mobile nav header badge — same subscription island as sidebar. */
export function PageAuthMobileNavBadge({ circleSubmissions, accountCircleByline }) {
  const { currentUser, library } = useAuth();
  const myPurchases = library || [];
  const userStatus = useMemo(
    () => resolveUserStatus(currentUser, myPurchases, circleSubmissions, accountCircleByline),
    [currentUser, myPurchases, circleSubmissions, accountCircleByline]
  );
  const accountDisplayName =
    currentUser?.name?.trim() || currentUser?.email?.split("@")[0] || "Member";
  const accountDisplayInitial = ((accountDisplayName || "?")[0] || "?").toUpperCase();

  if (!currentUser || !userStatus) return null;
  return (
    <motion.div
      style={{
        padding: "10px 24px",
        marginBottom: 4,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <motion.div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#00ffff22,#a259ff22)",
          border: "1px solid #333",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 900,
          color: "#00ffff",
        }}
      >
        {accountDisplayInitial}
      </motion.div>
      <motion.div>
        <motion.div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>
          {accountDisplayName}
        </motion.div>
        <motion.div
          style={{
            fontSize: 9,
            color: userStatus.color,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {userStatus.label}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Phase R1 — deep-link handler isolated from PageStorefront reconcile.
 */
export function PageAuthDeepLinkHandler({
  singles,
  albums,
  displayFeatures,
  switchTab,
  openSingleModal,
  openAlbumModal,
  openFeatureModal,
}) {
  const { currentUser, loading: authLoading } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("deepLink") || consumePendingDeepLink();
    if (!raw) return;
    const parsed = parseDeepLink(raw);
    if (!parsed) return;
    if (params.has("deepLink")) {
      const next = new URL(window.location.href);
      next.searchParams.delete("deepLink");
      window.history.replaceState({}, "", next.pathname + (next.search || ""));
    }
    if (!currentUser) {
      setPostAuthRedirect(window.location.pathname + window.location.search || `/?deepLink=${raw}`);
    }
    if (parsed.type === "song") {
      const single = singles.find((s) => s.slug === parsed.slug);
      if (single) {
        switchTab("singles");
        openSingleModal(single);
      }
    } else if (parsed.type === "album") {
      const album = albums.find((a) => a.slug === parsed.slug);
      if (album) {
        switchTab("albums");
        openAlbumModal(album);
      }
    } else if (parsed.type === "feature") {
      const feat = displayFeatures.find((f) => f.slug === parsed.slug);
      if (feat) {
        switchTab("singles");
        openFeatureModal(feat);
      }
    }
  }, [
    authLoading,
    currentUser,
    displayFeatures,
    singles,
    albums,
    openSingleModal,
    openAlbumModal,
    openFeatureModal,
    switchTab,
  ]);

  return null;
}

/**
 * Phase R1 — community/account/mobile auth UI island (not home storefront).
 */
export function PageAuthSessionBridge({
  circleSubmissions,
  accountCircleByline,
  children,
}) {
  const { currentUser, library } = useAuth();
  const myPurchases = library || [];
  const userStatus = useMemo(
    () => resolveUserStatus(currentUser, myPurchases, circleSubmissions, accountCircleByline),
    [currentUser, myPurchases, circleSubmissions, accountCircleByline]
  );
  const accountDisplayName =
    currentUser?.name?.trim() || currentUser?.email?.split("@")[0] || "Member";
  const accountDisplayInitial = ((accountDisplayName || "?")[0] || "?").toUpperCase();

  return children({
    currentUser,
    myPurchases,
    userStatus,
    accountDisplayName,
    accountDisplayInitial,
    accountCircleByline,
  });
}

/**
 * Phase R1 — help tab user id (auth subscription isolated).
 */
export function PageAuthHelpSupport() {
  const { currentUser } = useAuth();
  return <HelpSupportSection userId={currentUser?.id} />;
}

/**
 * Phase R1 — checkout pending URL effect (auth subscription isolated).
 * onCheckout is stable (useCallback []) and reads cart via cartRef internally —
 * no cart prop needed here, which prevents the effect from firing every render.
 */
export function PageAuthCheckoutPendingEffect({ onCheckout }) {
  const { currentUser } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "pending") return;
    window.history.replaceState({}, "", window.location.pathname);
    void onCheckout();
  }, [currentUser, onCheckout]);

  return null;
}

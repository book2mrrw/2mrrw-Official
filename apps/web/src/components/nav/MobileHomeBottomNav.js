"use client";

import { memo, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { MobileNavAnimatedIcon } from "@/components/nav/MobileNavAnimatedIcon";
import { VaultNavLockIcon } from "@/components/nav/VaultNavLockIcon";
import {
  getHomeScrollSection,
  subscribeHomeScrollSection,
} from "@/lib/home-scroll-section-store";

const MOBILE_NAV_MORE_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

function useHomeScrollSection() {
  return useSyncExternalStore(
    subscribeHomeScrollSection,
    getHomeScrollSection,
    getHomeScrollSection
  );
}

function isMobileNavTabActive(tabId, activeTab, homeSection) {
  if (tabId === "cards") return activeTab === "cards" || (activeTab === "home" && homeSection === "cards");
  if (tabId === "vault") return activeTab === "vault" || (activeTab === "home" && homeSection === "vault");
  if (tabId === "shows") return activeTab === "shows" || (activeTab === "home" && homeSection === "shows");
  if (tabId === "singles") return activeTab === "singles" || activeTab === "albums";
  if (tabId === "mymusic") return activeTab === "mymusic";
  return activeTab === tabId;
}

const MobileHomeBottomNav = memo(function MobileHomeBottomNav({
  tabs,
  activeTab,
  mobileNavOpen,
  onSwitchTab,
  onOpenMore,
}) {
  const homeSection = useHomeScrollSection();

  const activeIdx = tabs.findIndex((tab) =>
    tab.more ? mobileNavOpen : isMobileNavTabActive(tab.id, activeTab, homeSection)
  );
  const idx = activeIdx >= 0 ? activeIdx : 0;
  const tabWidth = 100 / tabs.length;

  return (
    <motion.div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 6700,
        background: "rgba(6,6,6,0.94)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-evenly",
        paddingTop: 6,
        paddingBottom: "max(14px, env(safe-area-inset-bottom))",
        minHeight: 62,
        overflow: "visible",
        isolation: "auto",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: `calc(${idx * tabWidth}% + ${tabWidth / 2}% - 12px)`,
          bottom: "max(10px, env(safe-area-inset-bottom, 0px))",
          width: 24,
          height: 3,
          borderRadius: 2,
          background: "#00ffff",
          boxShadow: "0 0 10px rgba(0,255,255,0.55)",
          transition: "left 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: "none",
          zIndex: 6701,
        }}
      />
      {tabs.map((tab) => {
        const active = tab.more
          ? mobileNavOpen
          : isMobileNavTabActive(tab.id, activeTab, homeSection);
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => (tab.more ? onOpenMore() : onSwitchTab(tab.id))}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: active ? "#00ffff" : "#555",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 0.5,
              padding: "4px 4px 10px",
              borderRadius: 10,
              flex: 1,
              minWidth: 0,
              maxWidth: 56,
              minHeight: 44,
              justifyContent: "center",
              textShadow: active ? "0 0 12px rgba(0,255,255,0.5)" : "none",
              transition: "color 0.2s",
              position: "relative",
              zIndex: 1,
            }}
          >
            {tab.vault ? (
              <VaultNavLockIcon />
            ) : tab.more ? (
              MOBILE_NAV_MORE_SVG
            ) : (
              <MobileNavAnimatedIcon tabId={tab.id} />
            )}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </motion.div>
  );
});

export default MobileHomeBottomNav;

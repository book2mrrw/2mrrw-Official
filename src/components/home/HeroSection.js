"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { catalogMotionVideoUrl } from "@/lib/media-urls";

const SOCIALS = [
  { name: "YouTube", href: "https://youtube.com/@callme2mrrw?si=Bwvli5p7hhvED7eq", svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>) },
  { name: "Instagram", href: "https://www.instagram.com/callme2mrrw?igsh=MXMwdzNiZGE5NTJwaw==", svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>) },
  { name: "TikTok", href: "https://tiktok.com/@thareal2mrrw", svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>) },
  { name: "Twitch", href: "https://twitch.tv/callme2mrrw", svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>) },
  { name: "X", href: "https://x.com/callme2mrrw", svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>) },
  { name: "Patreon", href: "https://patreon.com/2mrrw", svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M0 .48v23.04h4.22V.48zm15.385 0c-4.764 0-8.641 3.88-8.641 8.65 0 4.755 3.877 8.623 8.641 8.623 4.75 0 8.615-3.868 8.615-8.623C24 4.36 20.136.48 15.385.48z"/></svg>) },
];

/**
 * Phase 17B — Hero island props from Page:
 * - Re-renders when `isMobile` or `mobileHeroHeight` change (resize / breakpoint).
 * - Does NOT receive playback, auth, or entitlement props (islands own those subscriptions).
 * - Parent `Page` tab/catalog/modal state can still reconcile Hero if Page re-renders with stable hero props (memo bails).
 * - Carousel video pause/play is DOM-only via `syncSinglesCarouselVideos` in page.js (not a React prop).
 */
const HeroSection = memo(function HeroSection({
  isMobile,
  mobileHeroHeight,
  heroContainerRef,
  heroVideoRef,
  heroTextRef,
  heroSocialsRef,
}) {
  return (
    <motion.div
      ref={heroContainerRef}
      style={{
        position: "relative",
        height: mobileHeroHeight,
        marginBottom: 0,
        borderRadius: isMobile ? 0 : 20,
        overflow: "hidden",
        background: "black",
        transition: isMobile ? "none" : "none",
      }}
    >
      <video
        ref={heroVideoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        webkit-playsinline="true"
        src={catalogMotionVideoUrl("videos/A2B.mp4")}
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: isMobile ? 0.35 : 0.35,
          filter: isMobile ? "brightness(1) blur(0px)" : "brightness(1) blur(1px)",
          transform: "scale(1)",
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top,black,transparent 60%)" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at center,transparent 30%,black 100%)" }} />
      <motion.div ref={heroTextRef} style={{ position: "absolute", top: isMobile ? 16 : 25, left: isMobile ? 16 : 25, zIndex: 10, transformOrigin: "top left" }}>
        <div style={{ fontSize: isMobile ? 28 : 42, fontWeight: 900, letterSpacing: isMobile ? 5 : 8, animation: "pulse 2.5s infinite", textShadow: "0 0 20px rgba(0,255,255,0.8)" }}>2MRRW</div>
      </motion.div>
      <motion.div ref={heroSocialsRef} style={{ position: "absolute", bottom: isMobile ? 14 : 24, right: isMobile ? 14 : 25, display: "flex", gap: isMobile ? 12 : 16, alignItems: "center", zIndex: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {SOCIALS.map((s) => (
          <a
            key={s.name}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            title={s.name}
            style={{ color: "rgba(255,255,255,0.65)", transition: "transform 0.2s,color 0.2s,filter 0.2s", display: "flex", alignItems: "center", textDecoration: "none" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.5)";
              e.currentTarget.style.color = "#00ffff";
              e.currentTarget.style.filter = "drop-shadow(0 0 6px rgba(0,255,255,0.8))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.color = "rgba(255,255,255,0.65)";
              e.currentTarget.style.filter = "none";
            }}
          >
            {s.svg}
          </a>
        ))}
      </motion.div>
    </motion.div>
  );
});

export default HeroSection;

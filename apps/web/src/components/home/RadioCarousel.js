"use client";

import { memo } from "react";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import ReleaseCardPlayButton from "@/components/music/ReleaseCardPlayButton";
import CoverArt from "@/components/ui/CoverArt";
import { resolveContentAccess } from "@/lib/music-access";
import {
  catalogStaticCoverDisplay,
  withR2CatalogMedia,
} from "@/components/home/catalogMedia";

function RadioCarousel({
  narrow = false,
  isMobile,
  currentSlide,
  radioSlides,
  radioIndex,
  goRadio,
  isAdmin,
  onGift,
  onAddToCart,
  onFlowConversionActive,
  accountState,
  currentUserId,
  onLibraryChange,
}) {
  const coverW = isMobile ? 120 : narrow ? 200 : 320;
  const infoPad = isMobile ? "20px 16px" : narrow ? "28px 22px" : "36px 32px";
  const titleSize = isMobile ? 18 : narrow ? 24 : 34;
  const radioAccess = resolveContentAccess(currentSlide, accountState);
  const radioCover = catalogStaticCoverDisplay(currentSlide);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 22,
        overflow: "hidden",
        background: "linear-gradient(135deg,#080808,#0d0d0d)",
        border: "1px solid #1e1e1e",
        boxShadow: "0 8px 60px rgba(0,0,0,0.6)",
        height: "100%",
      }}
    >
      {isAdmin ? <GiftOverlayButton onClick={() => onGift(currentSlide)} /> : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 30% 50%,${currentSlide.tagColor}10 0%,transparent 55%)`,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div style={{ display: "flex", alignItems: "stretch", minHeight: isMobile ? 180 : 320, position: "relative", zIndex: 1 }}>
        <div
          style={{ flexShrink: 0, width: coverW, position: "relative", overflow: "hidden" }}
        >
          <CoverArt
            src={radioCover.src}
            baseCover={radioCover.baseCover}
            type={radioCover.type}
            alt={currentSlide.title}
            width="100%"
            height="100%"
            style={{ objectFit: "cover", display: "block" }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(135deg,transparent 40%,rgba(0,0,0,0.35) 100%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              background: currentSlide.tagColor,
              color: "#000",
              fontSize: 8,
              fontWeight: 900,
              letterSpacing: 2,
              padding: "4px 10px",
              borderRadius: 20,
              boxShadow: `0 0 16px ${currentSlide.tagColor}88`,
            }}
          >
            {currentSlide.tag}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            padding: infoPad,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: isMobile ? 8 : 14,
          }}
        >
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 4, textTransform: "uppercase", fontWeight: 700 }}>2MRRW RADIO</div>
          <div style={{ fontSize: titleSize, fontWeight: 900, letterSpacing: 2, lineHeight: 1.1 }}>{currentSlide.title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 18 }}>
              {[10, 16, 8, 14].map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: 3,
                    height: h,
                    borderRadius: 2,
                    background: currentSlide.tagColor,
                    boxShadow: `0 0 6px ${currentSlide.tagColor}88`,
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 13, color: "#555", letterSpacing: 1 }}>SINGLE</div>
          </div>
          {radioAccess?.showPrice ? (
            <div style={{ fontSize: isMobile ? 16 : 20, color: "#00ffff", fontWeight: 700 }}>${currentSlide.price.toFixed(2)}</div>
          ) : null}
          <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
            <ReleaseCardPlayButton
              item={withR2CatalogMedia(currentSlide)}
              accountState={accountState}
              userId={currentUserId}
              isAdmin={isAdmin}
              source="home_radio_carousel"
            />
            {radioAccess?.showCart ? (
              <button
                onClick={() =>
                  onAddToCart({
                    title: currentSlide.title,
                    slug: currentSlide.slug,
                    cover: currentSlide.cover,
                    price: currentSlide.price,
                  })
                }
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.85";
                  e.currentTarget.style.transform = "scale(1.04)";
                  onFlowConversionActive(true);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.transform = "scale(1)";
                  onFlowConversionActive(false);
                }}
                style={{
                  padding: isMobile ? "10px 16px" : "11px 22px",
                  background: currentSlide.tagColor,
                  color: "#000",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontSize: isMobile ? 12 : 13,
                  fontWeight: 900,
                  transition: "0.25s",
                  boxShadow: `0 0 20px ${currentSlide.tagColor}55`,
                }}
              >
                + Add to Cart
              </button>
            ) : null}
            <MusicPlusButton
              track={currentSlide}
              userId={currentUserId}
              access={radioAccess}
              onLibraryChange={onLibraryChange}
            />
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: isMobile ? 4 : 10 }}>
            {radioSlides.map((s, i) => (
              <div
                key={s.slug}
                onClick={() => goRadio(i)}
                style={{
                  width: i === radioIndex ? 22 : 6,
                  height: 6,
                  borderRadius: 4,
                  background: i === radioIndex ? currentSlide.tagColor : "#2a2a2a",
                  cursor: "pointer",
                  transition: "all 0.3s",
                  boxShadow: i === radioIndex ? `0 0 8px ${currentSlide.tagColor}88` : "none",
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: isMobile ? 12 : 24, right: isMobile ? 12 : 24, display: "flex", gap: 8 }}>
          {[
            { d: "prev", icon: "‹" },
            { d: "next", icon: "›" },
          ].map(({ d, icon }) => (
            <button
              key={d}
              onClick={() => {
                const ni =
                  d === "prev"
                    ? radioIndex === 0
                      ? radioSlides.length - 1
                      : radioIndex - 1
                    : radioIndex === radioSlides.length - 1
                      ? 0
                      : radioIndex + 1;
                goRadio(ni);
              }}
              style={{
                width: isMobile ? 32 : 36,
                height: isMobile ? 32 : 36,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid #2a2a2a",
                color: "#666",
                fontSize: 18,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = currentSlide.tagColor;
                e.currentTarget.style.color = currentSlide.tagColor;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#2a2a2a";
                e.currentTarget.style.color = "#666";
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(RadioCarousel);

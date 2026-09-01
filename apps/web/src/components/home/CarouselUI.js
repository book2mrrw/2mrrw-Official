"use client";

import { memo, useRef, useState } from "react";
import { useMountEnterAnimation, useSlugEnterAnimation } from "@/hooks/useMountEnterAnimation";
import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import { resolveContentAccess } from "@/lib/music-access";
import { toPlaybackTrack, toInstantStartTrack } from "@/lib/music-playback";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
import { useArtworkGesture } from "@/hooks/useArtworkGesture";

function CarouselUI({
  currentSingle, currentSingleAccess, singleIndex, singles, prevSingle, nextSingle,
  goToSingle, onSingleClick, addToCart, addVinylToCart, buttonHoverIn,
  buttonHoverOut, accountState, userId, isAdmin, onGift, onLibraryChange,
}) {
  const [previewHover, setPreviewHover] = useState(false);
  const [coverVideoFailed, setCoverVideoFailed] = useState(false);
  const carouselCoverRef = useRef(null);
  const { handlers: carouselGesture } = useArtworkGesture({
    slug: currentSingle?.slug || "",
    elementRef: carouselCoverRef,
  });
  const { shouldAnimate: shouldAnimateCover } = useMountEnterAnimation();
  const shouldAnimateTitle = useSlugEnterAnimation(currentSingle?.slug);
  const access = currentSingleAccess || (currentSingle ? resolveContentAccess(currentSingle, accountState) : null);
  const coverDisplay = catalogCoverDisplay(currentSingle);
  const coverVideoSrc = (!coverVideoFailed && (currentSingle?.video || currentSingle?.visual) && (currentSingle?.coverArtType === "video" || coverDisplay?.type === "video"))
    ? (currentSingle.video || currentSingle.visual)
    : null;
  const currentLibraryItem = accountState?.library?.find((item) => item.slug === currentSingle?.slug);
  const currentSingleIsGifted = currentLibraryItem?.source === "gift" || currentLibraryItem?.gifted === true;

  if (!currentSingle) return null;

  const hintCurrentSingle = () => {
    const track = toPlaybackTrack(currentSingle, { ...accountState, userId, isAdmin }, "carousel");
    if (!track?.src) return;
    const { startTrack } = toInstantStartTrack(track);
    if (startTrack?.src) getPagePlaybackActionsBridge()?.hintUpcomingPlay?.(startTrack);
  };
  const navStyle = {
    width: 50, height: 50, borderRadius: "50%", background: "rgba(255,255,255,0.04)",
    border: "1px solid #2a2a2a", color: "#555", fontSize: 22, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    transition: "all 0.2s",
  };
  const navEnter = (event) => {
    event.currentTarget.style.borderColor = "#00ffff";
    event.currentTarget.style.color = "#00ffff";
    event.currentTarget.style.boxShadow = "0 0 10px rgba(0,255,255,0.3)";
  };
  const navLeave = (event) => {
    event.currentTarget.style.borderColor = "#2a2a2a";
    event.currentTarget.style.color = "#555";
    event.currentTarget.style.boxShadow = "none";
  };

  return (
    <div className="catalog-featured-carousel" style={{ background: "linear-gradient(135deg,#0e0e0e,#111)", border: "1px solid #1e1e1e", position: "relative", overflow: "hidden", boxShadow: "0 4px 40px rgba(0,0,0,0.5)" }}>
      {isAdmin ? <GiftOverlayButton onClick={() => onGift?.(currentSingle)} /> : null}
      <div aria-hidden="true" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 360, height: 360, background: "radial-gradient(circle,rgba(0,255,255,0.04) 0%,transparent 70%)", pointerEvents: "none" }} />
      <button className="catalog-featured-carousel__previous" aria-label="Previous single" onClick={prevSingle} style={navStyle} onMouseEnter={navEnter} onMouseLeave={navLeave}>‹</button>
      <div
        ref={carouselCoverRef}
        className="catalog-featured-carousel__cover"
        style={{ flexShrink: 0, position: "relative" }}
        onMouseEnter={() => { setPreviewHover(true); hintCurrentSingle(); }}
        onMouseLeave={() => setPreviewHover(false)}
        onTouchStart={hintCurrentSingle}
        onPointerDown={carouselGesture.onPointerDown}
        onPointerMove={carouselGesture.onPointerMove}
        onPointerUp={carouselGesture.onPointerUp}
        onPointerCancel={carouselGesture.onPointerCancel}
        onLostPointerCapture={carouselGesture.onLostPointerCapture}
      >
        {coverVideoSrc ? (
          <video
            key={coverVideoSrc}
            src={coverVideoSrc}
            poster={currentSingle.baseCover || currentSingle.cover || undefined}
            autoPlay muted loop playsInline preload="auto" webkit-playsinline="true"
            onError={() => setCoverVideoFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: 18, boxShadow: "0 10px 50px rgba(0,0,0,0.7)", transition: "filter 0.3s", filter: previewHover ? "brightness(0.55)" : "brightness(1)", animation: shouldAnimateCover ? "fadeInCover 0.4s ease forwards" : undefined, pointerEvents: "none" }}
          />
        ) : (
          <CoverArt
            src={coverDisplay.src}
            type={coverDisplay.type || "image"}
            alt="" width="100%" height="100%" borderRadius={18}
            style={{ boxShadow: "0 10px 50px rgba(0,0,0,0.7)", transition: "filter 0.3s", filter: previewHover ? "brightness(0.55)" : "brightness(1)", animation: shouldAnimateCover ? "fadeInCover 0.4s ease forwards" : undefined }}
          />
        )}
        <button
          type="button"
          aria-label={`${access?.canStream ? "Listen to" : "Preview"} ${currentSingle.title}`}
          onClick={() => onSingleClick?.(currentSingle)}
          style={{ position: "absolute", inset: 0, width: "100%", border: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 18, cursor: "pointer", opacity: previewHover ? 1 : 0, transition: "opacity 0.25s", background: "transparent", color: "white" }}
        >
          <span style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", border: "1.5px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 30px rgba(0,0,0,0.5)" }}><svg viewBox="0 0 24 24" fill="white" width="28" height="28" style={{ marginLeft: 3 }}><path d="M8 5v14l11-7z" /></svg></span>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "rgba(255,255,255,0.85)", textTransform: "uppercase" }}>{access?.canStream ? "Listen" : "Preview"}</span>
        </button>
      </div>
      <div className="catalog-featured-carousel__info" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="hero-title-glow catalog-featured-carousel__title" style={{ fontWeight: 900, letterSpacing: 2, animation: shouldAnimateTitle ? "fadeInUp 0.35s ease forwards" : undefined }}>{currentSingle.title}</div>
        <div style={{ fontSize: 13, color: "#555", letterSpacing: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>SINGLE · {singleIndex + 1} of {singles.length}</span>
          <MusicAccessBadge access={access} label={access?.badge} compact />
          {currentSingleIsGifted ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", background: "linear-gradient(135deg,rgba(162,89,255,0.15),rgba(0,191,255,0.08))", border: "1px solid rgba(162,89,255,0.3)", borderRadius: 20, animation: "giftBadgePulse 3s ease-in-out infinite", fontSize: 10, fontWeight: 700, color: "#a259ff", letterSpacing: 1, textTransform: "uppercase" }}>
              <GiftIcon size={12} style={{ animation: "giftIconSpin 4s ease-in-out infinite" }} /> Gift from 2MRRW
            </span>
          ) : null}
        </div>
        {access?.showPrice ? <div className="catalog-featured-carousel__price" style={{ color: "#00ffff", fontWeight: 700 }}>${currentSingle.price.toFixed(2)}</div> : null}
        <div className="catalog-featured-carousel__dots" style={{ display: "flex", gap: 6 }}>
          {singles.map((single, index) => (
            <button key={single.slug} type="button" aria-label={`Show ${single.title}`} onClick={() => goToSingle(index, index > singleIndex ? "right" : "left")} style={{ width: index === singleIndex ? 24 : 7, height: 7, padding: 0, border: 0, borderRadius: 4, background: index === singleIndex ? "#00ffff" : "#333", cursor: "pointer", transition: "all 0.3s", boxShadow: index === singleIndex ? "0 0 8px rgba(0,255,255,0.6)" : "none" }} />
          ))}
        </div>
        <div className="catalog-featured-carousel__actions" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {access?.showCart ? <button className="catalog-featured-carousel__cart" onClick={() => addToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{ background: "#0a0a0a", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: "bold", transition: "0.25s" }}>+ Add to Cart</button> : null}
          {access?.showCart ? <button className="catalog-featured-carousel__cart" onClick={() => addVinylToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{ background: "#0a0a0a", color: "#aaa", border: "1px solid #2a2a2a", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "0.25s" }}>+ Vinyl $47.99</button> : null}
          <MusicPlusButton track={currentSingle} userId={userId} access={access} onLibraryChange={onLibraryChange} />
        </div>
      </div>
      <button className="catalog-featured-carousel__next" aria-label="Next single" onClick={nextSingle} style={navStyle} onMouseEnter={navEnter} onMouseLeave={navLeave}>›</button>
    </div>
  );
}

export default memo(CarouselUI);

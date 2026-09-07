"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useStorefrontCardChrome } from "@/hooks/useStorefrontCardChrome";
import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import { VideoPreviewIcon, AdminVideoLinkedMarker } from "@/components/audio-visual/VideoPreviewIcon";
import { AudioVisualInlinePreview } from "@/components/audio-visual/AudioVisualInlinePreview";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import PlaybackPrewarmCardShell from "@/components/music/PlaybackPrewarmCardShell";
import { itemHasPlayableAudio, resolveContentAccess } from "@/lib/music-access";
import { albumCardPlaybackItem, toPlaybackTrack, toInstantStartTrack } from "@/lib/music-playback";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";
import { withR2CatalogMedia, isUpcomingReleaseDate, catalogCoverDisplay } from "@/components/home/catalogMedia";
import { CountdownTimer } from "@/components/music/CountdownTimer";
import { useArtworkGesture }       from "@/hooks/useArtworkGesture";
import { useVisualAssets } from "@/hooks/useVisualAssets";
import { globalMediaController } from "@/media/visualEngine/GlobalMediaController";
import {
  createReleasePresentationIdentity,
  entitlementPresentationIdentity,
  useReleasePresentationLifecycle,
} from "@/hooks/useReleasePresentation";

const VisualMomentOverlay  = dynamic(() => import("@/components/music/VisualMomentOverlay"),  { ssr: false });
const FullVisualExperience = dynamic(() => import("@/components/music/FullVisualExperience"), { ssr: false });
const AudioVisualPlayer    = dynamic(() => import("@/components/audio-visual/AudioVisualPlayer").then((m) => m.AudioVisualPlayer), { ssr: false });

function ReleasePresentationProbe({ identity, entitlementIdentity }) {
  useReleasePresentationLifecycle({
    identity,
    entitlementIdentity,
    controlsReady: true,
  });
  return null;
}

/**
 * Release card cover surface with Visual Moment gesture support.
 *
 * Tap  → onCardClick (open release modal)
 * Hold → Visual Moment activates (if asset available)
 * Hold + swipe up → FullVisualExperience
 */
function CatalogCardCoverSurface({
  mediaItem,
  coverDisplay,
  hoverIn,
  hoverOut,
  onCardClick,
  onHintPlay,
  accountState,
  presentationIdentity,
}) {
  const [momentActive,     setMomentActive]     = useState(false);
  const [fullVisualOpen,   setFullVisualOpen]   = useState(false);
  const [momentScale,      setMomentScale]      = useState(1);
  const suppressNextClick  = useRef(false);
  const coverRef           = useRef(null);
  const dwellTimerRef      = useRef(null);

  const { assets, primaryAsset } = useVisualAssets(mediaItem?.slug, accountState);
  const hasVisualMoment = Boolean(primaryAsset);

  // Stable refs to avoid stale closures in IntersectionObserver / timer callbacks
  const primaryAssetRef   = useRef(primaryAsset);
  const fullVisualOpenRef = useRef(fullVisualOpen);
  const mediaSlugRef      = useRef(mediaItem?.slug);
  useEffect(() => { primaryAssetRef.current   = primaryAsset;    }, [primaryAsset]);
  useEffect(() => { fullVisualOpenRef.current = fullVisualOpen;  }, [fullVisualOpen]);
  useEffect(() => { mediaSlugRef.current      = mediaItem?.slug; }, [mediaItem?.slug]);

  // ── Visual Moment passive dwell — HOLD GESTURE IS EXCLUSIVELY SCREW ────────
  // VisualMoment is no longer hold-triggered. Gesture conflict eliminated.
  // Desktop: mouse-hover dwell (600ms). Mobile/touch: IntersectionObserver (2s).

  const _activateDwell = useCallback(() => {
    const asset = primaryAssetRef.current;
    const slug  = mediaSlugRef.current;
    if (!asset || !slug) return;
    suppressNextClick.current = true;
    setMomentScale(1.025);
    setMomentActive(true);
    globalMediaController.activateMoment(slug, asset);
  }, []);

  const _deactivateDwell = useCallback(() => {
    clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = null;
    setMomentScale(1);
    setMomentActive(false);
    if (!fullVisualOpenRef.current) globalMediaController.deactivateMoment();
  }, []);

  // IntersectionObserver dwell — touch/mobile primary (only on non-hover devices)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasVisualMoment) return;
    if (window.matchMedia("(hover: hover)").matches) return; // desktop uses mouse-enter dwell
    const el = coverRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        dwellTimerRef.current = setTimeout(_activateDwell, 2000);
      } else {
        _deactivateDwell();
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(dwellTimerRef.current); };
  }, [hasVisualMoment, _activateDwell, _deactivateDwell]);

  // Desktop mouse-hover dwell handlers
  const handleMouseEnter = useCallback(() => {
    hoverIn?.();
    onHintPlay?.();
    if (!primaryAssetRef.current) return;
    clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = setTimeout(_activateDwell, 600);
  }, [hoverIn, onHintPlay, _activateDwell]);

  const handleMouseLeave = useCallback(() => {
    hoverOut?.();
    _deactivateDwell();
  }, [hoverOut, _deactivateDwell]);

  const onSwipeUp = useCallback(() => {
    const asset = primaryAssetRef.current;
    const slug  = mediaSlugRef.current;
    if (!asset || !slug) return;
    setMomentActive(false);
    setFullVisualOpen(true);
    globalMediaController.expandToFull(slug, asset);
  }, []);

  // Artwork gesture — HOLD is now exclusively Screw. No VisualMoment conflict.
  const { handlers: artHandlers } = useArtworkGesture({
    slug:       mediaItem?.slug || "",
    elementRef: coverRef,
    disabled:   false,
  });

  const handleClick = useCallback((e) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    onCardClick?.(mediaItem);
  }, [onCardClick, mediaItem]);

  const handleFullClose = useCallback(() => {
    setFullVisualOpen(false);
    setMomentActive(false);
    globalMediaController.exitFull();
  }, []);

  return (
    <div
      ref={coverRef}
      style={{
        position:   "relative",
        cursor:     "pointer",
        transform:  `scale(${momentScale})`,
        transition: momentActive ? "transform 0.25s cubic-bezier(0.34,1.56,0.64,1)" : "transform 0.2s ease",
        userSelect: "none",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={onHintPlay}
      onClick={handleClick}
      {...artHandlers}
    >
      {/* Animated cover art / static cover — routed through CoverArt so a
          motion cover gets the same viewport-gated, decode-budget-aware
          loading (and audio-priority suspension) as every other surface,
          instead of an unconditional autoplay the instant this card mounts. */}
      <CoverArt
        src={coverDisplay.src}
        baseCover={mediaItem?.baseCover || undefined}
        type={coverDisplay.type || mediaItem.coverArtType}
        presentationIdentity={presentationIdentity}
        skeleton
        alt="" width="100%" height="auto"
        style={{ aspectRatio: "1/1", backgroundColor: "#0a0a0a", pointerEvents: "none", transition: "transform 0.3s, filter 0.3s, box-shadow 0.3s", display: "block" }}
      />

      {/* Visual Moment overlay — renders over cover during hold */}
      {hasVisualMoment && primaryAsset && (
        <VisualMomentOverlay
          active={momentActive}
          asset={primaryAsset}
          releaseSlug={mediaItem.slug}
          onSwipeUp={onSwipeUp}
          onVideoError={() => setMomentActive(false)}
        />
      )}

      {/* Hold indicator badge — visible after a brief hold begins */}
      {hasVisualMoment && !momentActive && (
        <div
          aria-hidden
          style={{
            position:      "absolute",
            bottom:        8,
            right:         8,
            width:         6,
            height:        6,
            borderRadius:  "50%",
            background:    "rgba(0,191,255,0.7)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Full visual experience portal */}
      {fullVisualOpen && primaryAsset && (
        <FullVisualExperience
          asset={primaryAsset}
          releaseSlug={mediaItem.slug}
          coverUrl={mediaItem.cover || mediaItem.baseCover}
          onClose={handleFullClose}
        />
      )}
    </div>
  );
}

const merchSelectStyle = {
  background: "#111", color: "#ccc", border: "1px solid #2a2a2a", borderRadius: 6,
  padding: "6px 8px", fontSize: 12, fontFamily: "inherit", flex: "1 1 auto", minWidth: 0,
};

/**
 * Size/color variant picker + real Add to Cart / Checkout actions for a
 * merch card — own local state (which variant is selected), scoped to this
 * one card, same reasoning as CatalogCardVideoPreview above: this must never
 * live on the grid-mapping parent, or picking a variant on one card would
 * re-render every other card in the grid.
 */
function MerchCardVariantActions({ mediaItem, addToCart, onCheckoutNow, buttonHoverIn, buttonHoverOut }) {
  const variants = mediaItem.variants || [];
  const sizes = [...new Set(variants.map((v) => v.size).filter(Boolean))];
  const colors = [...new Set(variants.map((v) => v.color).filter(Boolean))];
  const [selectedSize, setSelectedSize] = useState(sizes[0] || null);
  const [selectedColor, setSelectedColor] = useState(colors[0] || null);

  const selectedVariant =
    variants.find((v) =>
      (sizes.length === 0 || v.size === selectedSize) &&
      (colors.length === 0 || v.color === selectedColor)
    ) || variants[0];

  const variantLabel = [selectedVariant?.size, selectedVariant?.color].filter(Boolean).join(" / ");
  const cartItem = selectedVariant ? {
    slug: mediaItem.slug,
    title: variantLabel ? `${mediaItem.title} (${variantLabel})` : mediaItem.title,
    cover: mediaItem.cover,
    price: selectedVariant.price,
    product_type: "merch",
    variantId: selectedVariant.id,
    externalVariantId: selectedVariant.externalVariantId,
    catalogVariantId: selectedVariant.catalogVariantId,
    size: selectedVariant.size || null,
    color: selectedVariant.color || null,
  } : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }} onClick={(e) => e.stopPropagation()}>
      {(sizes.length > 1 || colors.length > 1) && (
        <div style={{ display: "flex", gap: 6 }}>
          {sizes.length > 1 && (
            <select aria-label="Size" value={selectedSize || ""} onChange={(e) => setSelectedSize(e.target.value)} style={merchSelectStyle}>
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {colors.length > 1 && (
            <select aria-label="Color" value={selectedColor || ""} onChange={(e) => setSelectedColor(e.target.value)} style={merchSelectStyle}>
              {colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      )}
      {selectedVariant?.price != null && (
        <div style={{ color: "#00ffff", fontWeight: 700, fontSize: 13 }}>${selectedVariant.price.toFixed(2)}</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!cartItem}
          onClick={() => cartItem && addToCart(cartItem)}
          onMouseEnter={buttonHoverIn}
          onMouseLeave={buttonHoverOut}
          style={{ flex: 1, background: "#1a1a1a", color: "white", border: "1px solid #2a2a2a", borderRadius: 6, padding: "9px 0", cursor: cartItem ? "pointer" : "not-allowed", transition: "0.25s", fontWeight: 600, minWidth: 72, opacity: cartItem ? 1 : 0.5 }}
        >
          Add to Cart
        </button>
        <button
          disabled={!cartItem}
          onClick={() => cartItem && onCheckoutNow?.(cartItem)}
          style={{ flex: 1, background: "#00ffff", color: "#000", border: "none", borderRadius: 6, padding: "9px 0", cursor: cartItem ? "pointer" : "not-allowed", transition: "0.25s", fontWeight: 800, minWidth: 72, opacity: cartItem ? 1 : 0.5 }}
        >
          Checkout
        </button>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Owns its own local inline-preview/fullscreen state, scoped to exactly one
 * card — mirrors CatalogCardCoverSurface's own local hover/moment state
 * further down this file. Toggling one card's video preview must never
 * re-render every other card in the grid, so this state deliberately does
 * NOT live on CatalogGrid itself.
 */
function CatalogCardVideoPreview({ mediaItem, isAdmin }) {
  const [inlinePreviewOpen, setInlinePreviewOpen] = useState(false);
  const [fullscreenVideo, setFullscreenVideo] = useState(null);

  if (!mediaItem.audio_visual_id) return null;

  return (
    <>
      <VideoPreviewIcon
        offsetTop={isAdmin ? 48 : 8}
        onClick={() => setInlinePreviewOpen(true)}
      />
      {isAdmin ? <AdminVideoLinkedMarker /> : null}
      {inlinePreviewOpen && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, aspectRatio: "1/1", zIndex: 20, overflow: "hidden" }}>
          <AudioVisualInlinePreview
            videoId={mediaItem.audio_visual_id}
            onClose={() => setInlinePreviewOpen(false)}
            onWatchFull={() => {
              setInlinePreviewOpen(false);
              setFullscreenVideo({ id: mediaItem.audio_visual_id, title: mediaItem.title, posterUrl: mediaItem.audio_visual_poster_url });
            }}
          />
        </div>
      )}
      {fullscreenVideo && (
        <AudioVisualPlayer
          videoId={fullscreenVideo.id}
          title={fullscreenVideo.title}
          posterUrl={fullscreenVideo.posterUrl}
          onClose={() => setFullscreenVideo(null)}
        />
      )}
    </>
  );
}

function CatalogGrid({
  items,
  type,
  addToCart,
  onCheckoutNow,
  hoverIn,
  hoverOut,
  buttonHoverIn,
  buttonHoverOut,
  onCardClick,
  onPlayAlbum,
  onOpenAlbumTracklist,
  catalogPlaybackLookup,
  onGift,
  onLibraryChange,
}) {
  const { entitlementAccountState, userId, isAdminStable } = useStorefrontCardChrome();
  const accountState = entitlementAccountState;
  const isAdmin = isAdminStable;
  if (!items || items.length === 0) return null;
  return (
    <div className="catalog-adaptive-container">
    <div className={`catalog-adaptive-grid ${type}-row`}>
      {items.map((item) => {
        if (!item?.slug) return null;
        const mediaItem = withR2CatalogMedia(item);
        const coverDisplay = catalogCoverDisplay(mediaItem);
        const access = resolveContentAccess(mediaItem, accountState);
        const presentationIdentity = createReleasePresentationIdentity(
          mediaItem,
          `home_catalog:${type}`,
          coverDisplay?.type === "video"
            ? mediaItem?.video || mediaItem?.visual || coverDisplay?.src
            : coverDisplay?.src
        );
        const entitlementIdentity = entitlementPresentationIdentity({
          accountState,
          userId,
          isAdmin,
          access,
        });
        const showPlayActions = itemHasPlayableAudio(mediaItem, access);
        const playItem =
          type === "albums" ? albumCardPlaybackItem(mediaItem, catalogPlaybackLookup) : mediaItem;
        const albumLibraryItem = accountState?.library?.find(
          (lib) => lib.slug === mediaItem?.slug
        );
        const albumIsGifted =
          albumLibraryItem?.source === "gift" ||
          albumLibraryItem?.gifted === true;
        const targetDate = mediaItem.scheduled_publish_at || mediaItem.date;
        const isUpcoming =
          !isAdmin && (mediaItem.status === "scheduled" || isUpcomingReleaseDate(targetDate));

        if (isUpcoming) {
          return (
            <div
              key={mediaItem.slug}
              data-release-presentation-key={presentationIdentity.key || undefined}
              className="catalog-adaptive-card release-card release-card--upcoming"
              onClick={() => onCardClick?.(mediaItem)}
              style={{
                position: "relative",
                background: "#0a0a0a",
                borderRadius: 16,
                overflow: "hidden",
                border: "1px solid #1a1a1a",
              }}
            >
              <ReleasePresentationProbe
                identity={presentationIdentity}
                entitlementIdentity={entitlementIdentity}
              />
              <div className="release-card-cover release-card-cover--locked">
                <CoverArt
                  src={coverDisplay.src || mediaItem.cover}
                  baseCover={mediaItem?.baseCover || undefined}
                  type={coverDisplay.type || mediaItem.coverArtType}
                  presentationIdentity={presentationIdentity}
                  alt=""
                  className="release-card-cover-img--blur"
                  style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }}
                />
                <div className="release-card-upcoming-overlay">
                  <div className="release-card-lock-icon">
                    <LockIcon />
                  </div>
                  <div className="release-card-countdown">
                    <CountdownTimer targetDate={targetDate} />
                  </div>
                </div>
              </div>
              <div className="catalog-adaptive-card__meta release-card-meta">
                <div className="catalog-adaptive-card__title release-card-title" style={{ fontWeight: 700 }}>
                  {mediaItem.title}
                </div>
                <div className="release-card-upcoming-label">
                  {mediaItem.availability?.phase === "early_access" ? "EARLY ACCESS"
                    : mediaItem.availability?.preorderOpen ? "PRE-ORDER OPEN"
                    : "DROPPING SOON"}
                </div>
                {access?.lifecycleMessage ? <div style={{ fontSize: 10, color: "rgba(255,255,255,.58)", lineHeight: 1.35, marginTop: 5 }}>{access.lifecycleMessage}</div> : null}
              </div>
            </div>
          );
        }

        return (
        <PlaybackPrewarmCardShell
          key={mediaItem.slug}
          releaseItem={mediaItem}
          playItem={playItem}
          catalogPlaybackLookup={catalogPlaybackLookup}
          accountState={accountState}
          userId={userId}
          source={type === "albums" ? "home_album_card" : "home_card"}
          isAlbumCard={type === "albums"}
          enabled={showPlayActions}
          data-release-presentation-key={presentationIdentity.key || undefined}
          className="catalog-adaptive-card release-card"
          style={{position:"relative",background:"#0a0a0a",borderRadius:16,overflow:"hidden",border:"1px solid #1a1a1a",transition:"border-color 0.25s"}}
          onMouseEnter={e=>e.currentTarget.style.borderColor="#2a2a2a"}
          onMouseLeave={e=>e.currentTarget.style.borderColor="#1a1a1a"}
        >
          <ReleasePresentationProbe
            identity={presentationIdentity}
            entitlementIdentity={entitlementIdentity}
          />
          {isAdmin ? <GiftOverlayButton onClick={() => onGift?.(mediaItem)} /> : null}
          <CatalogCardVideoPreview mediaItem={mediaItem} isAdmin={isAdmin} />
          <CatalogCardCoverSurface
            mediaItem={mediaItem}
            coverDisplay={coverDisplay}
            hoverIn={hoverIn}
            hoverOut={hoverOut}
            onCardClick={onCardClick}
            accountState={accountState}
            presentationIdentity={presentationIdentity}
            onHintPlay={() => {
              const track = toPlaybackTrack(withR2CatalogMedia(playItem), { ...accountState, userId, isAdmin }, type === "albums" ? "home_album_card" : "home_card");
              if (!track?.src) return;
              const { startTrack } = toInstantStartTrack(track);
              if (startTrack?.src) getPagePlaybackActionsBridge()?.hintUpcomingPlay?.(startTrack);
            }}
          />
          {type==="albums"&&(mediaItem.type==="deluxe"||mediaItem.releaseType==="deluxe")?(
            <span style={{position:"absolute",top:8,right:8,fontSize:9,fontWeight:800,letterSpacing:1.2,padding:"4px 7px",borderRadius:6,background:"rgba(245,158,11,0.92)",color:"#111"}}>DELUXE</span>
          ):null}
          <div className="catalog-adaptive-card__meta">
            <div className={`${type==="albums"&&isUpcomingReleaseDate(mediaItem.date)?"song-title-turquoise-glow ":""}catalog-adaptive-card__title`} style={{fontWeight:700,marginBottom:4,lineHeight:1.3}}>{mediaItem.title}</div>
            {mediaItem.date && <div className="catalog-adaptive-card__date" style={{color:"#444",marginBottom:6,letterSpacing:1}}>{mediaItem.date}</div>}
            {access?.badge && <div style={{marginBottom:6}}><MusicAccessBadge access={access} label={access.badge} compact /></div>}
            {albumIsGifted ? (
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                marginBottom: 6,
                padding: "2px 7px",
                background: "linear-gradient(135deg,rgba(162,89,255,0.15),rgba(0,191,255,0.08))",
                border: "1px solid rgba(162,89,255,0.3)",
                borderRadius: 20,
                animation: "giftBadgePulse 3s ease-in-out infinite",
                fontSize: 10,
                fontWeight: 700,
                color: "#a259ff",
                letterSpacing: 1,
              }}>
                <GiftIcon size={12} style={{ animation: "giftIconSpin 4s ease-in-out infinite" }} />
                <span style={{ textTransform: "uppercase" }}>
                  Gift from 2MRRW
                </span>
              </div>
            ) : null}
            {access?.showPrice && <div className="catalog-adaptive-card__price" style={{color:"#00ffff",fontWeight:700}}>${mediaItem.price.toFixed(2)}</div>}
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}} onClick={type==="albums"?e=>e.stopPropagation():undefined}>
              {showPlayActions && type==="albums" ? (
                <div style={{flex:1,minWidth:0}}>
                  <ReleaseCardActions
                    item={withR2CatalogMedia(playItem)}
                    accountState={accountState}
                    userId={userId}
                    isAdmin={isAdmin}
                    source="home_album_card"
                    showCart={Boolean(access?.showCart)}
                    onLibraryChange={onLibraryChange}
                    onPlayClick={(e) => {
                      e.stopPropagation();
                      onPlayAlbum?.(e, mediaItem);
                    }}
                    onAddToCart={e => { e.stopPropagation(); addToCart(mediaItem); }}
                    cartButtonStyle={{
                      background:"#1a1a1a",
                      color:"white",
                      border:"1px solid #2a2a2a",
                    }}
                    cartLabel="+ Cart"
                  />
                </div>
              ) : type === "products" && mediaItem.variants?.length > 0 ? (
                <MerchCardVariantActions
                  mediaItem={mediaItem}
                  addToCart={addToCart}
                  onCheckoutNow={onCheckoutNow}
                  buttonHoverIn={buttonHoverIn}
                  buttonHoverOut={buttonHoverOut}
                />
              ) : access?.showCart ? (
                <button className="catalog-adaptive-card__cart" onClick={()=>addToCart(mediaItem)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{flex:1,background:"#1a1a1a",color:"white",border:"1px solid #2a2a2a",cursor:"pointer",transition:"0.25s",fontWeight:600,minWidth:72}}>Add to Cart</button>
              ) : null}
            </div>
          </div>
        </PlaybackPrewarmCardShell>
      );
      })}
    </div>
    </div>
  );
}

export default memo(CatalogGrid);

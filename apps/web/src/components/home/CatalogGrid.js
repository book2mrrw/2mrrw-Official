"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useStorefrontCardChrome } from "@/hooks/useStorefrontCardChrome";
import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import GiftIcon from "@/components/gifts/GiftIcon";
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
  useReleaseCoverLifecycle,
  useReleasePresentationLifecycle,
} from "@/hooks/useReleasePresentation";

const VisualMomentOverlay  = dynamic(() => import("@/components/music/VisualMomentOverlay"),  { ssr: false });
const FullVisualExperience = dynamic(() => import("@/components/music/FullVisualExperience"), { ssr: false });

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
  const [videoFailed,      setVideoFailed]      = useState(false);
  const [momentActive,     setMomentActive]     = useState(false);
  const [fullVisualOpen,   setFullVisualOpen]   = useState(false);
  const [momentScale,      setMomentScale]      = useState(1);
  const suppressNextClick  = useRef(false);
  const coverRef           = useRef(null);
  const dwellTimerRef      = useRef(null);

  const { assets, primaryAsset } = useVisualAssets(mediaItem?.slug, accountState);
  const hasVisualMoment = Boolean(primaryAsset);
  const coverLifecycle = useReleaseCoverLifecycle(
    presentationIdentity,
    coverDisplay?.type === "video"
      ? mediaItem?.video || mediaItem?.visual || coverDisplay?.src
      : coverDisplay?.src
  );

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
      {/* Animated cover art / static cover */}
      {!videoFailed && (mediaItem?.video || mediaItem?.visual) && coverDisplay?.type === "video" ? (
        <video
          src={mediaItem?.video || mediaItem?.visual || undefined}
          poster={mediaItem.cover || undefined}
          autoPlay muted loop playsInline preload="auto"
          webkit-playsinline="true"
          onLoadedMetadata={coverLifecycle.onVideoLoadedMetadata}
          onLoadedData={coverLifecycle.onVideoLoadedData}
          onError={() => setVideoFailed(true)}
          style={{ backgroundColor: "#0a0a0a", width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block", transition: "transform 0.3s, filter 0.3s, box-shadow 0.3s", pointerEvents: "none" }}
        />
      ) : (
        <CoverArt
          src={coverDisplay.src}
          baseCover={mediaItem?.baseCover || undefined}
          type={coverDisplay.type || mediaItem.coverArtType}
          presentationIdentity={presentationIdentity}
          alt="" width="100%" height="auto"
          style={{ aspectRatio: "1/1", transition: "transform 0.3s, filter 0.3s, box-shadow 0.3s", display: "block" }}
        />
      )}

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

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CatalogGrid({
  items,
  type,
  addToCart,
  hoverIn,
  hoverOut,
  buttonHoverIn,
  buttonHoverOut,
  onCardClick,
  onPlayAlbum,
  onOpenAlbumTracklist,
  catalogPlaybackLookup,
  isMobile,
  onGift,
  onLibraryChange,
}) {
  const { entitlementAccountState, userId, isAdminStable } = useStorefrontCardChrome();
  const accountState = entitlementAccountState;
  const isAdmin = isAdminStable;
  if (!items || items.length === 0) return null;
  const containerStyle = isMobile
    ? { display:"flex", flexWrap:"nowrap", overflowX:"auto", overflowY:"hidden", WebkitOverflowScrolling:"touch", scrollSnapType:"x mandatory", overscrollBehaviorX:"contain", touchAction:"pan-x pan-y", gap:12, paddingBottom:10 }
    : { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:22 };
  return (
    <div className={isMobile?`${type}-row`:""} style={containerStyle}>
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
              className="release-card release-card--upcoming"
              onClick={() => onCardClick?.(mediaItem)}
              style={{
                ...(isMobile ? { flex: "0 0 160px", width: 160, scrollSnapAlign: "start" } : {}),
                position: "relative",
                background: "#0a0a0a",
                borderRadius: isMobile ? 12 : 16,
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
              <div className="release-card-meta" style={{ padding: isMobile ? "10px" : "14px 16px" }}>
                <div className="release-card-title" style={{ fontSize: isMobile ? 12 : 14, fontWeight: 700 }}>
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
          style={{...(isMobile?{flex:"0 0 160px",width:160,scrollSnapAlign:"start"}:{}),position:"relative",background:"#0a0a0a",borderRadius:isMobile?12:16,overflow:"hidden",border:"1px solid #1a1a1a",transition:"border-color 0.25s"}}
          onMouseEnter={e=>e.currentTarget.style.borderColor="#2a2a2a"}
          onMouseLeave={e=>e.currentTarget.style.borderColor="#1a1a1a"}
        >
          <ReleasePresentationProbe
            identity={presentationIdentity}
            entitlementIdentity={entitlementIdentity}
          />
          {isAdmin ? <GiftOverlayButton onClick={() => onGift?.(mediaItem)} /> : null}
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
          <div style={{padding:isMobile?"10px 10px 14px":"14px 16px 18px"}}>
            <div className={type==="albums"&&isUpcomingReleaseDate(mediaItem.date)?"song-title-turquoise-glow":undefined} style={{fontSize:isMobile?12:14,fontWeight:700,marginBottom:4,lineHeight:1.3}}>{mediaItem.title}</div>
            {mediaItem.date && <div style={{fontSize:isMobile?9:11,color:"#444",marginBottom:6,letterSpacing:1}}>{mediaItem.date}</div>}
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
            {access?.showPrice && <div style={{fontSize:isMobile?12:13,color:"#00ffff",fontWeight:700,marginBottom:isMobile?8:10}}>${mediaItem.price.toFixed(2)}</div>}
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
              ) : access?.showCart ? (
                <button onClick={()=>addToCart(mediaItem)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{flex:1,padding:isMobile?"9px 0":"8px 0",fontSize:isMobile?11:12,background:"#1a1a1a",color:"white",border:"1px solid #2a2a2a",cursor:"pointer",borderRadius:isMobile?7:8,transition:"0.25s",fontWeight:600,minWidth:72}}>Add to Cart</button>
              ) : null}
            </div>
          </div>
        </PlaybackPrewarmCardShell>
      );
      })}
    </div>
  );
}

export default memo(CatalogGrid);

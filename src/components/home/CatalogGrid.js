"use client";

import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import { itemHasPlayableAudio, resolveContentAccess } from "@/lib/music-access";
import { albumCardPlaybackItem } from "@/lib/music-playback";
import { withR2CatalogMedia, isUpcomingReleaseDate } from "@/components/home/catalogMedia";
import { CountdownTimer } from "@/components/music/CountdownTimer";

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function CatalogGrid({ items, type, addToCart, hoverIn, hoverOut, buttonHoverIn, buttonHoverOut, onCardClick, onOpenAlbumTracklist, isMobile, accountState, userId, isAdmin, onGift, onLibraryChange }) {
  if (!items || items.length === 0) return null;
  const containerStyle = isMobile
    ? { display:"flex", flexWrap:"nowrap", overflowX:"auto", WebkitOverflowScrolling:"touch", scrollSnapType:"x mandatory", overscrollBehaviorX:"contain", gap:12, paddingBottom:10 }
    : { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:22 };
  return (
    <div className={isMobile?`${type}-row`:""} style={containerStyle}>
      {items.map(item=>{
        const access = resolveContentAccess(item, accountState);
        const showPlayActions = itemHasPlayableAudio(item, access);
        const playItem = type === "albums" ? albumCardPlaybackItem(item) : item;
        const albumLibraryItem = accountState?.library?.find(
          (lib) => lib.slug === item?.slug
        );
        const albumIsGifted =
          albumLibraryItem?.source === "gift" ||
          albumLibraryItem?.gifted === true;
        const targetDate = item.scheduled_publish_at || item.date;
        const isUpcoming =
          item.status === "scheduled" || isUpcomingReleaseDate(targetDate);

        if (isUpcoming) {
          return (
            <div
              key={item.slug}
              className="release-card release-card--upcoming"
              style={{
                ...(isMobile ? { flex: "0 0 160px", width: 160, scrollSnapAlign: "start" } : {}),
                position: "relative",
                background: "#0a0a0a",
                borderRadius: isMobile ? 12 : 16,
                overflow: "hidden",
                border: "1px solid #1a1a1a",
              }}
            >
              <div className="release-card-cover release-card-cover--locked">
                <img
                  src={item.cover}
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
                  {item.title}
                </div>
                <div className="release-card-upcoming-label">DROPPING SOON</div>
              </div>
            </div>
          );
        }

        return (
        <div key={item.slug} style={{...(isMobile?{flex:"0 0 160px",width:160,scrollSnapAlign:"start"}:{}),position:"relative",background:"#0a0a0a",borderRadius:isMobile?12:16,overflow:"hidden",border:"1px solid #1a1a1a",transition:"border-color 0.25s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="#2a2a2a"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1a1a1a"}>
          {isAdmin ? <GiftOverlayButton onClick={() => onGift?.(item)} /> : null}
          <div onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => onCardClick?.(item)} style={{ cursor: "pointer" }}>
            <CoverArt
              src={item.cover}
              type={item.coverArtType}
              alt=""
              width="100%"
              height="auto"
              style={{
                aspectRatio: "1/1",
                transition: "transform 0.3s, filter 0.3s, box-shadow 0.3s",
                display: "block",
              }}
            />
          </div>
          {type==="albums"&&(item.type==="deluxe"||item.releaseType==="deluxe")?(
            <span style={{position:"absolute",top:8,right:8,fontSize:9,fontWeight:800,letterSpacing:1.2,padding:"4px 7px",borderRadius:6,background:"rgba(245,158,11,0.92)",color:"#111"}}>DELUXE</span>
          ):null}
          <div style={{padding:isMobile?"10px 10px 14px":"14px 16px 18px"}}>
            <div className={type==="albums"&&isUpcomingReleaseDate(item.date)?"song-title-turquoise-glow":undefined} style={{fontSize:isMobile?12:14,fontWeight:700,marginBottom:4,lineHeight:1.3}}>{item.title}</div>
            {item.date && <div style={{fontSize:isMobile?9:11,color:"#444",marginBottom:6,letterSpacing:1}}>{item.date}</div>}
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
            {access?.showPrice && <div style={{fontSize:isMobile?12:13,color:"#00ffff",fontWeight:700,marginBottom:isMobile?8:10}}>${item.price.toFixed(2)}</div>}
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}} onClick={type==="albums"?e=>e.stopPropagation():undefined}>
              {showPlayActions && type==="albums" ? (
                <div style={{flex:1,minWidth:0}}>
                  <ReleaseCardActions
                    item={withR2CatalogMedia(playItem)}
                    accountState={accountState}
                    userId={userId}
                    source="home_album_card"
                    showCart={Boolean(access?.showCart)}
                    onPlayClick={(e) => {
                      e.stopPropagation();
                      onOpenAlbumTracklist?.(withR2CatalogMedia(item));
                    }}
                    onAddToCart={e => { e.stopPropagation(); addToCart(item); }}
                    cartButtonStyle={{
                      background:"#1a1a1a",
                      color:"white",
                      border:"1px solid #2a2a2a",
                    }}
                    cartLabel="+ Cart"
                  />
                </div>
              ) : access?.showCart ? (
                <button onClick={()=>addToCart(item)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{flex:1,padding:isMobile?"9px 0":"8px 0",fontSize:isMobile?11:12,background:"#1a1a1a",color:"white",border:"1px solid #2a2a2a",cursor:"pointer",borderRadius:isMobile?7:8,transition:"0.25s",fontWeight:600,minWidth:72}}>Add to Cart</button>
              ) : null}
              {userId && type==="albums" && <span onClick={e=>e.stopPropagation()}><MusicPlusButton track={item} userId={userId} access={access} isMobile={isMobile} deepLinkType="album" onLibraryChange={onLibraryChange} /></span>}
            </div>
          </div>
        </div>
      );})}
    </div>
  );
}

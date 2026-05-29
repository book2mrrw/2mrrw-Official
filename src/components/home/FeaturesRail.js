"use client";

import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import { itemHasPlayableAudio, resolveContentAccess } from "@/lib/music-access";
import { catalogCoverDisplay, withR2CatalogMedia } from "@/components/home/catalogMedia";
export default function FeaturesRail({ features, isMobile, addToCart, onOpenFeature, accountState, userId, isAdmin, onGift, onLibraryChange }) {
  return (
    <div className="features-row" style={{display:"flex",flexWrap:"nowrap",overflowX:"auto",WebkitOverflowScrolling:"touch",scrollSnapType:"x mandatory",overscrollBehaviorX:"contain",gap:isMobile?12:18,paddingBottom:14}}>
      {features.map((feat,i)=>{
        const item = withR2CatalogMedia(feat);
        const access = resolveContentAccess(item, accountState);
        const showPlayActions = itemHasPlayableAudio(item, access);
        const coverDisplay = catalogCoverDisplay(item);
        return (
        <div key={item.slug || item.id || `feature-${i}`} style={{flex:"0 0 auto",width:isMobile?160:220,scrollSnapAlign:"start",background:"#0a0a0a",borderRadius:14,border:"1px solid #1a1a1a",opacity:0,animation:`fadeInUp 0.5s ease ${i*0.09}s forwards`,transition:"border-color 0.25s",position:"relative"}} onMouseEnter={e=>e.currentTarget.style.borderColor="#a259ff55"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1a1a1a"}>
          {isAdmin ? <GiftOverlayButton onClick={() => onGift?.(item)} /> : null}
          <div
            role="button"
            tabIndex={0}
            onClick={() => onOpenFeature?.(item)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenFeature?.(item);
              }
            }}
            style={{ cursor: "pointer" }}
          >
          <CoverArt
            src={coverDisplay.src}
            type={coverDisplay.type || "image"}
            alt=""
            width="100%"
            height="auto"
            borderRadius="13px 13px 0 0"
            style={{ aspectRatio: "1/1", display: "block" }}
          />
          </div>
          <div style={{padding:isMobile?"10px 12px 14px":"12px 14px 16px"}}>
            <div className="hero-title-glow" style={{fontSize:isMobile?12:13,fontWeight:700,marginBottom:4}}>{item.title}</div>
            <div style={{fontSize:10,color:"#a259ff",fontWeight:700,letterSpacing:1.5,marginBottom:6}}>{item.featuring}</div>
            {access?.showPrice && item.price != null && Number.isFinite(Number(item.price)) ? (
              <div style={{fontSize:12,color:"#00ffff",fontWeight:700,marginBottom:isMobile?8:10}}>${Number(item.price).toFixed(2)}</div>
            ) : null}
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
              {showPlayActions ? (
                <div style={{flex:1,minWidth:0}}>
                  <ReleaseCardActions
                    item={item}
                    accountState={accountState}
                    userId={userId}
                    source="home_feature_card"
                    showCart={Boolean(access?.showCart)}
                    onLibraryChange={onLibraryChange}
                    onAddToCart={e => { e.stopPropagation(); addToCart(item); }}
                    cartButtonStyle={{
                      background:"#1a1a1a",
                      color:"white",
                      border:"1px solid #2a2a2a",
                    }}
                    cartLabel="+ Cart"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      );})}
    </div>
  );
}

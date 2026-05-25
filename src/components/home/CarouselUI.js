"use client";

import { useState } from "react";
import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import { resolveContentAccess } from "@/lib/music-access";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
export default function CarouselUI({ large, isMobile, currentSingle, currentSingleAccess, singleIndex, singles, prevSingle, nextSingle, goToSingle, openSingleModal, addToCart, addVinylToCart, buttonHoverIn, buttonHoverOut, accountState, userId, isAdmin, onGift, onLibraryChange }) {
  const [previewHover, setPreviewHover] = useState(false);
  const access = currentSingleAccess || (currentSingle ? resolveContentAccess(currentSingle, accountState) : null);
  const coverDisplay = catalogCoverDisplay(currentSingle);
  const currentLibraryItem = accountState?.library?.find(
    (lib) => lib.slug === currentSingle?.slug
  );
  const currentSingleIsGifted =
    currentLibraryItem?.source === "gift" ||
    currentLibraryItem?.gifted === true;
  return (
    <div style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",gap:isMobile?16:20,background:"linear-gradient(135deg,#0e0e0e,#111)",border:"1px solid #1e1e1e",borderRadius:isMobile?16:20,padding:isMobile?"20px 16px":large?"32px 28px":"28px 24px",position:"relative",overflow:"hidden",boxShadow:"0 4px 40px rgba(0,0,0,0.5)"}}>
      {isAdmin ? <GiftOverlayButton onClick={() => onGift?.(currentSingle)} /> : null}
      <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:360,height:360,background:"radial-gradient(circle,rgba(0,255,255,0.04) 0%,transparent 70%)",pointerEvents:"none"}}/>
      {isMobile ? (
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={prevSingle} style={{width:44,height:44,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"1px solid #2a2a2a",color:"#555",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>‹</button>
          <div style={{flex:1,position:"relative",aspectRatio:"1/1"}} onMouseEnter={()=>setPreviewHover(true)} onMouseLeave={()=>setPreviewHover(false)}>
            <CoverArt
              key={currentSingle.slug}
              src={coverDisplay.src}
              type={coverDisplay.type || "image"}
              alt=""
              width="100%"
              height="100%"
              borderRadius={14}
              style={{
                boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
                transition: "filter 0.3s",
                filter: previewHover ? "brightness(0.55)" : "brightness(1)",
                animation: "fadeInCover 0.4s ease forwards",
              }}
            />
            <div onClick={()=>openSingleModal(currentSingle)} style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,borderRadius:14,cursor:"pointer",opacity:previewHover?1:0,transition:"opacity 0.25s"}}>
              <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(0,0,0,0.6)",backdropFilter:"blur(8px)",border:"1.5px solid rgba(255,255,255,0.25)",display:"flex",alignItems:"center",justifyContent:"center"}}><svg viewBox="0 0 24 24" fill="white" width="24" height="24" style={{marginLeft:3}}><path d="M8 5v14l11-7z"/></svg></div>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.85)",textTransform:"uppercase"}}>Preview</div>
            </div>
          </div>
          <button onClick={nextSingle} style={{width:44,height:44,borderRadius:"50%",background:"rgba(255,255,255,0.06)",border:"1px solid #2a2a2a",color:"#555",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>›</button>
        </div>
      ) : (
        <button onClick={prevSingle} style={{width:large?50:44,height:large?50:44,borderRadius:"50%",background:"rgba(255,255,255,0.04)",border:"1px solid #2a2a2a",color:"#555",fontSize:large?22:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#00ffff";e.currentTarget.style.color="#00ffff";e.currentTarget.style.boxShadow="0 0 10px rgba(0,255,255,0.3)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#2a2a2a";e.currentTarget.style.color="#555";e.currentTarget.style.boxShadow="none";}}>‹</button>
      )}
      {!isMobile && (
        <div style={{flexShrink:0,width:large?340:300,height:large?340:300,position:"relative"}} onMouseEnter={()=>setPreviewHover(true)} onMouseLeave={()=>setPreviewHover(false)}>
          <CoverArt
            key={currentSingle.slug}
            src={coverDisplay.src}
            type={coverDisplay.type || "image"}
            alt=""
            width="100%"
            height="100%"
            borderRadius={large ? 18 : 16}
            style={{
              boxShadow: large ? "0 10px 50px rgba(0,0,0,0.7)" : "0 8px 40px rgba(0,0,0,0.6)",
              transition: "filter 0.3s",
              filter: previewHover ? "brightness(0.55)" : "brightness(1)",
              animation: "fadeInCover 0.4s ease forwards",
            }}
          />
          <div onClick={()=>openSingleModal(currentSingle)} style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,borderRadius:large?18:16,cursor:"pointer",opacity:previewHover?1:0,transition:"opacity 0.25s"}}>
            <div style={{width:64,height:64,borderRadius:"50%",background:"rgba(0,0,0,0.55)",backdropFilter:"blur(8px)",border:"1.5px solid rgba(255,255,255,0.25)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 30px rgba(0,0,0,0.5)"}}><svg viewBox="0 0 24 24" fill="white" width="28" height="28" style={{marginLeft:3}}><path d="M8 5v14l11-7z"/></svg></div>
            <div style={{fontSize:12,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.85)",textTransform:"uppercase"}}>Preview</div>
          </div>
        </div>
      )}
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:isMobile?10:large?14:12}}>
        <div key={`title-${currentSingle.slug}`} className={isMobile?"song-title-turquoise-glow":"hero-title-glow"} style={{fontSize:isMobile?22:large?30:26,fontWeight:900,letterSpacing:2,animation:"fadeInUp 0.35s ease forwards"}}>{currentSingle.title}</div>
        <div style={{fontSize:13,color:"#555",letterSpacing:1,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span>SINGLE{large&&!isMobile?` · ${singleIndex+1} of ${singles.length}`:""}</span>
          <MusicAccessBadge access={access} label={access?.badge} compact />
          {currentSingleIsGifted ? (
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
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
        </div>
        {access?.showPrice && <div style={{fontSize:isMobile?16:large?18:16,color:"#00ffff",fontWeight:700}}>${currentSingle.price.toFixed(2)}</div>}
        <div style={{display:"flex",gap:6}}>
          {singles.map((s,i)=><div key={s.slug} onClick={()=>goToSingle(i,i>singleIndex?"right":"left")} style={{width:i===singleIndex?(isMobile?20:large?24:20):(isMobile?6:large?7:6),height:isMobile?6:large?7:6,borderRadius:4,background:i===singleIndex?"#00ffff":"#333",cursor:"pointer",transition:"all 0.3s",boxShadow:i===singleIndex?"0 0 8px rgba(0,255,255,0.6)":"none"}}/>)}
        </div>
        <div style={{display:"flex",gap:10,marginTop:isMobile?4:large?8:6,flexWrap:"wrap",alignItems:"center"}}>
          {access?.showCart && <button onClick={()=>addToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{padding:isMobile?"12px 0":large?"11px 20px":"10px 18px",background:"#0a0a0a",color:"#00ffff",border:"1px solid #00ffff",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:"bold",transition:"0.25s",width:isMobile?"100%":"auto"}}>+ Add to Cart</button>}
          {access?.showCart && (large||isMobile) && <button onClick={()=>addVinylToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{padding:isMobile?"12px 0":"11px 20px",background:"#0a0a0a",color:"#aaa",border:"1px solid #2a2a2a",borderRadius:8,cursor:"pointer",fontSize:13,transition:"0.25s",width:isMobile?"100%":"auto"}}>+ Vinyl $47.99</button>}
          {userId && <MusicPlusButton track={currentSingle} userId={userId} access={access} isMobile={isMobile} onLibraryChange={onLibraryChange} />}
        </div>
      </div>
      {!isMobile && <button onClick={nextSingle} style={{width:large?50:44,height:large?50:44,borderRadius:"50%",background:"rgba(255,255,255,0.04)",border:"1px solid #2a2a2a",color:"#555",fontSize:large?22:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#00ffff";e.currentTarget.style.color="#00ffff";e.currentTarget.style.boxShadow="0 0 10px rgba(0,255,255,0.3)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#2a2a2a";e.currentTarget.style.color="#555";e.currentTarget.style.boxShadow="none";}}>›</button>}
    </div>
  );
}

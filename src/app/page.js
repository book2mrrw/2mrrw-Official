"use client";
import { useState, useEffect, useRef, useCallback, useMemo, memo, startTransition, Suspense } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import CheckoutForm from "@/components/payments/CheckoutForm";
const DonateModal = dynamic(() => import("@/components/payments/DonateModal"), { ssr: false });
import { useAuth } from "@/context/AuthContext";
import { getControlSystemReleaseDetail } from "@/lib/control-system/releases";
import ImmersivePreviewModal from "@/components/preview/ImmersivePreviewModal";
import GiftBottomSheet from "@/components/gifts/GiftBottomSheet";
import GiftButton from "@/components/gifts/GiftButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import GiftsSentSection from "@/components/gifts/GiftsSentSection";
import CollectorCardAdminPanel from "@/components/admin/CollectorCardAdminPanel";
import HelpSupportSection from "@/components/support/HelpSupportSection";
import MyMusicTab from "@/components/music/MyMusicTab";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import { parseDeepLink, consumePendingDeepLink, setPostAuthRedirect } from "@/lib/deep-links";
import { consumeGiftHighlightSlug } from "@/lib/gifts/session-keys";
import { resolveContentAccess, resolvePlaybackSrc, isAdminAccount } from "@/lib/music-access";
import { albumTracksForPlayback, toPlaybackTrack } from "@/lib/music-playback";
import { useAudioPlayer } from "@/context/AudioContext";
import { useMediaEngine } from "@/media/useMediaEngine";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import AlbumTracklistSheet from "@/components/music/AlbumTracklistSheet";
import { VaultUnlockedRoom } from "@/components/vault/VaultUnlockedRoom";
import { MobileNavAnimatedIcon } from "@/components/nav/MobileNavAnimatedIcon";
import { VaultNavLockIcon } from "@/components/nav/VaultNavLockIcon";
import { COLLECTORS_CARDS_ROUTE } from "@/lib/collectors-cards";
import { catalogCoverUrl, catalogMotionVideoUrl, catalogPreviewAudioUrl, catalogPublicMediaUrl } from "@/lib/media-urls";
import CoverArt, { resolveCoverMediaType } from "@/components/ui/CoverArt";
import LivePanel from "@/components/home/LivePanel";
import FlowState from "@/components/home/FlowState";
import RadioCarousel from "@/components/home/RadioCarousel";
import AmbientPlaybackBackground from "@/components/home/AmbientPlaybackBackground";
import CarouselUI from "@/components/home/CarouselUI";
import FeaturesRail from "@/components/home/FeaturesRail";
import CatalogGrid from "@/components/home/CatalogGrid";
import { withR2CatalogMedia, catalogCoverDisplay } from "@/components/home/catalogMedia";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";
import { ModalErrorBoundary } from "@/system/errors";
import { useAbortController } from "@/system/guards/useAbortController";
import { TrackCardSkeleton } from "@/ui/skeletons";

const MOBILE_NAV_TABS = [
  { id: "home", label: "Home" },
  { id: "singles", label: "Music" },
  { id: "mymusic", label: "Collection" },
  { id: "shop", label: "Shop" },
  { id: "cards", label: "Cards" },
  { id: "vault", label: "Vault", vault: true },
  { id: "more", label: "More", more: true },
];
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);


const SPRING_SOFT = { type: "spring", stiffness: 280, damping: 32 };
const MOBILE_NAV_SHEET_MS = 300;
const OVERLAY_FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.22 } };
const SHEET_UP = { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" }, transition: SPRING_SOFT };
const MOBILE_NAV_SHEET_SLIDE = {
  initial: { y: "100%" },
  animate: { y: 0 },
  transition: { duration: MOBILE_NAV_SHEET_MS / 1000, ease: [0.4, 0, 0.2, 1] },
};
const MODAL_CENTER = { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.96 }, transition: SPRING_SOFT };
const MOBILE_NAV_MORE_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

// ── HELPERS ───────────────────────────────────────────────────────────────────
const formatTime = (s) => {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// ── SOCIALS ───────────────────────────────────────────────────────────────────
const SOCIALS = [
  { name: "YouTube",   href: "https://youtube.com/@callme2mrrw?si=Bwvli5p7hhvED7eq",                svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>) },
  { name: "Instagram", href: "https://www.instagram.com/callme2mrrw?igsh=MXMwdzNiZGE5NTJwaw==",      svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>) },
  { name: "TikTok",    href: "https://tiktok.com/@thareal2mrrw",                                      svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>) },
  { name: "Twitch",    href: "https://twitch.tv/callme2mrrw",                                         svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>) },
  { name: "X",         href: "https://x.com/callme2mrrw",                                            svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>) },
  { name: "Patreon",   href: "https://patreon.com/2mrrw",                                             svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M0 .48v23.04h4.22V.48zm15.385 0c-4.764 0-8.641 3.88-8.641 8.65 0 4.755 3.877 8.623 8.641 8.623 4.75 0 8.615-3.868 8.615-8.623C24 4.36 20.136.48 15.385.48z"/></svg>) },
];

// ── AUDIO VISUALS (music videos) ─────────────────────────────────────────────
const musicVideos = [
  { id:"mv-1", title:"Hour Glass", youtubeId:"tv_aS-hJ880", description:"Official Music Video" },
  { id:"mv-2", title:"A2B",        youtubeId:"kPITYHMVeXM", description:"Official Music Video" },
  { id:"mv-3", title:"W.2.D",      youtubeId:"jsrA1SL3_GU", description:"Official Music Video" },
];

// ── EXCLUSIVE ITEMS ───────────────────────────────────────────────────────────
const REAL_INVENTORY = {
  "exc-bundle-lovehz": null,
  "exc-signed-vinyl":  null,
};

const exclusiveItemsBase = [
  { id:"exc-bundle-lovehz",title:"Love Hz Vol.1 Launch Bundle", subtitle:"Collector Bundle · Launch Edition", type:"bundle",         cover:"/images/albums/lovehz.jpg", price:149.99, description:"Full digital album + collector art card + hand-signed lyric sheet. Exclusive to launch supporters. This is ownership. Not just music.",                                                                               features:["Digital album — instant download","Collector art card (numbered)","Hand-signed lyric sheet","Early listener credit","Inner Circle badge unlocked"],        badge:"LAUNCH BUNDLE",  badgeColor:"#a259ff", slug:"exc-bundle-lovehz" },
  { id:"exc-signed-vinyl",  title:"Signed Vinyl — T.B.H.",      subtitle:"Hand-Signed · Limited Press",      type:"vinyl",          cover:"/images/albums/tbh.jpg",    price:74.99,  description:"T.B.H. on wax, hand-signed on the sleeve. Limited press. This is the record you pull out and show people. The one that started it.",                                                                                features:["Hand-signed sleeve by 2MRRW","Limited press run","Ships in protective sleeve","Certificate of authenticity","Collector-grade packaging"],                  badge:"SIGNED",          badgeColor:"#00ffff", slug:"exc-signed-vinyl" },
];

// ── CIRCLE RESPONSES ──────────────────────────────────────────────────────────
const circleResponses = [
  { id:"resp-1", question:"What does 2MRRW actually mean to you personally?",                            questionBy:"EarlyFan_J",    questionTime:"March 15, 2026", response:"It means tomorrow is always possible. No matter how heavy today gets, you hold on because tomorrow is a blank page. That's the whole movement — not optimism, just possibility.", tag:"VISIONARY PICK",      tagColor:"#a259ff", highlight:true  },
  { id:"resp-2", question:"How do you decide which songs make the album vs. which stay unreleased?",     questionBy:"Listener_K",    questionTime:"March 28, 2026", response:"The ones that make it are the ones that still hurt when I listen back. If I can hear it and feel nothing — it's not ready for you. If it still cuts, it's real enough to share.",        tag:"FEATURED",            tagColor:"#00ffff", highlight:false },
  { id:"resp-3", question:"Will there be a Love Hz Vol.2?",                                              questionBy:"Collector_001", questionTime:"April 5, 2026",  response:"Already working on it. Vol.1 was the introduction to the frequency. Vol.2 is what happens when the signal locks in. You'll feel the difference.",                               tag:"COMMUNITY HIGHLIGHT", tagColor:"#ff6b35", highlight:false },
];

// ── INNER CIRCLE POSTS ────────────────────────────────────────────────────────
const innerCirclePosts = [
  { id:"ic-1", title:"Why I Almost Scrapped Love Hz Vol.1",   date:"April 10, 2026",  preview:"There was a version of this project that never would have seen the light. Here's what changed.",       body:"There was a point — around month 14 of making this album — where I deleted everything. The whole project folder. Emptied the trash. Gone.\n\nIt wasn't creative block. It was the opposite. I had too much. 22 songs and none of them felt like they belonged together. I was chasing something I couldn't name yet.\n\nWhat brought it back was stripping it down to 6 tracks and asking: which of these would I still stand behind in 10 years? The answer became Love Hz Vol.1. Not the version I planned. The version that survived." },
  { id:"ic-2", title:"The Story Behind W.2.D",                date:"March 30, 2026",  preview:"This track wasn't written in a studio. It was written in a parking lot at 2am. Here's the full story.", body:"W.2.D was written in the front seat of my car outside a gas station on I-20. It was 2am. I had my phone, a voice memo app, and about 40 minutes before I needed to be somewhere.\n\nThe whole thing came out in one sitting. Sometimes that happens. You stop trying to write and the song just falls out of you.\n\nI drove home, set up my mic, and recorded a demo that night. The version you're hearing is that demo, cleaned up. The urgency in it is real. That's not performance — that's actually what 2am sounds like." },
  { id:"ic-3", title:"What the Collector Cards Actually Mean", date:"March 18, 2026",  preview:"It's not merch. Here's the full vision behind the physical collector system and where it's going.",   body:"People keep calling the collector cards merch. They're not merch.\n\nMerch is a t-shirt. You wear it, it fades, you forget about it. A collector card is a record of presence. It says: I was here when this was being built. I believed before it was obvious.\n\nThe long-term vision is a tiered system where each card unlocks something real — early access, private sessions, input on creative decisions. The NFC chip on the 2MRRW: (A.D) card is the first version of that. It's going to go much further.\n\nIf you have one, hold it. You're not holding merch. You're holding a key." },
];

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const nextLiveDateTime = new Date("2026-05-10T20:00:00");
const events = [
  { id:"evt-1", name:"2MRRW Live – Dallas",  location:"Dallas, TX",      date:"2026-05-10", time:"8:00 PM", price:25.00, tickets:50 },
  { id:"evt-2", name:"2MRRW Live – Houston", location:"Houston, TX",     date:"2026-05-24", time:"9:00 PM", price:25.00, tickets:75 },
  { id:"evt-3", name:"2MRRW Live – Atlanta", location:"Atlanta, GA",     date:"2026-06-07", time:"8:30 PM", price:30.00, tickets:60 },
  { id:"evt-4", name:"2MRRW Live – LA",      location:"Los Angeles, CA", date:"2026-06-21", time:"9:00 PM", price:35.00, tickets:40 },
  { id:"evt-5", name:"2MRRW Live – NYC",     location:"New York, NY",    date:"2026-07-04", time:"8:00 PM", price:35.00, tickets:45 },
];
const radioSlides = [
  { slug:"hour-glass",     title:"Hour Glass",     type:"single", cover:"/images/singles/hourglass.jpg", price:2.99, tag:"NOW PLAYING", tagColor:"#00ffff" },
  { slug:"w2d",            title:"W.2.D",          type:"single", cover:"/images/singles/w2d.jpg",       price:2.99, tag:"FEATURED",    tagColor:"#a259ff" },
  { slug:"artificial",     title:"Artificial",     type:"single", cover:"/images/singles/artificial.jpg",price:2.99, tag:"TRENDING",    tagColor:"#ff6b35" },
  { slug:"turnt-me-2-dis", title:"Turnt Me 2 Dis", type:"single", cover:"/images/singles/turnt.jpg",     price:2.99, tag:"FEATURED",    tagColor:"#00ffff" },
];

const features = [
  { title:"I Don't Believe You", slug:"i-dont-believe-you", type:"feature", cover:"/images/features/idbu.jpg",   price:2.99, featuring:"FT. 2MRRW", preview:"/audio/previews/i-dont-believe-you-preview.wav" },
  { title:"2 Heavy",             slug:"2-heavy",            type:"feature", cover:"/images/features/2heavy.jpg", price:2.99, featuring:"FT. 2MRRW", preview:"/audio/previews/2-heavy-preview.wav" },
];

// ── SINGLES — FIXED: all paths point to /videos/singles/, wdaguys removed ────
const singles = [
  {
    title: "Hour Glass",
    slug: "hour-glass",
    type: "single",
    cover: "/images/singles/hourglass.jpg",
    video: "/videos/singles/hourglass.mp4",
    price: 2.99,
    preview: "/audio/previews/hourglass-preview.mp3",
  },
  {
    title: "W.2.D",
    slug: "w2d",
    type: "single",
    cover: "/images/singles/w2d.jpg",
    video: "/videos/singles/w2d.mp4",
    price: 2.99,
    preview: "/audio/previews/w2d-preview.mp3",
  },
  {
    title: "Artificial",
    slug: "artificial",
    type: "single",
    cover: "/images/singles/artificial.jpg",
    video: "/videos/singles/artificial.mp4",
    price: 2.99,
    preview: "/audio/previews/artificial-preview.mp3",
  },
  {
    title: "Turnt Me 2 Dis",
    slug: "turnt-me-2-dis",
    type: "single",
    cover: "/images/singles/turnt.jpg",
    video: "/videos/singles/turntme2dis.mp4",
    price: 2.99,
    preview: "/audio/previews/turntme2dis-preview.mp3",
  },
];

const albums = [
  { title:"T.B.H.",        slug:"tbh",     type:"album", cover:"/images/albums/tbh.jpg",    price:9.99,  date:"July 7, 2022",   vinyl:47.99, tracks:["Glass Full","Up 2 Me","Unexpcted","All Yours","Locomotive","LEFT","Was Wrong","ArTiFICiaL"] },
  { title:"(A.D)",         slug:"ad",      type:"album", cover:"/images/albums/ad.jpg",     price:9.99,  date:"March 24, 2024", vinyl:47.99, tracks:["2mrrw's Ntro","Said N' Done","A.D.D","Perspective (2018)","Grand Scheme","A2B","Life Changes (2018)","Itself (2018)","Wastin Time","Like Me Or Not"] },
  { title:"Love Hz Vol.1", slug:"love-hz", type:"album", cover:"/images/albums/lovehz.jpg", price:12.99, date:"August 2026",    vinyl:47.99, tracks:["Roll Call","W.2.D","All Of It","Knock On Wood","Stayed 2 Long","Hour Glass"] },
];

const fallbackMerch = [
  { title:"2MRRW HOODIE",  slug:"hoodie", cover:"/images/albums/tbh.jpg",    price:59.99 },
  { title:"2MRRW T-SHIRT", slug:"shirt",  cover:"/images/albums/ad.jpg",     price:29.99 },
  { title:"2MRRW HAT",     slug:"hat",    cover:"/images/albums/lovehz.jpg", price:24.99 },
];

// ── INVENTORY HELPERS ─────────────────────────────────────────────────────────
function loadInventory() {
  try {
    const stored = localStorage.getItem("2mrrw_inventory");
    if (stored) return JSON.parse(stored);
  } catch {}
  const initial = {};
  Object.entries(REAL_INVENTORY).forEach(([slug, max]) => { initial[slug] = max; });
  return initial;
}
function saveInventory(inv) {
  try { localStorage.setItem("2mrrw_inventory", JSON.stringify(inv)); } catch {}
}
function decrementInventory(inv, slug) {
  if (!(slug in inv)) return inv;
  if (inv[slug] === null) return inv;
  if (inv[slug] <= 0) return inv;
  const next = { ...inv, [slug]: inv[slug] - 1 };
  saveInventory(next);
  return next;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── AUDIO VISUALS SECTION ────────────────────────────────────────────────────
const AudioVisualsSection = memo(function AudioVisualsSection({ isMobile, onAudioVisualsFocused }) {
  const [featuredId, setFeaturedId] = useState(musicVideos[0].youtubeId);
  const [hasEntered, setHasEntered] = useState(false);
  const sectionRef = useRef(null);
  const iframeRef = useRef(null);
  const firedFocusRef = useRef(false);

  const featuredVid = useMemo(
    () => musicVideos.find(v => v.youtubeId === featuredId) || musicVideos[0],
    [featuredId]
  );

  const triggerFocus = useCallback(() => {
    if (!firedFocusRef.current) {
      firedFocusRef.current = true;
      if (typeof onAudioVisualsFocused === "function") {
        onAudioVisualsFocused();
      }
    }
    setHasEntered(true);
  }, [onAudioVisualsFocused]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const threshold = isMobile ? 0.5 : 0.4;
    let hasBeenInView = false;

    const sendCmd = (cmd) => {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "command", func: cmd, args: [] }),
          "*"
        );
      } catch {}
    };

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          triggerFocus();
          if (hasBeenInView) {
            sendCmd("playVideo");
          }
          hasBeenInView = true;
        } else if (hasBeenInView) {
          sendCmd("pauseVideo");
        }
      },
      { threshold: [0, threshold] }
    );

    obs.observe(el);
    return () => obs.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback((id) => {
    setFeaturedId(id);
  }, []);

  const iframeSrc = useMemo(
    () => `https://www.youtube.com/embed/${featuredId}?rel=0&playsinline=1&autoplay=1&mute=0&enablejsapi=1`,
    [featuredId]
  );

  const handlePlaceholderClick = useCallback(() => {
    triggerFocus();
  }, [triggerFocus]);

  return (
    <div ref={sectionRef}>
      <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:isMobile?12:20,marginTop:isMobile?24:32}}>
        <h2 className="section-heading" style={{margin:0,fontSize:isMobile?17:22}}>Audio Visuals</h2>
        <span style={{fontSize:10,color:"#333",letterSpacing:3,textTransform:"uppercase",fontWeight:700}}>Official Visuals</span>
      </div>

      {isMobile ? (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:16,overflow:"hidden"}}>
            <div style={{position:"relative",paddingBottom:"56.25%",height:0,background:"#000"}}>
              {hasEntered ? (
                <iframe
                  key={featuredId}
                  ref={iframeRef}
                  src={iframeSrc}
                  title={featuredVid.title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",border:"none"}}
                />
              ) : (
                <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",cursor:"pointer"}} onClick={handlePlaceholderClick}>
                  <img
                    src={`https://img.youtube.com/vi/${featuredId}/mqdefault.jpg`}
                    alt={featuredVid.title}
                    style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
                  />
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.35)"}}>
                    <div style={{width:52,height:52,borderRadius:"50%",background:"rgba(0,0,0,0.7)",border:"2px solid rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <svg viewBox="0 0 24 24" fill="white" width="22" height="22" style={{marginLeft:3}}><path d="M8 5v14l11-7z"/></svg>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{padding:"12px 14px"}}>
              <div style={{fontSize:14,fontWeight:800,letterSpacing:1}}>{featuredVid.title}</div>
              <div style={{fontSize:11,color:"#555",marginTop:3}}>{featuredVid.description}</div>
            </div>
          </div>

          <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:6,scrollSnapType:"x mandatory",WebkitOverflowScrolling:"touch"}}>
            {musicVideos.map(vid => {
              const isActive = featuredId === vid.youtubeId;
              return (
                <div
                  key={vid.id}
                  onClick={() => handleSelect(vid.youtubeId)}
                  style={{
                    flex:"0 0 auto",
                    width:140,
                    scrollSnapAlign:"start",
                    background:"#0e0e0e",
                    border:`1px solid ${isActive ? "#00ffff55" : "#1e1e1e"}`,
                    borderRadius:12,
                    overflow:"hidden",
                    cursor:"pointer",
                    transition:"border-color 0.2s, box-shadow 0.2s",
                    boxShadow:isActive ? "0 0 12px rgba(0,255,255,0.18)" : "none",
                  }}
                >
                  <div style={{position:"relative",paddingBottom:"56.25%",height:0}}>
                    <img
                      src={`https://img.youtube.com/vi/${vid.youtubeId}/mqdefault.jpg`}
                      alt={vid.title}
                      style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",objectFit:"cover"}}
                    />
                    {isActive && (
                      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.45)"}}>
                        <div style={{width:28,height:28,borderRadius:"50%",background:"#00ffff",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <svg viewBox="0 0 24 24" fill="#000" width="12" height="12"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{padding:"8px 10px"}}>
                    <div style={{fontSize:11,fontWeight:700,lineHeight:1.3,color:isActive ? "#00ffff" : "white"}}>{vid.title}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{display:"flex",gap:20,alignItems:"flex-start"}}>
          <div style={{flex:"1 1 0",minWidth:0,background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:20,overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.5)"}}>
            <div style={{position:"relative",paddingBottom:"56.25%",height:0,background:"#000"}}>
              {hasEntered ? (
                <iframe
                  key={featuredId}
                  ref={iframeRef}
                  src={iframeSrc}
                  title={featuredVid.title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",border:"none"}}
                />
              ) : (
                <div
                  style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",cursor:"pointer"}}
                  onClick={handlePlaceholderClick}
                >
                  <img
                    src={`https://img.youtube.com/vi/${featuredId}/maxresdefault.jpg`}
                    alt={featuredVid.title}
                    style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
                    onError={e => { e.currentTarget.src = `https://img.youtube.com/vi/${featuredId}/mqdefault.jpg`; }}
                  />
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.3)"}}>
                    <div style={{width:72,height:72,borderRadius:"50%",background:"rgba(0,0,0,0.65)",border:"2px solid rgba(255,255,255,0.25)",display:"flex",alignItems:"center",justifyContent:"center",transition:"transform 0.2s"}} onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
                      <svg viewBox="0 0 24 24" fill="white" width="32" height="32" style={{marginLeft:4}}><path d="M8 5v14l11-7z"/></svg>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{padding:"16px 20px"}}>
              <div style={{fontSize:17,fontWeight:800,letterSpacing:1,marginBottom:4}}>{featuredVid.title}</div>
              <div style={{fontSize:12,color:"#555"}}>{featuredVid.description}</div>
            </div>
          </div>

          <div style={{width:236,flexShrink:0,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:9,color:"#2a2a2a",letterSpacing:3,textTransform:"uppercase",fontWeight:700,marginBottom:2}}>Up Next</div>
            {musicVideos.map(vid => {
              const isActive = featuredId === vid.youtubeId;
              return (
                <div
                  key={vid.id}
                  onClick={() => handleSelect(vid.youtubeId)}
                  style={{
                    background:isActive ? "#111" : "#0a0a0a",
                    border:`1px solid ${isActive ? "rgba(0,255,255,0.3)" : "#1a1a1a"}`,
                    borderRadius:14,
                    overflow:"hidden",
                    cursor:"pointer",
                    transition:"all 0.2s",
                    boxShadow:isActive ? "0 0 18px rgba(0,255,255,0.1)" : "none",
                  }}
                  onMouseEnter={e => {
                    if (!isActive) { e.currentTarget.style.borderColor = "rgba(0,255,255,0.2)"; e.currentTarget.style.background = "#0e0e0e"; }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.background = "#0a0a0a"; }
                  }}
                >
                  <div style={{display:"flex",gap:10,padding:10,alignItems:"center"}}>
                    <div style={{position:"relative",width:90,height:50,borderRadius:8,overflow:"hidden",flexShrink:0}}>
                      <img
                        src={`https://img.youtube.com/vi/${vid.youtubeId}/mqdefault.jpg`}
                        alt={vid.title}
                        style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
                      />
                      {isActive && (
                        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.5)"}}>
                          <svg viewBox="0 0 24 24" fill="#00ffff" width="16" height="16"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                        </div>
                      )}
                      {!isActive && (
                        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0)",transition:"background 0.2s"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(0,0,0,0.4)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0)"}>
                          <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0)" width="16" height="16" style={{transition:"fill 0.2s"}} onMouseEnter={e=>e.currentTarget.style.fill="white"} onMouseLeave={e=>e.currentTarget.style.fill="rgba(255,255,255,0)"}><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      )}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{
                        fontSize:12,
                        fontWeight:700,
                        color:isActive ? "#00ffff" : "white",
                        lineHeight:1.3,
                        overflow:"hidden",
                        textOverflow:"ellipsis",
                        whiteSpace:"nowrap",
                      }}>{vid.title}</div>
                      <div style={{fontSize:10,color:"#444",marginTop:2,lineHeight:1.3}}>{vid.description}</div>
                      {isActive && (
                        <div style={{fontSize:8,color:"#00ffff",letterSpacing:2.5,marginTop:4,fontWeight:700,textTransform:"uppercase"}}>Now Playing</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
export default function Page() {
  const { currentUser, library, owns, accountState, isAdmin, signOut, refreshLibrary, refreshAccountState, loading: authLoading } = useAuth();
  const {
    playTrack,
    playQueue,
    upgradeToFullStream,
    hasStarted,
    currentTrack,
    csMode,
    isPlaying,
    currentTime,
    duration,
    pause,
    toggle,
    seek,
  } = useAudioPlayer();
  // ── STATE ─────────────────────────────────────────────────────────────────
  const [cart, setCart]                           = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("2mrrw_cart");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [activeTab, setActiveTab]                 = useState("home");
  const [musicSubTab, setMusicSubTab]             = useState("singles");
  const [activeVideo, setActiveVideo]             = useState("tv_aS-hJ880");
  const [addedFlash, setAddedFlash]               = useState(null);
  const [soundOn, setSoundOn]                     = useState(false);
  const [selectedSingle, setSelectedSingle]       = useState(null);
  const [previewModalOpen, setPreviewModalOpen]   = useState(false);
  const [selectedReleaseDetail, setSelectedReleaseDetail] = useState(null);
  const [selectedAlbum, setSelectedAlbum]         = useState(null);
  const [singleIndex, setSingleIndex]             = useState(0);
  const [slideDir, setSlideDir]                   = useState("right");
  const [animating, setAnimating]                 = useState(false);
  const [checkingOut, setCheckingOut]             = useState(false);
  const [checkoutError, setCheckoutError]         = useState("");
  const [clientSecret, setClientSecret]           = useState(null);
  const [calMonth, setCalMonth]                   = useState(new Date().getMonth());
  const [calYear, setCalYear]                     = useState(new Date().getFullYear());
  const [selectedEvent, setSelectedEvent]         = useState(null);
  const [blogPost, setBlogPost]                   = useState(null);
  const [blogComment, setBlogComment]             = useState("");
  const [blogComments, setBlogComments]           = useState({});
  const [exclusiveModal, setExclusiveModal]       = useState(null);
  const [circleQuestion, setCircleQuestion]       = useState("");
  const [circleCategory, setCircleCategory]       = useState("question");
  const [circleSubmissions, setCircleSubmissions] = useState([]);
  const [circleSubmitted, setCircleSubmitted]     = useState(false);
  const myPurchases = useMemo(() => library || [], [library]);
  const [membershipUpsellOpen, setMembershipUpsellOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [giftSheetRelease, setGiftSheetRelease] = useState(null);
  const [giftHighlightSlug, setGiftHighlightSlug] = useState(null);
  const [albumTracklistRelease, setAlbumTracklistRelease] = useState(null);
  const [liveCountdown, setLiveCountdown]         = useState({ days:0, hours:0, minutes:0, seconds:0 });
  const [liveIsLive, setLiveIsLive]               = useState(false);
  const [innerCirclePost, setInnerCirclePost]     = useState(null);
  const [expandedGroup, setExpandedGroup]         = useState(null);
  const [mobileNavExpandedGroups, setMobileNavExpandedGroups] = useState(() => new Set());
  const [tabKey, setTabKey]                       = useState(0);
  const [nowPlaying, setNowPlaying]               = useState(null);
  const [radioIndex, setRadioIndex]               = useState(0);
  const [flowConversionActive, setFlowConversionActive] = useState(false);
  const [printfulProducts, setPrintfulProducts]   = useState([]);
  const [printfulLoading, setPrintfulLoading]     = useState(true);
  const [inventory, setInventory]                 = useState({});
  const [exclusiveCatalog, setExclusiveCatalog] = useState(exclusiveItemsBase);
  const [publicVault, setPublicVault]             = useState(null);
  const [isMobile, setIsMobile]                   = useState(false);
  const [mobileCartOpen, setMobileCartOpen]       = useState(false);
  const [mobileNavOpen, setMobileNavOpen]         = useState(false);
  const [mobileNavClosing, setMobileNavClosing]   = useState(false);
  const [homeScrollSection, setHomeScrollSection] = useState(null);
  const [heroScrollY, setHeroScrollY]             = useState(0);
  const [browseSingles, setBrowseSingles]         = useState(singles);
  const [catalogPage, setCatalogPage]             = useState(1);
  const [catalogHasMore, setCatalogHasMore]       = useState(false);
  const [catalogLoading, setCatalogLoading]       = useState(false);
  const catalogFetchAbort = useAbortController([catalogPage]);

  // ── REFS ──────────────────────────────────────────────────────────────────
  const cursorRef          = useRef(null);
  const cursorTrailRef     = useRef(null);
  const ambientRefs        = useRef({});
  const ytPlayerRef        = useRef(null);
  const ytIframeRef        = useRef(null);
  const mainScrollRef      = useRef(null);
  const singlesRowRef      = useRef(null);

  const syncSinglesCarouselVideos = useCallback(() => {
    const row = singlesRowRef.current;
    if (!row) return;
    const vw = window.innerWidth;
    row.querySelectorAll("video[data-single-carousel]").forEach((video) => {
      const card = video.closest("[data-single-card]");
      const rect = (card || video).getBoundingClientRect();
      const inView = rect.left >= 0 && rect.right <= vw;
      if (inView) video.play().catch(() => {});
      else video.pause();
    });
  }, []);

  // ── AUDIO FOCUS HANDLER ───────────────────────────────────────────────────
  const handleAudioVisualsFocused = useCallback(() => {
    if (isPlaying) pause();
  }, [isPlaying, pause]);

  // ── EFFECTS ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const onScroll = () => setHeroScrollY(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!isMobile || activeTab !== "home") return;
    const root = mainScrollRef.current;
    if (!root) return;
    const targets = [
      { id: "home-vault", section: "vault" },
      { id: "home-cards", section: "cards" },
      { id: "home-shows", section: "shows" },
    ];
    const nodes = targets
      .map(t => ({ ...t, el: document.getElementById(t.id) }))
      .filter(t => t.el);
    if (!nodes.length) return;
    const obs = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const match = nodes.find(n => n.el === visible[0].target);
          if (match) setHomeScrollSection(match.section);
        }
      },
      { root, threshold: [0.2, 0.45, 0.65], rootMargin: "-12% 0px -55% 0px" }
    );
    nodes.forEach(n => obs.observe(n.el));
    return () => obs.disconnect();
  }, [isMobile, activeTab, tabKey]);

  useEffect(() => {
    setInventory(loadInventory());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        const res = await fetch(`/api/catalog/releases?page=${catalogPage}&limit=20`, {
          cache: "no-store",
          signal: catalogFetchAbort.signal,
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const incoming = (data.tracks || []).map((t) => withR2CatalogMedia(t));
        setBrowseSingles((prev) => {
          const merged = catalogPage === 1 ? [...singles] : [...prev];
          const seen = new Set(merged.map((s) => s.slug));
          incoming.forEach((t) => {
            if (t?.slug && !seen.has(t.slug)) {
              seen.add(t.slug);
              merged.push(t);
            }
          });
          return merged;
        });
        setCatalogHasMore(Boolean(data.hasMore));
      } catch {
        /* keep static singles */
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogPage, catalogFetchAbort.signal]);

  const loadMoreCatalog = useCallback(() => {
    if (!catalogHasMore || catalogLoading) return;
    setCatalogPage((p) => p + 1);
  }, [catalogHasMore, catalogLoading]);

  const displaySingles = browseSingles.length ? browseSingles : singles;

  useEffect(() => {
    if (activeTab !== "home") return undefined;
    let debounceTimer;
    const onScroll = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(syncSinglesCarouselVideos, 100);
    };
    const row = singlesRowRef.current;
    row?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    syncSinglesCarouselVideos();
    const onVisibility = () => {
      if (document.hidden) {
        singlesRowRef.current?.querySelectorAll("video[data-single-carousel]").forEach((v) => v.pause());
      } else {
        syncSinglesCarouselVideos();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(debounceTimer);
      row?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeTab, tabKey, syncSinglesCarouselVideos]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/catalog/exclusive-drops", { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && response.ok && Array.isArray(payload.items) && payload.items.length) {
          setExclusiveCatalog(payload.items);
        }
      } catch {
        /* keep static fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "innercircle") return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/public/vault", { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && response.ok) setPublicVault(payload);
      } catch {
        if (!cancelled) setPublicVault(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    setPrintfulLoading(true);
    fetch("/api/printful/products")
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.products) && data.products.length > 0) {
          const normalized = data.products.map(p => ({
            slug:  p.slug  || String(p.id),
            title: p.title || p.name || "Untitled",
            cover: p.cover || p.thumbnail || p.thumbnail_url || p.preview_url || p.image || null,
            price: typeof p.price === "number"
              ? p.price
              : parseFloat(p.retail_price ?? p.variants?.[0]?.retail_price ?? 0),
          }));
          setPrintfulProducts(normalized);
        }
      })
      .catch(err => console.error("PRINTFUL FETCH ERROR:", err))
      .finally(() => setPrintfulLoading(false));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("2mrrw_circle");
    if (stored) setCircleSubmissions(JSON.parse(stored));
  }, []);

  useEffect(() => {
    localStorage.setItem("2mrrw_cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    const tick = () => {
      const diff = nextLiveDateTime - new Date();
      if (diff <= 0) { setLiveIsLive(true); setLiveCountdown({days:0,hours:0,minutes:0,seconds:0}); return; }
      setLiveIsLive(false);
      setLiveCountdown({
        days:    Math.floor(diff / (1000*60*60*24)),
        hours:   Math.floor((diff % (1000*60*60*24)) / (1000*60*60)),
        minutes: Math.floor((diff % (1000*60*60)) / (1000*60)),
        seconds: Math.floor((diff % (1000*60)) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const move = e => {
      if (cursorRef.current)      { cursorRef.current.style.left = e.clientX+"px"; cursorRef.current.style.top = e.clientY+"px"; }
      if (cursorTrailRef.current) { cursorTrailRef.current.style.left = e.clientX+"px"; cursorTrailRef.current.style.top = e.clientY+"px"; }
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);

  useEffect(() => {
    const paths = { shop:"shop", blog:"community", vision:"community", circle:"community", innercircle:"community", shows:"shows", live:"live", vault:"exclusive" };
    Object.values(ambientRefs.current).forEach(a => { try { a.pause(); } catch {} });
    if (soundOn && paths[activeTab]) {
      const src = catalogPublicMediaUrl(`audio/ambient/${paths[activeTab]}.mp3`);
      if (!ambientRefs.current[src]) { try { const a=new Audio(src); a.loop=true; a.volume=0.07; ambientRefs.current[src]=a; } catch {} }
      if (ambientRefs.current[src]) ambientRefs.current[src].play().catch(()=>{});
    }
    return () => { Object.values(ambientRefs.current).forEach(a => { try { a.pause(); } catch {} }); };
  }, [activeTab, soundOn]);

  const { state: { isPlaying: engineIsPlaying } } = useMediaEngine();

  useEffect(() => {
    if (!engineIsPlaying) return;
    Object.values(ambientRefs.current).forEach((a) => {
      try {
        a.pause();
      } catch {
        /* ambient refs are best-effort */
      }
    });
  }, [engineIsPlaying]);

  useEffect(() => {
    if (authLoading || !previewModalOpen || !selectedSingle?.slug) return;
    const access = resolveContentAccess(selectedSingle, accountState);
    if (!access?.canStream) return;
    const playbackTrack = toPlaybackTrack(
      selectedSingle,
      { ...accountState, userId: currentUser?.id },
      "preview_modal"
    );
    if (currentTrack?.slug === selectedSingle.slug) {
      void upgradeToFullStream();
      return;
    }
    void playTrack(playbackTrack);
  }, [
    authLoading,
    previewModalOpen,
    selectedSingle,
    accountState,
    currentUser?.id,
    currentTrack?.slug,
    playTrack,
    upgradeToFullStream,
  ]);

  useEffect(() => {
    if (activeTab !== "live") {
      if (ytPlayerRef.current) { try { ytPlayerRef.current.destroy(); } catch {} ytPlayerRef.current = null; }
    }
  }, [activeTab]);

  const playAlbumTracks = useCallback(
    (album, startIndex = 0) => {
      const tracks = albumTracksForPlayback(album, { ...accountState, userId: currentUser?.id }, "album_modal");
      if (tracks.length) {
        void playQueue(tracks, startIndex);
        return;
      }
      const access = resolveContentAccess(album, accountState);
      if (!access.canStream) return;
      void playTrack(toPlaybackTrack(album, { ...accountState, userId: currentUser?.id }, "album_modal"));
    },
    [accountState, currentUser?.id, playQueue, playTrack]
  );

  const goRadio = useCallback((i) => {
    // phase11: startTransition — carousel index is non-urgent
    startTransition(() => setRadioIndex(i));
  }, []);

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const addToCartRaw   = useCallback(item => {
    if (item.slug && owns(item.slug)) return;
    setCart(p => [...p, item]);
    setAddedFlash(item.slug);
    setTimeout(() => setAddedFlash(null), 400);
  }, [owns]);
  const addToCart      = useCallback(item => {
    addToCartRaw(item);
  }, [addToCartRaw]);
  const clearCart      = () => setCart([]);
  const removeFromCart = idx => setCart(p => p.filter((_, i) => i !== idx));
  const total          = cart.reduce((s, item) => s + item.price, 0);
  const cartRequiresShipping = useMemo(() => cart.some((item) => {
    const slug = String(item?.slug || "");
    if (slug === "vault-pass") return false;
    return slug.startsWith("exc-card") ||
      slug.startsWith("exc-bundle") ||
      slug.includes("vinyl") ||
      ["hoodie", "shirt", "hat"].includes(slug) ||
      slug.startsWith("evt-");
  }), [cart]);

  const hoverIn       = useCallback(e => { e.currentTarget.style.transform="scale(1.08)"; e.currentTarget.style.filter="brightness(1.15)"; e.currentTarget.style.boxShadow="0 0 18px rgba(0,255,255,0.6)"; }, []);
  const hoverOut      = useCallback(e => { e.currentTarget.style.transform="scale(1)";    e.currentTarget.style.filter="brightness(1)";    e.currentTarget.style.boxShadow="none"; }, []);
  const buttonHoverIn = useCallback(e => { e.currentTarget.style.boxShadow="0 0 14px rgba(0,255,255,0.8)"; e.currentTarget.style.borderColor="#00ffff"; }, []);
  const buttonHoverOut= useCallback(e => { e.currentTarget.style.boxShadow="none"; e.currentTarget.style.borderColor="#333"; }, []);

  const goToSingle = useCallback((newIndex, direction) => {
    setAnimating(cur => {
      if (cur) return cur;
      setTimeout(() => {
        // phase11: startTransition — carousel index is non-urgent
        startTransition(() => {
          setSingleIndex(newIndex);
          setAnimating(false);
        });
      }, 320);
      setSlideDir(direction);
      return true;
    });
  }, []);
  const prevSingle    = useCallback(() => goToSingle(singleIndex === 0 ? displaySingles.length-1 : singleIndex-1, "left"),  [goToSingle, singleIndex, displaySingles.length]);
  const nextSingle    = useCallback(() => goToSingle(singleIndex === displaySingles.length-1 ? 0 : singleIndex+1, "right"), [goToSingle, singleIndex, displaySingles.length]);
  const currentSingle = useMemo(() => withR2CatalogMedia(displaySingles[singleIndex]), [singleIndex, displaySingles]);
  const currentSingleAccess = useMemo(
    () => (currentSingle ? resolveContentAccess(currentSingle, accountState) : null),
    [currentSingle, accountState]
  );
  const selectedSingleAccess = useMemo(
    () => (selectedSingle ? resolveContentAccess(selectedSingle, accountState) : null),
    [selectedSingle, accountState]
  );
  const selectedAlbumAccess = useMemo(
    () => (selectedAlbum ? resolveContentAccess(selectedAlbum, accountState) : null),
    [selectedAlbum, accountState]
  );
  const addVinylToCart= useCallback(s => addToCart({ title:`${s.title} – Vinyl`, slug:`${s.slug}-vinyl`, cover:s.cover, price:47.99 }), [addToCart]);

  const openSingleModal = useCallback((single) => {
    if (nowPlaying) setNowPlaying(null);
    setSelectedSingle(single);
    setPreviewModalOpen(true);
    setSelectedReleaseDetail(null);
    if (!single?.slug) return;
    if (authLoading) return;
    void playTrack(
      toPlaybackTrack(single, { ...accountState, userId: currentUser?.id }, "preview_modal")
    );
    void getControlSystemReleaseDetail({ slug: single.slug, fallbackRelease: single }).then((detail) => {
      if (detail) setSelectedReleaseDetail(detail);
    });
  }, [nowPlaying, accountState, authLoading, currentUser?.id, playTrack]);

  const handleSingleClick = useCallback(
    (single) => {
      openSingleModal(single);
    },
    [openSingleModal]
  );

  const closeSingleModal = useCallback(() => {
    setPreviewModalOpen(false);
    pause();
    setSelectedSingle(null);
    setSelectedReleaseDetail(null);
  }, [pause]);

  const handleFeatureClick = useCallback(
    (feat) => {
      setNowPlaying(feat);
      void playTrack(toPlaybackTrack(feat, { ...accountState, userId: currentUser?.id }, "feature"));
    },
    [accountState, currentUser?.id, playTrack]
  );

  const dismissNowPlaying = useCallback(() => {
    setNowPlaying(null);
    pause();
  }, [pause]);

  const seekTo = useCallback(
    (e) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(ratio * duration);
    },
    [duration, seek]
  );

  const nowPlayingMatchesTrack =
    nowPlaying && currentTrack?.slug === nowPlaying.slug;
  const miniPlayerPlaying = Boolean(nowPlayingMatchesTrack && isPlaying);

  const openGiftSheet = useCallback((release) => {
    if (!isAdmin) return;
    setGiftSheetRelease(release);
  }, [isAdmin]);

  const handlePreviewLibraryChange = useCallback(() => {
    void refreshAccountState();
    void refreshLibrary();
  }, [refreshAccountState, refreshLibrary]);

  const handlePreviewGift = useCallback(() => {
    if (selectedSingle) openGiftSheet(selectedSingle);
  }, [selectedSingle, openGiftSheet]);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckingOut(true); setCheckoutError("");
    try {
      const res  = await fetch("/api/create-payment-intent", { method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include", body:JSON.stringify({ cart }) });
      const data = await res.json();
      if (!res.ok) { setCheckoutError(data.error || data.message || "Checkout failed."); setCheckingOut(false); return; }
      if (!data.clientSecret) { setCheckoutError("No client secret returned."); setCheckingOut(false); return; }
      setClientSecret(data.clientSecret);
      setCheckingOut(false);
    } catch (err) { setCheckoutError(`Network error: ${err.message}`); setCheckingOut(false); }
  };

  const handleCheckoutSuccess = async (paymentIntentId) => {
    if (paymentIntentId) {
      try {
        await fetch("/api/purchase/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ paymentIntentId }),
        });
      } catch { /* webhook may still fulfill */ }
    }
    let inv = { ...inventory };
    cart.forEach(item => {
      if (item.slug in REAL_INVENTORY) { inv = decrementInventory(inv, item.slug); }
    });
    setInventory(inv);
    setClientSecret(null); setCheckingOut(false); clearCart();
    await Promise.all([refreshAccountState(), refreshLibrary()]);
    setMembershipUpsellOpen(true);
    if (isMobile) setMobileCartOpen(false);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "pending") return;
    if (cart.length === 0) return;
    window.history.replaceState({}, "", window.location.pathname);
    void handleCheckout();
  }, [currentUser, cart]);

  const handleSignOut = async () => {
    await signOut();
  };

  const getDaysInMonth     = (m, y) => new Date(y, m+1, 0).getDate();
  const getFirstDayOfMonth = (m, y) => new Date(y, m, 1).getDay();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const getShowsForDay = day => events.filter(s => { const d=new Date(s.date); return d.getFullYear()===calYear && d.getMonth()===calMonth && d.getDate()===day; });
  const prevMonth = () => { if (calMonth===0) { setCalMonth(11); setCalYear(calYear-1); } else setCalMonth(calMonth-1); };
  const nextMonth = () => { if (calMonth===11) { setCalMonth(0); setCalYear(calYear+1); } else setCalMonth(calMonth+1); };

  const handleAddComment = postId => {
    if (!blogComment.trim()) return;
    const name = currentUser ? currentUser.name : "Anonymous";
    setBlogComments(p => ({ ...p, [postId]: [...(p[postId]||[]), { name, text:blogComment, time:new Date().toLocaleString() }] }));
    setBlogComment("");
  };
  const handleCircleSubmit = () => {
    if (!circleQuestion.trim()) return;
    const name = currentUser ? currentUser.name : "Anonymous";
    const sub  = { id:`sub-${Date.now()}`, text:circleQuestion, category:circleCategory, by:name, time:new Date().toLocaleString() };
    const upd  = [sub, ...circleSubmissions];
    setCircleSubmissions(upd); localStorage.setItem("2mrrw_circle", JSON.stringify(upd));
    setCircleQuestion(""); setCircleSubmitted(true); setTimeout(() => setCircleSubmitted(false), 3500);
  };

  const getUserStatus = () => {
    if (!currentUser) return null;
    const hasCollector = myPurchases.some(p => p.slug?.startsWith("exc-card"));
    const hasBundle    = myPurchases.some(p => p.slug?.startsWith("exc-bundle"));
    const subs         = circleSubmissions.filter(s => s.by === currentUser.name).length;
    if ((hasCollector||hasBundle) && subs >= 1) return { label:"INNER CIRCLE",   color:"#a259ff", glow:"rgba(162,89,255,0.5)" };
    if  (hasCollector||hasBundle)               return { label:"COLLECTOR",       color:"#ff6b35", glow:"rgba(255,107,53,0.5)" };
    if  (subs >= 3)                             return { label:"VISIONARY",       color:"#00ffff", glow:"rgba(0,255,255,0.5)" };
    return { label:"EARLY SUPPORTER", color:"#aaa", glow:"rgba(170,170,170,0.3)" };
  };
  const userStatus = getUserStatus();

  const closeMobileNav = useCallback(() => {
    if (!mobileNavOpen || mobileNavClosing) return;
    setMobileNavClosing(true);
  }, [mobileNavOpen, mobileNavClosing]);

  useEffect(() => {
    if (!mobileNavClosing) return undefined;
    const timer = setTimeout(() => {
      setMobileNavOpen(false);
      setMobileNavClosing(false);
    }, MOBILE_NAV_SHEET_MS);
    return () => clearTimeout(timer);
  }, [mobileNavClosing]);

  const mobileNavSheetOpen = mobileNavOpen || mobileNavClosing;

  useEffect(() => {
    if (!mobileNavSheetOpen) return undefined;
    registerModal("mobile-nav-sheet");
    return () => unregisterModal("mobile-nav-sheet");
  }, [mobileNavSheetOpen]);

  useEffect(() => {
    if (!mobileCartOpen) return undefined;
    registerModal("mobile-cart-sheet");
    return () => unregisterModal("mobile-cart-sheet");
  }, [mobileCartOpen]);

  useEffect(() => {
    if (!clientSecret) return undefined;
    registerModal("stripe-checkout-overlay");
    return () => unregisterModal("stripe-checkout-overlay");
  }, [clientSecret]);

  const openMobileNav = useCallback(() => {
    setMobileNavClosing(false);
    setMobileNavExpandedGroups(new Set());
    setMobileNavOpen(true);
  }, []);

  const toggleMobileNavGroup = useCallback((groupId) => {
    setMobileNavExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const switchTab = tabId => {
    if (tabId === "cards") {
      window.location.assign(COLLECTORS_CARDS_ROUTE);
      return;
    }
    // phase11: startTransition — non-urgent UI update
    startTransition(() => {
    setHomeScrollSection(null);
    setTabKey(p => p + 1);
    setActiveTab(tabId);
    const navGroupByTab = {
      singles: "g-music",
      albums: "g-music",
      mymusic: "g-music",
      shop: "g-shop",
      blog: "g-community",
      vision: "g-community",
      circle: "g-community",
      innercircle: "g-community",
      vault: "g-vault",
      shows: "g-shows",
      live: "g-live",
      home: "g-home",
    };
    if (navGroupByTab[tabId]) setExpandedGroup(navGroupByTab[tabId]);
    if (isMobile) {
      setMobileNavOpen(false);
      setMobileNavClosing(false);
      setMobileNavExpandedGroups(new Set());
    }
    });
  };

  const openCollection = () => {
    switchTab("mymusic");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam) {
      switchTab(tabParam);
      const next = new URL(window.location.href);
      next.searchParams.delete("tab");
      window.history.replaceState({}, "", next.pathname + (next.search || ""));
      if (tabParam === "mymusic") {
        window.setTimeout(() => {
          mainScrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
        }, 0);
      }
      return;
    }
    const openTab = sessionStorage.getItem("openTab");
    const highlightSlug = consumeGiftHighlightSlug();
    if (highlightSlug) {
      setGiftHighlightSlug(highlightSlug);
      window.setTimeout(() => setGiftHighlightSlug(null), 9000);
    }
    if (!openTab) return;
    sessionStorage.removeItem("openTab");
    switchTab(openTab);
    if (openTab === "mymusic") {
      window.setTimeout(() => {
        mainScrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
      }, 0);
    }
  }, []);

  const isMobileNavTabActive = tabId => {
    if (tabId === "cards") return activeTab === "cards" || (activeTab === "home" && homeScrollSection === "cards");
    if (tabId === "vault") return activeTab === "vault" || (activeTab === "home" && homeScrollSection === "vault");
    if (tabId === "shows") return activeTab === "shows" || (activeTab === "home" && homeScrollSection === "shows");
    if (tabId === "singles") return activeTab === "singles" || activeTab === "albums";
    if (tabId === "mymusic") return activeTab === "mymusic";
    return activeTab === tabId;
  };

  const switchMusicSubTab = sub => {
    // phase11: startTransition — browse sub-tab switch
    startTransition(() => {
      setMusicSubTab(sub);
      setTabKey((p) => p + 1);
    });
  };

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
        setSelectedAlbum(album);
      }
    } else if (parsed.type === "feature") {
      const feat = features.find((f) => f.slug === parsed.slug);
      if (feat) {
        switchTab("singles");
        handleFeatureClick(feat);
      }
    }
  }, [authLoading, currentUser, openSingleModal, handleFeatureClick]);

  const shopItems      = printfulProducts.length > 0 ? printfulProducts : fallbackMerch;
  const shopIsFallback = !printfulLoading && printfulProducts.length === 0;

  const liveStreamDate = nextLiveDateTime.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
  const liveStreamTime = nextLiveDateTime.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
  const currentSlide   = useMemo(() => withR2CatalogMedia(radioSlides[radioIndex]), [radioIndex]);
  const activeFlowMode = flowConversionActive ? "conversion" : nowPlaying ? "nowplaying" : "idle";
  const accountStateReady = !authLoading;
  const showOwnTrackConversion = accountStateReady && !isAdminAccount(accountState);

  const exclusiveItems = exclusiveCatalog.map(item => ({
    ...item,
    stock: inventory[item.slug] !== undefined ? inventory[item.slug] : REAL_INVENTORY[item.slug],
  }));
  const blogPosts = [
    { id:"post-1", title:"The Making of Love Hz Vol.1",          date:"April 2, 2026",      author:"2MRRW", body:"Love Hz Vol.1 started as a series of late-night sessions in a home studio with nothing but a laptop, a MIDI keyboard, and a vision. Every track on that project represents a different frequency of love — the highs, the lows, the static in between. We wanted listeners to feel the entire spectrum.\n\nThe process took nearly 18 months. Some songs were written in 10 minutes, others were rebuilt from scratch a dozen times. What you hear is the version that survived. We hope it resonates with you the way it resonated with us when we finally pressed play for the first time." },
    { id:"post-2", title:"Why We Started 2MRRW",                 date:"March 15, 2026",     author:"2MRRW", body:"2MRRW was never supposed to be a brand. It started as a reminder — tomorrow is always possible. No matter what today looks like, tomorrow holds something different.\n\nWe put that energy into every record, every show, every piece of merch. It's not just a name on a hoodie. It's a mindset we live by and want to share with everyone who connects with the music." },
    { id:"post-3", title:"Tour Prep: What Goes Into a Live Show", date:"February 28, 2026", author:"2MRRW", body:"People see the 90-minute set. They don't see the weeks of rehearsal, the production calls, the logistics of moving equipment across state lines. A live 2MRRW show is designed from the ground up — the lighting, the setlist order, the energy arc from opener to closer.\n\nWe treat every city like it's the only city. Dallas gets the same energy as NYC. That's the standard we hold ourselves to and always will." },
  ];

  const sidebarNav = [
    { groupId:"g-home",      label:"HOME",           directTab:"home",    subTabs:[] },
    { groupId:"g-music",     label:"MUSIC",          directTab:"singles", subTabs:[{id:"singles",label:"Singles"},{id:"albums",label:"Albums"},{id:"mymusic",label:"My Music Collection"}] },
    { groupId:"g-shop",      label:"SHOP",           directTab:"shop",    subTabs:[{id:"shop",label:"Merch"}] },
    { groupId:"g-cards",     label:"CARDS",          directTab:"cards",   subTabs:[{id:"cards",label:"Collector's Cards"}] },
    { groupId:"g-vault",     label:"VAULT",          directTab:"vault",   subTabs:[{id:"vault",label:"Exclusive Drops"}] },
    { groupId:"g-shows",     label:"SHOWS & EVENTS", directTab:"shows",   subTabs:[{id:"shows",label:"Upcoming Shows"}] },
    { groupId:"g-community", label:"MORE",           directTab:"blog",    subTabs:[{id:"blog",label:"Blog"},{id:"vision",label:"Vision"},{id:"circle",label:"Circle"},{id:"innercircle",label:"Inner Circle"},{id:"live",label:"2MRRW Live"},{id:"help",label:"Help & Support"}] },
  ];

  const stockLabel = (item) => {
    if (item.stock === null || item.stock === undefined) return null;
    if (item.stock <= 0) return "SOLD OUT";
    return `${item.stock} remaining`;
  };

  const mobileHeroHeight = isMobile ? Math.max(108, 200 - heroScrollY * 0.46) : 380;
  const mobileVideoBrightness = isMobile ? Math.max(0.08, 0.35 - heroScrollY * 0.0025) : 0.35;
  const heroTextOpacity = isMobile ? Math.max(0, 1 - heroScrollY / 70) : 1;
  const heroTextScale = isMobile ? Math.max(0.72, 1 - heroScrollY / 350) : 1;
  const heroSocialsOp = isMobile ? Math.max(0, 1 - heroScrollY / 60) : 1;
  const mobileScrollPadding = isMobile ? (nowPlaying ? "178px" : "110px") : "30px";
  const mobileCartFabBottom = nowPlaying
    ? "calc(62px + env(safe-area-inset-bottom, 0px) + 72px)"
    : "calc(62px + env(safe-area-inset-bottom, 0px) + 12px)";
  const mobileMiniPlayerBottom = "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)";

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
      <div ref={cursorRef} style={{position:"fixed",width:28,height:28,borderRadius:"50%",background:"radial-gradient(circle,rgba(0,255,255,0.22) 0%,transparent 70%)",pointerEvents:"none",transform:"translate(-50%,-50%)",zIndex:99999,mixBlendMode:"screen",transition:"left 0.045s linear,top 0.045s linear",display:isMobile?"none":undefined}}/>
      <div ref={cursorTrailRef} style={{position:"fixed",width:16,height:16,borderRadius:"50%",background:"radial-gradient(circle,rgba(0,255,255,0.10) 0%,transparent 70%)",pointerEvents:"none",transform:"translate(-50%,-50%)",zIndex:99998,mixBlendMode:"screen",transition:"left 0.18s ease,top 0.18s ease",display:isMobile?"none":undefined}}/>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,background:"radial-gradient(circle at 18% 18%,rgba(0,255,255,0.026) 0%,transparent 55%),radial-gradient(circle at 82% 80%,rgba(162,89,255,0.018) 0%,transparent 52%)"}}/>
      {/* ── SINGLE PREVIEW MODAL (immersive) ── */}
      <AnimatePresence>
        {previewModalOpen && selectedSingle && (
          <ImmersivePreviewModal
            key="immersive-preview-modal"
            single={selectedSingle}
            releaseDetail={selectedReleaseDetail}
            isMobile={isMobile}
            trackAccess={selectedSingleAccess}
            userId={currentUser?.id}
            isAdmin={isAdmin}
            onGift={handlePreviewGift}
            onLibraryChange={handlePreviewLibraryChange}
            onClose={closeSingleModal}
            onAddToCart={addToCart}
            onAddVinyl={addVinylToCart}
          />
        )}
      </AnimatePresence>



      {/* ── ALBUM MODAL ── */}
      <AnimatePresence>
        {selectedAlbum && (
          <motion.div
            key="album-overlay"
            {...OVERLAY_FADE}
            onClick={() => setSelectedAlbum(null)}
            style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:8888,
              display:"flex",alignItems:isMobile?"flex-end":"center",justifyContent:"center",
              padding:isMobile?0:16,
            }}
          >
            <motion.div
              key="album-sheet"
              {...(isMobile ? SHEET_UP : MODAL_CENTER)}
              onClick={e => e.stopPropagation()}
              style={{
                background:"#0d0d0d",
                border:isMobile?"1px solid #1e1e1e":"1px solid #222",
                borderRadius:isMobile?"20px 20px 0 0":20,
                width:isMobile?"100%":320,
                maxWidth:isMobile?"100%":"none",
                maxHeight:isMobile?"88vh":"80vh",
                overflowY:"auto",
                display:"flex",
                flexDirection:"column",
                alignItems:"center",
                gap:10,
                padding:isMobile?"0 0 28px":"22px 26px",
              }}
            >
              {isMobile && <motion.div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"12px auto 0",flexShrink:0}} />}
              {isMobile && (
                <motion.div style={{position:"relative",width:"100%",height:180,flexShrink:0,overflow:"hidden"}}>
                  <img src={selectedAlbum.cover} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} alt="" />
                  <motion.div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.9) 0%,transparent 50%)"}} />
                  <motion.div style={{position:"absolute",bottom:16,left:20,right:20}}>
                    <motion.div style={{fontSize:20,fontWeight:900,letterSpacing:2}}>{selectedAlbum.title}</motion.div>
                    <motion.div style={{fontSize:11,opacity:0.5,letterSpacing:1,marginTop:4}}>{selectedAlbum.date}</motion.div>
                  </motion.div>
                </motion.div>
              )}
              <motion.div style={{padding:isMobile?"0 20px":"0",width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                {!isMobile && <img src={selectedAlbum.cover} style={{width:130,height:130,borderRadius:10,objectFit:"cover"}} alt="" />}
                {!isMobile && <motion.div style={{fontSize:17,fontWeight:900,letterSpacing:2,textAlign:"center"}}>{selectedAlbum.title}</motion.div>}
                {!isMobile && <motion.div style={{fontSize:11,opacity:0.4,letterSpacing:1}}>{selectedAlbum.date}</motion.div>}
                <motion.div style={{width:"100%",marginTop:4}}>
                  <motion.div style={{fontSize:10,letterSpacing:2,opacity:0.4,marginBottom:8,textTransform:"uppercase"}}>Track Listing</motion.div>
                  {selectedAlbum.tracks.map((t,i)=>{
                    const trackTitle = typeof t === "string" ? t : t?.title || `Track ${i + 1}`;
                    const canPlayTrack = Boolean(selectedAlbumAccess?.canStream);
                    return (
                      <motion.div key={i} style={{padding:"6px 0",fontSize:13,borderBottom:"1px solid #1a1a1a",color:canPlayTrack ? "white" : "#666",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                        <span>{i+1}. {trackTitle}{!canPlayTrack ? " · Preview only" : ""}</span>
                        {canPlayTrack ? (
                          <button type="button" onClick={()=>playAlbumTracks(selectedAlbum, i)} style={{background:"none",border:"none",color:"#00ffff",cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0}}>Play</button>
                        ) : (
                          <span style={{fontSize:10,color:"#444",flexShrink:0}}>Locked</span>
                        )}
                      </motion.div>
                    );
                  })}
                </motion.div>
                {selectedAlbumAccess?.canStream && (
                  <button type="button" onClick={()=>playAlbumTracks(selectedAlbum, 0)} style={{width:"100%",padding:"12px 0",background:"#00ffff",color:"#000",border:"none",borderRadius:10,cursor:"pointer",fontSize:13,marginTop:6,fontWeight:800}}>Play Album</button>
                )}
                {selectedAlbumAccess?.showCart && (
                  <>
                    <button onClick={()=>{addToCart(selectedAlbum);setSelectedAlbum(null);}} style={{width:"100%",padding:"12px 0",background:"#1f1f1f",color:"white",border:"1px solid #333",borderRadius:10,cursor:"pointer",fontSize:13,marginTop:6,fontWeight:700}}>Add to Cart – ${selectedAlbum.price.toFixed(2)}</button>
                    <button onClick={()=>{addToCart({title:`${selectedAlbum.title} – Vinyl`,slug:`${selectedAlbum.slug}-vinyl`,cover:selectedAlbum.cover,price:selectedAlbum.vinyl});setSelectedAlbum(null);}} style={{width:"100%",padding:"12px 0",background:"#0a0a0a",color:"#00ffff",border:"1px solid #00ffff",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:"bold"}}>+ Add Vinyl – ${selectedAlbum.vinyl.toFixed(2)} (Optional)</button>
                  </>
                )}
                {currentUser?.id && selectedAlbum && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <MusicPlusButton
                      track={selectedAlbum}
                      userId={currentUser.id}
                      access={selectedAlbumAccess}
                      isMobile={isMobile}
                      deepLinkType="album"
                      onLibraryChange={() => { void refreshAccountState(); void refreshLibrary(); }}
                    />
                  </div>
                )}
                <button onClick={()=>setSelectedAlbum(null)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:12,marginTop:4}}>Close</button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>



      {/* ── TICKET MODAL ── */}
      {selectedEvent && (
        <div onClick={()=>setSelectedEvent(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:8888,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?16:0}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#111",border:"1px solid #222",borderRadius:20,padding:30,width:isMobile?"100%":360,maxWidth:isMobile?"calc(100vw - 32px)":"none",display:"flex",flexDirection:"column",gap:14}}>
            <div style={{fontSize:20,fontWeight:800,letterSpacing:2}}>{selectedEvent.name}</div>
            <div style={{fontSize:13,color:"#aaa"}}>{selectedEvent.location}</div>
            <div style={{fontSize:13,color:"#aaa"}}>{new Date(selectedEvent.date).toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})} · {selectedEvent.time}</div>
            <div style={{fontSize:22,fontWeight:900,color:"#00ffff"}}>${selectedEvent.price.toFixed(2)}</div>
            <div style={{fontSize:12,color:"#555"}}>{selectedEvent.tickets} tickets remaining</div>
            <button onClick={()=>{addToCart({title:`Ticket – ${selectedEvent.name}`,slug:selectedEvent.id,cover:null,price:selectedEvent.price});setSelectedEvent(null);}} style={{width:"100%",padding:"12px 0",background:"#00ffff",color:"#000",fontWeight:"bold",border:"none",borderRadius:8,cursor:"pointer",fontSize:14}}>Add Ticket to Cart – ${selectedEvent.price.toFixed(2)}</button>
            <button onClick={()=>setSelectedEvent(null)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:12,textAlign:"center"}}>Close</button>
          </div>
        </div>
      )}

      {/* ── EXCLUSIVE / VAULT MODAL ── */}
      {exclusiveModal && (
        <div onClick={()=>setExclusiveModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:8888,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?16:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0d0d0d",border:`1px solid ${exclusiveModal.badgeColor}33`,borderRadius:24,padding:isMobile?20:32,width:isMobile?"100%":380,maxWidth:isMobile?"calc(100vw - 32px)":"none",maxHeight:"88vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:16,boxShadow:`0 0 60px ${exclusiveModal.badgeColor}22`}}>
            <div style={{position:"relative"}}><img src={exclusiveModal.cover} style={{width:"100%",height:200,borderRadius:14,objectFit:"cover",display:"block"}}/><div style={{position:"absolute",top:12,left:12,background:exclusiveModal.badgeColor,color:"#000",fontSize:10,fontWeight:900,letterSpacing:2,padding:"4px 10px",borderRadius:20}}>{exclusiveModal.badge}</div></div>
            <div style={{fontSize:20,fontWeight:900,letterSpacing:1}}>{exclusiveModal.title}</div>
            <div style={{fontSize:12,color:"#555",letterSpacing:1}}>{exclusiveModal.subtitle}</div>
            <div style={{fontSize:13,color:"#999",lineHeight:1.8}}>{exclusiveModal.description}</div>
            <div style={{borderTop:"1px solid #1e1e1e",paddingTop:16}}>
              <div style={{fontSize:11,color:"#555",letterSpacing:2,marginBottom:10,textTransform:"uppercase"}}>What's Included</div>
              {exclusiveModal.features.map((f,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",fontSize:13,color:"#ccc",borderBottom:"1px solid #111"}}><span style={{color:exclusiveModal.badgeColor,fontSize:16,lineHeight:1}}>✓</span> {f}</div>)}
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:4}}>
              <div>
                <div style={{fontSize:26,fontWeight:900,color:exclusiveModal.badgeColor}}>${exclusiveModal.price.toFixed(2)}</div>
                {exclusiveModal.stock !== null && exclusiveModal.stock !== undefined && (
                  <div style={{fontSize:11,color:exclusiveModal.stock<=0?"#ff4d4d":"#555",marginTop:2}}>
                    {exclusiveModal.stock<=0?"SOLD OUT":`${exclusiveModal.stock} remaining`}
                  </div>
                )}
              </div>
              <button
                onClick={()=>{
                  if (exclusiveModal.stock !== null && exclusiveModal.stock <= 0) return;
                  addToCart({title:exclusiveModal.title,slug:exclusiveModal.slug,cover:exclusiveModal.cover,price:exclusiveModal.price});
                  setExclusiveModal(null);
                }}
                disabled={exclusiveModal.stock !== null && exclusiveModal.stock <= 0}
                style={{padding:"12px 24px",background:exclusiveModal.stock<=0?"#222":exclusiveModal.badgeColor,color:exclusiveModal.stock<=0?"#555":"#000",fontWeight:900,border:"none",borderRadius:10,cursor:exclusiveModal.stock<=0?"not-allowed":"pointer",fontSize:14,letterSpacing:1,transition:"opacity 0.2s"}}
              >
                {exclusiveModal.stock!==null&&exclusiveModal.stock<=0?"Sold Out":"Add to Cart"}
              </button>
            </div>
            <button onClick={()=>setExclusiveModal(null)} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:12,textAlign:"center"}}>Close</button>
          </div>
        </div>
      )}

      {/* ══════════════════════ MAIN LAYOUT ═══════════════════════════════════ */}
      <div style={{display:"flex",flexDirection:isMobile?"column":"row",height:"100vh",overflow:"hidden",maxWidth:"100vw",overflowX:"hidden",background:"#050505",color:"white",position:"relative",zIndex:1,fontFamily:"'Helvetica Now','Helvetica Neue',Helvetica,Arial,sans-serif"}}>
        {hasStarted && currentTrack?.cover && (
          <AmbientPlaybackBackground currentTrack={currentTrack} csMode={csMode} />
        )}

        {/* ── DESKTOP SIDEBAR ── */}
        {!isMobile && (
          <div style={{width:220,flexShrink:0,borderRight:"1px solid #141414",background:"rgba(4,4,4,0.9)",backdropFilter:"blur(20px)",display:"flex",flexDirection:"column",height:"100vh",overflowY:"auto",boxShadow:"2px 0 32px rgba(0,0,0,0.5)"}}>
            <div style={{padding:"22px 18px 18px",borderBottom:"1px solid #111",flexShrink:0}}>
              <div style={{fontSize:20,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 24px rgba(0,255,255,0.45)",marginBottom:4}}>2MRRW</div>
              {currentUser && userStatus && <div style={{fontSize:9,color:userStatus.color,letterSpacing:2.5,fontWeight:700,opacity:0.85}}>{userStatus.label}</div>}
            </div>
            <nav style={{flex:1,padding:"12px 0",overflowY:"auto"}}>
              {sidebarNav.map(group => {
                const isGroupActive = group.subTabs.length===0 ? activeTab===group.directTab : group.subTabs.some(st=>st.id===activeTab);
                const isExpanded    = expandedGroup === group.groupId;
                return (
                  <div key={group.groupId} style={{marginBottom:2}}>
                    <button onClick={()=>{ if(group.subTabs.length===0){switchTab(group.directTab);}else{setExpandedGroup(isExpanded?null:group.groupId);}}} style={{width:"100%",padding:"13px 18px 13px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",background:isGroupActive?"linear-gradient(90deg,rgba(0,255,255,0.09) 0%,transparent 100%)":"transparent",border:"none",borderLeft:isGroupActive?"2px solid #00ffff":"2px solid transparent",color:isGroupActive?"#00ffff":"#b0b0b0",fontSize:11,fontWeight:700,letterSpacing:2.5,cursor:"pointer",textAlign:"left",transition:"all 0.18s",textShadow:isGroupActive?"0 0 12px rgba(0,255,255,0.4)":"none"}} onMouseEnter={e=>{if(!isGroupActive){e.currentTarget.style.color="#fff";e.currentTarget.style.background="rgba(255,255,255,0.035)";}}} onMouseLeave={e=>{if(!isGroupActive){e.currentTarget.style.color="#b0b0b0";e.currentTarget.style.background="transparent";}}}>
                      <span>{group.label}</span>
                      {group.subTabs.length>0 && <span style={{fontSize:14,color:isExpanded?"#888":"#555",display:"inline-block",transform:isExpanded?"rotate(90deg)":"rotate(0deg)",transition:"transform 0.22s ease",lineHeight:1}}>›</span>}
                    </button>
                    {isExpanded && group.subTabs.length>0 && (
                      <div style={{animation:"expandDown 0.2s ease forwards"}}>
                        {group.subTabs.map(st=>(
                          <button key={st.id} onClick={()=>switchTab(st.id)} style={{width:"100%",padding:"10px 18px 10px 30px",background:activeTab===st.id?"rgba(0,255,255,0.055)":"transparent",border:"none",color:activeTab===st.id?"#00ffff":"#999",fontSize:12,letterSpacing:1.5,cursor:"pointer",textAlign:"left",transition:"all 0.14s",fontWeight:activeTab===st.id?700:400,display:"flex",alignItems:"center",gap:8}} onMouseEnter={e=>{if(activeTab!==st.id)e.currentTarget.style.color="#fff";}} onMouseLeave={e=>{if(activeTab!==st.id)e.currentTarget.style.color="#999";}}>
                            <span style={{width:4,height:4,borderRadius:"50%",flexShrink:0,background:activeTab===st.id?"#00ffff":"transparent",boxShadow:activeTab===st.id?"0 0 6px rgba(0,255,255,0.9)":"none",transition:"all 0.15s"}}/>
                            {st.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
            <div style={{padding:"14px 14px 18px",borderTop:"1px solid #111",display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
              <button onClick={()=>switchTab("account")} style={{width:"100%",padding:"10px 12px",textAlign:"left",background:activeTab==="account"?"rgba(0,255,255,0.07)":"transparent",border:"none",borderLeft:activeTab==="account"?"2px solid #00ffff":"2px solid transparent",color:activeTab==="account"?"#00ffff":"#b0b0b0",fontSize:11,fontWeight:700,letterSpacing:2.5,cursor:"pointer",transition:"0.18s"}} onMouseEnter={e=>{if(activeTab!=="account")e.currentTarget.style.color="#fff";}} onMouseLeave={e=>{if(activeTab!=="account")e.currentTarget.style.color="#b0b0b0";}}>ACCOUNT</button>
              <button onClick={()=>setSoundOn(!soundOn)} style={{width:"100%",padding:"9px 12px",textAlign:"left",background:"transparent",border:"none",color:soundOn?"#00ffff":"#888",fontSize:11,cursor:"pointer",letterSpacing:2,fontWeight:700,transition:"0.18s",textShadow:soundOn?"0 0 8px rgba(0,255,255,0.5)":"none"}}>{soundOn?"♫  SOUND ON":"♫  SOUND OFF"}</button>
            </div>
          </div>
        )}

        {/* ── MAIN AREA ── */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
          <div
            ref={mainScrollRef}
            style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:0,WebkitOverflowScrolling:"touch"}}
          >
            <motion.div style={{padding:isMobile?`0 0 ${mobileScrollPadding} 0`:"0 30px 30px"}}>
            <motion.div style={{padding:isMobile?"0 14px":"0"}}>
            {/* HERO — scroll compression on mobile */}
            <motion.div style={{
              position:"relative", height: mobileHeroHeight, marginBottom: 0,
              borderRadius: isMobile ? 0 : 20, overflow:"hidden", background:"black",
              transition: isMobile ? "height 0.08s cubic-bezier(0.25,0.46,0.45,0.94)" : "none",
            }}>
              <video autoPlay muted loop playsInline preload="auto" webkit-playsinline="true" src={catalogMotionVideoUrl("videos/A2B.mp4")}
                style={{
                  position:"absolute",width:"100%",height:"100%",objectFit:"cover",
                  opacity: mobileVideoBrightness,
                  filter:`brightness(${mobileVideoBrightness / 0.35}) blur(${isMobile ? Math.min(2, heroScrollY * 0.01) : 1}px)`,
                  transform:`scale(${isMobile ? 1 + heroScrollY * 0.0008 : 1})`,
                  transition: isMobile ? "filter 0.1s, transform 0.1s" : "none",
                }}
              />
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,black,transparent 60%)"}}/>
              <div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>
              <motion.div style={{position:"absolute",top:isMobile?16:25,left:isMobile?16:25,zIndex:10,opacity:heroTextOpacity,transform:`scale(${heroTextScale})`,transformOrigin:"top left",transition:isMobile?"opacity 0.08s, transform 0.08s":"none"}}>
                <div style={{fontSize:isMobile?28:42,fontWeight:900,letterSpacing:isMobile?5:8,animation:"pulse 2.5s infinite",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</div>
              </motion.div>
              <motion.div style={{position:"absolute",bottom:isMobile?14:24,right:isMobile?14:25,display:"flex",gap:isMobile?12:16,alignItems:"center",zIndex:10,flexWrap:"wrap",justifyContent:"flex-end",opacity:heroSocialsOp,transition:isMobile?"opacity 0.08s":"none"}}>
                {SOCIALS.map(s=><a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" title={s.name} style={{color:"rgba(255,255,255,0.65)",transition:"transform 0.2s,color 0.2s,filter 0.2s",display:"flex",alignItems:"center",textDecoration:"none"}} onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.5)";e.currentTarget.style.color="#00ffff";e.currentTarget.style.filter="drop-shadow(0 0 6px rgba(0,255,255,0.8))";}} onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.color="rgba(255,255,255,0.65)";e.currentTarget.style.filter="none";}}>{s.svg}</a>)}
              </motion.div>
            </motion.div>

            {activeTab==="home" && (
              <div style={{padding:"18px 0 8px",display:"flex",justifyContent:"flex-start",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                <button type="button" className="donate-glow-button" onClick={()=>setDonateOpen(true)}>♥ Donate</button>
                <button type="button" className="subscribe-shimmer-button" onClick={()=>{window.location.href="/subscribe";}}>Subscribe</button>
              </div>
            )}

            <div key={tabKey} style={{animation:"fadeInTab 0.22s ease forwards"}}>

              {/* ══ HOME ══ */}
              {activeTab==="home" && (
                <>
                  {/* Latest Singles */}
                  <motion.div style={{marginTop:20,marginBottom:4}}>
                    <motion.div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:14,flexWrap:"wrap"}}>
                      <h2 className="section-heading" style={{margin:0}}>Latest Singles</h2>
                      {currentUser ? (
                        <button type="button" className="collection-portal-link" onClick={openCollection} aria-label="Open my music collection">
                          My Music Collection
                        </button>
                      ) : null}
                    </motion.div>

                    <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:18,alignItems:"flex-start"}}>

                      <div
                        ref={singlesRowRef}
                        className="singles-row"
                        style={{
                          flex:1,
                          display:"flex",
                          gap:isMobile?12:18,
                          overflowX:"auto",
                          paddingBottom:14,
                          scrollSnapType:"x mandatory",
                          WebkitOverflowScrolling:"touch",
                          overscrollBehaviorX:"contain",
                          flexWrap:"nowrap",
                          width:"100%",
                          minWidth:0,
                        }}
                      >
                        {displaySingles.map((single, i) => {
                          const singleUi = withR2CatalogMedia(single);
                          const singleAccess = resolveContentAccess(singleUi, accountState);
                          return (
                          <div
                            key={single.slug}
                            data-single-card
                            onClick={() => openSingleModal(singleUi)}
                            style={{
                              flex:"0 0 auto",
                              width:isMobile?160:200,
                              cursor:"pointer",
                              scrollSnapAlign:"start",
                              opacity:0,
                              animation:`fadeInUp 0.5s ease ${i*0.09}s forwards`,
                              background:"#0a0a0a",
                              borderRadius:14,
                              border:"1px solid #1a1a1a",
                              transition:"border-color 0.25s, box-shadow 0.25s",
                              position:"relative",
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.borderColor = "#00ffff33";
                              e.currentTarget.style.boxShadow = "0 0 18px rgba(0,255,255,0.35)";
                              const vid = e.currentTarget.querySelector("video");
                              if (vid) { vid.style.transform = "scale(1.05)"; vid.style.filter = "brightness(1.12)"; }
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.borderColor = "#1a1a1a";
                              e.currentTarget.style.boxShadow = "none";
                              const vid = e.currentTarget.querySelector("video");
                              if (vid) { vid.style.transform = "scale(1)"; vid.style.filter = "brightness(1)"; }
                            }}
                          >
                            {isAdmin ? (
                              <GiftOverlayButton onClick={() => openGiftSheet(singleUi)} />
                            ) : null}
                            {/* FIXED: src points to /videos/singles/, webkit-playsinline for iOS Safari */}
                            <video
                              data-single-carousel
                              src={singleUi.video}
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              webkit-playsinline="true"
                              style={{
                                width:"100%",
                                aspectRatio:"1/1",
                                objectFit:"cover",
                                display:"block",
                                borderRadius:"13px 13px 0 0",
                                transition:"transform 0.3s, filter 0.3s",
                                pointerEvents:"none",
                              }}
                            />
                            <div style={{padding:isMobile?"10px 12px 14px":"12px 14px 16px"}}>
                              <div className="song-title-turquoise-glow" style={{fontSize:isMobile?12:13,fontWeight:700,marginBottom:4}}>{single.title}</div>
                              {singleAccess?.showPrice ? (
                                <div style={{fontSize:12,color:"#00ffff",fontWeight:700,marginBottom:isMobile?8:10}}>${single.price.toFixed(2)}</div>
                              ) : null}
                              <ReleaseCardActions
                                item={singleUi}
                                accountState={accountState}
                                userId={currentUser?.id}
                                source="home_single_card"
                                showCart={Boolean(singleAccess?.showCart)}
                                onAddToCart={e => { e.stopPropagation(); addToCart(single); }}
                                cartButtonStyle={{
                                  background:"#1a1a1a",
                                  color:"white",
                                  border:"1px solid #2a2a2a",
                                }}
                                cartLabel="+ Cart"
                              />
                            </div>
                          </div>
                        );})}
                        {catalogLoading ? (
                          <>
                            <TrackCardSkeleton />
                            <TrackCardSkeleton />
                          </>
                        ) : null}
                      </div>
                      {catalogHasMore ? (
                        <button
                          type="button"
                          onClick={loadMoreCatalog}
                          disabled={catalogLoading}
                          style={{marginTop:12,padding:"10px 18px",background:"transparent",border:"1px solid #333",color:"#888",borderRadius:8,cursor:catalogLoading?"default":"pointer",fontSize:12,letterSpacing:1.5}}
                        >
                          {catalogLoading ? "Loading…" : "Load more"}
                        </button>
                      ) : null}

                      {!isMobile && (
                        <LivePanel
                          liveIsLive={liveIsLive}
                          liveStreamDate={liveStreamDate}
                          liveStreamTime={liveStreamTime}
                          liveCountdown={liveCountdown}
                        />
                      )}
                    </div>

                    {isMobile && (
                      <div style={{marginTop:14,background:"linear-gradient(135deg,rgba(8,8,8,0.92),rgba(13,13,13,0.95))",border:"1px solid rgba(0,255,255,0.15)",borderRadius:16,padding:"20px 18px",backdropFilter:"blur(12px)"}}>
                        <div style={{fontSize:11,color:"#444",letterSpacing:3,marginBottom:10,textTransform:"uppercase",fontWeight:700}}>2MRRW LIVE</div>
                        {liveIsLive ? (
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{width:10,height:10,borderRadius:"50%",background:"#00ffff",animation:"pulse 1.2s infinite"}}/>
                            <div style={{fontSize:20,fontWeight:900,color:"#00ffff",letterSpacing:3}}>LIVE NOW</div>
                          </div>
                        ) : (
                          <div style={{display:"flex",gap:8}}>
                            {[{v:liveCountdown.days,l:"D"},{v:liveCountdown.hours,l:"H"},{v:liveCountdown.minutes,l:"M"},{v:liveCountdown.seconds,l:"S"}].map(u=>(
                              <div key={u.l} style={{flex:1,background:"rgba(0,0,0,0.5)",border:"1px solid #1a1a1a",borderRadius:10,padding:"10px 4px",textAlign:"center"}}>
                                <div style={{fontSize:22,fontWeight:900,color:"#00ffff",fontVariantNumeric:"tabular-nums",lineHeight:1}}>{String(u.v).padStart(2,"0")}</div>
                                <div style={{fontSize:9,color:"#444",letterSpacing:1.5,marginTop:3}}>{u.l}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>

                  {/* Features */}
                  <div style={{marginTop:28,marginBottom:4}}>
                    <h2 className="section-heading" style={{marginBottom:14}}>Features</h2>
                    <FeaturesRail features={features} isMobile={isMobile} addToCart={addToCart} onPlay={handleFeatureClick} accountState={accountState} userId={currentUser?.id} isAdmin={isAdmin} onGift={openGiftSheet} onLibraryChange={() => { void refreshAccountState(); void refreshLibrary(); }}/>
                  </div>

                  {/* Radio */}
                  <div style={{marginTop:28,marginBottom:28}}>
                    <h2 className="section-heading" style={{marginBottom:14}}>2MRRW RADIO</h2>
                    {isMobile ? (
                      <RadioCarousel
                        isMobile={isMobile}
                        currentSlide={currentSlide}
                        radioSlides={radioSlides}
                        radioIndex={radioIndex}
                        goRadio={goRadio}
                        isAdmin={isAdmin}
                        onGift={openGiftSheet}
                        onAddToCart={addToCart}
                        onFlowConversionActive={setFlowConversionActive}
                        accountState={accountState}
                        currentUserId={currentUser?.id}
                        onLibraryChange={() => { void refreshAccountState(); void refreshLibrary(); }}
                      />
                    ) : (
                      <div style={{display:"flex",gap:16,alignItems:"stretch",minHeight:320}}>
                        <div style={{flex:"0 0 55%",minWidth:0}}>
                          <RadioCarousel
                            narrow
                            isMobile={isMobile}
                            currentSlide={currentSlide}
                            radioSlides={radioSlides}
                            radioIndex={radioIndex}
                            goRadio={goRadio}
                            isAdmin={isAdmin}
                            onGift={openGiftSheet}
                            onAddToCart={addToCart}
                            onFlowConversionActive={setFlowConversionActive}
                            accountState={accountState}
                            currentUserId={currentUser?.id}
                            onLibraryChange={() => { void refreshAccountState(); void refreshLibrary(); }}
                          />
                        </div>
                        <FlowState
                          activeFlowMode={activeFlowMode}
                          currentSlide={currentSlide}
                          showOwnTrackConversion={showOwnTrackConversion}
                          onAddToCart={addToCart}
                        />
                      </div>
                    )}
                  </div>

                  <div style={{margin:"0 0 24px",height:1,background:"#1a1a1a"}}/>

                  {/* Albums */}
                  <div id="home-albums">
                    <h2 className="section-heading" style={{marginBottom:16}}>Albums</h2>
                    <CatalogGrid items={albums} type="albums" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} onCardClick={setSelectedAlbum} onOpenAlbumTracklist={setAlbumTracklistRelease} isMobile={isMobile} accountState={accountState} userId={currentUser?.id} isAdmin={isAdmin} onGift={openGiftSheet} onLibraryChange={() => { void refreshAccountState(); void refreshLibrary(); }}/>
                  </div>

                  {/* Audio Visuals */}
                  <div style={{margin:"32px 0 24px",height:1,background:"#1a1a1a"}}/>
                  <AudioVisualsSection isMobile={isMobile} onAudioVisualsFocused={handleAudioVisualsFocused}/>

                  <div style={{margin:"32px 0 24px",height:1,background:"#1a1a1a"}}/>

                  {/* Shop */}
                  <div id="home-shop">
                    <h2 className="section-heading" style={{marginBottom:16}}>Shop</h2>
                    {printfulLoading ? <div style={{padding:"32px 0",textAlign:"center",fontSize:13,color:"#333",letterSpacing:2}}>Loading products…</div> : (
                      <>
                        {shopIsFallback && <div style={{fontSize:11,color:"#333",letterSpacing:1,marginBottom:16}}>Store coming soon — preview below</div>}
                        <CatalogGrid items={shopItems} type="products" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} isMobile={isMobile}/>
                      </>
                    )}
                  </div>

                  <div style={{margin:"32px 0 24px",height:1,background:"#1a1a1a"}}/>

                  {/* Vault — empty placeholder; collector cards live on /collectors-cards */}
                  <div id="home-vault">
                    <h2 className="section-heading" style={{marginBottom:8}}>Vault</h2>
                    <div style={{background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:isMobile?14:18,padding:isMobile?"28px 20px":"40px 32px",textAlign:"center"}}>
                      <p style={{fontSize:13,color:"#555",letterSpacing:1,lineHeight:1.8,margin:0}}>The Vault remains completely empty for now. Exclusive drops will be listed here when they launch.</p>
                    </div>
                  </div>

                  <div style={{margin:"32px 0 24px",height:1,background:"#1a1a1a"}}/>

                  <div id="home-cards">
                    <h2 className="section-heading" style={{marginBottom:8}}>Collector&apos;s Cards</h2>
                    <p style={{fontSize:13,color:"#444",marginBottom:18,letterSpacing:1,lineHeight:1.8}}>Physical ownership tokens — numbered editions on a dedicated page.</p>
                    <button type="button" onClick={()=>{ window.location.href = COLLECTORS_CARDS_ROUTE; }} style={{padding:"11px 18px",background:"transparent",border:"1px solid rgba(0,255,255,0.35)",borderRadius:10,color:"#00ffff",fontSize:12,fontWeight:700,letterSpacing:1.5,cursor:"pointer"}}>View Collector&apos;s Cards →</button>
                  </div>

                  <div style={{margin:"32px 0 24px",height:1,background:"#1a1a1a"}}/>

                  {/* Shows */}
                  <div id="home-shows">
                    <h2 className="section-heading" style={{marginBottom:16}}>Shows & Events</h2>
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      {events.map(evt=>(
                        <div key={evt.id} style={{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:14,padding:isMobile?"14px":"16px 18px",display:"flex",alignItems:isMobile?"flex-start":"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                          <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:isMobile?13:14,marginBottom:3}}>{evt.name}</div><div style={{fontSize:12,color:"#aaa"}}>{evt.location}</div><div style={{fontSize:11,color:"#555",marginTop:2}}>{new Date(evt.date).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"})} · {evt.time}</div></div>
                          <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{fontSize:15,fontWeight:900,color:"#00ffff"}}>${evt.price.toFixed(2)}</div><button onClick={()=>setSelectedEvent(evt)} style={{padding:"8px 14px",background:"#111",color:"white",border:"1px solid #333",borderRadius:8,cursor:"pointer",fontWeight:"bold",fontSize:12,transition:"0.2s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="#00ffff"} onMouseLeave={e=>e.currentTarget.style.borderColor="#333"}>Tickets</button></div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{margin:"32px 0 24px",height:1,background:"#1a1a1a"}}/>

                  {/* Live */}
                  <div id="home-live">
                    <h2 className="section-heading" style={{marginBottom:16}}>2MRRW LIVE</h2>
                    <div style={{background:"linear-gradient(135deg,#080808,#0d0d0d)",border:"1px solid rgba(0,255,255,0.1)",borderRadius:20,padding:isMobile?"20px 16px":"32px",textAlign:"center"}}>
                      <div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:8}}>NEXT LIVE STREAM</div>
                      <div style={{fontSize:isMobile?16:20,fontWeight:800,marginBottom:4}}>2MRRW LIVE – Dallas</div>
                      <div style={{fontSize:13,color:"#aaa",marginBottom:24}}>{liveStreamDate} · {liveStreamTime}</div>
                      {liveIsLive ? <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontSize:22,fontWeight:900,color:"#00ffff"}}><div style={{width:10,height:10,borderRadius:"50%",background:"#00ffff",animation:"pulse 1.2s infinite"}}/>LIVE NOW</div>
                        : <div style={{display:"flex",justifyContent:"center",gap:isMobile?8:14,flexWrap:"wrap"}}>{[{v:liveCountdown.days,l:"Days"},{v:liveCountdown.hours,l:"Hours"},{v:liveCountdown.minutes,l:"Min"},{v:liveCountdown.seconds,l:"Sec"}].map(u=><div key={u.l} style={{background:"#0a0a0a",border:"1px solid #1e1e1e",borderRadius:14,padding:isMobile?"12px 10px":"16px 20px",minWidth:isMobile?52:68,textAlign:"center"}}><div style={{fontSize:isMobile?24:32,fontWeight:900,color:"#00ffff",fontVariantNumeric:"tabular-nums",lineHeight:1}}>{String(u.v).padStart(2,"0")}</div><div style={{fontSize:9,color:"#444",letterSpacing:2,marginTop:5,textTransform:"uppercase"}}>{u.l}</div></div>)}</div>}
                    </div>
                  </div>
                  <div style={{height:40}}/>
                </>
              )}

              {/* ══ MUSIC TAB ══ */}
              {(activeTab==="singles"||activeTab==="albums"||activeTab==="mymusic") && (
                <>
                  <div style={{marginTop:8,marginBottom:0}}>
                    <div style={{display:"flex",gap:0,borderBottom:"1px solid #1a1a1a",marginBottom:24}}>
                      {[{id:"singles",label:"Singles"},{id:"albums",label:"Albums"},{id:"mymusic",label:"Collection"}].map(sub=>(
                        <button key={sub.id} onClick={()=>switchTab(sub.id)} style={{padding:isMobile?"11px 16px":"12px 22px",background:"none",border:"none",borderBottom:activeTab===sub.id?"2px solid #00ffff":"2px solid transparent",color:activeTab===sub.id?"#00ffff":"#555",fontSize:isMobile?12:13,fontWeight:700,letterSpacing:1.5,cursor:"pointer",transition:"all 0.18s",textTransform:"uppercase",marginBottom:-1}}>
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── SINGLES sub-tab ── */}
                  {activeTab==="singles" && (
                    <>
                      <div style={{marginBottom:20}}>
                        <div style={{position:"relative"}}>
                          <input placeholder="Search singles…" style={{width:"100%",padding:"11px 14px 11px 38px",background:"#0d0d0d",border:"1px solid #1e1e1e",borderRadius:10,color:"white",fontSize:13,outline:"none",boxSizing:"border-box",transition:"border-color 0.2s"}} onFocus={e=>e.currentTarget.style.borderColor="#00ffff33"} onBlur={e=>e.currentTarget.style.borderColor="#1e1e1e"}/>
                          <svg style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",opacity:0.3}} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                        </div>
                      </div>
                      <h2 className="section-heading" style={{marginBottom:14}}>Singles</h2>
                      <CarouselUI large={!isMobile} isMobile={isMobile} currentSingle={currentSingle} currentSingleAccess={currentSingleAccess} singleIndex={singleIndex} singles={displaySingles} prevSingle={prevSingle} nextSingle={nextSingle} goToSingle={goToSingle} onSingleClick={handleSingleClick} addToCart={addToCart} addVinylToCart={addVinylToCart} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} accountState={accountState} userId={currentUser?.id} isAdmin={isAdmin} onGift={openGiftSheet} onLibraryChange={() => { void refreshAccountState(); void refreshLibrary(); }}/>
                      <div style={{marginTop:32,marginBottom:4}}>
                        <h2 className="section-heading" style={{marginBottom:14}}>Features</h2>
                        <FeaturesRail features={features} isMobile={isMobile} addToCart={addToCart} onPlay={handleFeatureClick} accountState={accountState} userId={currentUser?.id} isAdmin={isAdmin} onGift={openGiftSheet} onLibraryChange={() => { void refreshAccountState(); void refreshLibrary(); }}/>
                      </div>
                      <AudioVisualsSection isMobile={isMobile} onAudioVisualsFocused={handleAudioVisualsFocused}/>
                    </>
                  )}

                  {/* ── ALBUMS sub-tab ── */}
                  {activeTab==="albums" && (
                    <>
                      <h2 className="section-heading" style={{marginBottom:16}}>Albums</h2>
                      <CatalogGrid items={albums} type="albums" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} onCardClick={setSelectedAlbum} onOpenAlbumTracklist={setAlbumTracklistRelease} isMobile={isMobile} accountState={accountState} userId={currentUser?.id} isAdmin={isAdmin} onGift={openGiftSheet} onLibraryChange={() => { void refreshAccountState(); void refreshLibrary(); }}/>
                    </>
                  )}

                  {/* ── MY MUSIC sub-tab ── */}
                  {activeTab==="mymusic" && (
                    <>
                      <MyMusicTab
                        singles={displaySingles}
                        albums={albums}
                        isMobile={isMobile}
                        isAdmin={isAdmin}
                        highlightSlug={giftHighlightSlug}
                        onSwitchTab={switchTab}
                        onOpenSingle={openSingleModal}
                        onOpenAlbum={setSelectedAlbum}
                      />
                    </>
                  )}
                </>
              )}

              {/* ══ SHOP ══ */}
              {activeTab==="shop" && (
                <>
                  <h2 className="section-heading" style={{marginBottom:16}}>Merch</h2>
                  {printfulLoading ? <div style={{padding:"60px 0",textAlign:"center",fontSize:13,color:"#333",letterSpacing:2}}>Loading products…</div> : (
                    <>
                      {shopIsFallback && <div style={{marginBottom:20,padding:"12px 16px",background:"rgba(255,255,255,0.02)",border:"1px solid #1a1a1a",borderRadius:10,fontSize:11,color:"#444",letterSpacing:1,lineHeight:1.7}}>Store inventory is syncing. Showing preview items — check back soon for the full Printful catalog.</div>}
                      <CatalogGrid items={shopItems} type="products" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} isMobile={isMobile}/>
                    </>
                  )}
                </>
              )}

              {/* ══ VAULT ══ */}
              {activeTab==="vault" && (
                <>
                  <h2 className="section-heading">Vault</h2>
                  <div style={{marginTop:28,background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:isMobile?14:20,padding:isMobile?"36px 24px":"48px 40px",textAlign:"center",maxWidth:520}}>
                    <p style={{fontSize:13,color:"#555",letterSpacing:1,lineHeight:1.8,margin:0}}>The Vault remains empty for now. Exclusive drops will be listed here when they launch.</p>
                  </div>
                </>
              )}

              {/* ══ SHOWS ══ */}
              {activeTab==="shows" && (
                <>
                  <h2 className="section-heading" style={{marginBottom:20}}>Shows & Events</h2>
                  {!isMobile && (
                    <div style={{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:20,padding:24,marginBottom:30}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
                        <button onClick={prevMonth} style={{background:"none",border:"1px solid #333",color:"white",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:16}}>‹</button>
                        <div style={{fontSize:18,fontWeight:700,letterSpacing:3}}>{monthNames[calMonth]} {calYear}</div>
                        <button onClick={nextMonth} style={{background:"none",border:"1px solid #333",color:"white",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:16}}>›</button>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} style={{textAlign:"center",fontSize:11,color:"#555",paddingBottom:6}}>{d}</div>)}</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
                        {Array.from({length:getFirstDayOfMonth(calMonth,calYear)}).map((_,i)=><div key={`e-${i}`}/>)}
                        {Array.from({length:getDaysInMonth(calMonth,calYear)}).map((_,i)=>{
                          const day=i+1; const dayShows=getShowsForDay(day);
                          const isToday=new Date().getDate()===day && new Date().getMonth()===calMonth && new Date().getFullYear()===calYear;
                          return <div key={day} onClick={()=>dayShows.length>0&&setSelectedEvent(dayShows[0])} style={{minHeight:44,borderRadius:8,background:dayShows.length>0?"rgba(0,255,255,0.08)":"transparent",border:isToday?"1px solid #00ffff":dayShows.length>0?"1px solid rgba(0,255,255,0.3)":"1px solid #1a1a1a",cursor:dayShows.length>0?"pointer":"default",padding:6,display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"0.2s"}}><span style={{fontSize:12,color:isToday?"#00ffff":"#aaa"}}>{day}</span>{dayShows.map(s=><span key={s.id} style={{fontSize:9,background:"#00ffff",color:"#000",borderRadius:4,padding:"1px 4px",fontWeight:700}}>EVENT</span>)}</div>;
                        })}
                      </div>
                    </div>
                  )}
                  <h2 style={{letterSpacing:3,fontSize:14,color:"#555",marginBottom:16,textTransform:"uppercase"}}>Upcoming Events</h2>
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {events.map(evt=>(
                      <div key={evt.id} style={{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:14,padding:isMobile?"14px":"18px 20px",display:"flex",alignItems:isMobile?"flex-start":"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:isMobile?13:15,marginBottom:4}}>{evt.name}</div><div style={{fontSize:12,color:"#aaa"}}>{evt.location}</div><div style={{fontSize:11,color:"#555",marginTop:2}}>{new Date(evt.date).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"})} · {evt.time}</div></div>
                        <div style={{display:"flex",alignItems:"center",gap:isMobile?10:14}}><div style={{fontSize:isMobile?15:18,fontWeight:900,color:"#00ffff"}}>${evt.price.toFixed(2)}</div><button onClick={()=>setSelectedEvent(evt)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{padding:isMobile?"9px 14px":"10px 20px",background:"#111",color:"white",border:"1px solid #333",borderRadius:8,cursor:"pointer",fontWeight:"bold",fontSize:isMobile?12:13,transition:"0.25s"}}>Get Tickets</button></div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ══ LIVE ══ */}
              {activeTab==="live" && (
                <>
                  <h2 className="section-heading">2MRRW LIVE</h2>
                  <div style={{background:"linear-gradient(135deg,#080808,#0d0d0d)",border:"1px solid rgba(0,255,255,0.12)",borderRadius:20,padding:isMobile?"20px 16px":"36px 32px",marginBottom:28,textAlign:"center"}}>
                    <div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:6,textTransform:"uppercase"}}>Next Live Stream</div>
                    <div style={{fontSize:isMobile?17:22,fontWeight:800,marginBottom:4}}>2MRRW LIVE – Dallas</div>
                    <div style={{fontSize:13,color:"#aaa",marginBottom:28}}>{liveStreamDate} · {liveStreamTime}</div>
                    {liveIsLive ? <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:20}}><div style={{width:12,height:12,borderRadius:"50%",background:"#00ffff",boxShadow:"0 0 14px rgba(0,255,255,0.9)",animation:"pulse 1.2s infinite"}}/><div style={{fontSize:28,fontWeight:900,color:"#00ffff",letterSpacing:4}}>LIVE NOW</div></div>
                      : <div style={{display:"flex",justifyContent:"center",gap:isMobile?8:16,flexWrap:"wrap"}}>{[{v:liveCountdown.days,l:"Days"},{v:liveCountdown.hours,l:"Hours"},{v:liveCountdown.minutes,l:"Min"},{v:liveCountdown.seconds,l:"Sec"}].map(u=><div key={u.l} style={{background:"#0a0a0a",border:"1px solid #1e1e1e",borderRadius:14,padding:isMobile?"12px 10px":"18px 22px",minWidth:isMobile?52:74,textAlign:"center"}}><div style={{fontSize:isMobile?26:36,fontWeight:900,color:"#00ffff",fontVariantNumeric:"tabular-nums",lineHeight:1}}>{String(u.v).padStart(2,"0")}</div><div style={{fontSize:9,color:"#444",letterSpacing:2,marginTop:6,textTransform:"uppercase"}}>{u.l}</div></div>)}</div>}
                  </div>
                  <div style={{background:"#0d0d0d",border:"1px solid #1e1e1e",borderRadius:20,overflow:"hidden",marginBottom:28}}>
                    <div style={{position:"relative",paddingBottom:"56.25%",background:"#050505"}}>
                      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
                        <div style={{width:70,height:70,borderRadius:"50%",border:"1px solid #222",display:"flex",alignItems:"center",justifyContent:"center"}}><svg viewBox="0 0 24 24" fill="#333" width="32" height="32"><circle cx="12" cy="12" r="4"/><path d="M20.188 10.934a8.999 8.999 0 0 0-16.376 0M23.472 9.16a13.5 13.5 0 0 0-22.944 0M16.905 12.7a4.5 4.5 0 0 0-9.81 0M12 17v-1m0 5v-2" stroke="#333" strokeWidth="1.5" fill="none"/></svg></div>
                        <div style={{fontSize:14,color:"#333",fontWeight:700,letterSpacing:2}}>{liveIsLive?"STREAM STARTING…":"OFFLINE"}</div>
                        <div style={{fontSize:12,color:"#2a2a2a"}}>Live streams announced via Circle + socials</div>
                      </div>
                    </div>
                    <div style={{padding:"16px 20px",borderTop:"1px solid #111"}}><div style={{fontSize:13,color:"#444"}}>Live streams broadcast here and on Twitch. Follow to get notified.</div></div>
                  </div>
                </>
              )}

              {/* ══ HELP & SUPPORT ══ */}
              {activeTab==="help" && (
                <HelpSupportSection userId={currentUser?.id} />
              )}

              {/* ══ BLOG ══ */}
              {activeTab==="blog" && (
                <>
                  {blogPost ? (
                    <div>
                      <button onClick={()=>setBlogPost(null)} style={{background:"none",border:"none",color:"#00ffff",cursor:"pointer",fontSize:13,marginBottom:20,padding:0,letterSpacing:1}}>← BACK TO BLOG</button>
                      <h1 style={{fontSize:isMobile?20:24,fontWeight:900,marginBottom:6,letterSpacing:1}}>{blogPost.title}</h1>
                      <div style={{fontSize:12,color:"#555",marginBottom:24}}>{blogPost.date} · by {blogPost.author}</div>
                      <div style={{fontSize:14,lineHeight:1.9,color:"#ccc",whiteSpace:"pre-line",marginBottom:40}}>{blogPost.body}</div>
                      <div style={{borderTop:"1px solid #1e1e1e",paddingTop:24}}>
                        <h3 style={{fontSize:13,letterSpacing:3,color:"#555",marginBottom:16,textTransform:"uppercase"}}>Comments</h3>
                        {(blogComments[blogPost.id]||[]).length===0 && <p style={{fontSize:13,color:"#444",marginBottom:20}}>No comments yet. Be the first.</p>}
                        {(blogComments[blogPost.id]||[]).map((c,i)=><div key={i} style={{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:10,padding:"12px 16px",marginBottom:10}}><div style={{fontSize:12,fontWeight:700,color:"#00ffff",marginBottom:4}}>{c.name}</div><div style={{fontSize:13,color:"#ccc"}}>{c.text}</div><div style={{fontSize:10,color:"#444",marginTop:6}}>{c.time}</div></div>)}
                        <div style={{display:"flex",gap:10,marginTop:16}}>
                          <input placeholder="Leave a comment…" value={blogComment} onChange={e=>setBlogComment(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddComment(blogPost.id)} style={{flex:1,padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:13}}/>
                          <button onClick={()=>handleAddComment(blogPost.id)} style={{padding:"10px 18px",background:"#00ffff",color:"#000",fontWeight:"bold",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>Post</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="section-heading" style={{marginBottom:24}}>Community Blog</h2>
                      <div style={{display:"flex",flexDirection:"column",gap:20}}>
                        {blogPosts.map(post=>(
                          <div key={post.id} onClick={()=>setBlogPost(post)} style={{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:14,padding:isMobile?18:24,cursor:"pointer",transition:"0.25s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#00ffff";e.currentTarget.style.boxShadow="0 0 16px rgba(0,255,255,0.1)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#1e1e1e";e.currentTarget.style.boxShadow="none";}}>
                            <div style={{fontSize:isMobile?15:18,fontWeight:800,marginBottom:6}}>{post.title}</div>
                            <div style={{fontSize:11,color:"#555",marginBottom:12}}>{post.date} · by {post.author}</div>
                            <div style={{fontSize:13,color:"#777",lineHeight:1.7}}>{post.body.slice(0,160)}…</div>
                            <div style={{fontSize:12,color:"#00ffff",marginTop:14}}>Read more →</div>
                            <div style={{fontSize:11,color:"#444",marginTop:6}}>{(blogComments[post.id]||[]).length} comment{(blogComments[post.id]||[]).length!==1?"s":""}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ══ VISION ══ */}
              {activeTab==="vision" && (
                <>
                  <h2 className="section-heading">Vision</h2>
                  <div style={{background:"linear-gradient(135deg,#080808,#0e0e0e)",border:"1px solid #1a1a1a",borderRadius:24,padding:isMobile?"28px 20px":"48px 40px",marginBottom:28,textAlign:"center",position:"relative",overflow:"hidden"}}>
                    <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at center,rgba(0,255,255,0.04) 0%,transparent 65%)",pointerEvents:"none"}}/>
                    <div style={{fontSize:11,color:"#444",letterSpacing:4,marginBottom:20,textTransform:"uppercase"}}>The Name</div>
                    <div style={{fontSize:isMobile?36:52,fontWeight:900,letterSpacing:isMobile?4:8,color:"white",textShadow:"0 0 40px rgba(0,255,255,0.3)",marginBottom:20,lineHeight:1}}>2MRRW</div>
                    <div style={{fontSize:16,color:"#777",letterSpacing:2,fontStyle:"italic"}}>Tomorrow. Always possible.</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:20}}>
                    {[{label:"The Name",heading:"What 2MRRW Means",body:"2MRRW started as a reminder, not a brand. A reminder that no matter how hard today is, tomorrow is a blank page. You get to start again. The number 2 is intentional — it's shorthand for the second chance, the next version, the one that gets it right.\n\nEvery record, every show, every piece of merch carries that forward. If you're listening, you're part of the movement."},{label:"The Music",heading:"Artist Philosophy",body:"Music is not background noise. It's a conversation. 2MRRW makes music that holds something real — real emotion, real experience, real questions. Not manufactured for playlists. Built for people who feel deeply.\n\nThe goal is never to chase what's popular. The goal is to make something that still means something in 10 years. That's the standard every project is held to."},{label:"The Mission",heading:"What This Is Building",body:"This is not a streaming play. This is an ecosystem. Direct-to-fan. Artist-owned. Built on trust between creator and believer.\n\nThe music is the entry point. The community is the foundation. The collector system is the bridge between listening and belonging. Every piece is connected. Every purchase, every comment, every ticket is a step deeper into something that's being built in real time.\n\nListeners come and go. Fans stay. Believers build the movement."}].map((s,i)=>(
                      <div key={i} style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:18,padding:isMobile?"20px":"28px 30px"}}>
                        <div style={{fontSize:10,color:"#444",letterSpacing:3,marginBottom:10,textTransform:"uppercase"}}>{s.label}</div>
                        <div style={{fontSize:isMobile?17:20,fontWeight:800,marginBottom:16,letterSpacing:0.5}}>{s.heading}</div>
                        <div style={{fontSize:14,color:"#888",lineHeight:2,whiteSpace:"pre-line"}}>{s.body}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:32,padding:"28px 30px",borderTop:"1px solid #1a1a1a",textAlign:"center"}}><div style={{fontSize:13,color:"#555",lineHeight:2}}>You are not just a listener.<br/><span style={{color:"#00ffff",fontWeight:700}}>You are early.</span></div></div>
                </>
              )}

              {/* ══ CIRCLE ══ */}
              {activeTab==="circle" && (
                <>
                  <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:6,flexWrap:"wrap"}}>
                    <h2 className="section-heading" style={{margin:0}}>The Circle</h2>
                    {userStatus && <div style={{fontSize:10,fontWeight:900,letterSpacing:2,padding:"3px 10px",borderRadius:20,background:userStatus.glow+"22",color:userStatus.color,border:`1px solid ${userStatus.color}44`,boxShadow:`0 0 10px ${userStatus.glow}`}}>{userStatus.label}</div>}
                  </div>
                  <p style={{fontSize:13,color:"#444",marginBottom:28,lineHeight:1.8}}>This is not a comment section. It's a direct line. Ask 2MRRW anything. Share what the music means to you. Selected submissions receive an official response.</p>
                  <div style={{background:"#0d0d0d",border:"1px solid #1e1e1e",borderRadius:20,padding:isMobile?20:28,marginBottom:32}}>
                    <div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>Ask 2MRRW</div>
                    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>{["question","thought","feedback","message"].map(cat=><button key={cat} onClick={()=>setCircleCategory(cat)} style={{padding:"6px 12px",fontSize:11,fontWeight:700,letterSpacing:1,cursor:"pointer",border:circleCategory===cat?"1px solid #00ffff":"1px solid #2a2a2a",borderRadius:20,background:circleCategory===cat?"rgba(0,255,255,0.1)":"transparent",color:circleCategory===cat?"#00ffff":"#555",textTransform:"uppercase",transition:"0.2s"}}>{cat}</button>)}</div>
                    <textarea placeholder="Write your question or message…" value={circleQuestion} onChange={e=>setCircleQuestion(e.target.value)} rows={4} style={{width:"100%",padding:"12px 14px",background:"#0a0a0a",border:"1px solid #2a2a2a",color:"white",borderRadius:12,fontSize:14,resize:"vertical",outline:"none",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.7}}/>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:12,flexWrap:"wrap",gap:8}}>
                      <div style={{fontSize:12,color:"#444"}}>{currentUser?`Posting as ${currentUser.name}`:"Posting anonymously"}</div>
                      <button onClick={handleCircleSubmit} style={{padding:"10px 24px",background:circleSubmitted?"#1a3a1a":"#00ffff",color:circleSubmitted?"#00ff88":"#000",fontWeight:900,border:"none",borderRadius:10,cursor:"pointer",fontSize:13,transition:"0.3s",letterSpacing:1}}>{circleSubmitted?"✓ Submitted":"Submit"}</button>
                    </div>
                    {circleSubmitted && <div style={{marginTop:12,fontSize:12,color:"#00ff88"}}>Your message was received. If selected, 2MRRW will respond here in the archive.</div>}
                  </div>
                  <div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>2MRRW Responses</div>
                  <div style={{display:"flex",flexDirection:"column",gap:16,marginBottom:36}}>
                    {circleResponses.map(resp=>(
                      <div key={resp.id} style={{background:resp.highlight?"linear-gradient(135deg,#0d0d0d,#111)":"#0a0a0a",border:resp.highlight?`1px solid ${resp.tagColor}33`:"1px solid #1a1a1a",borderRadius:18,padding:isMobile?18:24,boxShadow:resp.highlight?`0 0 30px ${resp.tagColor}10`:"none"}}>
                        <div style={{marginBottom:16}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><div style={{width:28,height:28,borderRadius:"50%",background:"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#555",fontWeight:700,flexShrink:0}}>{resp.questionBy[0]}</div><div><div style={{fontSize:12,fontWeight:700,color:"#aaa"}}>{resp.questionBy}</div><div style={{fontSize:10,color:"#444"}}>{resp.questionTime}</div></div></div><div style={{fontSize:14,color:"#888",lineHeight:1.7,fontStyle:"italic"}}>"{resp.question}"</div></div>
                        <div style={{borderTop:"1px solid #1a1a1a",paddingTop:16}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><div style={{fontSize:11,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 10px rgba(0,255,255,0.5)"}}>2MRRW</div><div style={{fontSize:10,fontWeight:900,letterSpacing:1,padding:"2px 8px",borderRadius:10,background:resp.tagColor+"22",color:resp.tagColor,border:`1px solid ${resp.tagColor}44`}}>{resp.tag}</div></div><div style={{fontSize:14,color:"#ccc",lineHeight:1.9}}>{resp.response}</div></div>
                      </div>
                    ))}
                  </div>
                  <div style={{background:"linear-gradient(135deg,#0a0a14,#0d0d0d)",border:"1px solid #1a1a2a",borderRadius:20,padding:isMobile?"20px":"28px 30px"}}>
                    <div style={{fontSize:11,color:"#444",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>Community Status</div>
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
                      {[{label:"EARLY SUPPORTER",color:"#aaa",desc:"Joined the ecosystem early."},{label:"COLLECTOR",color:"#ff6b35",desc:"Purchased a collector card or bundle."},{label:"VISIONARY",color:"#00ffff",desc:"3+ Circle submissions."},{label:"INNER CIRCLE",color:"#a259ff",desc:"Collector + Circle member."}].map(s=><div key={s.label} style={{padding:"14px",background:"#080808",borderRadius:14,border:`1px solid ${s.color}22`}}><div style={{fontSize:9,fontWeight:900,letterSpacing:2,color:s.color,marginBottom:6}}>{s.label}</div><div style={{fontSize:11,color:"#555",lineHeight:1.6}}>{s.desc}</div></div>)}
                    </div>
                    {userStatus && <div style={{marginTop:20,padding:"14px 18px",background:userStatus.glow+"10",borderRadius:12,border:`1px solid ${userStatus.color}33`,display:"flex",alignItems:"center",gap:12}}><div style={{fontSize:10,color:"#555"}}>Your status:</div><div style={{fontSize:11,fontWeight:900,letterSpacing:2,color:userStatus.color}}>{userStatus.label}</div></div>}
                  </div>
                </>
              )}

              {/* ══ INNER CIRCLE ══ */}
              {activeTab==="innercircle" && (
                <>
                  {userStatus?.label !== "INNER CIRCLE" ? (
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",padding:isMobile?"40px 16px":"60px 20px"}}>
                      <div style={{fontSize:56,lineHeight:1,marginBottom:24,filter:"drop-shadow(0 0 24px rgba(162,89,255,0.5))",animation:"pulse 3s infinite"}}>🔒</div>
                      <div style={{fontSize:11,color:"#a259ff",letterSpacing:4,marginBottom:12,fontWeight:700}}>RESTRICTED ACCESS</div>
                      <div style={{fontSize:isMobile?20:24,fontWeight:900,letterSpacing:1,marginBottom:14}}>Inner Circle Access Required</div>
                      <div style={{fontSize:14,color:"#555",maxWidth:400,lineHeight:1.9,marginBottom:36}}>This section is reserved for verified Inner Circle members — those who own a piece of the music and are active in the conversation.</div>
                      <div style={{width:"100%",maxWidth:460,display:"flex",flexDirection:"column",gap:12,marginBottom:32}}>
                        <div style={{fontSize:11,color:"#a259ff",letterSpacing:3,marginBottom:4,fontWeight:700}}>HOW TO UNLOCK</div>
                        {[{label:"Own a Collector Card or Bundle",done:myPurchases.some(p=>p.slug?.startsWith("exc-card")||p.slug?.startsWith("exc-bundle")),link:"cards",linkLabel:"Collector's Cards →"},{label:"Submit to The Circle",done:circleSubmissions.filter(s=>s.by===currentUser?.name).length>=1,link:"circle",linkLabel:"Go to Circle →"}].map((step,i)=>(
                          <div key={i} style={{padding:"16px 20px",background:step.done?"rgba(162,89,255,0.06)":"#0d0d0d",border:`1px solid ${step.done?"rgba(162,89,255,0.3)":"#1e1e1e"}`,borderRadius:14,display:"flex",alignItems:"center",gap:14,textAlign:"left"}}>
                            <div style={{width:28,height:28,borderRadius:"50%",background:step.done?"rgba(162,89,255,0.2)":"#111",border:`1px solid ${step.done?"#a259ff":"#222"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:step.done?"#a259ff":"#333",flexShrink:0}}>{step.done?"✓":i+1}</div>
                            <div style={{flex:1,fontSize:13,color:step.done?"#a259ff":"#666",fontWeight:step.done?700:400}}>{step.label}</div>
                            {!step.done && <button onClick={()=>switchTab(step.link)} style={{padding:"6px 14px",background:"rgba(162,89,255,0.1)",border:"1px solid rgba(162,89,255,0.25)",borderRadius:8,color:"#a259ff",cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{step.linkLabel}</button>}
                          </div>
                        ))}
                      </div>
                      {userStatus && <div style={{fontSize:12,color:"#444"}}>Current status: <span style={{color:userStatus.color,fontWeight:700}}>{userStatus.label}</span></div>}
                    </div>
                  ) : (
                    <>
                      {innerCirclePost ? (
                        <div>
                          <button onClick={()=>setInnerCirclePost(null)} style={{background:"none",border:"none",color:"#a259ff",cursor:"pointer",fontSize:13,marginBottom:20,padding:0,letterSpacing:1}}>← BACK TO INNER CIRCLE</button>
                          <div style={{fontSize:10,color:"#a259ff",letterSpacing:3,marginBottom:12,textTransform:"uppercase"}}>Inner Circle Exclusive</div>
                          <h1 style={{fontSize:isMobile?20:24,fontWeight:900,marginBottom:6,letterSpacing:1}}>{innerCirclePost.title}</h1>
                          <div style={{fontSize:12,color:"#555",marginBottom:28}}>{innerCirclePost.date}</div>
                          <div style={{fontSize:14,lineHeight:1.9,color:"#ccc",whiteSpace:"pre-line"}}>{innerCirclePost.body}</div>
                        </div>
                      ) : (
                        <>
                          <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:6,flexWrap:"wrap"}}><h2 className="section-heading" style={{margin:0}}>Inner Circle</h2>{userStatus&&<div style={{fontSize:10,fontWeight:900,letterSpacing:2,padding:"3px 10px",borderRadius:20,background:"rgba(162,89,255,0.12)",color:"#a259ff",border:"1px solid rgba(162,89,255,0.3)"}}>{userStatus.label}</div>}</div>
                          <p style={{fontSize:13,color:"#444",marginBottom:32,lineHeight:1.8}}>Exclusive posts for believers. This is where the real conversation lives.</p>
                          <div style={{background:"linear-gradient(135deg,#0d0814,#0d0d0d)",border:"1px solid rgba(162,89,255,0.2)",borderRadius:20,padding:isMobile?"20px":"28px 30px",marginBottom:28,position:"relative",overflow:"hidden"}}>
                            <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at top left,rgba(162,89,255,0.06) 0%,transparent 60%)",pointerEvents:"none"}}/>
                            <div style={{fontSize:11,color:"#a259ff",letterSpacing:3,marginBottom:8,textTransform:"uppercase"}}>Direct from 2MRRW</div>
                            <div style={{fontSize:18,fontWeight:800,marginBottom:8}}>The stories behind the music.</div>
                            <div style={{fontSize:13,color:"#555",lineHeight:1.8}}>Not for everyone. Written for the people who actually listen.</div>
                          </div>
                          {publicVault?.unlocked ? (
                            <div style={{marginBottom:32}}>
                              <VaultUnlockedRoom
                                sections={publicVault.sections || []}
                                pricing={publicVault.pricing}
                                vaultAccess={publicVault.vaultAccess}
                              />
                            </div>
                          ) : null}
                          <div style={{display:"flex",flexDirection:"column",gap:18}}>
                            {innerCirclePosts.map((post,i)=>(
                              <div key={post.id} onClick={()=>setInnerCirclePost(post)} style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:16,padding:isMobile?18:24,cursor:"pointer",opacity:0,animation:`fadeInUp 0.5s ease ${i*0.1}s forwards`,transition:"border-color 0.25s,box-shadow 0.25s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#a259ff55";e.currentTarget.style.boxShadow="0 0 20px rgba(162,89,255,0.1)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#1a1a1a";e.currentTarget.style.boxShadow="none";}}>
                                <div style={{fontSize:10,color:"#a259ff",letterSpacing:3,marginBottom:8,textTransform:"uppercase"}}>Inner Circle Exclusive</div>
                                <div style={{fontSize:isMobile?15:18,fontWeight:800,marginBottom:6}}>{post.title}</div>
                                <div style={{fontSize:11,color:"#555",marginBottom:12}}>{post.date}</div>
                                <div style={{fontSize:13,color:"#666",lineHeight:1.7}}>{post.preview}</div>
                                <div style={{fontSize:12,color:"#a259ff",marginTop:16}}>Read more →</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ══ ACCOUNT ══ */}
              {activeTab==="account" && (
                <>
                  <h2 className="section-heading">Account</h2>
                  {currentUser ? (
                    <div style={{display:"flex",flexDirection:"column",gap:20}}>
                      <div style={{background:"#0d0d0d",border:"1px solid #1e1e1e",borderRadius:20,padding:isMobile?20:28}}>
                        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20,flexWrap:"wrap"}}><div style={{width:56,height:56,borderRadius:"50%",background:"linear-gradient(135deg,#00ffff22,#a259ff22)",border:"1px solid #333",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:900,color:"#00ffff",flexShrink:0}}>{currentUser.name[0].toUpperCase()}</div><div><div style={{fontSize:18,fontWeight:800}}>{currentUser.name}</div><div style={{fontSize:13,color:"#555",marginTop:2}}>{currentUser.email}</div></div>{userStatus&&<div style={{marginLeft:isMobile?0:"auto",fontSize:10,fontWeight:900,letterSpacing:2,padding:"4px 12px",borderRadius:20,background:userStatus.glow+"22",color:userStatus.color,border:`1px solid ${userStatus.color}44`}}>{userStatus.label}</div>}</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>{[{label:"Purchases",value:myPurchases.length},{label:"Circle Posts",value:circleSubmissions.filter(s=>s.by===currentUser.name).length},{label:"Member Since",value:"2026"}].map(stat=><div key={stat.label} style={{padding:"14px 10px",background:"#080808",borderRadius:12,border:"1px solid #1a1a1a",textAlign:"center"}}><div style={{fontSize:isMobile?20:24,fontWeight:900,color:"#00ffff"}}>{stat.value}</div><div style={{fontSize:isMobile?9:11,color:"#555",marginTop:4,letterSpacing:1}}>{stat.label}</div></div>)}</div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{[{label:"My Collection",tab:"mymusic",color:"#00ffff"},{label:"Vault Drops",tab:"vault",color:"#a259ff"},{label:"The Circle",tab:"circle",color:"#ff6b35"},{label:"Inner Circle",tab:"innercircle",color:"#a259ff"}].map(link=><button key={link.tab} onClick={()=>switchTab(link.tab)} style={{padding:"14px",background:"#0a0a0a",border:`1px solid ${link.color}22`,borderRadius:14,cursor:"pointer",textAlign:"left",color:link.color,fontSize:isMobile?12:13,fontWeight:700,transition:"0.2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=link.color+"55";e.currentTarget.style.background=link.color+"0a";}} onMouseLeave={e=>{e.currentTarget.style.borderColor=link.color+"22";e.currentTarget.style.background="#0a0a0a";}}>{link.label} →</button>)}</div>
                      {isAdmin ? <GiftsSentSection /> : null}
                      {isAdmin ? <CollectorCardAdminPanel accountState={accountState} /> : null}
                      <button onClick={handleSignOut} style={{width:"100%",height:44,padding:0,background:"transparent",color:"#444",border:"1px solid #333",borderRadius:10,cursor:"pointer",fontSize:13,transition:"0.2s"}} onMouseEnter={e=>{e.currentTarget.style.color="#fff";}} onMouseLeave={e=>{e.currentTarget.style.color="#444";}}>Sign Out</button>
                    </div>
                  ) : (
                    <div style={{maxWidth:400,padding:"24px 0"}}>
                      <div style={{fontSize:13,color:"#777",lineHeight:1.7}}>Loading account…</div>
                    </div>
                  )}
                </>
              )}

            </div>{/* end tabKey */}
            </motion.div>
            </motion.div>
          </div>{/* end scroll area */}

          {/* ── NOW PLAYING BAR (desktop) ── */}
          {nowPlaying && !isMobile && (
            <div style={{flexShrink:0,borderTop:"1px solid #141414",background:"rgba(4,4,4,0.97)",backdropFilter:"blur(20px)",zIndex:isMobile?6500:1,marginBottom:isMobile?60:0}}>
              <div onClick={seekTo} style={{width:"100%",height:3,background:"#111",cursor:"pointer",position:"relative"}}>
                <div style={{width:duration?`${(currentTime/duration)*100}%`:"0%",height:"100%",background:"#00ffff",transition:"width 0.1s linear",boxShadow:"0 0 4px rgba(0,255,255,0.5)"}}/>
              </div>
              <div style={{padding:isMobile?"8px 14px":"10px 20px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 -4px 30px rgba(0,0,0,0.5)"}}>
                <img src={nowPlaying.cover} style={{width:36,height:36,borderRadius:8,objectFit:"cover",flexShrink:0}} alt=""/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nowPlaying.title}</div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:1,fontVariantNumeric:"tabular-nums"}}>{formatTime(currentTime)} / {formatTime(duration)}</div>
                </div>
                <button onClick={() => { void toggle(); }} style={{width:36,height:36,borderRadius:"50%",background:"#00ffff",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                  {miniPlayerPlaying
                    ? <svg viewBox="0 0 24 24" fill="#000" width="14" height="14"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                    : <svg viewBox="0 0 24 24" fill="#000" width="14" height="14" style={{marginLeft:2}}><path d="M8 5v14l11-7z"/></svg>}
                </button>
                <button onClick={dismissNowPlaying} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0}}>×</button>
              </div>
            </div>
          )}
        </div>

        {/* ── DESKTOP CART SIDEBAR ── */}
        {!isMobile && (
          <div style={{width:240,flexShrink:0,borderLeft:"1px solid #222",padding:25,overflowY:"auto",background:"rgba(4,4,4,0.8)",backdropFilter:"blur(12px)"}}>
            <h3 style={{fontSize:12,letterSpacing:3,color:"#555",marginBottom:16,textTransform:"uppercase"}}>Cart</h3>
            {cart.length===0 && <p style={{opacity:0.4,fontSize:13}}>Empty</p>}
            {cart.map((item,i)=>(
              <div key={i} style={{marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                {item.cover && <img src={item.cover} style={{width:36,height:36,borderRadius:6,objectFit:"cover"}}/>}
                <span style={{fontSize:12,flex:1,lineHeight:1.4}}>{item.title}<br/><span style={{color:"#00ffff",fontSize:11}}>${item.price.toFixed(2)}</span></span>
                <button onClick={()=>removeFromCart(i)} onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color="#666"} style={{background:"none",border:"none",color:"#666",fontSize:16,cursor:"pointer",marginLeft:"auto",transition:"0.2s"}}>×</button>
              </div>
            ))}
            <div style={{marginTop:20,fontSize:13,fontWeight:700}}>Total: <span style={{color:"#00ffff"}}>${total.toFixed(2)}</span></div>
            <button onClick={clearCart} style={{marginTop:15,width:"100%",padding:12,background:"rgba(255,30,30,0.15)",color:"#ff4d4d",fontWeight:"bold",border:"1px solid #ff4d4d33",borderRadius:8,cursor:"pointer",fontSize:12,transition:"0.2s"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,30,30,0.25)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,30,30,0.15)"}>CLEAR CART</button>
            <button onClick={handleCheckout} disabled={checkingOut||cart.length===0} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{marginTop:10,width:"100%",padding:12,background:"#111",color:"white",border:"1px solid #333",borderRadius:8,cursor:"pointer",transition:"0.25s",fontSize:13,fontWeight:700}}>{checkingOut?"Loading…":"Checkout"}</button>
            {checkoutError && <div style={{marginTop:8}}><p style={{color:"#ff4d4d",fontSize:12}}>{checkoutError}</p></div>}
            {currentUser && <div><p style={{fontSize:11,color:"#555",marginTop:12,textAlign:"center"}}>Signed in as {currentUser.name}</p>{userStatus&&<div style={{marginTop:6,textAlign:"center",fontSize:10,fontWeight:900,letterSpacing:1,color:userStatus.color}}>{userStatus.label}</div>}</div>}
          </div>
        )}
      </div>

      {/* ── MOBILE UI ── */}
      {isMobile && (
        <>
          <motion.button
            layout
            onClick={()=>setMobileCartOpen(true)}
            animate={{ bottom: mobileCartFabBottom }}
            transition={SPRING_SOFT}
            style={{
              position:"fixed",right:16,zIndex:6800,width:50,height:50,borderRadius:"50%",
              background:"#00ffff",border:"none",cursor:"pointer",display:"flex",alignItems:"center",
              justifyContent:"center",boxShadow:"0 4px 24px rgba(0,255,255,0.4)",flexShrink:0,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" width="20" height="20"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
            {cart.length>0 && <motion.div style={{position:"absolute",top:-4,right:-4,minWidth:20,height:20,borderRadius:10,padding:"0 5px",background:"#ff4d4d",color:"white",fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{cart.length}</motion.div>}
          </motion.button>

          <motion.div style={{
            position:"fixed",bottom:0,left:0,right:0,zIndex:6700,
            background:"rgba(6,6,6,0.94)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
            borderTop:"1px solid rgba(255,255,255,0.06)",
            display:"flex",alignItems:"center",justifyContent:"space-evenly",
            paddingTop:6,paddingBottom:"max(14px, env(safe-area-inset-bottom))",
            minHeight:62,overflow:"visible",isolation:"auto",
          }}>
            {(() => {
              const activeIdx = MOBILE_NAV_TABS.findIndex(tab => (tab.more ? mobileNavOpen : isMobileNavTabActive(tab.id)));
              const idx = activeIdx >= 0 ? activeIdx : 0;
              const tabWidth = 100 / MOBILE_NAV_TABS.length;
              return (
                <div
                  aria-hidden
                  style={{
                    position:"fixed",
                    left:`calc(${idx * tabWidth}% + ${tabWidth / 2}% - 12px)`,
                    bottom:"max(10px, env(safe-area-inset-bottom, 0px))",
                    width:24,
                    height:3,
                    borderRadius:2,
                    background:"#00ffff",
                    boxShadow:"0 0 10px rgba(0,255,255,0.55)",
                    transition:"left 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
                    pointerEvents:"none",
                    zIndex:6701,
                  }}
                />
              );
            })()}
            {MOBILE_NAV_TABS.map(tab=>{
              const active = tab.more ? mobileNavOpen : isMobileNavTabActive(tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={()=> tab.more ? openMobileNav() : switchTab(tab.id)}
                  style={{
                    display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                    background:"none",border:"none",cursor:"pointer",
                    color:active?"#00ffff":"#555",fontSize:9,fontWeight:700,letterSpacing:0.5,
                    padding:"4px 4px 10px",borderRadius:10,flex:1,minWidth:0,maxWidth:56,minHeight:44,justifyContent:"center",
                    textShadow:active?"0 0 12px rgba(0,255,255,0.5)":"none",
                    transition:"color 0.2s",
                    position:"relative",
                    zIndex:1,
                  }}
                >
                  {tab.vault ? <VaultNavLockIcon /> : tab.more ? MOBILE_NAV_MORE_SVG : <MobileNavAnimatedIcon tabId={tab.id} />}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </motion.div>

          <AnimatePresence>
            {nowPlaying && (
              <motion.div
                key="mobile-mini-player"
                initial={{ y: 72, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 72, opacity: 0 }}
                transition={SPRING_SOFT}
                style={{
                  position:"fixed",left:12,right:12,bottom:mobileMiniPlayerBottom,zIndex:6750,
                  borderRadius:16,overflow:"hidden",
                  background:"rgba(10,10,10,0.9)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
                  border:"1px solid rgba(255,255,255,0.08)",
                  boxShadow:"0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,255,255,0.05)",
                }}
              >
                <motion.div onClick={seekTo} style={{width:"100%",height:3,background:"#111",cursor:"pointer"}}>
                  <motion.div style={{width:duration?`${(currentTime/duration)*100}%`:"0%",height:"100%",background:"#00ffff",transition:"width 0.1s linear"}}/>
                </motion.div>
                <motion.div style={{padding:"8px 12px",display:"flex",alignItems:"center",gap:10}}>
                  <img src={nowPlaying.cover} alt="" style={{width:40,height:40,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
                  <motion.div style={{flex:1,minWidth:0}}>
                    <motion.div style={{fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nowPlaying.title}</motion.div>
                    <motion.div style={{fontSize:10,color:"#555",fontVariantNumeric:"tabular-nums"}}>{formatTime(currentTime)} / {formatTime(duration)}</motion.div>
                  </motion.div>
                  <button onClick={() => { void toggle(); }} style={{width:38,height:38,borderRadius:"50%",background:"#00ffff",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                    {miniPlayerPlaying
                      ? <svg viewBox="0 0 24 24" fill="#000" width="14" height="14"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                      : <svg viewBox="0 0 24 24" fill="#000" width="14" height="14" style={{marginLeft:2}}><path d="M8 5v14l11-7z"/></svg>}
                  </button>
                  <button onClick={dismissNowPlaying} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:20,lineHeight:1,padding:"0 4px"}}>×</button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {mobileNavSheetOpen && (
              <ModalErrorBoundary stackId="mobile-nav-sheet" onClose={closeMobileNav} resetKey={mobileNavSheetOpen ? "open" : "closed"}>
              <motion.div
                key="nav-sheet"
                initial={{ opacity: 0 }}
                animate={{ opacity: mobileNavClosing ? 0 : 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                onClick={closeMobileNav}
                style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:8100,display:"flex",alignItems:"flex-end"}}
              >
                <motion.div
                  {...MOBILE_NAV_SHEET_SLIDE}
                  animate={{ y: mobileNavClosing ? "100%" : 0 }}
                  transition={{ duration: MOBILE_NAV_SHEET_MS / 1000, ease: [0.4, 0, 0.2, 1] }}
                  onClick={e=>e.stopPropagation()}
                  style={{width:"100%",background:"#0a0a0a",borderRadius:"20px 20px 0 0",paddingBottom:"max(32px, env(safe-area-inset-bottom))",border:"1px solid #1e1e1e",maxHeight:"80vh",overflowY:"auto"}}
                >
                  <motion.div
                    onClick={closeMobileNav}
                    style={{
                      width: 36,
                      height: 4,
                      borderRadius: 2,
                      background: "#555",
                      margin: "14px auto 16px",
                      cursor: "pointer",
                    }}
                  />
                  {currentUser&&userStatus&&<motion.div style={{padding:"10px 24px",marginBottom:4,display:"flex",alignItems:"center",gap:10}}><motion.div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#00ffff22,#a259ff22)",border:"1px solid #333",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:"#00ffff"}}>{currentUser.name[0].toUpperCase()}</motion.div><motion.div><motion.div style={{fontSize:13,fontWeight:700,color:"white"}}>{currentUser.name}</motion.div><motion.div style={{fontSize:9,color:userStatus.color,fontWeight:700,letterSpacing:1}}>{userStatus.label}</motion.div></motion.div></motion.div>}
                  {sidebarNav.map(group=>{
                    const hasSubs = group.subTabs.length > 0;
                    const isSheetExpanded = mobileNavExpandedGroups.has(group.groupId);
                    const isGroupActive = hasSubs
                      ? group.subTabs.some(st => st.id === activeTab)
                      : activeTab === group.directTab;
                    return (
                    <motion.div key={group.groupId} style={{marginBottom:2}}>
                      <button
                        type="button"
                        onClick={()=>{
                          if (!hasSubs) switchTab(group.directTab);
                          else toggleMobileNavGroup(group.groupId);
                        }}
                        style={{
                          width:"100%",
                          padding:"14px 24px",
                          background:"none",
                          border:"none",
                          color:isGroupActive?"#00ffff":"#ccc",
                          fontSize:13,
                          fontWeight:700,
                          letterSpacing:2,
                          textAlign:"left",
                          cursor:"pointer",
                          textTransform:"uppercase",
                          transition:"color 0.2s",
                          display:"flex",
                          alignItems:"center",
                          justifyContent:"space-between",
                          gap:12,
                        }}
                      >
                        <span>{group.label}</span>
                        {hasSubs ? (
                          <span style={{fontSize:16,color:"#555",lineHeight:1,transform:isSheetExpanded?"rotate(45deg)":"rotate(0deg)",transition:"transform 0.22s ease"}}>+</span>
                        ) : null}
                      </button>
                      <AnimatePresence initial={false}>
                        {hasSubs && isSheetExpanded ? (
                          <motion.div
                            key={`${group.groupId}-subs`}
                            className="nav-sub-reveal"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                            style={{paddingLeft:12,paddingBottom:6}}
                          >
                            {group.subTabs.map(st=>(
                              <button key={st.id} type="button" onClick={()=>switchTab(st.id)} style={{width:"100%",padding:"10px 24px 10px 32px",background:"none",border:"none",color:activeTab===st.id?"#00ffff":"#666",fontSize:12,textAlign:"left",cursor:"pointer",letterSpacing:1,transition:"color 0.2s"}}>{st.label}</button>
                            ))}
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </motion.div>
                    );
                  })}
                  <motion.div style={{padding:"14px 24px",borderTop:"1px solid #111",marginTop:4,display:"flex",flexDirection:"column",gap:10}}>
                    <button onClick={()=>switchTab("account")} style={{width:"100%",padding:"13px 0",background:"#00ffff",color:"#000",fontWeight:900,border:"none",borderRadius:10,cursor:"pointer",fontSize:14,letterSpacing:1}}>My Account</button>
                    <button onClick={()=>setSoundOn(!soundOn)} style={{width:"100%",padding:"11px 0",background:"transparent",color:soundOn?"#00ffff":"#666",fontWeight:700,border:"1px solid #2a2a2a",borderRadius:10,cursor:"pointer",fontSize:13,letterSpacing:1}}>{soundOn?"♫ Sound On":"♫ Sound Off"}</button>
                  </motion.div>
                </motion.div>
              </motion.div>
              </ModalErrorBoundary>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {mobileCartOpen && (
              <ModalErrorBoundary stackId="mobile-cart-sheet" onClose={() => setMobileCartOpen(false)} resetKey={mobileCartOpen ? "open" : "closed"}>
              <motion.div
                key="cart-sheet"
                {...OVERLAY_FADE}
                onClick={()=>setMobileCartOpen(false)}
                style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:8100,display:"flex",alignItems:"flex-end"}}
              >
                <motion.div
                  {...SHEET_UP}
                  onClick={e=>e.stopPropagation()}
                  style={{width:"100%",background:"#0a0a0a",borderRadius:"20px 20px 0 0",padding:"0 0 max(32px, env(safe-area-inset-bottom))",border:"1px solid #1e1e1e",maxHeight:"82vh",overflowY:"auto"}}
                >
                  <motion.div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"14px auto 0"}}/>
                  <motion.div style={{padding:"16px 20px 0"}}><h3 style={{fontSize:12,letterSpacing:3,color:"#555",marginBottom:16,textTransform:"uppercase"}}>Cart {cart.length>0&&`(${cart.length})`}</h3></motion.div>
                  {cart.length===0 && <p style={{opacity:0.4,fontSize:13,padding:"0 20px 20px"}}>Your cart is empty.</p>}
                  <motion.div style={{padding:"0 20px"}}>{cart.map((item,i)=><motion.div key={i} style={{marginBottom:10,display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #1a1a1a"}}>{item.cover&&<img src={item.cover} style={{width:44,height:44,borderRadius:8,objectFit:"cover",flexShrink:0}} alt="" />}<span style={{fontSize:13,flex:1,lineHeight:1.4}}>{item.title}<br/><span style={{color:"#00ffff",fontSize:12}}>${item.price.toFixed(2)}</span></span><button onClick={()=>removeFromCart(i)} style={{background:"none",border:"none",color:"#666",fontSize:22,cursor:"pointer",padding:"0 4px",lineHeight:1}}>×</button></motion.div>)}</motion.div>
                  {cart.length>0 && <motion.div style={{padding:"16px 20px 0",display:"flex",flexDirection:"column",gap:10}}><motion.div style={{fontSize:15,fontWeight:700}}>Total: <span style={{color:"#00ffff"}}>${total.toFixed(2)}</span></motion.div><button onClick={handleCheckout} disabled={checkingOut} style={{width:"100%",padding:"14px 0",background:"#00ffff",color:"#000",fontWeight:900,border:"none",borderRadius:10,cursor:"pointer",fontSize:15}}>{checkingOut?"Loading…":"Checkout"}</button><button onClick={()=>{clearCart();setMobileCartOpen(false);}} style={{width:"100%",padding:"12px 0",background:"transparent",color:"#ff4d4d",border:"1px solid #ff4d4d33",borderRadius:10,cursor:"pointer",fontSize:13}}>Clear Cart</button></motion.div>}
                  {checkoutError && <p style={{color:"#ff4d4d",fontSize:12,padding:"10px 20px 0"}}>{checkoutError}</p>}
                  <motion.div style={{padding:"12px 20px 0"}}><button onClick={()=>setMobileCartOpen(false)} style={{width:"100%",padding:"12px 0",background:"none",border:"1px solid #1e1e1e",color:"#555",cursor:"pointer",fontSize:13,borderRadius:10}}>Close</button></motion.div>
                </motion.div>
              </motion.div>
              </ModalErrorBoundary>
            )}
          </AnimatePresence>
        </>
      )}



      {/* ── CSS ── */}
      <style jsx>{`
        html,body{width:100%;overflow-x:clip;}
        *,*::before,*::after{box-sizing:border-box;}
        @media(max-width:768px){
          .singles-row,.albums-row,.features-row,.products-row,.videos-row{display:flex!important;flex-wrap:nowrap!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;scroll-snap-type:x mandatory!important;overscroll-behavior-x:contain!important;gap:12px!important;padding-bottom:10px!important;}
          .singles-row>*,.albums-row>*,.features-row>*,.products-row>*,.videos-row>*{flex:0 0 auto!important;scroll-snap-align:start!important;}
        }
        .singles-row::-webkit-scrollbar,.albums-row::-webkit-scrollbar,.features-row::-webkit-scrollbar,.products-row::-webkit-scrollbar,.videos-row::-webkit-scrollbar{height:4px;}
        .singles-row::-webkit-scrollbar-track,.albums-row::-webkit-scrollbar-track,.features-row::-webkit-scrollbar-track,.products-row::-webkit-scrollbar-track,.videos-row::-webkit-scrollbar-track{background:#111;border-radius:4px;}
        .singles-row::-webkit-scrollbar-thumb,.albums-row::-webkit-scrollbar-thumb,.features-row::-webkit-scrollbar-thumb,.products-row::-webkit-scrollbar-thumb,.videos-row::-webkit-scrollbar-thumb{background:#00ffff;border-radius:4px;}
        @keyframes pulse{0%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.85}100%{transform:scale(1);opacity:1}}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeInCover{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
        @keyframes fadeInTab{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes expandDown{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes flowIdlePulse{0%{opacity:.4}50%{opacity:.9}100%{opacity:.4}}
        @keyframes flowIdleDot{0%{opacity:.15;transform:scale(.8)}50%{opacity:.7;transform:scale(1.2)}100%{opacity:.15;transform:scale(.8)}}
        @keyframes eqBar1{from{height:6px}to{height:16px}}
        @keyframes eqBar2{from{height:10px}to{height:18px}}
        @keyframes eqBar3{from{height:14px}to{height:8px}}
        @keyframes eqBar4{from{height:8px}to{height:14px}}
        @keyframes donateSweep{0%{transform:translateX(-140%) skewX(-18deg);opacity:0}22%{opacity:.45}54%{opacity:.18}100%{transform:translateX(190%) skewX(-18deg);opacity:0}}
        @keyframes subscribeSweep{0%{transform:translateX(-145%) skewX(-18deg);opacity:0}18%{opacity:.5}48%{opacity:.2}100%{transform:translateX(195%) skewX(-18deg);opacity:0}}
        .donate-glow-button,.subscribe-shimmer-button{position:relative;overflow:hidden;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;transition:color .2s,border-color .2s,background .2s,box-shadow .2s,transform .2s;border:1px solid #2a2a2a;isolation:isolate}
        .donate-glow-button{background:transparent;color:#888}
        .donate-glow-button:hover{color:#fff;border-color:#555;background:rgba(255,255,255,0.04)}
        .donate-glow-button::after{content:"";position:absolute;top:-30%;bottom:-30%;left:0;width:42%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent);animation:donateSweep 5.8s ease-in-out infinite;pointer-events:none}
        .subscribe-shimmer-button{background:#0a0a0a;color:#c4b5fd;border-color:#a259ff55;box-shadow:0 0 22px rgba(162,89,255,.16),inset 0 1px 0 rgba(162,89,255,.08)}
        .subscribe-shimmer-button:hover{color:#e9d5ff;border-color:#a259ff88;box-shadow:0 0 32px rgba(162,89,255,.28),inset 0 1px 0 rgba(162,89,255,.12);transform:translateY(-1px)}
        .subscribe-shimmer-button::after{content:"";position:absolute;top:-32%;bottom:-32%;left:0;width:48%;background:linear-gradient(90deg,transparent,rgba(162,89,255,.55),rgba(198,169,255,.28),transparent);animation:subscribeSweep 5.8s ease-in-out infinite;pointer-events:none}
        .section-heading{animation:fadeInUp .9s cubic-bezier(.22,1,.36,1) both;animation-fill-mode:forwards;}
      `}</style>

      {/* ── POST-PURCHASE MEMBERSHIP UPSELL ── */}
      <AnimatePresence>
        {membershipUpsellOpen && (
          <motion.div key="membership-upsell" {...OVERLAY_FADE} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?16:0}}>
            <motion.div {...(isMobile ? SHEET_UP : MODAL_CENTER)} style={{background:"#0a0a0a",padding:isMobile?22:30,borderRadius:isMobile?"20px 20px 0 0":20,width:isMobile?"100%":420,border:"1px solid #222",alignSelf:isMobile?"flex-end":"center",boxShadow:"0 0 40px rgba(0,255,255,0.12)"}}>
              <div style={{fontSize:11,color:"#00ffff",letterSpacing:3,marginBottom:12,textTransform:"uppercase"}}>Thanks for supporting</div>
              <div style={{fontSize:22,fontWeight:900,marginBottom:10}}>Want early access, exclusive drops, and giveaways?</div>
              <p style={{fontSize:13,color:"#888",lineHeight:1.7,marginBottom:20}}>Membership is optional. Your purchase is already saved to your library.</p>
              <button onClick={()=>{setMembershipUpsellOpen(false);switchTab("innercircle");}} style={{width:"100%",padding:"13px 0",background:"#a259ff",color:"#fff",fontWeight:900,border:"none",borderRadius:10,cursor:"pointer",fontSize:14,marginBottom:10}}>Join Membership</button>
              <button onClick={()=>setMembershipUpsellOpen(false)} style={{width:"100%",padding:"12px 0",background:"transparent",color:"#777",border:"1px solid #333",borderRadius:10,cursor:"pointer",fontSize:13}}>Maybe later</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
        <DonateModal open={donateOpen} onClose={()=>setDonateOpen(false)} isMobile={isMobile}/>
      </Suspense>
      <GiftBottomSheet
        open={Boolean(giftSheetRelease)}
        release={giftSheetRelease}
        senderUserId={currentUser?.id}
        isMobile={isMobile}
        onClose={() => setGiftSheetRelease(null)}
      />
      <AlbumTracklistSheet
        open={Boolean(albumTracklistRelease)}
        album={albumTracklistRelease}
        accountState={accountState}
        userId={currentUser?.id}
        onClose={() => setAlbumTracklistRelease(null)}
      />

      {/* ── STRIPE MODAL ── */}
      <AnimatePresence>
        {clientSecret && (
          <ModalErrorBoundary
            stackId="stripe-checkout-overlay"
            onClose={() => { setClientSecret(null); setCheckingOut(false); }}
            resetKey={clientSecret}
          >
          <motion.div
            key="stripe"
            {...OVERLAY_FADE}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?16:0}}
          >
            <motion.div
              {...(isMobile ? SHEET_UP : MODAL_CENTER)}
              style={{background:"#0a0a0a",padding:isMobile?20:30,borderRadius:isMobile?"20px 20px 0 0":20,width:isMobile?"100%":400,maxWidth:isMobile?"100%":"none",border:"1px solid #222",alignSelf:isMobile?"flex-end":"center"}}
            >
              <motion.div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>Checkout</motion.div>
              <Elements stripe={stripePromise} options={{clientSecret,appearance:{theme:"night",variables:{colorPrimary:"#00ffff",colorBackground:"#0a0a0a",colorText:"#ffffff",borderRadius:"8px"}}}}>
                <CheckoutForm onSuccess={handleCheckoutSuccess} requiresShipping={cartRequiresShipping}/>
              </Elements>
              <button onClick={()=>{setClientSecret(null);setCheckingOut(false);}} style={{marginTop:10,width:"100%",padding:10,background:"none",border:"1px solid #333",color:"#777",cursor:"pointer",borderRadius:8}}>Cancel</button>
            </motion.div>
          </motion.div>
          </ModalErrorBoundary>
        )}
      </AnimatePresence>

    </>
  );
}


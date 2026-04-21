"use client";
import { useState, useEffect, useRef } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

// ── SOCIALS ───────────────────────────────────────────────────────────────────
const SOCIALS = [
  {
    name: "YouTube",
    href: "https://youtube.com/@callme2mrrw?si=Bwvli5p7hhvED7eq",
    svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>),
  },
  {
    name: "Instagram",
    href: "https://www.instagram.com/callme2mrrw?igsh=MXMwdzNiZGE5NTJwaw==",
    svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" /></svg>),
  },
  {
    name: "TikTok",
    href: "https://tiktok.com/@thareal2mrrw",
    svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" /></svg>),
  },
  {
    name: "Twitch",
    href: "https://twitch.tv/callme2mrrw",
    svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>),
  },
  {
    name: "X",
    href: "https://x.com/callme2mrrw",
    svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>),
  },
  {
    name: "Patreon",
    href: "https://patreon.com/2mrrw",
    svg: (<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M0 .48v23.04h4.22V.48zm15.385 0c-4.764 0-8.641 3.88-8.641 8.65 0 4.755 3.877 8.623 8.641 8.623 4.75 0 8.615-3.868 8.615-8.623C24 4.36 20.136.48 15.385.48z" /></svg>),
  },
];

// ── MUSIC VIDEOS ─────────────────────────────────────────────────────────────
const musicVideos = [
  { id: "mv-1", title: "A2B", youtubeId: "YOUR_YOUTUBE_ID_HERE", description: "Official Music Video" },
  { id: "mv-2", title: "Hour Glass", youtubeId: "YOUR_YOUTUBE_ID_HERE", description: "Official Music Video" },
  { id: "mv-3", title: "W.2.D", youtubeId: "YOUR_YOUTUBE_ID_HERE", description: "Official Music Video" },
];

// ── EXCLUSIVE ITEMS ───────────────────────────────────────────────────────────
const exclusiveItems = [
  { id: "exc-card-tbh", title: "T.B.H. Collector Art Card", subtitle: "First Edition · #/100", type: "collector-card", cover: "/images/albums/tbh.jpg", price: 89.99, description: "4×6 premium matte card, 400gsm thick stock. Hand-signed with a personal message. QR code links directly to the T.B.H. digital album. Ships in an acrylic display case.", features: ["Hand-signed by 2MRRW", "QR code → digital album access", "400gsm soft-touch matte finish", "Acrylic display case included", "Numbered 1 of 100"], stock: 23, badge: "FIRST EDITION", badgeColor: "#00ffff", slug: "exc-card-tbh" },
  { id: "exc-card-ad", title: "(A.D.) Collector Art Card", subtitle: "Early Supporter Series · #/50", type: "collector-card", cover: "/images/albums/ad.jpg", price: 99.99, description: "5×5 premium card with embedded NFC chip. Tap your phone to unlock exclusive fan content. Hand-signed. Ships in a magnetic enclosure. Limited to 50 pieces worldwide.", features: ["NFC chip — tap to open exclusive portal", "Hand-signed by 2MRRW", "500gsm with magnetic enclosure", "Numbered 1 of 50", "Inner Circle access granted"], stock: 11, badge: "EARLY SUPPORTER", badgeColor: "#ff6b35", slug: "exc-card-ad" },
  { id: "exc-bundle-lovehz", title: "Love Hz Vol.1 Launch Bundle", subtitle: "Collector Bundle · Launch Edition", type: "bundle", cover: "/images/albums/lovehz.jpg", price: 149.99, description: "Full digital album + collector art card + hand-signed lyric sheet. Exclusive to launch supporters. This is ownership. Not just music.", features: ["Digital album — instant download", "Collector art card (numbered)", "Hand-signed lyric sheet", "Early listener credit", "Inner Circle badge unlocked"], stock: 7, badge: "LAUNCH BUNDLE", badgeColor: "#a259ff", slug: "exc-bundle-lovehz" },
  { id: "exc-signed-vinyl", title: "Signed Vinyl — T.B.H.", subtitle: "Hand-Signed · Limited Press", type: "vinyl", cover: "/images/albums/tbh.jpg", price: 74.99, description: "T.B.H. on wax, hand-signed on the sleeve. Limited press. This is the record you pull out and show people. The one that started it.", features: ["Hand-signed sleeve by 2MRRW", "Limited press run", "Ships in protective sleeve", "Certificate of authenticity", "Collector-grade packaging"], stock: 14, badge: "SIGNED", badgeColor: "#00ffff", slug: "exc-signed-vinyl" },
];

// ── CIRCLE RESPONSES ──────────────────────────────────────────────────────────
const circleResponses = [
  { id: "resp-1", question: "What does 2MRRW actually mean to you personally?", questionBy: "EarlyFan_J", questionTime: "March 15, 2026", response: "It means tomorrow is always possible. No matter how heavy today gets, you hold on because tomorrow is a blank page. That's the whole movement — not optimism, just possibility.", tag: "VISIONARY PICK", tagColor: "#a259ff", highlight: true },
  { id: "resp-2", question: "How do you decide which songs make the album vs. which stay unreleased?", questionBy: "Listener_K", questionTime: "March 28, 2026", response: "The ones that make it are the ones that still hurt when I listen back. If I can hear it and feel nothing — it's not ready for you. If it still cuts, it's real enough to share.", tag: "FEATURED", tagColor: "#00ffff", highlight: false },
  { id: "resp-3", question: "Will there be a Love Hz Vol.2?", questionBy: "Collector_001", questionTime: "April 5, 2026", response: "Already working on it. Vol.1 was the introduction to the frequency. Vol.2 is what happens when the signal locks in. You'll feel the difference.", tag: "COMMUNITY HIGHLIGHT", tagColor: "#ff6b35", highlight: false },
];

// ── INNER CIRCLE BLOG POSTS ───────────────────────────────────────────────────
const innerCirclePosts = [
  { id: "ic-1", title: "Why I Almost Scrapped Love Hz Vol.1", date: "April 10, 2026", preview: "There was a version of this project that never would have seen the light. Here's what changed.", body: "There was a point — around month 14 of making this album — where I deleted everything. The whole project folder. Emptied the trash. Gone.\n\nIt wasn't creative block. It was the opposite. I had too much. 22 songs and none of them felt like they belonged together. I was chasing something I couldn't name yet.\n\nWhat brought it back was stripping it down to 6 tracks and asking: which of these would I still stand behind in 10 years? The answer became Love Hz Vol.1. Not the version I planned. The version that survived." },
  { id: "ic-2", title: "The Story Behind W.2.D", date: "March 30, 2026", preview: "This track wasn't written in a studio. It was written in a parking lot at 2am. Here's the full story.", body: "W.2.D was written in the front seat of my car outside a gas station on I-20. It was 2am. I had my phone, a voice memo app, and about 40 minutes before I needed to be somewhere.\n\nThe whole thing came out in one sitting. Sometimes that happens. You stop trying to write and the song just falls out of you.\n\nI drove home, set up my mic, and recorded a demo that night. The version you're hearing is that demo, cleaned up. The urgency in it is real. That's not performance — that's actually what 2am sounds like." },
  { id: "ic-3", title: "What the Collector Cards Actually Mean", date: "March 18, 2026", preview: "It's not merch. Here's the full vision behind the physical collector system and where it's going.", body: "People keep calling the collector cards merch. They're not merch.\n\nMerch is a t-shirt. You wear it, it fades, you forget about it. A collector card is a record of presence. It says: I was here when this was being built. I believed before it was obvious.\n\nThe long-term vision is a tiered system where each card unlocks something real — early access, private sessions, input on creative decisions. The NFC chip on the (A.D.) card is the first version of that. It's going to go much further.\n\nIf you have one, hold it. You're not holding merch. You're holding a key." },
];

// ═════════════════════════════════════════════════════════════════════════════
export default function Page() {

  // ── ORIGINAL STATE ────────────────────────────────────────────────────────
  const [cart, setCart] = useState([]);
  const [activeTab, setActiveTab] = useState("home");
  const [addedFlash, setAddedFlash] = useState(null);
  const [soundOn, setSoundOn] = useState(false);
  const [selectedSingle, setSelectedSingle] = useState(null);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [singleIndex, setSingleIndex] = useState(0);
  const [slideDir, setSlideDir] = useState("right");
  const [animating, setAnimating] = useState(false);
  const [gateSubmitted, setGateSubmitted] = useState(false);
  const [gateName, setGateName] = useState("");
  const [gatePhone, setGatePhone] = useState("");
  const [gateEmail, setGateEmail] = useState("");
  const [gateError, setGateError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [clientSecret, setClientSecret] = useState(null);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [blogPost, setBlogPost] = useState(null);
  const [blogComment, setBlogComment] = useState("");
  const [blogComments, setBlogComments] = useState({});
  const [exclusiveModal, setExclusiveModal] = useState(null);
  const [circleQuestion, setCircleQuestion] = useState("");
  const [circleCategory, setCircleCategory] = useState("question");
  const [circleSubmissions, setCircleSubmissions] = useState([]);
  const [circleSubmitted, setCircleSubmitted] = useState(false);
  const [circleFilter, setCircleFilter] = useState("all");
  const [myPurchases, setMyPurchases] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [liveCountdown, setLiveCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [previewHover, setPreviewHover] = useState(false);
  const [innerCirclePost, setInnerCirclePost] = useState(null);

  // ── NEW STATE ─────────────────────────────────────────────────────────────
  const [expandedGroup, setExpandedGroup] = useState("g-home");
  const [tabKey, setTabKey] = useState(0);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [nowPlayingPlaying, setNowPlayingPlaying] = useState(false);

  // ── REFS ──────────────────────────────────────────────────────────────────
  const cursorRef = useRef(null);
  const nowPlayingAudioRef = useRef(null);
  const ambientRefs = useRef({});

  // ── ORIGINAL useEffects ───────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem("2mrrw_user");
    if (stored) { setCurrentUser(JSON.parse(stored)); setGateSubmitted(true); }
  }, []);

  useEffect(() => {
    const els = document.querySelectorAll(".fade-on-scroll");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.style.opacity = 1; entry.target.style.transform = "translateY(0px)"; }
      });
    });
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("2mrrw_purchases");
    if (stored) setMyPurchases(JSON.parse(stored));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("2mrrw_circle");
    if (stored) setCircleSubmissions(JSON.parse(stored));
  }, []);

  useEffect(() => {
    const target = new Date("2026-05-10T20:00:00");
    const tick = () => {
      const now = new Date();
      const diff = target - now;
      if (diff <= 0) return;
      setLiveCountdown({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── NEW: Cursor glow ──────────────────────────────────────────────────────
  useEffect(() => {
    const move = (e) => {
      if (cursorRef.current) {
        cursorRef.current.style.left = e.clientX + "px";
        cursorRef.current.style.top = e.clientY + "px";
      }
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);

  // ── NEW: Ambient sound per section ────────────────────────────────────────
  useEffect(() => {
    const ambientPaths = {
      shop: "/audio/ambient/shop.mp3",
      blog: "/audio/ambient/community.mp3",
      vision: "/audio/ambient/community.mp3",
      circle: "/audio/ambient/community.mp3",
      innercircle: "/audio/ambient/community.mp3",
      videos: "/audio/ambient/videos.mp3",
      shows: "/audio/ambient/shows.mp3",
      live: "/audio/ambient/live.mp3",
      exclusive: "/audio/ambient/exclusive.mp3",
    };
    Object.values(ambientRefs.current).forEach((a) => { try { a.pause(); } catch {} });
    if (soundOn && ambientPaths[activeTab]) {
      const src = ambientPaths[activeTab];
      if (!ambientRefs.current[src]) {
        try {
          const audio = new Audio(src);
          audio.loop = true;
          audio.volume = 0.07;
          ambientRefs.current[src] = audio;
        } catch {}
      }
      if (ambientRefs.current[src]) ambientRefs.current[src].play().catch(() => {});
    }
    return () => { Object.values(ambientRefs.current).forEach((a) => { try { a.pause(); } catch {} }); };
  }, [activeTab, soundOn]);

  // ── NEW: Sync sidebar expanded group with activeTab ────────────────────────
  useEffect(() => {
    const map = {
      home: "g-home",
      singles: "g-music", albums: "g-music", mymusic: "g-music",
      shop: "g-shop",
      videos: "g-videos",
      blog: "g-community", vision: "g-community", circle: "g-community", innercircle: "g-community",
      exclusive: "g-exclusives",
      shows: "g-shows",
      live: "g-live",
    };
    if (map[activeTab]) setExpandedGroup(map[activeTab]);
  }, [activeTab]);

  // ── NEW: Now Playing audio sync ───────────────────────────────────────────
  useEffect(() => {
    if (!nowPlaying) return;
    if (nowPlayingAudioRef.current) {
      nowPlayingAudioRef.current.src = nowPlaying.preview;
      if (nowPlayingPlaying) nowPlayingAudioRef.current.play().catch(() => {});
    }
  }, [nowPlaying]);

  // ── ORIGINAL DATA ARRAYS ──────────────────────────────────────────────────
  const singles = [
    { title: "Hour Glass", slug: "hour-glass", cover: "/images/singles/hourglass.jpg", price: 2.99, preview: "/audio/previews/hourglass-preview.mp3", full: "/audio/full/hourglass.mp3" },
    { title: "W.2.D", slug: "w2d", cover: "/images/singles/w2d.jpg", price: 2.99, preview: "/audio/previews/w2d-preview.mp3", full: "/audio/full/w2d.mp3" },
    { title: "Artificial", slug: "artificial", cover: "/images/singles/artificial.jpg", price: 2.99, preview: "/audio/previews/artificial-preview.mp3", full: "/audio/full/artificial.mp3" },
    { title: "Turnt Me 2 Dis", slug: "turnt-me-2-dis", cover: "/images/singles/turnt.jpg", price: 2.99, preview: "/audio/previews/turntme2dis-preview.mp3", full: "/audio/full/turntme2dis.mp3" },
  ];

  const albums = [
    { title: "T.B.H.", slug: "tbh", cover: "/images/albums/tbh.jpg", price: 9.99, date: "July 7, 2022", vinyl: 47.99, tracks: ["Glass Full","Up 2 Me","Unexpcted","All Yours","Locomotive","LEFT","Was Wrong","ArTiFICiaL"] },
    { title: "(A.D)", slug: "ad", cover: "/images/albums/ad.jpg", price: 9.99, date: "March 24, 2024", vinyl: 47.99, tracks: ["2mrrw's Ntro","Said N' Done","A.D.D","Perspective (2018)","Grand Scheme","A2B","Life Changes (2018)","Itself (2018)","Wastin Time","Like Me Or Not"] },
    { title: "Love Hz Vol.1", slug: "love-hz", cover: "/images/albums/lovehz.jpg", price: 12.99, date: "August 2026", vinyl: 47.99, tracks: ["Roll Call","W.2.D","All Of It","Knock On Wood","Stayed 2 Long","Hour Glass"] },
  ];

  const merch = [
    { title: "2MRRW Hoodie", slug: "hoodie", cover: "/images/merch/hoodie.jpg", price: 59.99 },
    { title: "2MRRW T-Shirt", slug: "shirt", cover: "/images/merch/shirt.jpg", price: 29.99 },
    { title: "2MRRW Hat", slug: "hat", cover: "/images/merch/hat.jpg", price: 24.99 },
  ];

  const shows = [
    { id: "show-1", title: "2MRRW Live – Dallas", venue: "House of Blues Dallas", date: "2026-05-10", time: "8:00 PM", price: 25.00, tickets: 50 },
    { id: "show-2", title: "2MRRW Live – Houston", venue: "Warehouse Live", date: "2026-05-24", time: "9:00 PM", price: 25.00, tickets: 75 },
    { id: "show-3", title: "2MRRW Live – Atlanta", venue: "The Loft Atlanta", date: "2026-06-07", time: "8:30 PM", price: 30.00, tickets: 60 },
    { id: "show-4", title: "2MRRW Live – LA", venue: "The Troubadour", date: "2026-06-21", time: "9:00 PM", price: 35.00, tickets: 40 },
    { id: "show-5", title: "2MRRW Live – NYC", venue: "Bowery Ballroom", date: "2026-07-04", time: "8:00 PM", price: 35.00, tickets: 45 },
  ];

  const blogPosts = [
    { id: "post-1", title: "The Making of Love Hz Vol.1", date: "April 2, 2026", author: "2MRRW", body: "Love Hz Vol.1 started as a series of late-night sessions in a home studio with nothing but a laptop, a MIDI keyboard, and a vision. Every track on that project represents a different frequency of love — the highs, the lows, the static in between. We wanted listeners to feel the entire spectrum.\n\nThe process took nearly 18 months. Some songs were written in 10 minutes, others were rebuilt from scratch a dozen times. What you hear is the version that survived. We hope it resonates with you the way it resonated with us when we finally pressed play for the first time." },
    { id: "post-2", title: "Why We Started 2MRRW", date: "March 15, 2026", author: "2MRRW", body: "2MRRW was never supposed to be a brand. It started as a reminder — tomorrow is always possible. No matter what today looks like, tomorrow holds something different.\n\nWe put that energy into every record, every show, every piece of merch. It's not just a name on a hoodie. It's a mindset we live by and want to share with everyone who connects with the music." },
    { id: "post-3", title: "Tour Prep: What Goes Into a Live Show", date: "February 28, 2026", author: "2MRRW", body: "People see the 90-minute set. They don't see the weeks of rehearsal, the production calls, the logistics of moving equipment across state lines. A live 2MRRW show is designed from the ground up — the lighting, the setlist order, the energy arc from opener to closer.\n\nWe treat every city like it's the only city. Dallas gets the same energy as NYC. That's the standard we hold ourselves to and always will." },
  ];

  // ── NEW: Sidebar navigation structure ────────────────────────────────────
  const sidebarNav = [
    { groupId: "g-home",       label: "HOME",           directTab: "home",      subTabs: [] },
    { groupId: "g-music",      label: "MUSIC",          directTab: "singles",   subTabs: [{ id: "singles", label: "Singles" }, { id: "albums", label: "Albums" }, { id: "mymusic", label: "My Music" }] },
    { groupId: "g-shop",       label: "SHOP",           directTab: "shop",      subTabs: [{ id: "shop", label: "Merch" }] },
    { groupId: "g-videos",     label: "MUSIC VIDEOS",   directTab: "videos",    subTabs: [{ id: "videos", label: "All Videos" }] },
    { groupId: "g-community",  label: "COMMUNITY",      directTab: "blog",      subTabs: [{ id: "blog", label: "Blog" }, { id: "vision", label: "Vision" }, { id: "circle", label: "Circle" }, { id: "innercircle", label: "Inner Circle" }] },
    { groupId: "g-exclusives", label: "EXCLUSIVES",     directTab: "exclusive", subTabs: [{ id: "exclusive", label: "Exclusive Drops" }] },
    { groupId: "g-shows",      label: "SHOWS & EVENTS", directTab: "shows",     subTabs: [{ id: "shows", label: "Upcoming Shows" }] },
    { groupId: "g-live",       label: "LIVE",           directTab: "live",      subTabs: [{ id: "live", label: "Live Stream" }] },
  ];

  // ── ORIGINAL FUNCTIONS ────────────────────────────────────────────────────
  const addToCart = (item) => {
    setCart((prev) => [...prev, item]);
    setAddedFlash(item.slug);
    setTimeout(() => setAddedFlash(null), 400);
  };
  const clearCart = () => setCart([]);
  const removeFromCart = (index) => setCart((prev) => prev.filter((_, i) => i !== index));
  const total = cart.reduce((sum, item) => sum + item.price, 0);

  const hoverIn = (e) => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.filter = "brightness(1.15)"; e.currentTarget.style.boxShadow = "0 0 18px rgba(0,255,255,0.6)"; };
  const hoverOut = (e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.filter = "brightness(1)"; e.currentTarget.style.boxShadow = "none"; };
  const buttonHoverIn = (e) => { e.currentTarget.style.boxShadow = "0 0 14px rgba(0,255,255,0.8)"; e.currentTarget.style.borderColor = "#00ffff"; };
  const buttonHoverOut = (e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = "#333"; };

  const handleGateSubmit = async () => {
    if (!gateName.trim() || !gatePhone.trim() || !gateEmail.trim()) { setGateError("Please fill out all fields."); return; }
    setGateError("");
    try {
      const res = await fetch("/api/register-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: gateName, phone: gatePhone, email: gateEmail }) });
      const data = await res.json();
      if (!res.ok) { setGateError(data.error || "Something went wrong."); return; }
      const user = { id: data.id, name: gateName, phone: gatePhone, email: gateEmail };
      localStorage.setItem("2mrrw_user", JSON.stringify(user));
      setCurrentUser(user);
      setGateSubmitted(true);
    } catch { setGateError("Network error. Please try again."); }
  };
  const handleGateKeyDown = (e) => { if (e.key === "Enter") handleGateSubmit(); };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckingOut(true); setCheckoutError("");
    try {
      const res = await fetch("/api/create-payment-intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cart }) });
      const data = await res.json();
      if (!res.ok) { setCheckoutError(data.error || data.message || "Checkout failed."); setCheckingOut(false); return; }
      if (!data.clientSecret) { setCheckoutError("No client secret returned."); setCheckingOut(false); return; }
      setClientSecret(data.clientSecret);
    } catch (err) { setCheckoutError(`Network error: ${err.message}`); setCheckingOut(false); }
  };

  const handleCheckoutSuccess = () => {
    const newPurchases = [...myPurchases, ...cart.map(item => ({ ...item, purchasedAt: new Date().toISOString() }))];
    setMyPurchases(newPurchases);
    localStorage.setItem("2mrrw_purchases", JSON.stringify(newPurchases));
    setClientSecret(null); setCheckingOut(false); clearCart();
  };

  const addVinylToCart = (single) => { addToCart({ title: `${single.title} – Vinyl`, slug: `${single.slug}-vinyl`, cover: single.cover, price: 47.99 }); };

  const goToSingle = (newIndex, direction) => {
    if (animating) return;
    setAnimating(true); setSlideDir(direction);
    setTimeout(() => { setSingleIndex(newIndex); setAnimating(false); }, 320);
  };
  const prevSingle = () => goToSingle(singleIndex === 0 ? singles.length - 1 : singleIndex - 1, "left");
  const nextSingle = () => goToSingle(singleIndex === singles.length - 1 ? 0 : singleIndex + 1, "right");
  const currentSingle = singles[singleIndex];

  const getDaysInMonth = (month, year) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (month, year) => new Date(year, month, 1).getDay();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const getShowsForDay = (day) => shows.filter((s) => { const d = new Date(s.date); return d.getFullYear() === calYear && d.getMonth() === calMonth && d.getDate() === day; });
  const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(calMonth - 1); };
  const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(calMonth + 1); };

  const handleAddComment = (postId) => {
    if (!blogComment.trim()) return;
    const name = currentUser ? currentUser.name : "Anonymous";
    const newComment = { name, text: blogComment, time: new Date().toLocaleString() };
    setBlogComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), newComment] }));
    setBlogComment("");
  };

  const handleCircleSubmit = () => {
    if (!circleQuestion.trim()) return;
    const name = currentUser ? currentUser.name : "Anonymous";
    const sub = { id: `sub-${Date.now()}`, text: circleQuestion, category: circleCategory, by: name, time: new Date().toLocaleString() };
    const updated = [sub, ...circleSubmissions];
    setCircleSubmissions(updated);
    localStorage.setItem("2mrrw_circle", JSON.stringify(updated));
    setCircleQuestion(""); setCircleSubmitted(true);
    setTimeout(() => setCircleSubmitted(false), 3500);
  };

  const getUserStatus = () => {
    if (!currentUser) return null;
    const hasCollector = myPurchases.some(p => p.slug && p.slug.startsWith("exc-card"));
    const hasBundle = myPurchases.some(p => p.slug && p.slug.startsWith("exc-bundle"));
    const submissionCount = circleSubmissions.filter(s => s.by === currentUser.name).length;
    if ((hasCollector || hasBundle) && submissionCount >= 1) return { label: "INNER CIRCLE", color: "#a259ff", glow: "rgba(162,89,255,0.5)" };
    if (hasCollector || hasBundle) return { label: "COLLECTOR", color: "#ff6b35", glow: "rgba(255,107,53,0.5)" };
    if (submissionCount >= 3) return { label: "VISIONARY", color: "#00ffff", glow: "rgba(0,255,255,0.5)" };
    return { label: "EARLY SUPPORTER", color: "#aaa", glow: "rgba(170,170,170,0.3)" };
  };
  const userStatus = getUserStatus();

  // ── ORIGINAL tabs array (preserved) ──────────────────────────────────────
  const tabs = [
    { id: "home", label: "HOME" }, { id: "singles", label: "SINGLES" }, { id: "albums", label: "ALBUMS" },
    { id: "shop", label: "SHOP" }, { id: "exclusive", label: "EXCLUSIVE" }, { id: "videos", label: "MUSIC VIDEOS" },
    { id: "shows", label: "SHOWS & EVENTS" }, { id: "live", label: "LIVE" }, { id: "blog", label: "BLOG" },
    { id: "vision", label: "VISION" }, { id: "circle", label: "CIRCLE" }, { id: "innercircle", label: "INNER CIRCLE" },
    { id: "mymusic", label: "MY MUSIC" }, { id: "account", label: "ACCOUNT" },
  ];

  // ── NEW: switchTab with page-fade transition key ───────────────────────────
  const switchTab = (tabId) => { setTabKey((prev) => prev + 1); setActiveTab(tabId); };

  // ── CAROUSEL UI (original logic + carousel animation fix + nowPlaying) ────
  const CarouselUI = ({ large }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 20, background: "linear-gradient(135deg, #0e0e0e, #111)", border: "1px solid #1e1e1e", borderRadius: 20, padding: large ? "32px 28px" : "28px 24px", position: "relative", overflow: "hidden", boxShadow: "0 4px 40px rgba(0,0,0,0.5)" }}>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 360, height: 360, background: "radial-gradient(circle, rgba(0,255,255,0.04) 0%, transparent 70%)", pointerEvents: "none" }} />

      <button onClick={prevSingle}
        style={{ width: large ? 50 : 44, height: large ? 50 : 44, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", color: "#555", fontSize: large ? 22 : 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.color = "#00ffff"; e.currentTarget.style.boxShadow = "0 0 10px rgba(0,255,255,0.3)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; e.currentTarget.style.boxShadow = "none"; }}>‹</button>

      {/* ── COVER ART: key={singleIndex} forces one-shot fadeInCover on every change ── */}
      <div style={{ flexShrink: 0, width: large ? 340 : 300, height: large ? 340 : 300, position: "relative" }}
        onMouseEnter={() => setPreviewHover(true)} onMouseLeave={() => setPreviewHover(false)}>
        <img
          key={singleIndex}
          src={currentSingle.cover}
          style={{
            width: "100%", height: "100%", borderRadius: large ? 18 : 16, objectFit: "cover", display: "block",
            boxShadow: large ? "0 10px 50px rgba(0,0,0,0.7)" : "0 8px 40px rgba(0,0,0,0.6)",
            transition: "filter 0.3s ease",
            filter: previewHover ? "brightness(0.55)" : "brightness(1)",
            animation: "fadeInCover 0.4s ease forwards",
          }}
        />
        <div
          onClick={() => { setSelectedSingle(currentSingle); setNowPlaying(currentSingle); setNowPlayingPlaying(true); }}
          style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: large ? 18 : 16, cursor: "pointer", opacity: previewHover ? 1 : 0, transition: "opacity 0.25s ease" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", border: "1.5px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 30px rgba(0,0,0,0.5)" }}>
            <svg viewBox="0 0 24 24" fill="white" width="28" height="28" style={{ marginLeft: 3 }}><path d="M8 5v14l11-7z" /></svg>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "rgba(255,255,255,0.85)", textTransform: "uppercase" }}>Preview</div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: large ? 14 : 12 }}>
        <div key={`title-${singleIndex}`} style={{ fontSize: large ? 30 : 26, fontWeight: 900, letterSpacing: 2, animation: "fadeInUp 0.35s ease forwards" }}>
          {currentSingle.title}
        </div>
        <div style={{ fontSize: 13, color: "#555", letterSpacing: 1 }}>SINGLE{large ? ` · ${singleIndex + 1} of ${singles.length}` : ""}</div>
        <div style={{ fontSize: large ? 18 : 16, color: "#00ffff", fontWeight: 700 }}>${currentSingle.price.toFixed(2)}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {singles.map((_, i) => (
            <div key={i} onClick={() => goToSingle(i, i > singleIndex ? "right" : "left")}
              style={{ width: i === singleIndex ? (large ? 24 : 20) : (large ? 7 : 6), height: large ? 7 : 6, borderRadius: 4, background: i === singleIndex ? "#00ffff" : "#333", cursor: "pointer", transition: "all 0.3s ease", boxShadow: i === singleIndex ? "0 0 8px rgba(0,255,255,0.6)" : "none" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: large ? 8 : 6, flexWrap: "wrap" }}>
          <button onClick={() => addToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
            style={{ padding: large ? "11px 20px" : "10px 18px", background: "#0a0a0a", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: "bold", transition: "0.25s" }}>
            + Add to Cart
          </button>
          {large && (
            <button onClick={() => addVinylToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
              style={{ padding: "11px 20px", background: "#0a0a0a", color: "#aaa", border: "1px solid #2a2a2a", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "0.25s" }}>
              + Vinyl $47.99
            </button>
          )}
        </div>
      </div>

      <button onClick={nextSingle}
        style={{ width: large ? 50 : 44, height: large ? 50 : 44, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", color: "#555", fontSize: large ? 22 : 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.color = "#00ffff"; e.currentTarget.style.boxShadow = "0 0 10px rgba(0,255,255,0.3)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; e.currentTarget.style.boxShadow = "none"; }}>›</button>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <>
      {/* ── NEW: Cursor glow ──────────────────────────────────────────────── */}
      <div ref={cursorRef} style={{ position: "fixed", width: 28, height: 28, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,255,255,0.22) 0%, transparent 70%)", pointerEvents: "none", transform: "translate(-50%, -50%)", zIndex: 99999, mixBlendMode: "screen", transition: "left 0.045s linear, top 0.045s linear" }} />

      {/* ── NEW: Global ambient depth gradient ───────────────────────────── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "radial-gradient(circle at 18% 18%, rgba(0,255,255,0.026) 0%, transparent 55%), radial-gradient(circle at 82% 80%, rgba(162,89,255,0.018) 0%, transparent 52%)" }} />

      {/* ── NEW: Now Playing hidden audio element ─────────────────────────── */}
      <audio ref={nowPlayingAudioRef} style={{ display: "none" }} />

      {/* ── EMAIL GATE (unchanged) ────────────────────────────────────────── */}
      {!gateSubmitted && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 30 }}>
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "white", textShadow: "0 0 20px rgba(0,255,255,0.8)" }}>2MRRW</div>
          <p style={{ color: "#aaa", marginBottom: 10 }}>Enter your info to access the site</p>
          <input placeholder="Full Name" value={gateName} onChange={(e) => setGateName(e.target.value)} onKeyDown={handleGateKeyDown} style={{ width: 280, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 14 }} />
          <input placeholder="Phone Number" value={gatePhone} onChange={(e) => setGatePhone(e.target.value)} onKeyDown={handleGateKeyDown} style={{ width: 280, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 14 }} />
          <input placeholder="Email Address" value={gateEmail} onChange={(e) => setGateEmail(e.target.value)} onKeyDown={handleGateKeyDown} style={{ width: 280, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 14 }} />
          {gateError && <p style={{ color: "red", fontSize: 13 }}>{gateError}</p>}
          <button onClick={handleGateSubmit} style={{ width: 280, padding: "12px 0", background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Enter Site</button>
        </div>
      )}

      {/* ── SINGLE MODAL (unchanged) ──────────────────────────────────────── */}
      {selectedSingle && (
        <div onClick={() => setSelectedSingle(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 8888, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#111", border: "1px solid #222", borderRadius: 20, padding: 30, width: 340, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <img src={selectedSingle.cover} style={{ width: 200, height: 200, borderRadius: 14, objectFit: "cover" }} />
            <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedSingle.title}</div>
            <div style={{ fontSize: 13, opacity: 0.5 }}>${selectedSingle.price.toFixed(2)}</div>
            <audio controls autoPlay style={{ width: "100%", marginTop: 4 }} src={selectedSingle.preview} />
            <button onClick={() => { addToCart(selectedSingle); setSelectedSingle(null); }} style={{ width: "100%", padding: "10px 0", background: "#1f1f1f", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Add to Cart – ${selectedSingle.price.toFixed(2)}</button>
            <button onClick={() => { addVinylToCart(selectedSingle); setSelectedSingle(null); }} style={{ width: "100%", padding: "10px 0", background: "#0a0a0a", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: "bold" }}>+ Add Vinyl – $47.99 (Optional)</button>
            <button onClick={() => setSelectedSingle(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, marginTop: 4 }}>Close</button>
          </div>
        </div>
      )}

      {/* ── ALBUM MODAL (unchanged) ───────────────────────────────────────── */}
      {selectedAlbum && (
        <div onClick={() => setSelectedAlbum(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 8888, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#111", border: "1px solid #222", borderRadius: 20, padding: "22px 26px", width: 320, maxHeight: "65vh", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <img src={selectedAlbum.cover} style={{ width: 130, height: 130, borderRadius: 10, objectFit: "cover" }} />
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: 2, textAlign: "center" }}>{selectedAlbum.title}</div>
            <div style={{ fontSize: 11, opacity: 0.4, letterSpacing: 1 }}>{selectedAlbum.date}</div>
            <div style={{ width: "100%", marginTop: 4 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.4, marginBottom: 8, textTransform: "uppercase" }}>Track Listing</div>
              {selectedAlbum.tracks.map((track, i) => (<div key={i} style={{ padding: "6px 0", fontSize: 13, borderBottom: "1px solid #1a1a1a", color: "white" }}>{i + 1}. {track}</div>))}
            </div>
            <button onClick={() => { addToCart(selectedAlbum); setSelectedAlbum(null); }} style={{ width: "100%", padding: "10px 0", background: "#1f1f1f", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontSize: 13, marginTop: 6 }}>Add to Cart – ${selectedAlbum.price.toFixed(2)}</button>
            <button onClick={() => { addToCart({ title: `${selectedAlbum.title} – Vinyl`, slug: `${selectedAlbum.slug}-vinyl`, cover: selectedAlbum.cover, price: selectedAlbum.vinyl }); setSelectedAlbum(null); }} style={{ width: "100%", padding: "10px 0", background: "#0a0a0a", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: "bold" }}>+ Add Vinyl – ${selectedAlbum.vinyl.toFixed(2)} (Optional)</button>
            <button onClick={() => setSelectedAlbum(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, marginTop: 4 }}>Close</button>
          </div>
        </div>
      )}

      {/* ── TICKET MODAL (unchanged) ──────────────────────────────────────── */}
      {selectedEvent && (
        <div onClick={() => setSelectedEvent(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 8888, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#111", border: "1px solid #222", borderRadius: 20, padding: 30, width: 360, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>{selectedEvent.title}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>{selectedEvent.venue}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>{new Date(selectedEvent.date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · {selectedEvent.time}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#00ffff" }}>${selectedEvent.price.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: "#555" }}>{selectedEvent.tickets} tickets remaining</div>
            <button onClick={() => { addToCart({ title: `Ticket – ${selectedEvent.title}`, slug: selectedEvent.id, cover: null, price: selectedEvent.price }); setSelectedEvent(null); }} style={{ width: "100%", padding: "12px 0", background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Add Ticket to Cart – ${selectedEvent.price.toFixed(2)}</button>
            <button onClick={() => setSelectedEvent(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, textAlign: "center" }}>Close</button>
          </div>
        </div>
      )}

      {/* ── EXCLUSIVE MODAL (unchanged) ───────────────────────────────────── */}
      {exclusiveModal && (
        <div onClick={() => setExclusiveModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 8888, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#0d0d0d", border: `1px solid ${exclusiveModal.badgeColor}33`, borderRadius: 24, padding: 32, width: 380, maxHeight: "80vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, boxShadow: `0 0 60px ${exclusiveModal.badgeColor}22` }}>
            <div style={{ position: "relative" }}>
              <img src={exclusiveModal.cover} style={{ width: "100%", height: 200, borderRadius: 14, objectFit: "cover", display: "block" }} />
              <div style={{ position: "absolute", top: 12, left: 12, background: exclusiveModal.badgeColor, color: "#000", fontSize: 10, fontWeight: 900, letterSpacing: 2, padding: "4px 10px", borderRadius: 20 }}>{exclusiveModal.badge}</div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 1 }}>{exclusiveModal.title}</div>
            <div style={{ fontSize: 12, color: "#555", letterSpacing: 1 }}>{exclusiveModal.subtitle}</div>
            <div style={{ fontSize: 13, color: "#999", lineHeight: 1.8 }}>{exclusiveModal.description}</div>
            <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: 16 }}>
              <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>What's Included</div>
              {exclusiveModal.features.map((f, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13, color: "#ccc", borderBottom: "1px solid #111" }}><span style={{ color: exclusiveModal.badgeColor, fontSize: 16, lineHeight: 1 }}>✓</span> {f}</div>))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 900, color: exclusiveModal.badgeColor }}>${exclusiveModal.price.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{exclusiveModal.stock} remaining</div>
              </div>
              <button onClick={() => { addToCart({ title: exclusiveModal.title, slug: exclusiveModal.slug, cover: exclusiveModal.cover, price: exclusiveModal.price }); setExclusiveModal(null); }} style={{ padding: "12px 24px", background: exclusiveModal.badgeColor, color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, letterSpacing: 1 }}>Add to Cart</button>
            </div>
            <button onClick={() => setExclusiveModal(null)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 12, textAlign: "center" }}>Close</button>
          </div>
        </div>
      )}

      {/* ══════════════════════ MAIN LAYOUT ══════════════════════════════════ */}
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#050505", color: "white", position: "relative", zIndex: 1, fontFamily: "'Helvetica Now', 'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

        {/* ── NEW: LEFT SIDEBAR ─────────────────────────────────────────────── */}
        <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid #141414", background: "rgba(4,4,4,0.9)", backdropFilter: "blur(20px)", display: "flex", flexDirection: "column", height: "100vh", overflowY: "auto", boxShadow: "2px 0 32px rgba(0,0,0,0.5)" }}>

          {/* Logo */}
          <div style={{ padding: "22px 18px 18px", borderBottom: "1px solid #111", flexShrink: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 6, color: "white", textShadow: "0 0 24px rgba(0,255,255,0.45)", marginBottom: 4 }}>2MRRW</div>
            {currentUser && userStatus && (<div style={{ fontSize: 9, color: userStatus.color, letterSpacing: 2.5, fontWeight: 700, opacity: 0.85 }}>{userStatus.label}</div>)}
          </div>

          {/* Nav groups */}
          <nav style={{ flex: 1, padding: "10px 0", overflowY: "auto" }}>
            {sidebarNav.map((group) => {
              const isGroupActive = group.subTabs.length === 0 ? activeTab === group.directTab : group.subTabs.some((st) => st.id === activeTab);
              const isExpanded = expandedGroup === group.groupId;
              return (
                <div key={group.groupId} style={{ marginBottom: 1 }}>
                  <button
                    onClick={() => {
                      if (group.subTabs.length === 0) { switchTab(group.directTab); }
                      else { setExpandedGroup(isExpanded ? null : group.groupId); if (!isExpanded) switchTab(group.subTabs[0].id); }
                    }}
                    style={{ width: "100%", padding: "11px 18px 11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: isGroupActive ? "linear-gradient(90deg, rgba(0,255,255,0.09) 0%, transparent 100%)" : "transparent", border: "none", borderLeft: isGroupActive ? "2px solid #00ffff" : "2px solid transparent", color: isGroupActive ? "#00ffff" : "#4a4a4a", fontSize: 10, fontWeight: 700, letterSpacing: 2.5, cursor: "pointer", textAlign: "left", transition: "all 0.18s ease", textShadow: isGroupActive ? "0 0 12px rgba(0,255,255,0.4)" : "none" }}
                    onMouseEnter={(e) => { if (!isGroupActive) { e.currentTarget.style.color = "#888"; e.currentTarget.style.background = "rgba(255,255,255,0.025)"; } }}
                    onMouseLeave={(e) => { if (!isGroupActive) { e.currentTarget.style.color = "#4a4a4a"; e.currentTarget.style.background = "transparent"; } }}
                  >
                    <span>{group.label}</span>
                    {group.subTabs.length > 0 && (<span style={{ fontSize: 11, color: isExpanded ? "#555" : "#2a2a2a", display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.22s ease" }}>›</span>)}
                  </button>
                  {isExpanded && group.subTabs.length > 0 && (
                    <div style={{ animation: "expandDown 0.2s ease forwards" }}>
                      {group.subTabs.map((st) => (
                        <button key={st.id} onClick={() => switchTab(st.id)}
                          style={{ width: "100%", padding: "8px 18px 8px 30px", background: activeTab === st.id ? "rgba(0,255,255,0.055)" : "transparent", border: "none", color: activeTab === st.id ? "#00ffff" : "#3a3a3a", fontSize: 11, letterSpacing: 1.5, cursor: "pointer", textAlign: "left", transition: "all 0.14s ease", fontWeight: activeTab === st.id ? 700 : 400, display: "flex", alignItems: "center", gap: 8 }}
                          onMouseEnter={(e) => { if (activeTab !== st.id) e.currentTarget.style.color = "#777"; }}
                          onMouseLeave={(e) => { if (activeTab !== st.id) e.currentTarget.style.color = "#3a3a3a"; }}>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", flexShrink: 0, background: activeTab === st.id ? "#00ffff" : "transparent", boxShadow: activeTab === st.id ? "0 0 6px rgba(0,255,255,0.9)" : "none", transition: "all 0.15s" }} />
                          {st.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Bottom: Account, Sound, Donate */}
          <div style={{ padding: "14px 14px 18px", borderTop: "1px solid #111", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
            <button onClick={() => switchTab("account")}
              style={{ width: "100%", padding: "9px 12px", textAlign: "left", background: activeTab === "account" ? "rgba(0,255,255,0.07)" : "transparent", border: "none", borderLeft: activeTab === "account" ? "2px solid #00ffff" : "2px solid transparent", color: activeTab === "account" ? "#00ffff" : "#4a4a4a", fontSize: 10, fontWeight: 700, letterSpacing: 2.5, cursor: "pointer", transition: "0.18s" }}
              onMouseEnter={(e) => { if (activeTab !== "account") e.currentTarget.style.color = "#888"; }}
              onMouseLeave={(e) => { if (activeTab !== "account") e.currentTarget.style.color = "#4a4a4a"; }}>ACCOUNT</button>
            <button onClick={() => setSoundOn(!soundOn)}
              style={{ width: "100%", padding: "8px 12px", textAlign: "left", background: "transparent", border: "none", color: soundOn ? "#00ffff" : "#333", fontSize: 10, cursor: "pointer", letterSpacing: 2, fontWeight: 700, transition: "0.18s", textShadow: soundOn ? "0 0 8px rgba(0,255,255,0.5)" : "none" }}>
              {soundOn ? "♫  SOUND ON" : "♫  SOUND OFF"}
            </button>
            <button onClick={() => window.open("https://www.paypal.com/donate", "_blank")}
              style={{ width: "100%", padding: "8px 12px", textAlign: "left", background: "transparent", border: "none", color: "#333", fontSize: 10, cursor: "pointer", letterSpacing: 2, transition: "0.18s" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#888"}
              onMouseLeave={(e) => e.currentTarget.style.color = "#333"}>♥  DONATE</button>
          </div>
        </div>

        {/* ── MAIN SCROLL AREA ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 30 }}>

            {/* HERO (unchanged) */}
            <div style={{ position: "relative", height: 380, marginBottom: 30, borderRadius: 20, overflow: "hidden", background: "black" }}>
              <video autoPlay muted loop playsInline style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", opacity: 0.35, filter: "blur(1px)" }}>
                <source src="/videos/A2B.mp4" type="video/mp4" />
              </video>
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, black, transparent 60%)" }} />
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at center, transparent 30%, black 100%)" }} />
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.12)" }} />
              <div style={{ position: "absolute", top: 25, left: 25, zIndex: 10, fontSize: 42, fontWeight: 900, letterSpacing: 8, animation: "pulse 2.5s infinite", textShadow: "0 0 20px rgba(0,255,255,0.8)" }}>2MRRW</div>
              <div style={{ position: "absolute", bottom: 24, right: 25, display: "flex", gap: 16, alignItems: "center", zIndex: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {SOCIALS.map((social) => (
                  <a key={social.name} href={social.href} target="_blank" rel="noopener noreferrer" title={social.name}
                    style={{ color: "rgba(255,255,255,0.65)", transition: "transform 0.2s ease, color 0.2s ease, filter 0.2s ease", display: "flex", alignItems: "center", textDecoration: "none" }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.5)"; e.currentTarget.style.color = "#00ffff"; e.currentTarget.style.filter = "drop-shadow(0 0 6px rgba(0,255,255,0.8))"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.color = "rgba(255,255,255,0.65)"; e.currentTarget.style.filter = "none"; }}>
                    {social.svg}
                  </a>
                ))}
              </div>
            </div>

            {/* ── TAB CONTENT with fade transition ────────────────────────────── */}
            <div key={tabKey} style={{ animation: "fadeInTab 0.22s ease forwards" }}>

              {/* HOME */}
              {activeTab === "home" && (
                <>
                  <h2 className="section-heading">Latest Singles</h2>
                  <div className="singles-row" style={{ display: "flex", gap: 18, overflowX: "auto", paddingBottom: 14, scrollSnapType: "x mandatory", marginBottom: 28 }}>
                    {singles.map((single, i) => (
                      <div key={single.slug} onClick={() => { setSelectedSingle(single); setNowPlaying(single); setNowPlayingPlaying(true); }}
                        style={{ flexShrink: 0, width: 220, cursor: "pointer", scrollSnapAlign: "start", opacity: 0, animation: `fadeInUp 0.5s ease ${i * 0.09}s forwards`, background: "#0a0a0a", borderRadius: 14, overflow: "hidden", border: "1px solid #1a1a1a", transition: "border-color 0.25s, box-shadow 0.25s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff44"; e.currentTarget.style.boxShadow = "0 0 18px rgba(0,255,255,0.12)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.boxShadow = "none"; }}>
                        <img src={single.cover} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block", transition: "filter 0.3s ease" }}
                          onMouseEnter={(e) => { e.target.style.filter = "brightness(1.15)"; }} onMouseLeave={(e) => { e.target.style.filter = "brightness(1)"; }} />
                        <div style={{ padding: "12px 14px 16px" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{single.title}</div>
                          <div style={{ fontSize: 12, color: "#00ffff", fontWeight: 700, marginBottom: 10 }}>${single.price.toFixed(2)}</div>
                          <button onClick={(e) => { e.stopPropagation(); addToCart(single); }}
                            style={{ width: "100%", padding: "7px 0", fontSize: 11, background: "#1a1a1a", color: "white", border: "1px solid #2a2a2a", borderRadius: 7, cursor: "pointer", fontWeight: 600, transition: "0.2s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.color = "#00ffff"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "white"; }}>+ Cart</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <CarouselUI large={false} />
                  <div style={{ margin: "30px 0", height: 1, background: "#222" }} />
                  <h2 className="section-heading" style={{ animationDelay: "0.15s" }}>Albums</h2>
                  <Grid items={albums} type="albums" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} onSingleClick={setSelectedAlbum} />
                </>
              )}

              {/* SINGLES */}
              {activeTab === "singles" && (<><h2 className="section-heading">Singles</h2><CarouselUI large={true} /></>)}

              {/* ALBUMS */}
              {activeTab === "albums" && (<Grid items={albums} type="albums" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} onSingleClick={setSelectedAlbum} />)}

              {/* SHOP */}
              {activeTab === "shop" && (<Grid items={merch} type="products" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} />)}

              {/* EXCLUSIVE */}
              {activeTab === "exclusive" && (
                <>
                  <h2 className="section-heading">Exclusive Drops</h2>
                  <p style={{ fontSize: 13, color: "#444", marginBottom: 8, letterSpacing: 1, lineHeight: 1.8 }}>This is not merch. These are ownership tokens. Physical and digital proof that you were here first.</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 28 }}>
                    {exclusiveItems.map((item) => (
                      <div key={item.id}
                        style={{ background: "#0d0d0d", border: `1px solid #1e1e1e`, borderRadius: 20, overflow: "hidden", cursor: "pointer", transition: "all 0.3s ease" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = item.badgeColor + "55"; e.currentTarget.style.boxShadow = `0 0 28px ${item.badgeColor}18`; e.currentTarget.style.transform = "translateY(-3px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e1e1e"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}
                        onClick={() => setExclusiveModal(item)}>
                        <div style={{ position: "relative" }}>
                          <img src={item.cover} style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} />
                          <div style={{ position: "absolute", top: 12, left: 12, background: item.badgeColor, color: "#000", fontSize: 9, fontWeight: 900, letterSpacing: 2, padding: "4px 10px", borderRadius: 20 }}>{item.badge}</div>
                          <div style={{ position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 10, backdropFilter: "blur(4px)" }}>{item.stock} left</div>
                        </div>
                        <div style={{ padding: "16px 18px 20px" }}>
                          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, letterSpacing: 0.5 }}>{item.title}</div>
                          <div style={{ fontSize: 11, color: "#555", letterSpacing: 1, marginBottom: 12 }}>{item.subtitle}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 20, fontWeight: 900, color: item.badgeColor }}>${item.price.toFixed(2)}</div>
                            <button onClick={(e) => { e.stopPropagation(); setExclusiveModal(item); }}
                              style={{ padding: "8px 16px", background: "transparent", color: item.badgeColor, border: `1px solid ${item.badgeColor}66`, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "0.2s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = item.badgeColor + "22"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>View Drop</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 48, background: "linear-gradient(135deg, #0d0d0d, #111)", border: "1px solid #1e1e1e", borderRadius: 20, padding: 32 }}>
                    <div style={{ fontSize: 11, color: "#444", letterSpacing: 3, marginBottom: 14, textTransform: "uppercase" }}>About Collector Art Cards</div>
                    <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1, marginBottom: 16, lineHeight: 1.3 }}>Not merch. Ownership.</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
                      {[{ icon: "🃏", title: "Physical Card", desc: "350–600gsm thick stock. Matte soft-touch finish. Luxury feel designed to last." }, { icon: "✍️", title: "Hand-Signed", desc: "Personal message from 2MRRW. Each card is individually signed and numbered." }, { icon: "📱", title: "QR + NFC", desc: "Scan to access your music library. Select cards include NFC chip — tap to unlock." }, { icon: "🔒", title: "Scarcity Built In", desc: "First Edition, Early Supporter Series, numbered drops. Once they're gone, they're gone." }].map((f) => (
                        <div key={f.title} style={{ padding: "18px 20px", background: "#0a0a0a", borderRadius: 14, border: "1px solid #1a1a1a" }}>
                          <div style={{ fontSize: 24, marginBottom: 8 }}>{f.icon}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{f.title}</div>
                          <div style={{ fontSize: 12, color: "#555", lineHeight: 1.7 }}>{f.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* VIDEOS */}
              {activeTab === "videos" && (
                <>
                  <h2 className="section-heading">Music Videos</h2>
                  <p style={{ fontSize: 13, color: "#444", marginBottom: 28, letterSpacing: 1 }}>Official visuals from 2MRRW</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                    {musicVideos.map((vid) => (
                      <div key={vid.id} style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 20, overflow: "hidden" }}>
                        <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
                          <iframe src={`https://www.youtube.com/embed/${vid.youtubeId}`} title={vid.title} frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: "20px 20px 0 0" }} />
                        </div>
                        <div style={{ padding: "16px 20px" }}>
                          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 1, marginBottom: 4 }}>{vid.title}</div>
                          <div style={{ fontSize: 12, color: "#555" }}>{vid.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* SHOWS */}
              {activeTab === "shows" && (
                <>
                  <div style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 20, padding: 24, marginBottom: 30 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                      <button onClick={prevMonth} style={{ background: "none", border: "1px solid #333", color: "white", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>‹</button>
                      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3 }}>{monthNames[calMonth]} {calYear}</div>
                      <button onClick={nextMonth} style={{ background: "none", border: "1px solid #333", color: "white", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>›</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
                      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (<div key={d} style={{ textAlign: "center", fontSize: 11, color: "#555", paddingBottom: 6 }}>{d}</div>))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                      {Array.from({ length: getFirstDayOfMonth(calMonth, calYear) }).map((_, i) => <div key={`empty-${i}`} />)}
                      {Array.from({ length: getDaysInMonth(calMonth, calYear) }).map((_, i) => {
                        const day = i + 1;
                        const dayShows = getShowsForDay(day);
                        const isToday = new Date().getDate() === day && new Date().getMonth() === calMonth && new Date().getFullYear() === calYear;
                        return (
                          <div key={day} onClick={() => dayShows.length > 0 && setSelectedEvent(dayShows[0])}
                            style={{ minHeight: 44, borderRadius: 8, background: dayShows.length > 0 ? "rgba(0,255,255,0.08)" : "transparent", border: isToday ? "1px solid #00ffff" : dayShows.length > 0 ? "1px solid rgba(0,255,255,0.3)" : "1px solid #1a1a1a", cursor: dayShows.length > 0 ? "pointer" : "default", padding: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, transition: "0.2s" }}>
                            <span style={{ fontSize: 12, color: isToday ? "#00ffff" : "#aaa" }}>{day}</span>
                            {dayShows.map((s) => <span key={s.id} style={{ fontSize: 9, background: "#00ffff", color: "#000", borderRadius: 4, padding: "1px 4px", fontWeight: 700 }}>SHOW</span>)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <h2 style={{ letterSpacing: 3, fontSize: 14, color: "#555", marginBottom: 16, textTransform: "uppercase" }}>Upcoming Shows</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {shows.map((show) => (
                      <div key={show.id} style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 14, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{show.title}</div>
                          <div style={{ fontSize: 12, color: "#aaa" }}>{show.venue}</div>
                          <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{new Date(show.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {show.time}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <div style={{ fontSize: 18, fontWeight: 900, color: "#00ffff" }}>${show.price.toFixed(2)}</div>
                          <button onClick={() => setSelectedEvent(show)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{ padding: "10px 20px", background: "#111", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontWeight: "bold", fontSize: 13, transition: "0.25s" }}>Get Tickets</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* LIVE */}
              {activeTab === "live" && (
                <>
                  <h2 className="section-heading">Live</h2>
                  <div style={{ background: "linear-gradient(135deg, #080808, #0d0d0d)", border: "1px solid #1a1a1a", borderRadius: 20, padding: "36px 32px", marginBottom: 28, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 6, textTransform: "uppercase" }}>Next Show</div>
                    <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>2MRRW Live – Dallas</div>
                    <div style={{ fontSize: 13, color: "#aaa", marginBottom: 28 }}>House of Blues Dallas · May 10, 2026 · 8:00 PM</div>
                    <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
                      {[{ value: liveCountdown.days, label: "Days" }, { value: liveCountdown.hours, label: "Hours" }, { value: liveCountdown.minutes, label: "Min" }, { value: liveCountdown.seconds, label: "Sec" }].map((unit) => (
                        <div key={unit.label} style={{ background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: 14, padding: "18px 22px", minWidth: 74, textAlign: "center" }}>
                          <div style={{ fontSize: 36, fontWeight: 900, color: "#00ffff", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{String(unit.value).padStart(2, "0")}</div>
                          <div style={{ fontSize: 10, color: "#444", letterSpacing: 2, marginTop: 6, textTransform: "uppercase" }}>{unit.label}</div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setSelectedEvent(shows[0])} style={{ marginTop: 28, padding: "12px 32px", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, letterSpacing: 1 }}>Get Tickets – $25.00</button>
                  </div>
                  <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, overflow: "hidden", marginBottom: 28 }}>
                    <div style={{ position: "relative", paddingBottom: "56.25%", background: "#050505" }}>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                        <div style={{ width: 70, height: 70, borderRadius: "50%", border: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg viewBox="0 0 24 24" fill="#333" width="32" height="32"><circle cx="12" cy="12" r="4" /><path d="M20.188 10.934a8.999 8.999 0 0 0-16.376 0M23.472 9.16a13.5 13.5 0 0 0-22.944 0M16.905 12.7a4.5 4.5 0 0 0-9.81 0M12 17v-1m0 5v-2" stroke="#333" strokeWidth="1.5" fill="none" /></svg>
                        </div>
                        <div style={{ fontSize: 14, color: "#333", fontWeight: 700, letterSpacing: 2 }}>OFFLINE</div>
                        <div style={{ fontSize: 12, color: "#2a2a2a" }}>Next livestream announced via Circle + socials</div>
                      </div>
                    </div>
                    <div style={{ padding: "16px 20px", borderTop: "1px solid #111" }}>
                      <div style={{ fontSize: 13, color: "#444" }}>Livestreams go live here and on Twitch. Follow to get notified.</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 16, textTransform: "uppercase" }}>Full Tour Schedule</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {shows.map((show) => (
                      <div key={show.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 12, gap: 12, flexWrap: "wrap", transition: "0.2s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#333"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{show.title}</div>
                          <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{show.venue} · {new Date(show.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                        </div>
                        <button onClick={() => setSelectedEvent(show)} style={{ padding: "8px 16px", background: "transparent", color: "#00ffff", border: "1px solid #00ffff33", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "0.2s" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,255,255,0.08)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>Tickets</button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* BLOG */}
              {activeTab === "blog" && (
                <>
                  {blogPost ? (
                    <div>
                      <button onClick={() => setBlogPost(null)} style={{ background: "none", border: "none", color: "#00ffff", cursor: "pointer", fontSize: 13, marginBottom: 20, padding: 0, letterSpacing: 1 }}>← BACK TO BLOG</button>
                      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 6, letterSpacing: 1 }}>{blogPost.title}</h1>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 24 }}>{blogPost.date} · by {blogPost.author}</div>
                      <div style={{ fontSize: 14, lineHeight: 1.9, color: "#ccc", whiteSpace: "pre-line", marginBottom: 40 }}>{blogPost.body}</div>
                      <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: 24 }}>
                        <h3 style={{ fontSize: 13, letterSpacing: 3, color: "#555", marginBottom: 16, textTransform: "uppercase" }}>Comments</h3>
                        {(blogComments[blogPost.id] || []).length === 0 && <p style={{ fontSize: 13, color: "#444", marginBottom: 20 }}>No comments yet. Be the first.</p>}
                        {(blogComments[blogPost.id] || []).map((c, i) => (
                          <div key={i} style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#00ffff", marginBottom: 4 }}>{c.name}</div>
                            <div style={{ fontSize: 13, color: "#ccc" }}>{c.text}</div>
                            <div style={{ fontSize: 10, color: "#444", marginTop: 6 }}>{c.time}</div>
                          </div>
                        ))}
                        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                          <input placeholder="Leave a comment…" value={blogComment} onChange={(e) => setBlogComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddComment(blogPost.id)} style={{ flex: 1, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 13 }} />
                          <button onClick={() => handleAddComment(blogPost.id)} style={{ padding: "10px 18px", background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Post</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="section-heading" style={{ marginBottom: 24 }}>Community Blog</h2>
                      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        {blogPosts.map((post) => (
                          <div key={post.id} onClick={() => setBlogPost(post)} style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, cursor: "pointer", transition: "0.25s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.boxShadow = "0 0 16px rgba(0,255,255,0.1)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e1e1e"; e.currentTarget.style.boxShadow = "none"; }}>
                            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{post.title}</div>
                            <div style={{ fontSize: 11, color: "#555", marginBottom: 12 }}>{post.date} · by {post.author}</div>
                            <div style={{ fontSize: 13, color: "#777", lineHeight: 1.7 }}>{post.body.slice(0, 160)}…</div>
                            <div style={{ fontSize: 12, color: "#00ffff", marginTop: 14 }}>Read more →</div>
                            <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>{(blogComments[post.id] || []).length} comment{(blogComments[post.id] || []).length !== 1 ? "s" : ""}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* VISION */}
              {activeTab === "vision" && (
                <>
                  <h2 className="section-heading">Vision</h2>
                  <div style={{ background: "linear-gradient(135deg, #080808, #0e0e0e)", border: "1px solid #1a1a1a", borderRadius: 24, padding: "48px 40px", marginBottom: 28, textAlign: "center", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, rgba(0,255,255,0.04) 0%, transparent 65%)", pointerEvents: "none" }} />
                    <div style={{ fontSize: 11, color: "#444", letterSpacing: 4, marginBottom: 20, textTransform: "uppercase" }}>The Name</div>
                    <div style={{ fontSize: 52, fontWeight: 900, letterSpacing: 8, color: "white", textShadow: "0 0 40px rgba(0,255,255,0.3)", marginBottom: 20, lineHeight: 1 }}>2MRRW</div>
                    <div style={{ fontSize: 16, color: "#777", letterSpacing: 2, fontStyle: "italic" }}>Tomorrow. Always possible.</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {[
                      { label: "The Name", heading: "What 2MRRW Means", body: "2MRRW started as a reminder, not a brand. A reminder that no matter how hard today is, tomorrow is a blank page. You get to start again. The number 2 is intentional — it's shorthand for the second chance, the next version, the one that gets it right.\n\nEvery record, every show, every piece of merch carries that forward. If you're listening, you're part of the movement." },
                      { label: "The Music", heading: "Artist Philosophy", body: "Music is not background noise. It's a conversation. 2MRRW makes music that holds something real — real emotion, real experience, real questions. Not manufactured for playlists. Built for people who feel deeply.\n\nThe goal is never to chase what's popular. The goal is to make something that still means something in 10 years. That's the standard every project is held to." },
                      { label: "The Mission", heading: "What This Is Building", body: "This is not a streaming play. This is an ecosystem. Direct-to-fan. Artist-owned. Built on trust between creator and believer.\n\nThe music is the entry point. The community is the foundation. The collector system is the bridge between listening and belonging. Every piece is connected. Every purchase, every comment, every ticket is a step deeper into something that's being built in real time.\n\nListeners come and go. Fans stay. Believers build the movement." },
                    ].map((section, i) => (
                      <div key={i} style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 18, padding: "28px 30px" }}>
                        <div style={{ fontSize: 10, color: "#444", letterSpacing: 3, marginBottom: 10, textTransform: "uppercase" }}>{section.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, letterSpacing: 0.5 }}>{section.heading}</div>
                        <div style={{ fontSize: 14, color: "#888", lineHeight: 2, whiteSpace: "pre-line" }}>{section.body}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 32, padding: "28px 30px", borderTop: "1px solid #1a1a1a", textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: "#555", lineHeight: 2 }}>You are not just a listener.<br /><span style={{ color: "#00ffff", fontWeight: 700 }}>You are early.</span></div>
                  </div>
                </>
              )}

              {/* CIRCLE */}
              {activeTab === "circle" && (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                    <h2 className="section-heading" style={{ margin: 0 }}>The Circle</h2>
                    {userStatus && (<div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, padding: "3px 10px", borderRadius: 20, background: userStatus.glow + "22", color: userStatus.color, border: `1px solid ${userStatus.color}44`, boxShadow: `0 0 10px ${userStatus.glow}` }}>{userStatus.label}</div>)}
                  </div>
                  <p style={{ fontSize: 13, color: "#444", marginBottom: 28, letterSpacing: 0.5, lineHeight: 1.8 }}>This is not a comment section. It's a direct line. Ask 2MRRW anything. Share what the music means to you. Selected submissions receive an official response.</p>
                  <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, padding: 28, marginBottom: 32 }}>
                    <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 16, textTransform: "uppercase" }}>Ask 2MRRW</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                      {["question", "thought", "feedback", "message"].map((cat) => (
                        <button key={cat} onClick={() => setCircleCategory(cat)} style={{ padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: "pointer", border: circleCategory === cat ? "1px solid #00ffff" : "1px solid #2a2a2a", borderRadius: 20, background: circleCategory === cat ? "rgba(0,255,255,0.1)" : "transparent", color: circleCategory === cat ? "#00ffff" : "#555", textTransform: "uppercase", transition: "0.2s" }}>{cat}</button>
                      ))}
                    </div>
                    <textarea placeholder="Write your question or message…" value={circleQuestion} onChange={(e) => setCircleQuestion(e.target.value)} rows={4} style={{ width: "100%", padding: "12px 14px", background: "#0a0a0a", border: "1px solid #2a2a2a", color: "white", borderRadius: 12, fontSize: 14, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.7 }} />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: "#444" }}>{currentUser ? `Posting as ${currentUser.name}` : "Posting anonymously"}</div>
                      <button onClick={handleCircleSubmit} style={{ padding: "10px 24px", background: circleSubmitted ? "#1a3a1a" : "#00ffff", color: circleSubmitted ? "#00ff88" : "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, transition: "0.3s", letterSpacing: 1 }}>{circleSubmitted ? "✓ Submitted" : "Submit"}</button>
                    </div>
                    {circleSubmitted && <div style={{ marginTop: 12, fontSize: 12, color: "#00ff88", letterSpacing: 0.5 }}>Your message was received. If selected, 2MRRW will respond here in the archive.</div>}
                  </div>
                  <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 16, textTransform: "uppercase" }}>2MRRW Responses</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 36 }}>
                    {circleResponses.map((resp) => (
                      <div key={resp.id} style={{ background: resp.highlight ? "linear-gradient(135deg, #0d0d0d, #111)" : "#0a0a0a", border: resp.highlight ? `1px solid ${resp.tagColor}33` : "1px solid #1a1a1a", borderRadius: 18, padding: 24, boxShadow: resp.highlight ? `0 0 30px ${resp.tagColor}10` : "none" }}>
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#555", fontWeight: 700 }}>{resp.questionBy[0]}</div>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: "#aaa" }}>{resp.questionBy}</div><div style={{ fontSize: 10, color: "#444" }}>{resp.questionTime}</div></div>
                          </div>
                          <div style={{ fontSize: 14, color: "#888", lineHeight: 1.7, fontStyle: "italic" }}>"{resp.question}"</div>
                        </div>
                        <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 6, color: "white", textShadow: "0 0 10px rgba(0,255,255,0.5)" }}>2MRRW</div>
                            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1, padding: "2px 8px", borderRadius: 10, background: resp.tagColor + "22", color: resp.tagColor, border: `1px solid ${resp.tagColor}44` }}>{resp.tag}</div>
                          </div>
                          <div style={{ fontSize: 14, color: "#ccc", lineHeight: 1.9 }}>{resp.response}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: "linear-gradient(135deg, #0a0a14, #0d0d0d)", border: "1px solid #1a1a2a", borderRadius: 20, padding: "28px 30px" }}>
                    <div style={{ fontSize: 11, color: "#444", letterSpacing: 3, marginBottom: 16, textTransform: "uppercase" }}>Community Status</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                      {[{ label: "EARLY SUPPORTER", color: "#aaa", desc: "Joined the ecosystem early. You were here." }, { label: "COLLECTOR", color: "#ff6b35", desc: "Purchased a collector card or bundle. You own a piece." }, { label: "VISIONARY", color: "#00ffff", desc: "3+ Circle submissions. You're part of the conversation." }, { label: "INNER CIRCLE", color: "#a259ff", desc: "Collector + Circle member. The deepest level of access." }].map((s) => (
                        <div key={s.label} style={{ padding: "16px 18px", background: "#080808", borderRadius: 14, border: `1px solid ${s.color}22` }}>
                          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, color: s.color, marginBottom: 8 }}>{s.label}</div>
                          <div style={{ fontSize: 12, color: "#555", lineHeight: 1.7 }}>{s.desc}</div>
                        </div>
                      ))}
                    </div>
                    {userStatus && (
                      <div style={{ marginTop: 20, padding: "14px 18px", background: userStatus.glow + "10", borderRadius: 12, border: `1px solid ${userStatus.color}33`, display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ fontSize: 10, color: "#555" }}>Your status:</div>
                        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 2, color: userStatus.color }}>{userStatus.label}</div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ── INNER CIRCLE — NEW: gated access screen ─────────────────── */}
              {activeTab === "innercircle" && (
                <>
                  {userStatus?.label !== "INNER CIRCLE" ? (
                    /* Gate screen */
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "60px 20px" }}>
                      <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 24, filter: "drop-shadow(0 0 24px rgba(162,89,255,0.5))", animation: "pulse 3s infinite" }}>🔒</div>
                      <div style={{ fontSize: 11, color: "#a259ff", letterSpacing: 4, marginBottom: 12, fontWeight: 700 }}>RESTRICTED ACCESS</div>
                      <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 1, marginBottom: 14 }}>Inner Circle Access Required</div>
                      <div style={{ fontSize: 14, color: "#555", maxWidth: 400, lineHeight: 1.9, marginBottom: 36 }}>
                        This section is reserved for verified Inner Circle members — those who own a piece of the music and are active in the conversation.
                      </div>
                      <div style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
                        <div style={{ fontSize: 11, color: "#a259ff", letterSpacing: 3, marginBottom: 4, fontWeight: 700 }}>HOW TO UNLOCK</div>
                        {[
                          { label: "Own a Collector Card or Bundle", done: myPurchases.some(p => p.slug?.startsWith("exc-card") || p.slug?.startsWith("exc-bundle")), link: "exclusive", linkLabel: "Shop Exclusives →" },
                          { label: "Submit to The Circle", done: circleSubmissions.filter(s => s.by === currentUser?.name).length >= 1, link: "circle", linkLabel: "Go to Circle →" },
                        ].map((step, i) => (
                          <div key={i} style={{ padding: "16px 20px", background: step.done ? "rgba(162,89,255,0.06)" : "#0d0d0d", border: `1px solid ${step.done ? "rgba(162,89,255,0.3)" : "#1e1e1e"}`, borderRadius: 14, display: "flex", alignItems: "center", gap: 14, textAlign: "left", transition: "0.2s" }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: step.done ? "rgba(162,89,255,0.2)" : "#111", border: `1px solid ${step.done ? "#a259ff" : "#222"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: step.done ? "#a259ff" : "#333", flexShrink: 0 }}>{step.done ? "✓" : i + 1}</div>
                            <div style={{ flex: 1, fontSize: 13, color: step.done ? "#a259ff" : "#666", fontWeight: step.done ? 700 : 400 }}>{step.label}</div>
                            {!step.done && (<button onClick={() => switchTab(step.link)} style={{ padding: "6px 14px", background: "rgba(162,89,255,0.1)", border: "1px solid rgba(162,89,255,0.25)", borderRadius: 8, color: "#a259ff", cursor: "pointer", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{step.linkLabel}</button>)}
                          </div>
                        ))}
                      </div>
                      {userStatus && (<div style={{ fontSize: 12, color: "#444" }}>Current status: <span style={{ color: userStatus.color, fontWeight: 700 }}>{userStatus.label}</span></div>)}
                    </div>
                  ) : (
                    /* Full Inner Circle content (unchanged) */
                    <>
                      {innerCirclePost ? (
                        <div>
                          <button onClick={() => setInnerCirclePost(null)} style={{ background: "none", border: "none", color: "#a259ff", cursor: "pointer", fontSize: 13, marginBottom: 20, padding: 0, letterSpacing: 1 }}>← BACK TO INNER CIRCLE</button>
                          <div style={{ fontSize: 10, color: "#a259ff", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" }}>Inner Circle Exclusive</div>
                          <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 6, letterSpacing: 1 }}>{innerCirclePost.title}</h1>
                          <div style={{ fontSize: 12, color: "#555", marginBottom: 28 }}>{innerCirclePost.date}</div>
                          <div style={{ fontSize: 14, lineHeight: 1.9, color: "#ccc", whiteSpace: "pre-line" }}>{innerCirclePost.body}</div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                            <h2 className="section-heading" style={{ margin: 0 }}>Inner Circle</h2>
                            {userStatus && (<div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, padding: "3px 10px", borderRadius: 20, background: "rgba(162,89,255,0.12)", color: "#a259ff", border: "1px solid rgba(162,89,255,0.3)" }}>{userStatus.label}</div>)}
                          </div>
                          <p style={{ fontSize: 13, color: "#444", marginBottom: 32, letterSpacing: 0.5, lineHeight: 1.8 }}>Exclusive posts for believers. This is where the real conversation lives. Behind the music, behind the decisions, behind the art.</p>
                          <div style={{ background: "linear-gradient(135deg, #0d0814, #0d0d0d)", border: "1px solid rgba(162,89,255,0.2)", borderRadius: 20, padding: "28px 30px", marginBottom: 28, position: "relative", overflow: "hidden" }}>
                            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at top left, rgba(162,89,255,0.06) 0%, transparent 60%)", pointerEvents: "none" }} />
                            <div style={{ fontSize: 11, color: "#a259ff", letterSpacing: 3, marginBottom: 8, textTransform: "uppercase" }}>Direct from 2MRRW</div>
                            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>The stories behind the music.</div>
                            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.8 }}>Not for everyone. Written for the people who actually listen. Every post is unfiltered — what actually happened, what it actually means.</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                            {innerCirclePosts.map((post, i) => (
                              <div key={post.id} onClick={() => setInnerCirclePost(post)}
                                style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 16, padding: 24, cursor: "pointer", opacity: 0, animation: `fadeInUp 0.5s ease ${i * 0.1}s forwards`, transition: "border-color 0.25s, box-shadow 0.25s" }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#a259ff55"; e.currentTarget.style.boxShadow = "0 0 20px rgba(162,89,255,0.1)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.boxShadow = "none"; }}>
                                <div style={{ fontSize: 10, color: "#a259ff", letterSpacing: 3, marginBottom: 8, textTransform: "uppercase" }}>Inner Circle Exclusive</div>
                                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, letterSpacing: 0.3 }}>{post.title}</div>
                                <div style={{ fontSize: 11, color: "#555", marginBottom: 12 }}>{post.date}</div>
                                <div style={{ fontSize: 13, color: "#666", lineHeight: 1.7 }}>{post.preview}</div>
                                <div style={{ fontSize: 12, color: "#a259ff", marginTop: 16 }}>Read more →</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* MY MUSIC */}
              {activeTab === "mymusic" && (
                <>
                  <h2 className="section-heading">My Music</h2>
                  {!currentUser ? (
                    <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, padding: "48px 32px", textAlign: "center" }}>
                      <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Sign in to access your library</div>
                      <div style={{ fontSize: 13, color: "#555", marginBottom: 24 }}>Your purchased music, downloads, and exclusive content all live here.</div>
                      <button onClick={() => switchTab("account")} style={{ padding: "12px 28px", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14 }}>Go to Account</button>
                    </div>
                  ) : myPurchases.length === 0 ? (
                    <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, padding: "48px 32px", textAlign: "center" }}>
                      <div style={{ fontSize: 32, marginBottom: 16 }}>🎵</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Your library is empty</div>
                      <div style={{ fontSize: 13, color: "#555", marginBottom: 24 }}>Purchase singles, albums, or exclusive bundles. They'll appear here for download anytime.</div>
                      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                        <button onClick={() => switchTab("singles")} style={{ padding: "10px 22px", background: "#111", color: "#00ffff", border: "1px solid #00ffff44", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Browse Singles</button>
                        <button onClick={() => switchTab("albums")} style={{ padding: "10px 22px", background: "#111", color: "#aaa", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Browse Albums</button>
                        <button onClick={() => switchTab("exclusive")} style={{ padding: "10px 22px", background: "#111", color: "#a259ff", border: "1px solid #a259ff44", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Exclusive Drops</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: "#555", marginBottom: 24 }}>{myPurchases.length} item{myPurchases.length !== 1 ? "s" : ""} in your library · Signed in as {currentUser.name}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {myPurchases.map((item, i) => (
                          <div key={i} style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                            {item.cover && <img src={item.cover} style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{item.title}</div>
                              <div style={{ fontSize: 11, color: "#555" }}>Purchased {item.purchasedAt ? new Date(item.purchasedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</div>
                            </div>
                            <button onClick={() => alert("Download links are generated server-side with signed, expiring URLs. Connect your /api/generate-download-link endpoint to enable this.")}
                              style={{ padding: "8px 16px", background: "transparent", color: "#00ffff", border: "1px solid #00ffff33", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "0.2s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,255,255,0.08)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>↓ Download</button>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 24, padding: "14px 18px", background: "#080808", border: "1px solid #1a1a1a", borderRadius: 12, fontSize: 12, color: "#444", lineHeight: 1.8 }}>
                        Download links are secure and generated on-demand. Connect <code style={{ color: "#00ffff" }}>/api/generate-download-link</code> to your backend to enable signed expiring URLs.
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ACCOUNT */}
              {activeTab === "account" && (
                <>
                  <h2 className="section-heading">Account</h2>
                  {currentUser ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                      <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, padding: 28 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #00ffff22, #a259ff22)", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#00ffff" }}>{currentUser.name[0].toUpperCase()}</div>
                          <div><div style={{ fontSize: 18, fontWeight: 800 }}>{currentUser.name}</div><div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>{currentUser.email}</div></div>
                          {userStatus && (<div style={{ marginLeft: "auto", fontSize: 10, fontWeight: 900, letterSpacing: 2, padding: "4px 12px", borderRadius: 20, background: userStatus.glow + "22", color: userStatus.color, border: `1px solid ${userStatus.color}44` }}>{userStatus.label}</div>)}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                          {[{ label: "Purchases", value: myPurchases.length }, { label: "Circle Posts", value: circleSubmissions.filter(s => s.by === currentUser.name).length }, { label: "Member Since", value: "2026" }].map((stat) => (
                            <div key={stat.label} style={{ padding: "14px 16px", background: "#080808", borderRadius: 12, border: "1px solid #1a1a1a", textAlign: "center" }}>
                              <div style={{ fontSize: 24, fontWeight: 900, color: "#00ffff" }}>{stat.value}</div>
                              <div style={{ fontSize: 11, color: "#555", marginTop: 4, letterSpacing: 1 }}>{stat.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        {[{ label: "My Music Library", tab: "mymusic", color: "#00ffff" }, { label: "Exclusive Drops", tab: "exclusive", color: "#a259ff" }, { label: "The Circle", tab: "circle", color: "#ff6b35" }, { label: "Inner Circle", tab: "innercircle", color: "#a259ff" }].map((link) => (
                          <button key={link.tab} onClick={() => switchTab(link.tab)}
                            style={{ padding: "16px 18px", background: "#0a0a0a", border: `1px solid ${link.color}22`, borderRadius: 14, cursor: "pointer", textAlign: "left", color: link.color, fontSize: 13, fontWeight: 700, transition: "0.2s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = link.color + "55"; e.currentTarget.style.background = link.color + "0a"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = link.color + "22"; e.currentTarget.style.background = "#0a0a0a"; }}>
                            {link.label} →
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { localStorage.removeItem("2mrrw_user"); setCurrentUser(null); setGateSubmitted(false); }}
                        style={{ padding: "12px 0", background: "transparent", color: "#444", border: "1px solid #1e1e1e", borderRadius: 10, cursor: "pointer", fontSize: 13, width: "100%", transition: "0.2s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#333"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#444"; e.currentTarget.style.borderColor = "#1e1e1e"; }}>Sign Out</button>
                    </div>
                  ) : (
                    <div style={{ maxWidth: 400 }}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
                        {["login", "signup"].map((mode) => (
                          <button key={mode} onClick={() => { setAuthMode(mode); setAuthError(""); }}
                            style={{ flex: 1, padding: "10px 0", fontSize: 12, fontWeight: 700, letterSpacing: 2, cursor: "pointer", border: authMode === mode ? "1px solid #00ffff" : "1px solid #2a2a2a", borderRadius: 10, background: authMode === mode ? "rgba(0,255,255,0.1)" : "transparent", color: authMode === mode ? "#00ffff" : "#555", textTransform: "uppercase", transition: "0.2s" }}>
                            {mode === "login" ? "Sign In" : "Create Account"}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {authMode === "signup" && (<input placeholder="Full Name" style={{ padding: "12px 14px", background: "#111", border: "1px solid #2a2a2a", color: "white", borderRadius: 10, fontSize: 14, outline: "none" }} onFocus={(e) => { e.target.style.borderColor = "#00ffff44"; }} onBlur={(e) => { e.target.style.borderColor = "#2a2a2a"; }} />)}
                        <input placeholder="Email Address" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} style={{ padding: "12px 14px", background: "#111", border: "1px solid #2a2a2a", color: "white", borderRadius: 10, fontSize: 14, outline: "none" }} onFocus={(e) => { e.target.style.borderColor = "#00ffff44"; }} onBlur={(e) => { e.target.style.borderColor = "#2a2a2a"; }} />
                        <input placeholder="Password" type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} style={{ padding: "12px 14px", background: "#111", border: "1px solid #2a2a2a", color: "white", borderRadius: 10, fontSize: 14, outline: "none" }} onFocus={(e) => { e.target.style.borderColor = "#00ffff44"; }} onBlur={(e) => { e.target.style.borderColor = "#2a2a2a"; }} />
                        {authError && <div style={{ fontSize: 12, color: "#ff4d4d" }}>{authError}</div>}
                        <button onClick={() => { if (!authEmail.trim() || !authPassword.trim()) { setAuthError("Please fill out all fields."); return; } setAuthError("Connect /api/auth to enable full login. For now the site uses the entry gate for fan capture."); }}
                          style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, letterSpacing: 1, marginTop: 4 }}>
                          {authMode === "login" ? "Sign In" : "Create Account"}
                        </button>
                      </div>
                      <div style={{ marginTop: 20, fontSize: 12, color: "#444", lineHeight: 1.9 }}>Fan capture is handled by the site entry gate. Full auth requires connecting <code style={{ color: "#00ffff" }}>/api/auth</code> with session management.</div>
                    </div>
                  )}
                </>
              )}

            </div>{/* end tabKey fade wrapper */}
          </div>{/* end main scroll */}

          {/* ── NEW: NOW PLAYING MINI-PLAYER ────────────────────────────────── */}
          {nowPlaying && (
            <div style={{ flexShrink: 0, borderTop: "1px solid #141414", background: "rgba(4,4,4,0.95)", backdropFilter: "blur(20px)", padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 -4px 30px rgba(0,0,0,0.5)" }}>
              <img src={nowPlaying.cover} style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nowPlaying.title}</div>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>SINGLE · PREVIEW</div>
              </div>
              <button
                onClick={() => {
                  if (!nowPlayingAudioRef.current) return;
                  if (nowPlayingPlaying) { nowPlayingAudioRef.current.pause(); setNowPlayingPlaying(false); }
                  else { nowPlayingAudioRef.current.src = nowPlaying.preview; nowPlayingAudioRef.current.play().catch(() => {}); setNowPlayingPlaying(true); }
                }}
                style={{ width: 36, height: 36, borderRadius: "50%", background: "#00ffff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                {nowPlayingPlaying
                  ? <svg viewBox="0 0 24 24" fill="#000" width="14" height="14"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>
                  : <svg viewBox="0 0 24 24" fill="#000" width="14" height="14" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>
                }
              </button>
              <button onClick={() => { setNowPlaying(null); setNowPlayingPlaying(false); if (nowPlayingAudioRef.current) nowPlayingAudioRef.current.pause(); }}
                style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
            </div>
          )}
        </div>

        {/* ── CART SIDEBAR (unchanged) ──────────────────────────────────────── */}
        <div style={{ width: 240, flexShrink: 0, borderLeft: "1px solid #222", padding: 25, overflowY: "auto", background: "rgba(4,4,4,0.8)", backdropFilter: "blur(12px)" }}>
          <h3 style={{ fontSize: 12, letterSpacing: 3, color: "#555", marginBottom: 16, textTransform: "uppercase" }}>Cart</h3>
          {cart.length === 0 && <p style={{ opacity: 0.4, fontSize: 13 }}>Empty</p>}
          {cart.map((item, i) => (
            <div key={i} style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              {item.cover && <img src={item.cover} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
              <span style={{ fontSize: 12, flex: 1, lineHeight: 1.4 }}>{item.title}<br /><span style={{ color: "#00ffff", fontSize: 11 }}>${item.price.toFixed(2)}</span></span>
              <button onClick={() => removeFromCart(i)}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.textShadow = "0 0 8px rgba(255,255,255,0.8)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#666"; e.currentTarget.style.textShadow = "none"; }}
                style={{ background: "none", border: "none", color: "#666", fontSize: 16, cursor: "pointer", marginLeft: "auto", transition: "0.2s" }}>×</button>
            </div>
          ))}
          <div style={{ marginTop: 20, fontSize: 13, fontWeight: 700 }}>Total: <span style={{ color: "#00ffff" }}>${total.toFixed(2)}</span></div>
          <button onClick={clearCart} style={{ marginTop: 15, width: "100%", padding: 12, background: "rgba(255,30,30,0.15)", color: "#ff4d4d", fontWeight: "bold", border: "1px solid #ff4d4d33", borderRadius: 8, cursor: "pointer", fontSize: 12, transition: "0.2s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,30,30,0.25)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,30,30,0.15)"; }}>CLEAR CART</button>
          <button onClick={handleCheckout} disabled={checkingOut || cart.length === 0} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
            style={{ marginTop: 10, width: "100%", padding: 12, background: "#111", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", transition: "0.25s", fontSize: 13, fontWeight: 700 }}>
            {checkingOut ? "Redirecting…" : "Checkout"}
          </button>
          {checkoutError && (
            <div style={{ marginTop: 8 }}>
              <p style={{ color: "#ff4d4d", fontSize: 12 }}>{checkoutError}</p>
              <p style={{ color: "#555", fontSize: 11, marginTop: 4 }}>If you see "no valid payment method", make sure your /api/create-payment-intent includes <code style={{ color: "#00ffff" }}>payment_method_types: ["card"]</code>.</p>
            </div>
          )}
          {currentUser && (
            <div>
              <p style={{ fontSize: 11, color: "#555", marginTop: 12, textAlign: "center" }}>Signed in as {currentUser.name}</p>
              {userStatus && (<div style={{ marginTop: 6, textAlign: "center", fontSize: 10, fontWeight: 900, letterSpacing: 1, color: userStatus.color }}>{userStatus.label}</div>)}
            </div>
          )}
        </div>

      </div>{/* end main flex layout */}

      {/* ── CSS KEYFRAMES ─────────────────────────────────────────────────── */}
      <style jsx>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.85; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(22px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes fadeInCover {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes fadeInTab {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes expandDown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(60px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-60px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes countPulse {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }
        .section-heading {
          animation: fadeInUp 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
          animation-fill-mode: forwards;
        }
        .singles-row::-webkit-scrollbar { height: 4px; }
        .singles-row::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
        .singles-row::-webkit-scrollbar-thumb { background: #00ffff; border-radius: 4px; }
        .singles-row::-webkit-scrollbar-thumb:hover { background: #00cccc; }
      `}</style>

      {/* ── STRIPE CHECKOUT MODAL (unchanged) ────────────────────────────── */}
      {clientSecret && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#0a0a0a", padding: 30, borderRadius: 20, width: 400, border: "1px solid #222" }}>
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CheckoutForm onSuccess={handleCheckoutSuccess} />
            </Elements>
            <button onClick={() => { setClientSecret(null); setCheckingOut(false); }} style={{ marginTop: 10, width: "100%", padding: 10, background: "none", border: "1px solid #333", color: "#777", cursor: "pointer", borderRadius: 8 }}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

// ── GRID COMPONENT (unchanged) ────────────────────────────────────────────────
function Grid({ items, type, addToCart, hoverIn, hoverOut, buttonHoverIn, buttonHoverOut, onSingleClick }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 22 }}>
      {items.map((item) => (
        <div key={item.slug} style={{ position: "relative", background: "#0a0a0a", borderRadius: 16, overflow: "hidden", border: "1px solid #1a1a1a", transition: "0.25s" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; }}>
          <img src={item.cover} onClick={() => onSingleClick ? onSingleClick(item) : null} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
            style={{ width: "100%", aspectRatio: "1/1", height: "auto", cursor: "pointer", transition: "0.25s", objectFit: "cover", display: "block" }} />
          <div style={{ padding: "14px 16px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{item.title}</div>
            {item.date && <div style={{ fontSize: 11, color: "#444", marginBottom: 6, letterSpacing: 1 }}>{item.date}</div>}
            <div style={{ fontSize: 13, color: "#00ffff", fontWeight: 700, marginBottom: 10 }}>${item.price.toFixed(2)}</div>
            <button onClick={() => addToCart(item)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
              style={{ width: "100%", padding: "8px 0", fontSize: 12, background: "#1a1a1a", color: "white", border: "1px solid #2a2a2a", cursor: "pointer", borderRadius: 8, transition: "0.25s", fontWeight: 600 }}>
              Add to Cart
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── CHECKOUT FORM (unchanged) ─────────────────────────────────────────────────
function CheckoutForm({ onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true); setError("");
    const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (result.error) { setError(result.error.message || "Payment failed. Please try a different card."); setLoading(false); }
    else { onSuccess(); }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button type="submit" disabled={!stripe || loading} style={{ marginTop: 20, width: "100%", padding: 12, background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer" }}>
        {loading ? "Processing…" : "Pay Now"}
      </button>
      {error && <p style={{ color: "#ff4d4d", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </form>
  );
}
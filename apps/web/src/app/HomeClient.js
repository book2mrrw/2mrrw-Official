"use client";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo, startTransition, Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Elements } from "@stripe/react-stripe-js";
import { getStripeClient } from "@/lib/commerce/stripe-client";
const CheckoutForm = dynamic(() => import("@/components/payments/CheckoutForm"), { ssr: false });
const DonateModal = dynamic(() => import("@/components/payments/DonateModal"), { ssr: false });
import { stripePaymentOverlayStyle, stripePaymentPanelStyle } from "@/components/payments/stripePaymentShell";
const ImmersivePreviewModal = dynamic(() => import("@/components/preview/ImmersivePreviewModal"), { ssr: false });
const AlbumModal = dynamic(
  () => import("@/components/preview/ImmersivePreviewModal").then((mod) => ({ default: mod.AlbumModal })),
  { ssr: false }
);
const GiftBottomSheet = dynamic(() => import("@/components/gifts/GiftBottomSheet"), { ssr: false });
const CollectorCardAdminPanel = dynamic(() => import("@/components/admin/CollectorCardAdminPanel"), { ssr: false });
const NotificationSettingsSection = dynamic(() => import("@/components/account/NotificationSettingsSection"), { ssr: false });
const AnalyticsDashboard = dynamic(() => import("@/components/account/AnalyticsDashboard"), { ssr: false });
const VaultUnlockedRoom = dynamic(
  () => import("@/components/vault/VaultUnlockedRoom").then((mod) => ({ default: mod.VaultUnlockedRoom })),
  { ssr: false }
);
const AlbumTracklistSheet = dynamic(() => import("@/components/music/AlbumTracklistSheet"), { ssr: false });
import { getPageAuthRef } from "@/lib/storefront/page-auth-ref";
import { getCatalogSurfaceRef } from "@/lib/storefront/catalog-surface-ref";
import { releaseRetainedOfflineBlobUrls } from "@/lib/offline-cache";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";
import PageAuthRefSync from "@/components/storefront/PageAuthRefSync";
import {
  PageAuthSidebarBadge,
  PageAuthMobileNavBadge,
  PageAuthDeepLinkHandler,
  PageAuthCheckoutPendingEffect,
  PageAuthSessionBridge,
  PageAuthHelpSupport,
} from "@/components/storefront/PageAuthRegions";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";
import { getControlSystemReleaseDetail } from "@/lib/control-system/releases";
import GiftButton from "@/components/gifts/GiftButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import GiftsSentSection from "@/components/gifts/GiftsSentSection";
import HelpSupportSection from "@/components/support/HelpSupportSection";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import { consumeGiftHighlightSlug } from "@/lib/gifts/session-keys";
import { notifyEntitlementsUpdated } from "@/lib/diagnostics/state-churn-log";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
  recordPlaybackTraceContext,
} from "@/lib/diagnostics/playback-trace";
import { resolveContentAccess, resolvePlaybackSrc, resolveTrackAccess } from "@/lib/music-access";
import {
  albumTracksForPlayback,
  describeAlbumQueuePlaybackFailure,
  playableReleaseQueue,
  resolveReleaseQueueStartIndex,
  normalizeTrackForPlayback,
  resolveCatalogPlaybackItem,
  toPlaybackTrack,
  toInstantStartTrack,
} from "@/lib/music-playback";
import { usePagePlaybackActions } from "@/hooks/usePagePlaybackActions";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import MobileHomeBottomNav from "@/components/nav/MobileHomeBottomNav";
import {
  getHomeScrollSection,
  setHomeScrollSection,
} from "@/lib/home-scroll-section-store";
import { COLLECTORS_CARDS_ROUTE } from "@/lib/collectors-cards";
import { catalogCoverUrl, catalogPreviewAudioUrl, catalogPublicMediaUrl } from "@/lib/media-urls";
import CoverArt, { resolveCoverMediaType } from "@/components/ui/CoverArt";
import { LiveCountdownProvider } from "@/components/home/LiveCountdownContext";
import { LiveCountdownLiveTab } from "@/components/home/LiveCountdownDisplays";
import CatalogGrid from "@/components/home/CatalogGrid";
import HeroIsland from "@/components/home/HeroIsland";
import PlaybackChromeIsland from "@/components/storefront/PlaybackChromeIsland";
import AuthSurfaceIsland from "@/components/storefront/AuthSurfaceIsland";
import { useAuth } from "@/context/AuthContext";
const InlineReleasesManager = dynamic(() => import("@/components/admin/InlineReleasesManager"), { ssr: false });
import EntitlementSurfaceIsland from "@/components/storefront/EntitlementSurfaceIsland";
import HomeStorefrontIsland from "@/components/storefront/HomeStorefrontIsland";
import MusicTabCatalogPanels from "@/components/storefront/MusicTabCatalogPanels";
import {
  CatalogSurfaceProvider,
} from "@/components/storefront/catalog-surface-context";
import MobileCartFab from "@/components/storefront/MobileCartFab";
import ScrollPaddingShell from "@/components/storefront/ScrollPaddingShell";
import { withR2CatalogMedia, catalogCoverDisplay } from "@/components/home/catalogMedia";
import {
  getStorefrontAlbums,
  getStorefrontMixtapesAndEps,
} from "@/lib/media/canonical-catalog";
import { buildSearchIndex, searchCatalog } from "@/lib/catalog-search";
import { imagePipeline } from "@/media/imagePipeline";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";
import { ModalErrorBoundary } from "@/system/errors";
import { useBlackscreenMountTrace } from "@/lib/diagnostics/useBlackscreenMountTrace";

const MOBILE_NAV_TABS = [
  { id: "home", label: "Home" },
  { id: "singles", label: "Music" },
  { id: "mymusic", label: "Collection" },
  { id: "vault", label: "Vault", vault: true },
  { id: "cards", label: "Cards" },
  { id: "shop", label: "Shop" },
  { id: "more", label: "More", more: true },
];
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
// ── HELPERS ───────────────────────────────────────────────────────────────────
const formatTime = (s) => {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

function normalizeAlbumTracksForModal(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((track, index) => {
    if (typeof track === "string") {
      return { id: index + 1, slug: null, title: track, feat: null, dur: null, durSec: 0, free: false };
    }
    const dur = track?.dur ?? track?.duration ?? null;
    return {
      id: track?.id ?? index + 1,
      slug: track?.slug || track?.trackSlug || track?.track_slug || null,
      title: track?.title || `Track ${index + 1}`,
      feat: track?.feat || track?.featuring || null,
      dur: typeof dur === "number" ? formatTime(dur) : dur,
      durSec: track?.durSec ?? (typeof dur === "number" ? dur : 0),
      free: Boolean(track?.free),
      lyrics: track?.lyrics || null,
    };
  });
}

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

function TicketCheckoutButton({ event, onClose }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const handleBuy = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/tickets/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId: event.id }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Checkout failed"); return; }
      if (data.url) window.location.href = data.url;
    } catch (e) { setErr("Network error — try again"); }
    finally { setLoading(false); }
  };
  return (
    <>
      <button
        onClick={handleBuy}
        disabled={loading}
        style={{width:"100%",padding:"12px 0",background:loading?"#1a1a1a":"#00ffff",color:loading?"#555":"#000",fontWeight:"bold",border:"none",borderRadius:8,cursor:loading?"wait":"pointer",fontSize:14,transition:"0.2s"}}
      >{loading ? "Redirecting to checkout…" : `Buy Ticket — $${event.price.toFixed(2)}`}</button>
      {err && <div style={{fontSize:12,color:"#ef4444",textAlign:"center"}}>{err}</div>}
    </>
  );
}

const PRESET_PRICES = [25,30,35,40,45,50,60,75,100,125,150,175,200,250,300,350,400,500,750,1000,1500,2000,2500,3000,3500];

const TIMEZONES = [
  // Americas
  { label: "Hawaii (HT)",                value: "Pacific/Honolulu" },
  { label: "Alaska (AKT)",               value: "America/Anchorage" },
  { label: "Pacific (PT)",               value: "America/Los_Angeles" },
  { label: "Mountain (MT)",              value: "America/Denver" },
  { label: "Central (CT)",               value: "America/Chicago" },
  { label: "Eastern (ET)",               value: "America/New_York" },
  { label: "Atlantic (AT)",              value: "America/Halifax" },
  { label: "São Paulo (BRT)",            value: "America/Sao_Paulo" },
  { label: "Buenos Aires (ART)",         value: "America/Argentina/Buenos_Aires" },
  // Europe
  { label: "London (GMT/BST)",           value: "Europe/London" },
  { label: "Amsterdam / Paris (CET)",    value: "Europe/Amsterdam" },
  { label: "Berlin / Rome (CET)",        value: "Europe/Berlin" },
  { label: "Moscow (MSK)",               value: "Europe/Moscow" },
  // Africa
  { label: "Lagos / Kinshasa (WAT)",     value: "Africa/Lagos" },
  { label: "Johannesburg (SAST)",        value: "Africa/Johannesburg" },
  { label: "Nairobi / Kampala (EAT)",   value: "Africa/Nairobi" },
  // Asia / Pacific
  { label: "Dubai (GST)",               value: "Asia/Dubai" },
  { label: "India (IST +5:30)",         value: "Asia/Kolkata" },
  { label: "Bangkok / Jakarta (ICT)",   value: "Asia/Bangkok" },
  { label: "Singapore / KL (SGT)",      value: "Asia/Singapore" },
  { label: "Hong Kong (HKT)",           value: "Asia/Hong_Kong" },
  { label: "Tokyo (JST)",               value: "Asia/Tokyo" },
  { label: "Seoul (KST)",               value: "Asia/Seoul" },
  { label: "Sydney (AEDT/AEST)",        value: "Australia/Sydney" },
  { label: "Auckland (NZST/NZDT)",      value: "Pacific/Auckland" },
];

// Parse "8:00 PM", "20:00", etc. → total minutes from midnight
function _parseTimeMin(timeStr) {
  if (!timeStr) return null;
  let m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1]), min = parseInt(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

// Convert venue local datetime → UTC Date object
function _venueToUTC(dateStr, timeStr, venueTz) {
  const totalMin = _parseTimeMin(timeStr);
  if (totalMin === null || !dateStr || !venueTz) return null;
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const noonUTC = new Date(Date.UTC(yr, mo - 1, dy, 12, 0));
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: venueTz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(noonUTC);
    const tzH = parseInt(parts.find(p => p.type === "hour").value) % 24;
    const tzM = parseInt(parts.find(p => p.type === "minute").value);
    // offset of venue tz vs UTC at this date (in minutes)
    const offsetMin = tzH * 60 + tzM - 12 * 60;
    const venueMidnightUTC = noonUTC.getTime() - (12 * 60 + offsetMin) * 60000;
    return new Date(venueMidnightUTC + totalMin * 60000);
  } catch { return null; }
}

// Format event time: "8:00 PM CDT · 9:00 PM EDT your time" (or just venue time if same tz)
function _fmtEventTime(dateStr, timeStr, venueTz) {
  if (!timeStr) return "";
  const utc = _venueToUTC(dateStr, timeStr, venueTz);
  if (!utc || !venueTz) return timeStr;
  try {
    const venueFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: venueTz, hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
    });
    const venueStr = venueFmt.format(utc);
    const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (viewerTz === venueTz) return venueStr;
    const viewerFmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
    });
    const viewerStr = viewerFmt.format(utc);
    return `${venueStr} · ${viewerStr} your time`;
  } catch { return timeStr; }
}

// ── Inline admin shows management (admin-only, renders inside the SHOWS tab) ──
function InlineShowsAdmin({ onRefreshFanView }) {
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(null);
  const [customPrice, setCustomPrice] = useState(false);
  const blank = { name:"", location:"", event_date:"", event_time:"", venue_timezone:"America/Chicago", price_cents:"", tickets_available:"", active:true };
  const [form, setForm] = useState(blank);

  const showFlash = (msg, isErr=false) => {
    setFlash({ msg, isErr });
    setTimeout(() => setFlash(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/shows");
      const data = await res.json();
      setShows(data.shows || []);
    } catch { setShows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(blank); setEditingId(null); setCustomPrice(false); setShowForm(true); };
  const openEdit = (show) => {
    const isPreset = PRESET_PRICES.includes(show.price_cents / 100);
    setForm({
      name: show.name, location: show.location, event_date: show.event_date,
      event_time: show.event_time || "",
      venue_timezone: show.venue_timezone || "America/Chicago",
      price_cents: String(show.price_cents),
      tickets_available: show.tickets_available != null ? String(show.tickets_available) : "",
      active: show.active,
    });
    setCustomPrice(!isPreset);
    setEditingId(show.id);
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        price_cents: Number(form.price_cents) || 0,
        tickets_available: form.tickets_available === "" ? null : Number(form.tickets_available),
      };
      const res = await fetch("/api/admin/shows", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const data = await res.json();
      if (!res.ok) { showFlash(data.error || "Save failed", true); return; }
      showFlash(editingId ? "Show updated" : "Show created");
      setShowForm(false); setEditingId(null);
      await load(); onRefreshFanView?.();
    } catch (err) { showFlash(err.message || "Error", true); }
    finally { setSaving(false); }
  };

  const handleToggle = async (show) => {
    const res = await fetch("/api/admin/shows", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id: show.id, active: !show.active }) });
    if (!res.ok) { showFlash("Update failed", true); return; }
    showFlash(show.active ? "Show hidden from fans" : "Show visible to fans");
    await load(); onRefreshFanView?.();
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this show? It will be hidden from fans.")) return;
    const res = await fetch("/api/admin/shows", { method:"DELETE", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id }) });
    if (!res.ok) { showFlash("Delete failed", true); return; }
    showFlash("Show removed");
    await load(); onRefreshFanView?.();
  };

  const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}) : "—";
  const isPast  = (d) => d && new Date(d) < new Date(new Date().toISOString().slice(0,10));
  const admIn   = { background:"rgba(155,93,229,0.06)", border:"1px solid rgba(155,93,229,0.18)", borderRadius:14, padding:"16px 18px", marginBottom:20 };

  return (
    <div style={admIn}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:flash||showForm?14:0}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,letterSpacing:".25em",color:"#9b5de5",textTransform:"uppercase"}}>Admin — Shows Manager</span>
        <button onClick={openCreate} style={{background:"#9b5de5",border:"none",borderRadius:8,padding:"7px 14px",fontSize:11,fontWeight:700,color:"white",cursor:"pointer",letterSpacing:".08em"}}>+ New Show</button>
      </div>

      {flash && (
        <div style={{fontSize:12,padding:"8px 12px",borderRadius:8,marginBottom:10,background:flash.isErr?"rgba(239,68,68,.1)":"rgba(34,197,94,.1)",color:flash.isErr?"#ef4444":"#22c55e",border:`1px solid ${flash.isErr?"rgba(239,68,68,.2)":"rgba(34,197,94,.2)"}`}}>{flash.msg}</div>
      )}

      {showForm && (
        <form onSubmit={handleSave} style={{display:"flex",flexDirection:"column",gap:12,padding:"14px 0",borderTop:"1px solid rgba(155,93,229,0.15)"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,letterSpacing:".2em",color:"rgba(255,255,255,.4)"}}>{editingId ? "EDIT SHOW" : "NEW SHOW"}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <label style={{display:"flex",flexDirection:"column",gap:5,fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:".15em",color:"rgba(255,255,255,.45)"}}>
              SHOW NAME *
              <input style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"9px 12px",fontSize:12,color:"white",outline:"none"}} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="2MRRW Live – Dallas" required />
            </label>
            <label style={{display:"flex",flexDirection:"column",gap:5,fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:".15em",color:"rgba(255,255,255,.45)"}}>
              LOCATION *
              <input style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"9px 12px",fontSize:12,color:"white",outline:"none"}} value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Dallas, TX" required />
            </label>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <label style={{display:"flex",flexDirection:"column",gap:5,fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:".15em",color:"rgba(255,255,255,.45)"}}>
              DATE *
              <input type="date" style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"9px 12px",fontSize:12,color:"white",outline:"none",colorScheme:"dark"}} value={form.event_date} onChange={e=>setForm(f=>({...f,event_date:e.target.value}))} required />
            </label>
            <label style={{display:"flex",flexDirection:"column",gap:5,fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:".15em",color:"rgba(255,255,255,.45)"}}>
              TIME
              <input style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"9px 12px",fontSize:12,color:"white",outline:"none"}} value={form.event_time} onChange={e=>setForm(f=>({...f,event_time:e.target.value}))} placeholder="8:00 PM" />
            </label>
          </div>
          <label style={{display:"flex",flexDirection:"column",gap:5,fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:".15em",color:"rgba(255,255,255,.45)"}}>
            VENUE TIMEZONE *
            <select
              value={form.venue_timezone}
              onChange={e=>setForm(f=>({...f,venue_timezone:e.target.value}))}
              style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"9px 12px",fontSize:12,color:"white",outline:"none",appearance:"none",cursor:"pointer"}}
              required
            >
              {TIMEZONES.map(tz=>(
                <option key={tz.value} value={tz.value} style={{background:"#1a1a1a",color:"white"}}>{tz.label}</option>
              ))}
            </select>
          </label>
          <div>
            <div style={{fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:".15em",color:"rgba(255,255,255,.45)",marginBottom:8}}>TICKET PRICE (USD) *</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:customPrice?8:0}}>
              {PRESET_PRICES.map(p=>(
                <button type="button" key={p}
                  onClick={()=>{setCustomPrice(false);setForm(f=>({...f,price_cents:String(p*100)}));}}
                  style={{padding:"7px 11px",borderRadius:8,border:Number(form.price_cents)===p*100?"1px solid #9b5de5":"1px solid rgba(255,255,255,.1)",background:Number(form.price_cents)===p*100?"rgba(155,93,229,0.18)":"transparent",color:Number(form.price_cents)===p*100?"#c084fc":"rgba(255,255,255,.45)",fontSize:12,fontWeight:Number(form.price_cents)===p*100?700:400,cursor:"pointer",transition:"0.12s",lineHeight:1}}
                >${p}</button>
              ))}
              <button type="button"
                onClick={()=>setCustomPrice(true)}
                style={{padding:"7px 11px",borderRadius:8,border:customPrice?"1px solid #9b5de5":"1px solid rgba(255,255,255,.1)",background:customPrice?"rgba(155,93,229,0.18)":"transparent",color:customPrice?"#c084fc":"rgba(255,255,255,.45)",fontSize:12,cursor:"pointer",transition:"0.12s",lineHeight:1}}
              >Custom</button>
            </div>
            {customPrice && (
              <input autoFocus type="number" min="1" step="1"
                style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(155,93,229,0.4)",borderRadius:8,padding:"9px 12px",fontSize:13,color:"white",outline:"none",width:"100%",boxSizing:"border-box"}}
                placeholder="Enter price in dollars (e.g. 75)"
                value={form.price_cents ? Number(form.price_cents)/100 : ""}
                onChange={e=>setForm(f=>({...f,price_cents:String(Math.round(parseFloat(e.target.value||0)*100))}))}
              />
            )}
            {!form.price_cents && <input type="hidden" required />}
          </div>
          <label style={{display:"flex",flexDirection:"column",gap:5,fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:".15em",color:"rgba(255,255,255,.45)"}}>
            TICKETS AVAILABLE
            <input type="number" min="0" step="1" style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"9px 12px",fontSize:12,color:"white",outline:"none"}} value={form.tickets_available} onChange={e=>setForm(f=>({...f,tickets_available:e.target.value}))} placeholder="Unlimited" />
          </label>
          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"rgba(255,255,255,.5)",cursor:"pointer"}}>
            <input type="checkbox" checked={form.active} onChange={e=>setForm(f=>({...f,active:e.target.checked}))} />
            Visible to fans
          </label>
          <div style={{display:"flex",gap:8}}>
            <button type="submit" disabled={saving} style={{background:"#9b5de5",border:"none",borderRadius:8,padding:"9px 18px",fontSize:12,fontWeight:700,color:"white",cursor:saving?"wait":"pointer",opacity:saving?0.6:1}}>{saving ? "Saving…" : editingId ? "Save Changes" : "Create Show"}</button>
            <button type="button" onClick={()=>{setShowForm(false);setEditingId(null);}} style={{background:"transparent",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,padding:"9px 18px",fontSize:12,color:"rgba(255,255,255,.4)",cursor:"pointer"}}>Cancel</button>
          </div>
        </form>
      )}

      {!showForm && (
        loading ? (
          <div style={{fontSize:12,color:"rgba(255,255,255,.25)",padding:"8px 0"}}>Loading…</div>
        ) : shows.length === 0 ? (
          <div style={{fontSize:12,color:"rgba(255,255,255,.25)",padding:"8px 0"}}>No shows yet — create your first one above.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:10}}>
            {shows.map(show => (
              <div key={show.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"10px 12px",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,opacity:(!show.active||isPast(show.event_date))?0.5:1}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:"white",marginBottom:2}}>{show.name}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,.4)"}}>{show.location} · {fmtDate(show.event_date)}{show.event_time?` · ${show.event_time}`:""} · ${(show.price_cents/100).toFixed(2)}{show.tickets_available!=null?` · ${show.tickets_available} left`:" · unlimited"}
                    {isPast(show.event_date) && <span style={{color:"#f59e0b",marginLeft:6}}>PAST</span>}
                    {!show.active && <span style={{color:"#ef4444",marginLeft:6}}>HIDDEN</span>}
                    {show.active && !isPast(show.event_date) && show.tickets_available===0 && <span style={{color:"#ef4444",marginLeft:6}}>SOLD OUT</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>openEdit(show)} style={{background:"transparent",border:"1px solid rgba(255,255,255,.12)",borderRadius:6,padding:"4px 10px",fontSize:10,color:"rgba(255,255,255,.5)",cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>handleToggle(show)} style={{background:"transparent",border:"1px solid rgba(255,255,255,.12)",borderRadius:6,padding:"4px 10px",fontSize:10,color:show.active?"#f59e0b":"#22c55e",cursor:"pointer"}}>{show.active?"Hide":"Show"}</button>
                  <button onClick={()=>handleDelete(show.id)} style={{background:"transparent",border:"1px solid rgba(255,255,255,.12)",borderRadius:6,padding:"4px 10px",fontSize:10,color:"#ef4444",cursor:"pointer"}}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── Inline admin live-stream manager (admin-only, renders in the LIVE tab) ──
function InlineLiveAdmin() {
  const [broadcast, setBroadcast]       = useState(null);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [flash, setFlash]               = useState(null);
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState({ title: "2MRRW Live", goesLiveAt: "", channel: "callme2mrrw" });
  const [eventSub, setEventSub]         = useState(null);   // { configured, allActive, subscriptions, missing }
  const [eventSubLoading, setEsLoading] = useState(true);
  const [eventSubSaving, setEsSaving]   = useState(false);

  const showFlash = (msg, isErr = false) => {
    setFlash({ msg, isErr });
    setTimeout(() => setFlash(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/admin/livestream");
      const data = await res.json();
      setBroadcast(data.broadcast || null);
    } catch { setBroadcast(null); }
    finally { setLoading(false); }
  }, []);

  const loadEventSub = useCallback(async () => {
    setEsLoading(true);
    try {
      const res  = await fetch("/api/admin/twitch/register");
      const data = await res.json();
      setEventSub(data);
    } catch { setEventSub(null); }
    finally { setEsLoading(false); }
  }, []);

  const handleConnectEventSub = async () => {
    setEsSaving(true);
    try {
      const res  = await fetch("/api/admin/twitch/register", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { showFlash(data.error || "EventSub registration failed", true); }
      else { showFlash("Twitch EventSub connected. Going live on Twitch will now auto-trigger everything."); }
      await loadEventSub();
      // New subscriptions start in pending state — Twitch verifies the webhook within ~5s.
      // Re-check after 7s so the UI reflects the post-verification enabled state.
      setTimeout(() => loadEventSub(), 7000);
    } catch (err) { showFlash(err.message || "Error", true); }
    finally { setEsSaving(false); }
  };

  const handleDisconnectEventSub = async () => {
    if (!confirm("Remove all Twitch EventSub subscriptions?")) return;
    setEsSaving(true);
    try {
      const res  = await fetch("/api/admin/twitch/register", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { showFlash(data.error || "Disconnect failed", true); }
      else { showFlash(`Removed ${data.removed} subscription(s).`); }
      await loadEventSub();
    } catch (err) { showFlash(err.message || "Error", true); }
    finally { setEsSaving(false); }
  };

  useEffect(() => { load(); loadEventSub(); }, [load, loadEventSub]);

  const handleSchedule = async (e) => {
    e.preventDefault();
    if (!form.goesLiveAt) { showFlash("Please pick a date and time", true); return; }
    setSaving(true);
    try {
      const res  = await fetch("/api/admin/livestream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title: form.title, goesLiveAt: new Date(form.goesLiveAt).toISOString(), channel: form.channel }),
      });
      const data = await res.json();
      if (!res.ok) { showFlash(data.error || "Schedule failed", true); return; }
      showFlash("Stream scheduled — notifications will fire 24h and 15min before.");
      setShowForm(false);
      await load();
    } catch (err) { showFlash(err.message || "Error", true); }
    finally { setSaving(false); }
  };

  const handleGoLive = async () => {
    setSaving(true);
    try {
      const res  = await fetch("/api/admin/livestream", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "go_live", broadcastId: broadcast?.id, title: form.title }),
      });
      const data = await res.json();
      if (!res.ok) { showFlash(data.error || "Go live failed", true); return; }
      showFlash("You're LIVE. Notifications sent to all accounts.");
      await load();
    } catch (err) { showFlash(err.message || "Error", true); }
    finally { setSaving(false); }
  };

  const handleEndLive = async () => {
    if (!confirm("End the live stream?")) return;
    setSaving(true);
    try {
      const res  = await fetch("/api/admin/livestream", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "end_live", broadcastId: broadcast?.id }),
      });
      const data = await res.json();
      if (!res.ok) { showFlash(data.error || "End failed", true); return; }
      showFlash("Stream ended.");
      await load();
    } catch (err) { showFlash(err.message || "Error", true); }
    finally { setSaving(false); }
  };

  const admIn = { background: "rgba(155,93,229,0.06)", border: "1px solid rgba(155,93,229,0.18)", borderRadius: 14, padding: "16px 18px", marginBottom: 20 };
  const inputStyle = { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: "white", outline: "none", width: "100%", boxSizing: "border-box" };
  const labelStyle = { display: "flex", flexDirection: "column", gap: 5, fontSize: 9, fontFamily: "'DM Mono',monospace", letterSpacing: ".15em", color: "rgba(255,255,255,.45)" };

  return (
    <div style={admIn}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: flash || showForm ? 14 : 0 }}>
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".25em", color: "#9b5de5", textTransform: "uppercase" }}>Admin — Live Stream</span>
        <div style={{ display: "flex", gap: 8 }}>
          {!broadcast?.is_live && (
            <button onClick={() => setShowForm((s) => !s)} style={{ background: "transparent", border: "1px solid rgba(155,93,229,0.4)", borderRadius: 8, padding: "7px 14px", fontSize: 11, fontWeight: 700, color: "#c084fc", cursor: "pointer" }}>
              {showForm ? "Cancel" : "Schedule"}
            </button>
          )}
          {broadcast?.is_live ? (
            <button onClick={handleEndLive} disabled={saving} style={{ background: "#ef4444", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 11, fontWeight: 700, color: "white", cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Ending…" : "End Stream"}
            </button>
          ) : (
            <button onClick={handleGoLive} disabled={saving} style={{ background: "#00ffff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 11, fontWeight: 700, color: "#000", cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Going live…" : "⬤ Go Live Now"}
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div style={{ fontSize: 12, padding: "8px 12px", borderRadius: 8, marginBottom: 10, background: flash.isErr ? "rgba(239,68,68,.1)" : "rgba(34,197,94,.1)", color: flash.isErr ? "#ef4444" : "#22c55e", border: `1px solid ${flash.isErr ? "rgba(239,68,68,.2)" : "rgba(34,197,94,.2)"}` }}>
          {flash.msg}
        </div>
      )}

      {showForm && !broadcast?.is_live && (
        <form onSubmit={handleSchedule} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 0", borderTop: "1px solid rgba(155,93,229,0.15)" }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".2em", color: "rgba(255,255,255,.4)" }}>SCHEDULE STREAM</div>
          <label style={labelStyle}>TITLE<input style={inputStyle} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="2MRRW Live" /></label>
          <label style={labelStyle}>GOES LIVE AT (your local time) *<input type="datetime-local" style={{ ...inputStyle, colorScheme: "dark" }} value={form.goesLiveAt} onChange={(e) => setForm((f) => ({ ...f, goesLiveAt: e.target.value }))} required /></label>
          <label style={labelStyle}>TWITCH CHANNEL<input style={inputStyle} value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} placeholder="callme2mrrw" /></label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} style={{ background: "#9b5de5", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12, fontWeight: 700, color: "white", cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save Schedule"}</button>
          </div>
        </form>
      )}

      {!showForm && (
        loading ? (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.25)", padding: "8px 0" }}>Loading…</div>
        ) : broadcast ? (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)", marginTop: 10 }}>
            <span style={{ color: broadcast.is_live ? "#00ffff" : "rgba(255,255,255,.3)", fontWeight: 700 }}>
              {broadcast.is_live ? "● LIVE" : "○ OFFLINE"}
            </span>
            {" · "}{broadcast.title}
            {broadcast.goes_live_at && !broadcast.is_live && (
              <span style={{ color: "rgba(255,255,255,.3)" }}> · scheduled {new Date(broadcast.goes_live_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</span>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.25)", padding: "8px 0" }}>No stream scheduled — use Go Live Now or Schedule above.</div>
        )
      )}

      {/* ── Twitch EventSub section ─────────────────────────────────────── */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(155,93,229,0.12)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: ".2em", color: "rgba(155,93,229,0.7)", textTransform: "uppercase" }}>Twitch EventSub</span>
            {!eventSubLoading && eventSub && (
              <span style={{ marginLeft: 10, fontSize: 10, fontWeight: 700, color: eventSub.allActive ? "#22c55e" : eventSub.configured ? "#f59e0b" : "#ef4444" }}>
                {eventSub.allActive ? "● Connected" : eventSub.configured ? "⚠ Partial" : "○ Not connected"}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {!eventSubLoading && eventSub?.allActive && (
              <button onClick={handleDisconnectEventSub} disabled={eventSubSaving} style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "4px 10px", fontSize: 10, color: "#ef4444", cursor: eventSubSaving ? "wait" : "pointer", opacity: eventSubSaving ? 0.6 : 1 }}>
                {eventSubSaving ? "…" : "Disconnect"}
              </button>
            )}
            {!eventSubLoading && !eventSub?.allActive && (
              <button onClick={handleConnectEventSub} disabled={eventSubSaving} style={{ background: "rgba(145,70,255,0.15)", border: "1px solid rgba(145,70,255,0.4)", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontWeight: 700, color: "#9146ff", cursor: eventSubSaving ? "wait" : "pointer", opacity: eventSubSaving ? 0.6 : 1 }}>
                {eventSubSaving ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
        </div>
        {!eventSubLoading && eventSub && !eventSub.configured && eventSub.missing?.length > 0 && (
          <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 6, lineHeight: 1.5 }}>
            Missing env vars: {eventSub.missing.join(", ")}
          </div>
        )}
        {!eventSubLoading && eventSub?.allActive && (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.3)", marginTop: 6, lineHeight: 1.6 }}>
            Going live on Twitch auto-triggers the embed and notifies all accounts. No button needed.
          </div>
        )}
        {!eventSubLoading && eventSub && !eventSub.allActive && eventSub.configured && (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.3)", marginTop: 6, lineHeight: 1.6 }}>
            Click Connect to register stream.online / stream.offline webhooks with Twitch.
          </div>
        )}
      </div>
    </div>
  );
}

// ── My Tickets panel (logged-in users see their purchased tickets) ──
function MyTicketsPanel({ userId }) {
  const [tickets, setTickets] = useState(null);

  useEffect(() => {
    if (!userId) return;
    fetch("/api/tickets/my")
      .then(r => r.json())
      .then(d => setTickets(d.tickets || []))
      .catch(() => setTickets([]));
  }, [userId]);

  if (!tickets || tickets.length === 0) return null;

  return (
    <div style={{marginTop:32}}>
      <h2 style={{letterSpacing:3,fontSize:14,color:"#555",marginBottom:14,textTransform:"uppercase"}}>Your Tickets</h2>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {tickets.map(t => (
          <div key={t.id} style={{background:"#0e0e0e",border:"1px solid rgba(0,255,255,0.12)",borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:3}}>{t.show?.name || "Show"}</div>
              <div style={{fontSize:11,color:"#aaa"}}>{t.show?.location}</div>
              <div style={{fontSize:11,color:"#555",marginTop:2}}>{t.show?.date ? new Date(t.show.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}) : ""}{t.show?.time ? ` · ${t.show.time}` : ""}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#00ffff",letterSpacing:1}}>✓ CONFIRMED</div>
              <div style={{fontSize:11,color:"#555",marginTop:2}}>{t.quantity} ticket{t.quantity!==1?"s":""} · ${(t.priceCents/100).toFixed(2)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const FALLBACK_EVENTS = [
  { id:"evt-1", name:"2MRRW Live – Dallas",  location:"Dallas, TX",      date:"2026-05-10", time:"8:00 PM", price:25.00, tickets:50 },
  { id:"evt-2", name:"2MRRW Live – Houston", location:"Houston, TX",     date:"2026-05-24", time:"9:00 PM", price:25.00, tickets:75 },
  { id:"evt-3", name:"2MRRW Live – Atlanta", location:"Atlanta, GA",     date:"2026-06-07", time:"8:30 PM", price:30.00, tickets:60 },
  { id:"evt-4", name:"2MRRW Live – LA",      location:"Los Angeles, CA", date:"2026-06-21", time:"9:00 PM", price:35.00, tickets:40 },
  { id:"evt-5", name:"2MRRW Live – NYC",     location:"New York, NY",    date:"2026-07-04", time:"8:00 PM", price:35.00, tickets:45 },
];
const radioSlides = [
  { slug:"hour-glass",     title:"Hour Glass",     type:"single", cover:"/images/singles/hourglass.jpg", price:2.99, preview:"/audio/previews/hourglass-preview.mp3", tag:"NOW PLAYING", tagColor:"#00ffff" },
  { slug:"w2d",            title:"W.2.D",          type:"single", cover:"/images/singles/w2d.jpg",       price:2.99, preview:"/audio/previews/w2d-preview.mp3", tag:"FEATURED",    tagColor:"#a259ff" },
  { slug:"artificial",     title:"Artificial",     type:"single", cover:"/images/singles/artificial.jpg",price:2.99, preview:"/audio/previews/artificial-preview.mp3", tag:"TRENDING",    tagColor:"#ff6b35" },
  { slug:"turnt-me-2-dis", title:"Turnt Me 2 Dis", type:"single", cover:"/images/singles/turnt.jpg",     price:2.99, preview:"/audio/previews/turntme2dis-preview.mp3", tag:"FEATURED",    tagColor:"#00ffff" },
];

const features = [
  { title:"I Don't Believe You", slug:"i-dont-believe-you", type:"feature", cover:"/images/features/idbu.jpg",   price:2.99, featuring:"FT. 2MRRW", preview:"previews/features/i-dont-believe-you/", csAudio: null, csCover: null, hasCs: false },
  { title:"2 Heavy",             slug:"2-heavy",            type:"feature", cover:"/images/features/2heavy.jpg", price:2.99, featuring:"FT. 2MRRW", preview:"previews/features/2-heavy/", csAudio: null, csCover: null, hasCs: false },
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
    preview: "previews/singles/hour-glass/",
    csAudio: null,
    csCover: null,
    hasCs: false,
  },
  {
    title: "W.2.D",
    slug: "w2d",
    type: "single",
    cover: "/images/singles/w2d.jpg",
    video: "/videos/singles/w2d.mp4",
    price: 2.99,
    preview: "previews/singles/w2d/",
    csAudio: null,
    csCover: null,
    hasCs: false,
  },
  {
    title: "Artificial",
    slug: "artificial",
    type: "single",
    cover: "/images/singles/artificial.jpg",
    video: "/videos/singles/artificial.mp4",
    price: 2.99,
    preview: "previews/singles/artificial/",
    csAudio: null,
    csCover: null,
    hasCs: false,
  },
  {
    title: "Turnt Me 2 Dis",
    slug: "turnt-me-2-dis",
    type: "single",
    cover: "/images/singles/turnt.jpg",
    video: "/videos/singles/turntme2dis.mp4",
    price: 2.99,
    preview: "previews/singles/turnt-me-2-dis/",
    csAudio: null,
    csCover: null,
    hasCs: false,
  },
];

const albums = getStorefrontAlbums().map((release) => withR2CatalogMedia(release));
const mixtapesAndEps = getStorefrontMixtapesAndEps().map((release) => withR2CatalogMedia(release));

/** Last-resort catalog when Control System or `/api/catalog/releases` is unavailable */
const INLINE_SINGLES = singles;
const INLINE_FEATURES = features;
const INLINE_ALBUMS = albums;
const INLINE_MIXTAPES_AND_EPS = mixtapesAndEps;

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

// Static data that never changes at runtime — declared at module level so they
// are never recreated during renders.
const liveStreamDate = nextLiveDateTime.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
const liveStreamTime = nextLiveDateTime.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});

const sidebarNav = [
  { groupId:"g-home",      label:"HOME",           directTab:"home",    subTabs:[] },
  { groupId:"g-music",     label:"MUSIC",          directTab:"singles", subTabs:[{id:"singles",label:"Singles"},{id:"albums",label:"Albums"},{id:"mixtapes",label:"Mixtapes & EPs"},{id:"mymusic",label:"My Music Collection"}] },
  { groupId:"g-shop",      label:"SHOP",           directTab:"shop",    subTabs:[{id:"shop",label:"Merch"}] },
  { groupId:"g-cards",     label:"CARDS",          directTab:"cards",   subTabs:[{id:"cards",label:"Collector's Cards"}] },
  { groupId:"g-vault",     label:"VAULT",          directTab:"vault",   subTabs:[{id:"vault",label:"Exclusive Drops"}] },
  { groupId:"g-shows",     label:"SHOWS & EVENTS", directTab:"shows",   subTabs:[{id:"shows",label:"Upcoming Shows"}] },
  { groupId:"g-community", label:"MORE",           directTab:"blog",    subTabs:[{id:"blog",label:"Blog"},{id:"vision",label:"Vision"},{id:"circle",label:"Circle"},{id:"innercircle",label:"Inner Circle"},{id:"live",label:"2MRRW Live"},{id:"help",label:"Help & Support"}] },
];

const blogPosts = [
  { id:"post-1", title:"The Making of Love Hz Vol.1",          date:"April 2, 2026",      author:"2MRRW", body:"Love Hz Vol.1 started as a series of late-night sessions in a home studio with nothing but a laptop, a MIDI keyboard, and a vision. Every track on that project represents a different frequency of love — the highs, the lows, the static in between. We wanted listeners to feel the entire spectrum.\n\nThe process took nearly 18 months. Some songs were written in 10 minutes, others were rebuilt from scratch a dozen times. What you hear is the version that survived. We hope it resonates with you the way it resonated with us when we finally pressed play for the first time." },
  { id:"post-2", title:"Why We Started 2MRRW",                 date:"March 15, 2026",     author:"2MRRW", body:"2MRRW was never supposed to be a brand. It started as a reminder — tomorrow is always possible. No matter what today looks like, tomorrow holds something different.\n\nWe put that energy into every record, every show, every piece of merch. It's not just a name on a hoodie. It's a mindset we live by and want to share with everyone who connects with the music." },
  { id:"post-3", title:"Tour Prep: What Goes Into a Live Show", date:"February 28, 2026", author:"2MRRW", body:"People see the 90-minute set. They don't see the weeks of rehearsal, the production calls, the logistics of moving equipment across state lines. A live 2MRRW show is designed from the ground up — the lighting, the setlist order, the energy arc from opener to closer.\n\nWe treat every city like it's the only city. Dallas gets the same energy as NYC. That's the standard we hold ourselves to and always will." },
];

// ── Admin nav item — isolated useAuth() so re-renders don't cascade to HomeClient ──
function AdminManageReleasesNavItem({ activeTab, onSwitch, mobile = false }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  const active = activeTab === "manage-releases";
  if (mobile) {
    return (
      <motion.div style={{ marginBottom: 2 }}>
        <button
          type="button"
          onClick={() => onSwitch("manage-releases")}
          style={{
            width: "100%",
            padding: "14px 24px",
            background: "none",
            border: "none",
            color: active ? "#00ffff" : "#ccc",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 2,
            textAlign: "left",
            cursor: "pointer",
            textTransform: "uppercase",
            transition: "color 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>MANAGE RELEASES</span>
        </button>
      </motion.div>
    );
  }
  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={() => onSwitch("manage-releases")}
        style={{
          width: "100%",
          padding: "13px 18px 13px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: active ? "linear-gradient(90deg,rgba(0,255,255,0.09) 0%,transparent 100%)" : "transparent",
          border: "none",
          borderLeft: active ? "2px solid #00ffff" : "2px solid transparent",
          color: active ? "#00ffff" : "#b0b0b0",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 2.5,
          cursor: "pointer",
          textAlign: "left",
          transition: "all 0.18s",
          textShadow: active ? "0 0 12px rgba(0,255,255,0.4)" : "none",
        }}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.035)"; } }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = "#b0b0b0"; e.currentTarget.style.background = "transparent"; } }}
      >
        <span>MANAGE RELEASES</span>
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function HomeClient({ initialEvents, initialCatalog }) {
  // Prefer DB-driven catalog when available; fall back to hardcoded inline arrays.
  // withR2CatalogMedia resolves R2 paths to public CDN URLs for all sources.
  const effectiveSingles =
    initialCatalog?.singles?.length > 0
      ? initialCatalog.singles.map((r) => withR2CatalogMedia(r))
      : INLINE_SINGLES;

  const effectiveFeatures =
    initialCatalog?.features?.length > 0
      ? initialCatalog.features.map((r) => withR2CatalogMedia(r))
      : INLINE_FEATURES;

  const effectiveAlbums =
    initialCatalog?.albums?.length > 0
      ? initialCatalog.albums.map((r) => withR2CatalogMedia(r))
      : INLINE_ALBUMS;

  const effectiveMixtapes =
    initialCatalog?.mixtapes?.length > 0
      ? initialCatalog.mixtapes.map((r) => withR2CatalogMedia(r))
      : INLINE_MIXTAPES_AND_EPS;

  return (
    <CatalogSurfaceProvider
      initialSingles={effectiveSingles}
      inlineSingles={effectiveSingles}
      inlineFeatures={effectiveFeatures}
      inlineAlbums={effectiveAlbums}
      inlineMixtapesAndEps={effectiveMixtapes}
    >
      <PageStorefront
        initialEvents={initialEvents}
        effectiveAlbums={effectiveAlbums}
        effectiveMixtapes={effectiveMixtapes}
      />
    </CatalogSurfaceProvider>
  );
}

/**
 * Retain each tab's complete React/DOM/media identity for the storefront
 * session. Inactive surfaces are non-interactive and non-visible, but are
 * never destroyed merely because navigation selected another tab.
 */
function PersistentTabMount({ id, active, children }) {
  return (
    <section
      data-persistent-tab={id}
      aria-hidden={!active}
      inert={!active ? true : undefined}
      style={{ display: active ? undefined : "none" }}
    >
      {children}
    </section>
  );
}

function PageStorefront({ initialEvents, effectiveAlbums, effectiveMixtapes }) {
  const router = useRouter();
  useBlackscreenMountTrace("Page");
  // Shadows the module-level `albums`/`mixtapesAndEps` hardcoded fallback
  // constants for the rest of this component: every existing reference below
  // (search index, section rows, modals, Music tab) now resolves to the
  // DB-backed catalog computed in HomeClient, with the hardcoded arrays only
  // as their original fallback-of-last-resort when the DB has no rows of
  // that type. Previously every one of those references silently resolved to
  // the always-static module constants — a newly published Album/EP/Mixtape
  // could never appear on the storefront no matter what.
  const albums = effectiveAlbums;
  const mixtapesAndEps = effectiveMixtapes;
  const {
    playTrack,
    playQueue,
    pause,
    enterAudioVisualViewport,
    exitAudioVisualViewport,
  } = usePagePlaybackActions();
  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    logUiHydrationTrace("PAGESTOREFRONT_RENDER", { activeTab });
  });

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
  const [accountSubTab, setAccountSubTab]         = useState("overview");
  const [musicSubTab, setMusicSubTab]             = useState("singles");
  const [searchQuery, setSearchQuery]             = useState("");
  const [activeVideo, setActiveVideo]             = useState("tv_aS-hJ880");
  const [addedFlash, setAddedFlash]               = useState(null);
  const [soundOn, setSoundOn]                     = useState(false);
  const [selectedSingle, setSelectedSingle]       = useState(null);
  const [previewModalOpen, setPreviewModalOpen]   = useState(false);
  const [featureModalOpen, setFeatureModalOpen]   = useState(false);
  const [featureModalItem, setFeatureModalItem]   = useState(null);
  const [featureReleaseDetail, setFeatureReleaseDetail] = useState(null);
  const [selectedReleaseDetail, setSelectedReleaseDetail] = useState(null);
  const [selectedAlbum, setSelectedAlbum]         = useState(null);
  const [albumModalOpen, setAlbumModalOpen]       = useState(false);
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
  const [membershipUpsellOpen, setMembershipUpsellOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [giftSheetRelease, setGiftSheetRelease] = useState(null);
  const [giftHighlightSlug, setGiftHighlightSlug] = useState(null);
  const [albumTracklistRelease, setAlbumTracklistRelease] = useState(null);
  const [innerCirclePost, setInnerCirclePost]     = useState(null);
  const [expandedGroup, setExpandedGroup]         = useState(null);
  const [mobileNavExpandedGroups, setMobileNavExpandedGroups] = useState(() => new Set());
  const [radioIndex, setRadioIndex]               = useState(0);
  const [flowConversionActive, setFlowConversionActive] = useState(false);
  const [printfulProducts, setPrintfulProducts]   = useState([]);
  const [printfulLoading, setPrintfulLoading]     = useState(false);
  const [inventory, setInventory]                 = useState({});
  const [exclusiveCatalog, setExclusiveCatalog] = useState(exclusiveItemsBase);
  const [publicVault, setPublicVault]             = useState(null);
  const [isMobile, setIsMobile]                   = useState(false);
  const [mobileCartOpen, setMobileCartOpen]       = useState(false);
  const [mobileNavOpen, setMobileNavOpen]         = useState(false);
  const [mobileNavClosing, setMobileNavClosing]   = useState(false);
  const [liveEvents, setLiveEvents]               = useState(initialEvents ?? FALLBACK_EVENTS);

  // ── REFS ──────────────────────────────────────────────────────────────────
  const cursorRef          = useRef(null);
  const cursorTrailRef     = useRef(null);
  const ambientRefs        = useRef({});
  const ytPlayerRef        = useRef(null);
  const ytIframeRef        = useRef(null);
  const mainScrollRef      = useRef(null);
  const singlesRowRef      = useRef(null);
  const heroContainerRef   = useRef(null);
  const heroVideoRef       = useRef(null);

  const heroTextRef        = useRef(null);
  const heroSocialsRef     = useRef(null);
  const isMobileRef        = useRef(false);
  const uiScrollLogRef     = useRef(0);
  const prevActiveTabRef   = useRef("home");
  const activeTabIdentityRef = useRef("home");
  const tabScrollPositionsRef = useRef(new Map([["home", 0]]));
  const homeSinglesScrollLeftRef = useRef(0);
  const homeStorefrontMountCountRef = useRef(0);
  const eventsLoadedRef = useRef(false);

  // Kept in sync with modal state each render so callbacks can read the
  // current value without capturing stale closures or adding modal booleans
  // to useCallback deps (which would recreate the callback on every open/close).
  const previewModalOpenRef = useRef(false);
  const featureModalOpenRef = useRef(false);
  const albumModalOpenRef = useRef(false);

  // Mirror mutable state into refs so stable callbacks can read current values
  // without capturing state in their deps (which would recreate them on every change).
  const mobileNavOpenRef = useRef(false);
  const mobileNavClosingRef = useRef(false);
  const selectedAlbumRef = useRef(null);
  const cartRef = useRef([]);
  const inventoryRef = useRef({});

  useEffect(() => {
    previewModalOpenRef.current = previewModalOpen;
    featureModalOpenRef.current = featureModalOpen;
    albumModalOpenRef.current = albumModalOpen;
    mobileNavOpenRef.current = mobileNavOpen;
    mobileNavClosingRef.current = mobileNavClosing;
    selectedAlbumRef.current = selectedAlbum;
    cartRef.current = cart;
    inventoryRef.current = inventory;
  }, [
    albumModalOpen,
    cart,
    featureModalOpen,
    inventory,
    mobileNavClosing,
    mobileNavOpen,
    previewModalOpen,
    selectedAlbum,
  ]);

  const normalizedSelectedAlbum = useMemo(() => {
    if (!selectedAlbum) return null;
    return {
      ...selectedAlbum,
      artist: selectedAlbum.artist || "2MRRW",
      year: selectedAlbum.year || selectedAlbum.date,
      coverArt: selectedAlbum.coverArt || selectedAlbum.cover,
      price:
        selectedAlbum.price != null &&
        Number.isFinite(Number(selectedAlbum.price))
          ? `$${Number(selectedAlbum.price).toFixed(2)}`
          : selectedAlbum.price,
      tracks: normalizeAlbumTracksForModal(selectedAlbum.tracks || []),
    };
  }, [selectedAlbum]);

  const searchIndex = useMemo(() => buildSearchIndex(singles, albums, mixtapesAndEps), []);
  const searchResults = useMemo(() => searchCatalog(searchIndex, searchQuery), [searchIndex, searchQuery]);

  // ── AUDIO VISUALS VIEWPORT (music pause/resume via AudioContext) ───────────
  const handleAudioVisualsFocused = useCallback(() => {
    enterAudioVisualViewport();
  }, [enterAudioVisualViewport]);

  const handleAudioVisualsExit = useCallback(() => {
    exitAudioVisualViewport();
  }, [exitAudioVisualViewport]);

  // ── EFFECTS ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const detect = () => window.innerWidth < 768;
    isMobileRef.current = detect();
    setIsMobile(detect());
    let rafId = null;
    const onResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const m = detect();
        isMobileRef.current = m;
        setIsMobile((prev) => (prev === m ? prev : m));
      });
    };
    window.addEventListener("resize", onResize, { passive: true });
    // orientationchange fires before innerWidth updates on some Android browsers;
    // the resize event follows it, so one listener covers both.
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Phase 14C: applyHeroParallax disabled — height/opacity mutations caused layout thrash on scroll.

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isPlaybackTraceEnabled()) {
        const now = Date.now();
        if (now - uiScrollLogRef.current >= 300) {
          uiScrollLogRef.current = now;
          recordPlaybackTraceContext({ lastScrollAt: now });
          logUiChurn("scroll", { scrollTop: el.scrollTop, activeTab });
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeTab]);

  useEffect(() => {
    if (!isPlaybackTraceEnabled()) return;
    if (prevActiveTabRef.current !== activeTab) {
      logUiChurn("section-change", { from: prevActiveTabRef.current, to: activeTab });
      prevActiveTabRef.current = activeTab;
    }
  }, [activeTab]);

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
          if (match) {
            if (isPlaybackTraceEnabled()) {
              logUiChurn("intersection", {
                target: match.section,
                homeScroll: true,
                ratio: visible[0].intersectionRatio,
              });
              recordPlaybackTraceContext({ lastUiSection: match.section });
            }
            const nextSection = match.section;
            if (nextSection === getHomeScrollSection()) return;
            setHomeScrollSection(nextSection);
          }
        }
      },
      { root, threshold: [0.2, 0.45, 0.65], rootMargin: "-12% 0px -55% 0px" }
    );
    nodes.forEach(n => obs.observe(n.el));
    return () => obs.disconnect();
  }, [isMobile, activeTab]);

  useEffect(() => {
    if (activeTab !== "home") {
      setHomeScrollSection(null);
    }
  }, [activeTab]);

  useEffect(() => {
    homeStorefrontMountCountRef.current += 1;
    if (isPlaybackTraceEnabled()) {
      logUiChurn("HOME_STOREFRONT_MOUNT", {
        mountCount: homeStorefrontMountCountRef.current,
      });
    }
    return () => {
      if (isPlaybackTraceEnabled()) {
        logUiChurn("HOME_STOREFRONT_UNMOUNT", {
          mountCount: homeStorefrontMountCountRef.current,
        });
      }
    };
  }, []);

  useLayoutEffect(() => {
    const el = mainScrollRef.current;
    if (el) el.scrollTop = tabScrollPositionsRef.current.get(activeTab) ?? 0;
    if (activeTab === "home" && singlesRowRef.current) {
      singlesRowRef.current.scrollLeft = homeSinglesScrollLeftRef.current;
    }
    if (isPlaybackTraceEnabled()) {
      logUiChurn("TAB_SURFACE_RESTORED", {
        tab: activeTab,
        scrollTop: el?.scrollTop ?? 0,
      });
    }
  }, [activeTab]);

  useEffect(() => {
    setInventory(loadInventory());
  }, []);

  // Events arrive pre-fetched from the RSC page wrapper (initialEvents prop);
  // no client fetch needed.

  const enrichRadioSlide = useCallback(
    (slide) => {
      if (!slide) return slide;
      const match = getCatalogSurfaceRef().catalogPlaybackLookup.bySlug.get(slide.slug);
      const merged = match
        ? {
            ...match,
            ...slide,
            preview: slide.preview || match.preview,
            cover: slide.cover || match.cover,
            video: slide.video || match.video,
          }
        : slide;
      return withR2CatalogMedia(merged);
    },
    []
  );

  const enrichedRadioSlides = useMemo(
    () => radioSlides.map((slide) => enrichRadioSlide(slide)),
    [enrichRadioSlide]
  );

  useEffect(() => {
    if (activeTab !== "home") return undefined;
    const preloadItems = [
      ...getCatalogSurfaceRef().displaySingles.slice(0, 8),
      ...features.slice(0, 4),
      ...albums.slice(0, 6),
      ...enrichedRadioSlides.slice(0, 4),
    ];
    preloadItems.forEach((item) => {
      const { src, type } = catalogCoverDisplay(withR2CatalogMedia(item));
      if (src) imagePipeline.preload(src, "high", { coverArtType: type });
    });
    return undefined;
  }, [activeTab, enrichedRadioSlides]);

  useEffect(() => {
    if (activeTab !== "home") return undefined;
    const onVisibility = () => {
      if (document.hidden) {
        releaseRetainedOfflineBlobUrls();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "vault" && activeTab !== "innercircle") return;
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
  }, [activeTab]);

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
    if (activeTab !== "shop") return;
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
  }, [activeTab]);

  useEffect(() => {
    const stored = localStorage.getItem("2mrrw_circle");
    if (stored) setCircleSubmissions(JSON.parse(stored));
  }, []);

  useEffect(() => {
    localStorage.setItem("2mrrw_cart", JSON.stringify(cart));
  }, [cart]);

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
    const pauseAmbient = () => {
      Object.values(ambientRefs.current).forEach((a) => {
        try {
          a.pause();
        } catch {
          /* non-fatal */
        }
      });
    };
    pauseAmbient();
    const globalPlaybackActive = Boolean(getPagePlaybackActionsBridge()?.isPlaying);
    if (
      soundOn &&
      paths[activeTab] &&
      !document.hidden &&
      !globalPlaybackActive
    ) {
      const src = catalogPublicMediaUrl(`audio/ambient/${paths[activeTab]}.mp3`);
      if (!ambientRefs.current[src]) {
        try {
          const a = new Audio(src);
          a.loop = true;
          a.volume = 0.07;
          ambientRefs.current[src] = a;
        } catch {
          /* non-fatal */
        }
      }
      if (ambientRefs.current[src]) ambientRefs.current[src].play().catch(() => {});
    }
    return pauseAmbient;
  }, [activeTab, soundOn]);

  useEffect(() => {
    if (activeTab !== "home") return undefined;
    const pauseHeavyMedia = () => {
      Object.values(ambientRefs.current).forEach((a) => {
        try { a.pause(); } catch { /* non-fatal */ }
      });
    };
    // Pause once immediately if playback is already active on mount.
    if (document.hidden || getPagePlaybackActionsBridge()?.isPlaying) {
      pauseHeavyMedia();
    }
    const onPlaybackActiveChanged = (e) => {
      if (e.detail?.isPlaying || document.hidden) pauseHeavyMedia();
    };
    window.addEventListener("2mrrw:playback-active-changed", onPlaybackActiveChanged);
    return () => window.removeEventListener("2mrrw:playback-active-changed", onPlaybackActiveChanged);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "live") {
      if (ytPlayerRef.current) { try { ytPlayerRef.current.destroy(); } catch {} ytPlayerRef.current = null; }
    }
  }, [activeTab]);

  const playAlbumTracks = useCallback(
    async (album, startIndex = 0, accountStateOverride) => {
      const auth = getPageAuthRef();
      const catalogPlaybackLookup = getCatalogSurfaceRef().catalogPlaybackLookup;
      const albumItem = resolveCatalogPlaybackItem(album, catalogPlaybackLookup);
      const account = accountStateOverride
        ? { ...accountStateOverride, userId: auth.currentUser?.id, isAdmin: Boolean(auth.isAdmin || accountStateOverride?.isAdmin) }
        : { ...auth.accountState, userId: auth.currentUser?.id, isAdmin: auth.isAdmin };
      const tracks = albumTracksForPlayback(
        albumItem,
        account,
        "album_modal",
        catalogPlaybackLookup
      );
      const playable = playableReleaseQueue(tracks, account);
      if (playable.length) {
        const sourceTrack = tracks[startIndex];
        const queueIndex = resolveReleaseQueueStartIndex(playable, startIndex, sourceTrack);
        const { startTrack } = toInstantStartTrack(playable[queueIndex]);
        const instantQueue = playable.map((t, i) => (i === queueIndex ? startTrack : t));
        try {
          const result = await playQueue(instantQueue, queueIndex);
          return result !== false;
        } catch {
          return false;
        }
      }
      const blockedMessage = describeAlbumQueuePlaybackFailure(tracks, albumItem, auth.accountState);
      if (blockedMessage) return false;
      const access = resolveContentAccess(albumItem, auth.accountState);
      if (!access.canStream) return false;
      try {
        const result = await playTrack(normalizeTrackForPlayback(albumItem, account, "album_modal"));
        return result !== false;
      } catch {
        return false;
      }
    },
    [playQueue, playTrack]
  );

  const playMixtapeEpCard = useCallback(
    (e, item) => {
      e.stopPropagation();
      const albumItem = resolveCatalogPlaybackItem(item, getCatalogSurfaceRef().catalogPlaybackLookup);
      playAlbumTracks(albumItem, 0);
    },
    [playAlbumTracks]
  );

  const playAlbumCard = useCallback(
    (e, item) => {
      e.stopPropagation();
      const albumItem = resolveCatalogPlaybackItem(item, getCatalogSurfaceRef().catalogPlaybackLookup);
      playAlbumTracks(albumItem, 0);
    },
    [playAlbumTracks]
  );

  // Stable queue callbacks — read live refs at call time, safe to have [] deps.
  // Singles/features: no auto-advance. Play button restarts same song if it ended; toggles if playing.
  const playSinglesQueue = useCallback((e, clickedItem) => {
    e.stopPropagation();
    const auth = getPageAuthRef();
    const account = { ...auth.accountState, userId: auth.currentUser?.id, isAdmin: auth.isAdmin };
    const surface = getCatalogSurfaceRef();
    const bridge = getPagePlaybackActionsBridge();

    const isSameTrack = bridge?.currentTrack?.slug === clickedItem.slug;
    if (isSameTrack) {
      if (bridge?.playbackState === "idle") {
        const track = toPlaybackTrack(withR2CatalogMedia(clickedItem), account, "home_single_card");
        if (track?.src) {
          const { startTrack } = toInstantStartTrack(track);
          void bridge?.playQueue?.([startTrack], 0, { resumeAt: 0 });
        }
      } else {
        void bridge?.toggle?.();
      }
      return;
    }

    const allSingles = surface.displaySingles || [];
    const streamable = allSingles.filter((item) => {
      const access = resolveTrackAccess(item, account);
      return access.canStream || Boolean(item.preview_path || item.previewPath || item.preview);
    });
    const idx = streamable.findIndex((s) => s.slug === clickedItem.slug);
    if (idx === -1) return;
    const tracks = streamable
      .map((item) => toPlaybackTrack(withR2CatalogMedia(item), account, "home_single_card"))
      .filter((t) => t?.src);
    if (tracks.length) {
      const { startTrack } = toInstantStartTrack(tracks[idx]);
      void bridge?.playQueue?.(tracks.map((t, i) => (i === idx ? startTrack : t)), idx, { resumeAt: 0 });
    }
  }, []);

  const playFeaturesQueue = useCallback((e, clickedItem) => {
    e.stopPropagation();
    const auth = getPageAuthRef();
    const account = { ...auth.accountState, userId: auth.currentUser?.id, isAdmin: auth.isAdmin };
    const surface = getCatalogSurfaceRef();
    const bridge = getPagePlaybackActionsBridge();

    const isSameTrack = bridge?.currentTrack?.slug === clickedItem.slug;
    if (isSameTrack) {
      if (bridge?.playbackState === "idle") {
        const track = toPlaybackTrack(withR2CatalogMedia(clickedItem), account, "home_feature_card");
        if (track?.src) {
          const { startTrack } = toInstantStartTrack(track);
          void bridge?.playQueue?.([startTrack], 0, { resumeAt: 0 });
        }
      } else {
        void bridge?.toggle?.();
      }
      return;
    }

    const allFeatures = surface.displayFeatures || [];
    const streamable = allFeatures.filter((item) => {
      const access = resolveTrackAccess(item, account);
      return access.canStream || Boolean(item.preview_path || item.previewPath || item.preview);
    });
    const idx = streamable.findIndex((s) => s.slug === clickedItem.slug);
    if (idx === -1) return;
    const tracks = streamable
      .map((item) => toPlaybackTrack(withR2CatalogMedia(item), account, "home_feature_card"))
      .filter((t) => t?.src);
    if (tracks.length) {
      const { startTrack } = toInstantStartTrack(tracks[idx]);
      void bridge?.playQueue?.(tracks.map((t, i) => (i === idx ? startTrack : t)), idx, { resumeAt: 0 });
    }
  }, []);

  const playCanonicalCatalogItem = useCallback((item, source) => {
    const auth = getPageAuthRef();
    const playbackTrack = normalizeTrackForPlayback(
      item,
      { ...auth.accountState, userId: auth.currentUser?.id, isAdmin: auth.isAdmin },
      source
    );
    if (playbackTrack?.src) {
      const { startTrack } = toInstantStartTrack(playbackTrack);
      // resumeAt: 0 — explicit catalog tap always starts from the beginning;
      // clears any saved listening position so the track never resumes mid-way.
      void getPagePlaybackActionsBridge()?.playQueue?.([startTrack], 0, { resumeAt: 0 });
    }
  }, []);

  const goRadio = useCallback((i) => {
    // phase11: startTransition — carousel index is non-urgent
    startTransition(() => setRadioIndex(i));
  }, []);

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const addToCartRaw   = useCallback(item => {
    if (item.slug && getPageAuthRef().owns?.(item.slug)) return;
    setCart(p => [...p, item]);
    setAddedFlash(item.slug);
    setTimeout(() => setAddedFlash(null), 400);
  }, []);
  const addToCart      = useCallback(item => {
    addToCartRaw(item);
  }, [addToCartRaw]);
  const clearCart      = () => setCart([]);
  const removeFromCart = idx => setCart(p => p.filter((_, i) => i !== idx));
  const total          = useMemo(() => cart.reduce((s, item) => s + item.price, 0), [cart]);
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
  const addVinylToCart= useCallback(s => addToCart({ title:`${s.title} – Vinyl`, slug:`${s.slug}-vinyl`, cover:s.cover, price:47.99 }), [addToCart]);

  const dismissPreviewAndFeatureModals = useCallback(() => {
    setPreviewModalOpen(false);
    setSelectedSingle(null);
    setSelectedReleaseDetail(null);
    setFeatureModalOpen(false);
    setFeatureModalItem(null);
    setFeatureReleaseDetail(null);
  }, []);

  const openSingleModal = useCallback((single) => {
    if (featureModalOpenRef.current) {
      setFeatureModalOpen(false);
      setFeatureModalItem(null);
      setFeatureReleaseDetail(null);
    }
    if (albumModalOpenRef.current) {
      setAlbumModalOpen(false);
      setSelectedAlbum(null);
    }
    const singleItem = resolveCatalogPlaybackItem(single, getCatalogSurfaceRef().catalogPlaybackLookup);
    setSelectedSingle(singleItem);
    setPreviewModalOpen(true);
    setSelectedReleaseDetail(null);
    if (!singleItem?.slug) return;
    playCanonicalCatalogItem(singleItem, "preview_modal");
    void getControlSystemReleaseDetail({ slug: singleItem.slug, fallbackRelease: singleItem }).then((detail) => {
      if (detail) setSelectedReleaseDetail(detail);
    });
  }, [playCanonicalCatalogItem]);

  const openFeatureModal = useCallback(
    (feat) => {
      if (previewModalOpenRef.current) {
        setPreviewModalOpen(false);
        setSelectedSingle(null);
        setSelectedReleaseDetail(null);
      }
      if (albumModalOpenRef.current) {
        setAlbumModalOpen(false);
        setSelectedAlbum(null);
      }
      const featItem = resolveCatalogPlaybackItem(feat, getCatalogSurfaceRef().catalogPlaybackLookup);
      setFeatureModalItem(featItem);
      setFeatureModalOpen(true);
      setFeatureReleaseDetail(null);
      if (!featItem?.slug) return;
      playCanonicalCatalogItem(featItem, "feature_modal");
      void getControlSystemReleaseDetail({ slug: featItem.slug, fallbackRelease: featItem }).then((detail) => {
        if (detail) setFeatureReleaseDetail(detail);
      });
    },
    [playCanonicalCatalogItem]
  );

  const closeFeatureModal = useCallback(() => {
    setFeatureModalOpen(false);
    setFeatureModalItem(null);
    setFeatureReleaseDetail(null);
    // Do NOT pause here — audio continues in mini player after modal close,
    // matching single modal behavior and enabling seamless cross-section continuity.
  }, []);

  const openAlbumModal = useCallback(
    (album) => {
      dismissPreviewAndFeatureModals();
      const albumItem = resolveCatalogPlaybackItem(album, getCatalogSurfaceRef().catalogPlaybackLookup);
      setSelectedAlbum(albumItem);
      setAlbumModalOpen(true);
      if (!albumItem) return;
      // Don't restart from Track 1 if this album is already playing — just open the modal.
      const currentTrack = getPagePlaybackActionsBridge()?.currentTrack;
      const alreadyPlaying = currentTrack?.metadata?.albumSlug && currentTrack.metadata.albumSlug === albumItem.slug;
      if (!alreadyPlaying) playAlbumTracks(albumItem, 0);
    },
    [playAlbumTracks, dismissPreviewAndFeatureModals]
  );

  const playAlbumModalTrackAtIndex = useCallback(
    async (index, accountStateOverride) => {
      if (!selectedAlbumRef.current) return false;
      return playAlbumTracks(selectedAlbumRef.current, index, accountStateOverride);
    },
    [playAlbumTracks]
  );

  const handleSingleClick = useCallback(
    (single) => {
      openSingleModal(single);
    },
    [openSingleModal]
  );

  const closeSingleModal = useCallback(() => {
    setPreviewModalOpen(false);
    setSelectedSingle(null);
    setSelectedReleaseDetail(null);
  }, []);

  const closeAlbumModal = useCallback(() => {
    setAlbumModalOpen(false);
    setSelectedAlbum(null);
  }, []);

  useEffect(() => {
    if (!selectedAlbum) return;
    registerModal("album-modal");
    return () => unregisterModal("album-modal");
  }, [selectedAlbum]);

  const handleLibraryChange = useCallback(() => {
    const auth = getPageAuthRef();
    void auth.refreshAccountState?.({ reason: "library:change", source: "page.js" });
    void auth.refreshLibrary?.({ reason: "library:change", source: "page.js" });
  }, []);

  const makePreviewGiftHandler = useCallback(
    (openGiftSheet, release) => () => {
      if (release) openGiftSheet(release);
    },
    []
  );

  const handleCheckout = useCallback(async () => {
    if (cartRef.current.length === 0) return;
    setCheckingOut(true);
    setCheckoutError("");
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cart: cartRef.current }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.error || data.message || "Checkout failed.");
        setCheckingOut(false);
        return;
      }
      if (!data.clientSecret) {
        setCheckoutError("No client secret returned.");
        setCheckingOut(false);
        return;
      }
      setClientSecret(data.clientSecret);
      setCheckingOut(false);
    } catch (err) {
      setCheckoutError(`Network error: ${err.message}`);
      setCheckingOut(false);
    }
  }, []);

  const handleCheckoutSuccess = useCallback(async (paymentIntentId) => {
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
    // Read state via refs so this callback stays stable with [] deps.
    let inv = { ...inventoryRef.current };
    cartRef.current.forEach(item => {
      if (item.slug in REAL_INVENTORY) { inv = decrementInventory(inv, item.slug); }
    });
    setInventory(inv);
    setClientSecret(null); setCheckingOut(false); clearCart();
    const auth = getPageAuthRef();
    auth.invalidateEntitlementSnapshot?.("purchase:completed");
    await Promise.all([
      auth.refreshAccountState?.({
        source: "page.js",
        reason: "purchase:completed",
        force: true,
      }),
      auth.refreshLibrary?.({ source: "page.js", reason: "purchase:completed" }),
    ]);
    notifyEntitlementsUpdated({ source: "page.js", reason: "checkout-success" });
    setMembershipUpsellOpen(true);
    if (isMobileRef.current) setMobileCartOpen(false);
  }, []);

  const handleSignOut = async () => {
    await getPageAuthRef().signOut?.();
  };

  const refreshLiveEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/shows");
      const data = await res.json();
      if (Array.isArray(data.shows)) setLiveEvents(data.shows);
    } catch {}
  }, []);

  const getDaysInMonth     = (m, y) => new Date(y, m+1, 0).getDate();
  const getFirstDayOfMonth = (m, y) => new Date(y, m, 1).getDay();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const getShowsForDay = day => liveEvents.filter(s => { const d=new Date(s.date+"T12:00:00"); return d.getFullYear()===calYear && d.getMonth()===calMonth && d.getDate()===day; });
  const prevMonth = () => { if (calMonth===0) { setCalMonth(11); setCalYear(calYear-1); } else setCalMonth(calMonth-1); };
  const nextMonth = () => { if (calMonth===11) { setCalMonth(0); setCalYear(calYear+1); } else setCalMonth(calMonth+1); };

  const readAccountCircleByline = () => {
    const u = getPageAuthRef().currentUser;
    return (u?.name?.trim() || u?.email || "Anonymous").trim();
  };

  const handleAddComment = postId => {
    if (!blogComment.trim()) return;
    const u = getPageAuthRef().currentUser;
    const name = u ? readAccountCircleByline() : "Anonymous";
    setBlogComments(p => ({ ...p, [postId]: [...(p[postId]||[]), { name, text:blogComment, time:new Date().toLocaleString() }] }));
    setBlogComment("");
  };
  const handleCircleSubmit = () => {
    if (!circleQuestion.trim()) return;
    const u = getPageAuthRef().currentUser;
    const name = u ? readAccountCircleByline() : "Anonymous";
    const sub  = { id:`sub-${Date.now()}`, text:circleQuestion, category:circleCategory, by:name, time:new Date().toLocaleString() };
    const upd  = [sub, ...circleSubmissions];
    setCircleSubmissions(upd); localStorage.setItem("2mrrw_circle", JSON.stringify(upd));
    setCircleQuestion(""); setCircleSubmitted(true); setTimeout(() => setCircleSubmitted(false), 3500);
  };

  const closeMobileNav = useCallback(() => {
    if (!mobileNavOpenRef.current || mobileNavClosingRef.current) return;
    setMobileNavClosing(true);
  }, []);

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

  const switchTab = useCallback((tabId) => {
    if (tabId === "cards") {
      router.push(COLLECTORS_CARDS_ROUTE);
      return;
    }
    const previousTab = activeTabIdentityRef.current;
    if (previousTab === tabId) return;
    tabScrollPositionsRef.current.set(
      previousTab,
      mainScrollRef.current?.scrollTop ?? 0
    );
    if (previousTab === "home") {
      homeSinglesScrollLeftRef.current = singlesRowRef.current?.scrollLeft ?? 0;
    }
    activeTabIdentityRef.current = tabId;
    // phase11: startTransition — non-urgent UI update
    startTransition(() => {
      setActiveTab(tabId);
      const navGroupByTab = {
        singles: "g-music",
        albums: "g-music",
        mixtapes: "g-music",
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
      // Read isMobileRef instead of isMobile state — keeps this callback stable
      // with [] deps while still seeing the current mobile breakpoint at call time.
      if (isMobileRef.current) {
        setMobileNavOpen(false);
        setMobileNavClosing(false);
        setMobileNavExpandedGroups(new Set());
      }
    });
  }, [setActiveTab]);

  const openCollection = useCallback(() => {
    switchTab("mymusic");
  }, [switchTab]);

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
  }, [router]);

  const switchMusicSubTab = sub => {
    // phase11: startTransition — browse sub-tab switch
    startTransition(() => {
      setMusicSubTab(sub);
    });
  };

  const shopItems      = useMemo(() => printfulProducts.length > 0 ? printfulProducts : fallbackMerch, [printfulProducts]);
  const shopIsFallback = useMemo(() => !printfulLoading && printfulProducts.length === 0, [printfulLoading, printfulProducts]);

  const currentSlide   = useMemo(() => enrichedRadioSlides[radioIndex], [enrichedRadioSlides, radioIndex]);
  const handleDonateOpen = useCallback(() => setDonateOpen(true), []);

  const exclusiveItems = useMemo(() => exclusiveCatalog.map(item => ({
    ...item,
    stock: inventory[item.slug] !== undefined ? inventory[item.slug] : REAL_INVENTORY[item.slug],
  })), [exclusiveCatalog, inventory]);


  const stockLabel = (item) => {
    if (item.stock === null || item.stock === undefined) return null;
    if (item.stock <= 0) return "SOLD OUT";
    return `${item.stock} remaining`;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
      <PageAuthRefSync />
      <PageAuthDeepLinkHandler
        singles={singles}
        albums={albums}
        displayFeatures={getCatalogSurfaceRef().displayFeatures}
        switchTab={switchTab}
        openSingleModal={openSingleModal}
        openAlbumModal={openAlbumModal}
        openFeatureModal={openFeatureModal}
      />
      <PageAuthCheckoutPendingEffect onCheckout={handleCheckout} />
      <div ref={cursorRef} style={{position:"fixed",width:28,height:28,borderRadius:"50%",background:"radial-gradient(circle,rgba(0,255,255,0.22) 0%,transparent 70%)",pointerEvents:"none",transform:"translate(-50%,-50%)",zIndex:99999,mixBlendMode:"screen",transition:"left 0.045s linear,top 0.045s linear",display:isMobile?"none":undefined}}/>
      <div ref={cursorTrailRef} style={{position:"fixed",width:16,height:16,borderRadius:"50%",background:"radial-gradient(circle,rgba(0,255,255,0.10) 0%,transparent 70%)",pointerEvents:"none",transform:"translate(-50%,-50%)",zIndex:99998,mixBlendMode:"screen",transition:"left 0.18s ease,top 0.18s ease",display:isMobile?"none":undefined}}/>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,background:"radial-gradient(circle at 18% 18%,rgba(0,255,255,0.026) 0%,transparent 55%),radial-gradient(circle at 82% 80%,rgba(162,89,255,0.018) 0%,transparent 52%)"}}/>
      {/* ── IMMERSIVE MODALS (entitlement + auth islands — not hero) ── */}
      <EntitlementSurfaceIsland islandId="immersive-modals">
        {(ent) => (
          <AuthSurfaceIsland islandId="immersive-modals" onGiftRequest={setGiftSheetRelease}>
            {(auth) => (
              <>
                <AnimatePresence>
                  {previewModalOpen && selectedSingle && (
                    <ModalErrorBoundary
                      stackId="immersive-preview-modal"
                      onClose={closeSingleModal}
                      resetKey={selectedSingle?.slug || selectedSingle?.id || "preview"}
                    >
                      <ImmersivePreviewModal
                        key="immersive-preview-modal"
                        single={selectedSingle}
                        releaseDetail={selectedReleaseDetail}
                        isMobile={isMobile}
                        access={
                          resolveTrackAccess(selectedSingle, ent.entitlementAccountState)?.canStream
                            ? "full"
                            : "preview"
                        }
                        userId={auth.userId}
                        isAdmin={auth.isAdminStable}
                        onGift={makePreviewGiftHandler(auth.openGiftSheet, selectedSingle)}
                        onLibraryChange={auth.handleLibraryChange}
                        onClose={closeSingleModal}
                        onAddToCart={addToCart}
                        onAddVinyl={addVinylToCart}
                      />
                    </ModalErrorBoundary>
                  )}
                  {featureModalOpen && featureModalItem && (
                    <ModalErrorBoundary
                      stackId="immersive-feature-modal"
                      onClose={closeFeatureModal}
                      resetKey={featureModalItem?.slug || featureModalItem?.id || "feature"}
                    >
                      <ImmersivePreviewModal
                        key="immersive-feature-modal"
                        single={featureModalItem}
                        releaseDetail={featureReleaseDetail}
                        isMobile={isMobile}
                        access={
                          resolveTrackAccess(featureModalItem, ent.entitlementAccountState)?.canStream
                            ? "full"
                            : "preview"
                        }
                        userId={auth.userId}
                        isAdmin={auth.isAdminStable}
                        onGift={makePreviewGiftHandler(auth.openGiftSheet, featureModalItem)}
                        onLibraryChange={auth.handleLibraryChange}
                        onClose={closeFeatureModal}
                        onAddToCart={addToCart}
                        onAddVinyl={addVinylToCart}
                      />
                    </ModalErrorBoundary>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {albumModalOpen && selectedAlbum && (
                    <ModalErrorBoundary
                      stackId="immersive-album-modal"
                      onClose={closeAlbumModal}
                      resetKey={selectedAlbum?.slug || selectedAlbum?.id || "album"}
                    >
                      <AlbumModal
                        key={selectedAlbum.slug || selectedAlbum.id || "album"}
                        album={normalizedSelectedAlbum}
                        access={
                          resolveTrackAccess(selectedAlbum, ent.entitlementAccountState)?.canStream
                            ? "full"
                            : "preview"
                        }
                        onClose={closeAlbumModal}
                        onPlayTrackAtIndex={playAlbumModalTrackAtIndex}
                        otherReleases={[...albums, ...mixtapesAndEps].filter(r => r.slug !== selectedAlbum?.slug)}
                        onReleaseClick={openAlbumModal}
                      />
                    </ModalErrorBoundary>
                  )}
                </AnimatePresence>
              </>
            )}
          </AuthSurfaceIsland>
        )}
      </EntitlementSurfaceIsland>



      {/* ── TICKET MODAL ── */}
      {selectedEvent && (
        <div onClick={()=>setSelectedEvent(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:8888,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?16:0}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#111",border:"1px solid #222",borderRadius:20,padding:30,width:isMobile?"100%":360,maxWidth:isMobile?"calc(100vw - 32px)":"none",display:"flex",flexDirection:"column",gap:14}}>
            <div style={{fontSize:20,fontWeight:800,letterSpacing:2}}>{selectedEvent.name}</div>
            <div style={{fontSize:13,color:"#aaa"}}>{selectedEvent.location}</div>
            <div style={{fontSize:13,color:"#aaa"}}>{new Date(selectedEvent.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}{selectedEvent.time ? ` · ${_fmtEventTime(selectedEvent.date, selectedEvent.time, selectedEvent.venueTz)}` : ""}</div>
            <div style={{fontSize:22,fontWeight:900,color:"#00ffff"}}>${selectedEvent.price.toFixed(2)}</div>
            {selectedEvent.tickets === 0 ? (
              <div style={{fontSize:12,color:"#ef4444",fontWeight:700,letterSpacing:2}}>SOLD OUT</div>
            ) : selectedEvent.tickets != null ? (
              <div style={{fontSize:12,color:"#555"}}>{selectedEvent.tickets} ticket{selectedEvent.tickets!==1?"s":""} remaining</div>
            ) : null}
            {selectedEvent.tickets === 0 ? (
              <button disabled style={{width:"100%",padding:"12px 0",background:"#1a1a1a",color:"#444",fontWeight:"bold",border:"1px solid #2a2a2a",borderRadius:8,cursor:"not-allowed",fontSize:14}}>Sold Out</button>
            ) : (
              <TicketCheckoutButton event={selectedEvent} onClose={()=>setSelectedEvent(null)} />
            )}
            <button onClick={()=>setSelectedEvent(null)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:12,textAlign:"center"}}>Close</button>
          </div>
        </div>
      )}

      {/* ── EXCLUSIVE / VAULT MODAL ── */}
      {exclusiveModal && (
        <div onClick={()=>setExclusiveModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:8888,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?16:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0d0d0d",border:`1px solid ${exclusiveModal.badgeColor}33`,borderRadius:24,padding:isMobile?20:32,width:isMobile?"100%":380,maxWidth:isMobile?"calc(100vw - 32px)":"none",maxHeight:"88vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:16,boxShadow:`0 0 60px ${exclusiveModal.badgeColor}22`}}>
            <div style={{position:"relative"}}><img src={exclusiveModal.cover} alt={exclusiveModal.title || ""} style={{width:"100%",height:200,borderRadius:14,objectFit:"cover",display:"block"}}/><div style={{position:"absolute",top:12,left:12,background:exclusiveModal.badgeColor,color:"#000",fontSize:10,fontWeight:900,letterSpacing:2,padding:"4px 10px",borderRadius:20}}>{exclusiveModal.badge}</div></div>
            <div style={{fontSize:20,fontWeight:900,letterSpacing:1}}>{exclusiveModal.title}</div>
            <div style={{fontSize:12,color:"#555",letterSpacing:1}}>{exclusiveModal.subtitle}</div>
            <div style={{fontSize:13,color:"#999",lineHeight:1.8}}>{exclusiveModal.description}</div>
            <div style={{borderTop:"1px solid #1e1e1e",paddingTop:16}}>
              <div style={{fontSize:11,color:"#555",letterSpacing:2,marginBottom:10,textTransform:"uppercase"}}>What&apos;s Included</div>
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
      <PlaybackChromeIsland
        isMobile={isMobile}
        ambientRefs={ambientRefs}
      >
      <div style={{display:"flex",flexDirection:isMobile?"column":"row",height:"calc(100dvh - var(--player-bar-inset, 0px))",overflow:"hidden",maxWidth:"100vw",overflowX:"hidden",background:"#050505",color:"white",position:"relative",zIndex:1,fontFamily:"'Helvetica Now','Helvetica Neue',Helvetica,Arial,sans-serif"}}>
        {/* ── DESKTOP SIDEBAR ── */}
        {!isMobile && (
          <div style={{width:220,flexShrink:0,borderRight:"1px solid #141414",background:"rgba(4,4,4,0.9)",backdropFilter:"blur(20px)",display:"flex",flexDirection:"column",height:"100%",overflowY:"auto",boxShadow:"2px 0 32px rgba(0,0,0,0.5)"}}>
            <div style={{padding:"22px 18px 18px",borderBottom:"1px solid #111",flexShrink:0}}>
              <div style={{fontSize:20,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 24px rgba(0,255,255,0.45)",marginBottom:4}}>2MRRW</div>
              <PageAuthSidebarBadge
                circleSubmissions={circleSubmissions}
                accountCircleByline={readAccountCircleByline()}
              />
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
              <AdminManageReleasesNavItem activeTab={activeTab} onSwitch={switchTab} />
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
            data-main-scroll
            style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:0,WebkitOverflowScrolling:"touch"}}
          >
            <HeroIsland
              isMobile={isMobile}
              heroContainerRef={heroContainerRef}
              heroVideoRef={heroVideoRef}
              heroTextRef={heroTextRef}
              heroSocialsRef={heroSocialsRef}
            />
            <ScrollPaddingShell isMobile={isMobile}>
            <div data-tab-panel>

              {/* ══ HOME (Phase 17A/17B: persist mount + render islands) ══ */}
              <div
                data-home-storefront
                style={{ display: activeTab === "home" ? undefined : "none" }}
                aria-hidden={activeTab !== "home"}
              >
                <HomeStorefrontIsland
                  onGiftRequest={setGiftSheetRelease}
                  liveCountdownTarget={nextLiveDateTime}
                  isMobile={isMobile}
                  onDonateOpen={handleDonateOpen}
                  singlesRowRef={singlesRowRef}
                  onCardClick={openSingleModal}
                  addToCart={addToCart}
                  liveStreamDate={liveStreamDate}
                  liveStreamTime={liveStreamTime}
                  onOpenFeature={openFeatureModal}
                  albums={albums}
                  hoverIn={hoverIn}
                  hoverOut={hoverOut}
                  buttonHoverIn={buttonHoverIn}
                  buttonHoverOut={buttonHoverOut}
                  onAlbumClick={openAlbumModal}
                  onPlayAlbum={playAlbumCard}
                  onOpenAlbumTracklist={setAlbumTracklistRelease}
                  mixtapesAndEps={mixtapesAndEps}
                  onPlayMixtapeEp={playMixtapeEpCard}
                  onPlaySingle={playSinglesQueue}
                  onPlayFeature={playFeaturesQueue}
                  currentSlide={currentSlide}
                  enrichedRadioSlides={enrichedRadioSlides}
                  radioIndex={radioIndex}
                  onGoRadio={goRadio}
                  flowConversionActive={flowConversionActive}
                  onFlowConversionActive={setFlowConversionActive}
                  onAudioVisualsFocused={handleAudioVisualsFocused}
                  onAudioVisualsExit={handleAudioVisualsExit}
                  shopItems={shopItems}
                  printfulLoading={printfulLoading}
                  shopIsFallback={shopIsFallback}
                  events={liveEvents}
                  onSelectEvent={setSelectedEvent}
                  onOpenCollection={openCollection}
                />
              </div>

              {/* ══ MUSIC TAB ══ */}
              <div
                data-persistent-tab-group="music"
                aria-hidden={!(activeTab==="singles"||activeTab==="albums"||activeTab==="mixtapes"||activeTab==="mymusic")}
                inert={!(activeTab==="singles"||activeTab==="albums"||activeTab==="mixtapes"||activeTab==="mymusic") ? true : undefined}
                style={{display:(activeTab==="singles"||activeTab==="albums"||activeTab==="mixtapes"||activeTab==="mymusic") ? undefined : "none"}}
              >
                <EntitlementSurfaceIsland islandId="music-tab">
                  {(ent) => (
                    <AuthSurfaceIsland islandId="music-tab" onGiftRequest={setGiftSheetRelease}>
                      {(auth) => (
                <>
                  {/* Search bar */}
                  <div style={{marginTop:12,marginBottom:12,position:"relative"}}>
                    <input
                      type="search"
                      placeholder="Search tracks, albums…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:isMobile?"11px 40px 11px 14px":"12px 44px 12px 16px",color:"#fff",fontSize:isMobile?14:15,outline:"none",WebkitAppearance:"none",appearance:"none"}}
                    />
                    {searchQuery ? (
                      <button type="button" onClick={()=>setSearchQuery("")} aria-label="Clear search" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"rgba(255,255,255,0.45)",fontSize:18,cursor:"pointer",padding:"4px 6px",lineHeight:1}}>✕</button>
                    ) : (
                      <span aria-hidden style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,0.25)",pointerEvents:"none",fontSize:16}}>⌕</span>
                    )}
                  </div>

                  {/* Search results */}
                  {searchQuery.trim() ? (
                    <div style={{marginBottom:32}}>
                      {searchResults.length === 0 ? (
                        <div style={{padding:"40px 0",textAlign:"center",color:"rgba(255,255,255,0.25)",fontSize:14}}>No results for &ldquo;{searchQuery}&rdquo;</div>
                      ) : (
                        <>
                          <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",marginBottom:12}}>{searchResults.length} result{searchResults.length!==1?"s":""}</div>
                          {searchResults.map((r,i)=>(
                            <button key={`${r.type}-${r.slug}-${i}`} type="button"
                              onClick={()=>{
                                setSearchQuery("");
                                if(r.type==="single") openSingleModal(r.item);
                                else if(r.type==="album") openAlbumModal(r.item);
                                else if(r.type==="track") openAlbumModal(r.album);
                              }}
                              style={{display:"flex",alignItems:"center",gap:12,width:"100%",background:"none",border:"none",borderBottom:"1px solid rgba(255,255,255,0.05)",padding:"10px 4px",cursor:"pointer",textAlign:"left"}}
                            >
                              {r.cover && <img src={r.cover} alt="" width={40} height={40} style={{borderRadius:6,objectFit:"cover",flexShrink:0}} />}
                              <div style={{minWidth:0,flex:1}}>
                                <div style={{color:"#fff",fontSize:isMobile?13:14,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.title}</div>
                                <div style={{color:"rgba(255,255,255,0.4)",fontSize:11,marginTop:2}}>
                                  {r.type==="track"?`Track · ${r.albumTitle}`:r.type==="album"?"Album":"Single"}
                                </div>
                              </div>
                              <span style={{color:"rgba(255,255,255,0.2)",fontSize:11,flexShrink:0}}>▶</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                  <div style={{marginTop:8,marginBottom:0}}>
                    <div style={{display:"flex",gap:0,borderBottom:"1px solid #1a1a1a",marginBottom:24}}>
                      {[{id:"singles",label:"Singles"},{id:"albums",label:"Albums"},{id:"mixtapes",label:"Mixtapes & EPs"},{id:"mymusic",label:"Collection"}].map(sub=>(
                        <button key={sub.id} onClick={()=>switchTab(sub.id)} style={{padding:isMobile?"11px 16px":"12px 22px",background:"none",border:"none",borderBottom:activeTab===sub.id?"2px solid #00ffff":"2px solid transparent",color:activeTab===sub.id?"#00ffff":"#555",fontSize:isMobile?12:13,fontWeight:700,letterSpacing:1.5,cursor:"pointer",transition:"all 0.18s",textTransform:"uppercase",marginBottom:-1}}>
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <MusicTabCatalogPanels
                    activeTab={activeTab}
                    isMobile={isMobile}
                    singleIndex={singleIndex}
                    goToSingle={goToSingle}
                    handleSingleClick={handleSingleClick}
                    addToCart={addToCart}
                    addVinylToCart={addVinylToCart}
                    buttonHoverIn={buttonHoverIn}
                    buttonHoverOut={buttonHoverOut}
                    openFeatureModal={openFeatureModal}
                    openAlbumModal={openAlbumModal}
                    setAlbumTracklistRelease={setAlbumTracklistRelease}
                    albums={albums}
                    mixtapesAndEps={mixtapesAndEps}
                    hoverIn={hoverIn}
                    hoverOut={hoverOut}
                    giftHighlightSlug={giftHighlightSlug}
                    switchTab={switchTab}
                    openSingleModal={openSingleModal}
                    handleAudioVisualsFocused={handleAudioVisualsFocused}
                    handleAudioVisualsExit={handleAudioVisualsExit}
                    entitlementAccountState={ent.entitlementAccountState}
                    userId={auth.userId}
                    isAdminStable={auth.isAdminStable}
                    openGiftSheet={auth.openGiftSheet}
                    handleLibraryChange={auth.handleLibraryChange}
                    onPlayAlbum={playAlbumCard}
                  />
                    </>
                  )}
                </>
                      )}
                    </AuthSurfaceIsland>
                  )}
                </EntitlementSurfaceIsland>
              </div>

              {/* ══ SHOP ══ */}
              <PersistentTabMount id="shop" active={activeTab==="shop"}>
                <>
                  <h2 className="section-heading" style={{marginBottom:16}}>Merch</h2>
                  {printfulLoading ? <div style={{padding:"60px 0",textAlign:"center",fontSize:13,color:"#333",letterSpacing:2}}>Loading products…</div> : (
                    <>
                      {shopIsFallback && <div style={{marginBottom:20,padding:"12px 16px",background:"rgba(255,255,255,0.02)",border:"1px solid #1a1a1a",borderRadius:10,fontSize:11,color:"#444",letterSpacing:1,lineHeight:1.7}}>Store inventory is syncing. Showing preview items — check back soon for the full Printful catalog.</div>}
                      <CatalogGrid items={shopItems} type="products" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} isMobile={isMobile}/>
                    </>
                  )}
                </>
              </PersistentTabMount>

              {/* ══ VAULT ══ */}
              <PersistentTabMount id="vault" active={activeTab==="vault"}>
                <>
                  <h2 className="section-heading">Vault</h2>
                  <div style={{marginTop:28,background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:isMobile?14:20,padding:isMobile?"36px 24px":"48px 40px",textAlign:"center",maxWidth:520}}>
                    <p style={{fontSize:13,color:"#555",letterSpacing:1,lineHeight:1.8,margin:0}}>The Vault remains empty for now. Exclusive drops will be listed here when they launch.</p>
                  </div>
                </>
              </PersistentTabMount>

              {/* ══ SHOWS ══ */}
              <AuthSurfaceIsland islandId="shows-tab">
                {(auth) => (
                  <PersistentTabMount id="shows" active={activeTab==="shows"}>
                  <>
                    <h2 className="section-heading" style={{marginBottom:20}}>Shows & Events</h2>

                    {auth.isAdminStable && (
                      <InlineShowsAdmin onRefreshFanView={refreshLiveEvents} />
                    )}

                    <div style={{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:20,padding:isMobile?12:24,marginBottom:30}}>
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

                    <h2 style={{letterSpacing:3,fontSize:14,color:"#555",marginBottom:16,textTransform:"uppercase"}}>Upcoming Events</h2>
                    {liveEvents.length === 0 && (
                      <div style={{color:"#555",fontSize:13,letterSpacing:1,padding:"24px 0"}}>No upcoming shows scheduled.</div>
                    )}
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      {liveEvents.map(evt=>{
                        const soldOut = evt.tickets === 0;
                        return (
                          <div key={evt.id} style={{background:"#0e0e0e",border:`1px solid ${soldOut?"#2a1a1a":"#1e1e1e"}`,borderRadius:14,padding:isMobile?"14px":"18px 20px",display:"flex",alignItems:isMobile?"flex-start":"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",opacity:soldOut?0.7:1}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                                <div style={{fontWeight:700,fontSize:isMobile?13:15}}>{evt.name}</div>
                                {soldOut && <div style={{fontSize:9,fontWeight:900,letterSpacing:2,padding:"2px 8px",borderRadius:20,background:"rgba(239,68,68,0.12)",color:"#ef4444",border:"1px solid rgba(239,68,68,0.25)"}}>SOLD OUT</div>}
                              </div>
                              <div style={{fontSize:12,color:"#aaa"}}>{evt.location}</div>
                              <div style={{fontSize:11,color:"#555",marginTop:2}}>{new Date(evt.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"})}{evt.time ? ` · ${_fmtEventTime(evt.date, evt.time, evt.venueTz)}` : ""}</div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:isMobile?10:14}}>
                              <div style={{fontSize:isMobile?15:18,fontWeight:900,color:soldOut?"#555":"#00ffff"}}>${evt.price.toFixed(2)}</div>
                              <button
                                onClick={()=>!soldOut&&setSelectedEvent(evt)}
                                disabled={soldOut}
                                onMouseEnter={soldOut?null:buttonHoverIn}
                                onMouseLeave={soldOut?null:buttonHoverOut}
                                style={{padding:isMobile?"9px 14px":"10px 20px",background:soldOut?"#111":"#111",color:soldOut?"#444":"white",border:`1px solid ${soldOut?"#2a2a2a":"#333"}`,borderRadius:8,cursor:soldOut?"not-allowed":"pointer",fontWeight:"bold",fontSize:isMobile?12:13,transition:"0.25s"}}
                              >{soldOut?"Sold Out":"Get Tickets"}</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {auth.userId && <MyTicketsPanel userId={auth.userId} />}
                  </>
                  </PersistentTabMount>
                )}
              </AuthSurfaceIsland>

              {/* ══ LIVE ══ */}
              <AuthSurfaceIsland islandId="live-tab">
                {(auth) => (
                  <PersistentTabMount id="live" active={activeTab==="live"}>
                  <>
                    <h2 className="section-heading">2MRRW LIVE</h2>
                    {auth.isAdminStable && <InlineLiveAdmin />}
                    <LiveCountdownProvider targetDate={nextLiveDateTime}>
                      <LiveCountdownLiveTab
                        isMobile={isMobile}
                        liveStreamDate={liveStreamDate}
                        liveStreamTime={liveStreamTime}
                      />
                    </LiveCountdownProvider>
                  </>
                  </PersistentTabMount>
                )}
              </AuthSurfaceIsland>

              {/* ══ HELP & SUPPORT ══ */}
              <PersistentTabMount id="help" active={activeTab==="help"}>
                <PageAuthHelpSupport />
              </PersistentTabMount>

              {/* ══ BLOG ══ */}
              <PersistentTabMount id="blog" active={activeTab==="blog"}>
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
              </PersistentTabMount>

              {/* ══ VISION ══ */}
              <PersistentTabMount id="vision" active={activeTab==="vision"}>
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
              </PersistentTabMount>

              {/* ══ CIRCLE ══ */}
              <PersistentTabMount id="circle" active={activeTab==="circle"}>
                <PageAuthSessionBridge circleSubmissions={circleSubmissions} accountCircleByline={readAccountCircleByline()}>
                {(pa) => (
                <>
                  <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:6,flexWrap:"wrap"}}>
                    <h2 className="section-heading" style={{margin:0}}>The Circle</h2>
                    {pa.userStatus && <div style={{fontSize:10,fontWeight:900,letterSpacing:2,padding:"3px 10px",borderRadius:20,background:pa.userStatus.glow+"22",color:pa.userStatus.color,border:`1px solid ${pa.userStatus.color}44`,boxShadow:`0 0 10px ${pa.userStatus.glow}`}}>{pa.userStatus.label}</div>}
                  </div>
                  <p style={{fontSize:13,color:"#444",marginBottom:28,lineHeight:1.8}}>This is not a comment section. It&apos;s a direct line. Ask 2MRRW anything. Share what the music means to you. Selected submissions receive an official response.</p>
                  <div style={{background:"#0d0d0d",border:"1px solid #1e1e1e",borderRadius:20,padding:isMobile?20:28,marginBottom:32}}>
                    <div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>Ask 2MRRW</div>
                    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>{["question","thought","feedback","message"].map(cat=><button key={cat} onClick={()=>setCircleCategory(cat)} style={{padding:"6px 12px",fontSize:11,fontWeight:700,letterSpacing:1,cursor:"pointer",border:circleCategory===cat?"1px solid #00ffff":"1px solid #2a2a2a",borderRadius:20,background:circleCategory===cat?"rgba(0,255,255,0.1)":"transparent",color:circleCategory===cat?"#00ffff":"#555",textTransform:"uppercase",transition:"0.2s"}}>{cat}</button>)}</div>
                    <textarea placeholder="Write your question or message…" value={circleQuestion} onChange={e=>setCircleQuestion(e.target.value)} rows={4} style={{width:"100%",padding:"12px 14px",background:"#0a0a0a",border:"1px solid #2a2a2a",color:"white",borderRadius:12,fontSize:14,resize:"vertical",outline:"none",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.7}}/>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:12,flexWrap:"wrap",gap:8}}>
                      <div style={{fontSize:12,color:"#444"}}>{pa.currentUser?`Posting as ${pa.currentUser.name}`:"Posting anonymously"}</div>
                      <button onClick={handleCircleSubmit} style={{padding:"10px 24px",background:circleSubmitted?"#1a3a1a":"#00ffff",color:circleSubmitted?"#00ff88":"#000",fontWeight:900,border:"none",borderRadius:10,cursor:"pointer",fontSize:13,transition:"0.3s",letterSpacing:1}}>{circleSubmitted?"✓ Submitted":"Submit"}</button>
                    </div>
                    {circleSubmitted && <div style={{marginTop:12,fontSize:12,color:"#00ff88"}}>Your message was received. If selected, 2MRRW will respond here in the archive.</div>}
                  </div>
                  <div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>2MRRW Responses</div>
                  <div style={{display:"flex",flexDirection:"column",gap:16,marginBottom:36}}>
                    {circleResponses.map(resp=>(
                      <div key={resp.id} style={{background:resp.highlight?"linear-gradient(135deg,#0d0d0d,#111)":"#0a0a0a",border:resp.highlight?`1px solid ${resp.tagColor}33`:"1px solid #1a1a1a",borderRadius:18,padding:isMobile?18:24,boxShadow:resp.highlight?`0 0 30px ${resp.tagColor}10`:"none"}}>
                        <div style={{marginBottom:16}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><div style={{width:28,height:28,borderRadius:"50%",background:"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#555",fontWeight:700,flexShrink:0}}>{resp.questionBy[0]}</div><div><div style={{fontSize:12,fontWeight:700,color:"#aaa"}}>{resp.questionBy}</div><div style={{fontSize:10,color:"#444"}}>{resp.questionTime}</div></div></div><div style={{fontSize:14,color:"#888",lineHeight:1.7,fontStyle:"italic"}}>&quot;{resp.question}&quot;</div></div>
                        <div style={{borderTop:"1px solid #1a1a1a",paddingTop:16}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><div style={{fontSize:11,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 10px rgba(0,255,255,0.5)"}}>2MRRW</div><div style={{fontSize:10,fontWeight:900,letterSpacing:1,padding:"2px 8px",borderRadius:10,background:resp.tagColor+"22",color:resp.tagColor,border:`1px solid ${resp.tagColor}44`}}>{resp.tag}</div></div><div style={{fontSize:14,color:"#ccc",lineHeight:1.9}}>{resp.response}</div></div>
                      </div>
                    ))}
                  </div>
                  <div style={{background:"linear-gradient(135deg,#0a0a14,#0d0d0d)",border:"1px solid #1a1a2a",borderRadius:20,padding:isMobile?"20px":"28px 30px"}}>
                    <div style={{fontSize:11,color:"#444",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>Community Status</div>
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
                      {[{label:"EARLY SUPPORTER",color:"#aaa",desc:"Joined the ecosystem early."},{label:"COLLECTOR",color:"#ff6b35",desc:"Purchased a collector card or bundle."},{label:"VISIONARY",color:"#00ffff",desc:"3+ Circle submissions."},{label:"INNER CIRCLE",color:"#a259ff",desc:"Collector + Circle member."}].map(s=><div key={s.label} style={{padding:"14px",background:"#080808",borderRadius:14,border:`1px solid ${s.color}22`}}><div style={{fontSize:9,fontWeight:900,letterSpacing:2,color:s.color,marginBottom:6}}>{s.label}</div><div style={{fontSize:11,color:"#555",lineHeight:1.6}}>{s.desc}</div></div>)}
                    </div>
                    {pa.userStatus && <div style={{marginTop:20,padding:"14px 18px",background:pa.userStatus.glow+"10",borderRadius:12,border:`1px solid ${pa.userStatus.color}33`,display:"flex",alignItems:"center",gap:12}}><div style={{fontSize:10,color:"#555"}}>Your status:</div><div style={{fontSize:11,fontWeight:900,letterSpacing:2,color:pa.userStatus.color}}>{pa.userStatus.label}</div></div>}
                  </div>
                </>
                )}
                </PageAuthSessionBridge>
              </PersistentTabMount>

              {/* ══ INNER CIRCLE ══ */}
              <PersistentTabMount id="innercircle" active={activeTab==="innercircle"}>
                <PageAuthSessionBridge circleSubmissions={circleSubmissions} accountCircleByline={readAccountCircleByline()}>
                {(pa) => (
                <>
                  {pa.userStatus?.label !== "INNER CIRCLE" ? (
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",padding:isMobile?"40px 16px":"60px 20px"}}>
                      <div style={{fontSize:56,lineHeight:1,marginBottom:24,filter:"drop-shadow(0 0 24px rgba(162,89,255,0.5))",animation:"pulse 3s infinite"}}>🔒</div>
                      <div style={{fontSize:11,color:"#a259ff",letterSpacing:4,marginBottom:12,fontWeight:700}}>RESTRICTED ACCESS</div>
                      <div style={{fontSize:isMobile?20:24,fontWeight:900,letterSpacing:1,marginBottom:14}}>Inner Circle Access Required</div>
                      <div style={{fontSize:14,color:"#555",maxWidth:400,lineHeight:1.9,marginBottom:36}}>This section is reserved for verified Inner Circle members — those who own a piece of the music and are active in the conversation.</div>
                      <div style={{width:"100%",maxWidth:460,display:"flex",flexDirection:"column",gap:12,marginBottom:32}}>
                        <div style={{fontSize:11,color:"#a259ff",letterSpacing:3,marginBottom:4,fontWeight:700}}>HOW TO UNLOCK</div>
                        {[{label:"Own a Collector Card or Bundle",done:pa.myPurchases.some(p=>p.slug?.startsWith("exc-card")||p.slug?.startsWith("exc-bundle")),link:"cards",linkLabel:"Collector's Cards →"},{label:"Submit to The Circle",done:circleSubmissions.filter(s=>s.by===pa.currentUser?.name).length>=1,link:"circle",linkLabel:"Go to Circle →"}].map((step,i)=>(
                          <div key={i} style={{padding:"16px 20px",background:step.done?"rgba(162,89,255,0.06)":"#0d0d0d",border:`1px solid ${step.done?"rgba(162,89,255,0.3)":"#1e1e1e"}`,borderRadius:14,display:"flex",alignItems:"center",gap:14,textAlign:"left"}}>
                            <div style={{width:28,height:28,borderRadius:"50%",background:step.done?"rgba(162,89,255,0.2)":"#111",border:`1px solid ${step.done?"#a259ff":"#222"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:step.done?"#a259ff":"#333",flexShrink:0}}>{step.done?"✓":i+1}</div>
                            <div style={{flex:1,fontSize:13,color:step.done?"#a259ff":"#666",fontWeight:step.done?700:400}}>{step.label}</div>
                            {!step.done && <button onClick={()=>switchTab(step.link)} style={{padding:"6px 14px",background:"rgba(162,89,255,0.1)",border:"1px solid rgba(162,89,255,0.25)",borderRadius:8,color:"#a259ff",cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{step.linkLabel}</button>}
                          </div>
                        ))}
                      </div>
                      {pa.userStatus && <div style={{fontSize:12,color:"#444"}}>Current status: <span style={{color:pa.userStatus.color,fontWeight:700}}>{pa.userStatus.label}</span></div>}
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
                          <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:6,flexWrap:"wrap"}}><h2 className="section-heading" style={{margin:0}}>Inner Circle</h2>{pa.userStatus&&<div style={{fontSize:10,fontWeight:900,letterSpacing:2,padding:"3px 10px",borderRadius:20,background:"rgba(162,89,255,0.12)",color:"#a259ff",border:"1px solid rgba(162,89,255,0.3)"}}>{pa.userStatus.label}</div>}</div>
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
                </PageAuthSessionBridge>
              </PersistentTabMount>

              {/* ══ ACCOUNT ══ */}
              <PersistentTabMount id="account" active={activeTab==="account"}>
                <PageAuthSessionBridge circleSubmissions={circleSubmissions} accountCircleByline={readAccountCircleByline()}>
                {(pa) => (
                <>
                  <h2 className="section-heading">Account</h2>
                  {pa.currentUser ? (
                    <div style={{display:"flex",flexDirection:"column",gap:20}}>
                      <div style={{background:"#0d0d0d",border:"1px solid #1e1e1e",borderRadius:20,padding:isMobile?20:28}}>
                        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20,flexWrap:"wrap"}}><div style={{width:56,height:56,borderRadius:"50%",background:"linear-gradient(135deg,#00ffff22,#a259ff22)",border:"1px solid #333",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:900,color:"#00ffff",flexShrink:0}}>{pa.accountDisplayInitial}</div><div><div style={{fontSize:18,fontWeight:800}}>{pa.accountDisplayName}</div><div style={{fontSize:13,color:"#555",marginTop:2}}>{pa.currentUser?.email || "—"}</div></div>{pa.userStatus&&<div style={{marginLeft:isMobile?0:"auto",fontSize:10,fontWeight:900,letterSpacing:2,padding:"4px 12px",borderRadius:20,background:pa.userStatus.glow+"22",color:pa.userStatus.color,border:`1px solid ${pa.userStatus.color}44`}}>{pa.userStatus.label}</div>}</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>{[{label:"Purchases",value:pa.myPurchases.length},{label:"Circle Posts",value:circleSubmissions.filter(s=>s.by===pa.accountCircleByline||s.by===pa.currentUser?.name).length},{label:"Member Since",value:"2026"}].map(stat=><div key={stat.label} style={{padding:"14px 10px",background:"#080808",borderRadius:12,border:"1px solid #1a1a1a",textAlign:"center"}}><div style={{fontSize:isMobile?20:24,fontWeight:900,color:"#00ffff"}}>{stat.value}</div><div style={{fontSize:isMobile?9:11,color:"#555",marginTop:4,letterSpacing:1}}>{stat.label}</div></div>)}</div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{[{label:"My Collection",tab:"mymusic",color:"#00ffff"},{label:"Vault Drops",tab:"vault",color:"#a259ff"},{label:"The Circle",tab:"circle",color:"#ff6b35"},{label:"Inner Circle",tab:"innercircle",color:"#a259ff"}].map(link=><button key={link.tab} onClick={()=>switchTab(link.tab)} style={{padding:"14px",background:"#0a0a0a",border:`1px solid ${link.color}22`,borderRadius:14,cursor:"pointer",textAlign:"left",color:link.color,fontSize:isMobile?12:13,fontWeight:700,transition:"0.2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=link.color+"55";e.currentTarget.style.background=link.color+"0a";}} onMouseLeave={e=>{e.currentTarget.style.borderColor=link.color+"22";e.currentTarget.style.background="#0a0a0a";}}>{link.label} →</button>)}</div>
                      <NotificationSettingsSection isMobile={isMobile} />
                      <AuthSurfaceIsland islandId="account-admin">
                        {(auth) => (
                          <>
                            {auth.isAdminStable && (
                              <div style={{display:"flex",gap:8}}>
                                {["overview","analytics"].map(t=>(
                                  <button key={t} onClick={()=>setAccountSubTab(t)} style={{padding:"7px 16px",background:accountSubTab===t?"rgba(0,255,255,0.1)":"transparent",border:`1px solid ${accountSubTab===t?"rgba(0,255,255,0.35)":"#222"}`,borderRadius:999,color:accountSubTab===t?"#00ffff":"#555",fontSize:10,fontWeight:900,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",transition:"0.15s"}}>{t==="overview"?"OVERVIEW":"ANALYTICS"}</button>
                                ))}
                              </div>
                            )}
                            {(!auth.isAdminStable || accountSubTab==="overview") && (
                              <>
                                {auth.isAdminStable ? <GiftsSentSection /> : null}
                                {auth.isAdminStable ? (
                                  <CollectorCardAdminPanel accountState={auth.accountState} />
                                ) : null}
                              </>
                            )}
                            {auth.isAdminStable && accountSubTab==="analytics" && (
                              <AnalyticsDashboard isMobile={isMobile} />
                            )}
                          </>
                        )}
                      </AuthSurfaceIsland>
                      <button onClick={handleSignOut} style={{width:"100%",height:44,padding:0,background:"transparent",color:"#444",border:"1px solid #333",borderRadius:10,cursor:"pointer",fontSize:13,transition:"0.2s"}} onMouseEnter={e=>{e.currentTarget.style.color="#fff";}} onMouseLeave={e=>{e.currentTarget.style.color="#444";}}>Sign Out</button>
                    </div>
                  ) : (
                    <div style={{maxWidth:400,padding:"24px 0"}}>
                      <div style={{fontSize:13,color:"#777",lineHeight:1.7}}>Loading account…</div>
                    </div>
                  )}
                </>
                )}
                </PageAuthSessionBridge>
              </PersistentTabMount>

              {/* ══ MANAGE RELEASES (admin only) ══ */}
              <PersistentTabMount id="manage-releases" active={activeTab === "manage-releases"}>
                <AuthSurfaceIsland islandId="manage-releases-tab">
                  {(auth) => auth.isAdminStable ? <InlineReleasesManager /> : null}
                </AuthSurfaceIsland>
              </PersistentTabMount>

            </div>{/* end tab panel */}
            </ScrollPaddingShell>
          </div>{/* end scroll area */}
        </div>

        {/* ── DESKTOP CART SIDEBAR ── */}
        {!isMobile && (
          <div style={{width:240,flexShrink:0,borderLeft:"1px solid #222",padding:25,overflowY:"auto",background:"rgba(4,4,4,0.8)",backdropFilter:"blur(12px)"}}>
            <h3 style={{fontSize:12,letterSpacing:3,color:"#555",marginBottom:16,textTransform:"uppercase"}}>Cart</h3>
            {cart.length===0 && <p style={{opacity:0.4,fontSize:13}}>Empty</p>}
            {cart.map((item,i)=>(
              <div key={i} style={{marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                {item.cover && <img src={item.cover} alt={item.title || ""} style={{width:36,height:36,borderRadius:6,objectFit:"cover"}}/>}
                <span style={{fontSize:12,flex:1,lineHeight:1.4}}>{item.title}<br/><span style={{color:"#00ffff",fontSize:11}}>${item.price.toFixed(2)}</span></span>
                <button onClick={()=>removeFromCart(i)} onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color="#666"} style={{background:"none",border:"none",color:"#666",fontSize:16,cursor:"pointer",marginLeft:"auto",transition:"0.2s"}}>×</button>
              </div>
            ))}
            <div style={{marginTop:20,fontSize:13,fontWeight:700}}>Total: <span style={{color:"#00ffff"}}>${total.toFixed(2)}</span></div>
            <button onClick={clearCart} style={{marginTop:15,width:"100%",padding:12,background:"rgba(255,30,30,0.15)",color:"#ff4d4d",fontWeight:"bold",border:"1px solid #ff4d4d33",borderRadius:8,cursor:"pointer",fontSize:12,transition:"0.2s"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,30,30,0.25)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,30,30,0.15)"}>CLEAR CART</button>
            <button onClick={handleCheckout} disabled={checkingOut||cart.length===0} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut} style={{marginTop:10,width:"100%",padding:12,background:"#111",color:"white",border:"1px solid #333",borderRadius:8,cursor:"pointer",transition:"0.25s",fontSize:13,fontWeight:700}}>{checkingOut?"Loading…":"Checkout"}</button>
            {checkoutError && <div style={{marginTop:8}}><p style={{color:"#ff4d4d",fontSize:12}}>{checkoutError}</p></div>}
            <PageAuthSessionBridge circleSubmissions={circleSubmissions} accountCircleByline={readAccountCircleByline()}>
              {(pa) => pa.currentUser ? (
                <div>
                  <p style={{fontSize:11,color:"#555",marginTop:12,textAlign:"center"}}>Signed in as {pa.currentUser.name}</p>
                  {pa.userStatus && <div style={{marginTop:6,textAlign:"center",fontSize:10,fontWeight:900,letterSpacing:1,color:pa.userStatus.color}}>{pa.userStatus.label}</div>}
                </div>
              ) : null}
            </PageAuthSessionBridge>
          </div>
        )}
      </div>

      {/* ── MOBILE UI ── */}
      {isMobile && (
        <>
          <MobileCartFab cartCount={cart.length} onOpen={() => setMobileCartOpen(true)} />

          <MobileHomeBottomNav
            tabs={MOBILE_NAV_TABS}
            activeTab={activeTab}
            mobileNavOpen={mobileNavOpen}
            onSwitchTab={switchTab}
            onOpenMore={openMobileNav}
          />

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
                  <PageAuthMobileNavBadge
                    circleSubmissions={circleSubmissions}
                    accountCircleByline={readAccountCircleByline()}
                  />
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
                  <AdminManageReleasesNavItem activeTab={activeTab} onSwitch={switchTab} mobile />
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
      </PlaybackChromeIsland>

      {/* ── CSS ── */}
      <style jsx global>{`
        html,body{width:100%;overflow-x:clip;}
        *,*::before,*::after{box-sizing:border-box;}
        @media(max-width:768px){
          .singles-row,.mixtapes-eps-row,.albums-row,.features-row,.products-row,.videos-row{display:flex!important;flex-wrap:nowrap!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;scroll-snap-type:x mandatory!important;overscroll-behavior-x:contain!important;gap:12px!important;padding-bottom:10px!important;}
          .singles-row>*,.mixtapes-eps-row>*,.albums-row>*,.features-row>*,.products-row>*,.videos-row>*{flex:0 0 auto!important;scroll-snap-align:start!important;}
        }
        .singles-row::-webkit-scrollbar,.mixtapes-eps-row::-webkit-scrollbar,.albums-row::-webkit-scrollbar,.features-row::-webkit-scrollbar,.products-row::-webkit-scrollbar,.videos-row::-webkit-scrollbar{height:4px;}
        .singles-row::-webkit-scrollbar-track,.mixtapes-eps-row::-webkit-scrollbar-track,.albums-row::-webkit-scrollbar-track,.features-row::-webkit-scrollbar-track,.products-row::-webkit-scrollbar-track,.videos-row::-webkit-scrollbar-track{background:#111;border-radius:4px;}
        .singles-row::-webkit-scrollbar-thumb,.mixtapes-eps-row::-webkit-scrollbar-thumb,.albums-row::-webkit-scrollbar-thumb,.features-row::-webkit-scrollbar-thumb,.products-row::-webkit-scrollbar-thumb,.videos-row::-webkit-scrollbar-thumb{background:#00ffff;border-radius:4px;}
        @keyframes pulse{0%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.85}100%{transform:scale(1);opacity:1}}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
        @keyframes expandDown{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes flowIdlePulse{0%{opacity:.4}50%{opacity:.9}100%{opacity:.4}}
        @keyframes flowIdleDot{0%{opacity:.15;transform:scale(.8)}50%{opacity:.7;transform:scale(1.2)}100%{opacity:.15;transform:scale(.8)}}
        @keyframes eqBar1{from{height:6px}to{height:16px}}
        @keyframes eqBar2{from{height:10px}to{height:18px}}
        @keyframes eqBar3{from{height:14px}to{height:8px}}
        @keyframes eqBar4{from{height:8px}to{height:14px}}
        @keyframes donateSweep{0%{transform:translateX(-140%) skewX(-18deg);opacity:0}20%{opacity:.65}52%{opacity:.25}100%{transform:translateX(190%) skewX(-18deg);opacity:0}}
        @keyframes subscribeSweep{0%{transform:translateX(-145%) skewX(-18deg);opacity:0}18%{opacity:.65}48%{opacity:.22}100%{transform:translateX(195%) skewX(-18deg);opacity:0}}
        @keyframes goldPulse{0%,100%{box-shadow:0 0 8px rgba(212,175,55,.28),0 0 18px rgba(212,175,55,.1),inset 0 1px 0 rgba(255,215,0,.05)}50%{box-shadow:0 0 22px rgba(212,175,55,.62),0 0 42px rgba(212,175,55,.24),inset 0 1px 0 rgba(255,215,0,.12)}}
        @keyframes goldSweep{0%{transform:translateX(-140%) skewX(-18deg);opacity:0}20%{opacity:.55}55%{opacity:.2}100%{transform:translateX(190%) skewX(-18deg);opacity:0}}
        .donate-glow-button,.subscribe-shimmer-button{position:relative;overflow:hidden;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;transition:color .2s,border-color .2s,background .2s,box-shadow .2s,transform .2s;isolation:isolate}
        .donate-glow-button{background:rgba(0,220,220,.08);color:#00e5ff;border:1px solid rgba(0,255,255,.38);box-shadow:0 0 16px rgba(0,255,255,.12),inset 0 1px 0 rgba(0,255,255,.06)}
        .donate-glow-button:hover{color:#00ffff;border-color:rgba(0,255,255,.62);background:rgba(0,220,220,.16);box-shadow:0 0 30px rgba(0,255,255,.3),inset 0 1px 0 rgba(0,255,255,.1);transform:translateY(-1px)}
        .donate-glow-button::after{content:"";position:absolute;top:-30%;bottom:-30%;left:0;width:42%;background:linear-gradient(90deg,transparent,rgba(0,255,255,.55),rgba(180,255,255,.32),transparent);animation:donateSweep 5.8s ease-in-out infinite;pointer-events:none}
        .subscribe-shimmer-button{background:rgba(110,35,185,.16);color:#dbb8ff;border:1px solid rgba(162,89,255,.42);box-shadow:0 0 24px rgba(162,89,255,.2),inset 0 1px 0 rgba(255,255,255,.08)}
        .subscribe-shimmer-button:hover{color:#ede0ff;border-color:rgba(162,89,255,.72);background:rgba(110,35,185,.28);box-shadow:0 0 40px rgba(162,89,255,.36),inset 0 1px 0 rgba(255,255,255,.12);transform:translateY(-1px)}
        .subscribe-shimmer-button::after{content:"";position:absolute;top:-32%;bottom:-32%;left:0;width:48%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),rgba(180,120,255,.44),rgba(255,255,255,.15),transparent);animation:subscribeSweep 5.2s ease-in-out infinite;pointer-events:none}
        .my-coll-btn{font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.12em;color:#d4af37;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.42);border-radius:20px;padding:5px 12px;cursor:pointer;transition:background .2s,color .2s;position:relative;overflow:hidden;animation:goldPulse 2.8s ease-in-out infinite;isolation:isolate}
        .my-coll-btn:hover{background:rgba(212,175,55,.2);color:#ffd700;border-color:rgba(255,215,0,.7);animation-play-state:paused;box-shadow:0 0 28px rgba(212,175,55,.5),inset 0 1px 0 rgba(255,215,0,.12)}
        .my-coll-btn::after{content:"";position:absolute;top:-30%;bottom:-30%;left:0;width:40%;background:linear-gradient(90deg,transparent,rgba(255,215,0,.5),rgba(255,240,150,.3),transparent);animation:goldSweep 6.5s ease-in-out infinite;pointer-events:none}
        .section-heading{animation:fadeInUp .9s cubic-bezier(.22,1,.36,1) both;animation-fill-mode:forwards;}
      `}</style>

      {/* ── POST-PURCHASE MEMBERSHIP UPSELL ── */}
      <AnimatePresence>
        <EntitlementSurfaceIsland islandId="membership-upsell">
          {(ent) =>
            membershipUpsellOpen && ent.showSubscribeCta ? (
          <motion.div key="membership-upsell" {...OVERLAY_FADE} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?16:0}}>
            <motion.div {...(isMobile ? SHEET_UP : MODAL_CENTER)} style={{background:"#0a0a0a",padding:isMobile?22:30,borderRadius:isMobile?"20px 20px 0 0":20,width:isMobile?"100%":420,border:"1px solid #222",alignSelf:isMobile?"flex-end":"center",boxShadow:"0 0 40px rgba(0,255,255,0.12)"}}>
              <div style={{fontSize:11,color:"#00ffff",letterSpacing:3,marginBottom:12,textTransform:"uppercase"}}>Thanks for supporting</div>
              <div style={{fontSize:22,fontWeight:900,marginBottom:10}}>Want early access, exclusive drops, and giveaways?</div>
              <p style={{fontSize:13,color:"#888",lineHeight:1.7,marginBottom:20}}>Membership is optional. Your purchase is already saved to your library.</p>
              <button onClick={()=>{setMembershipUpsellOpen(false);switchTab("innercircle");}} style={{width:"100%",padding:"13px 0",background:"#a259ff",color:"#fff",fontWeight:900,border:"none",borderRadius:10,cursor:"pointer",fontSize:14,marginBottom:10}}>Join Membership</button>
              <button onClick={()=>setMembershipUpsellOpen(false)} style={{width:"100%",padding:"12px 0",background:"transparent",color:"#777",border:"1px solid #333",borderRadius:10,cursor:"pointer",fontSize:13}}>Maybe later</button>
            </motion.div>
          </motion.div>
            ) : null
          }
        </EntitlementSurfaceIsland>
      </AnimatePresence>

      <Suspense fallback={null}>
        <DonateModal open={donateOpen} onClose={()=>setDonateOpen(false)} isMobile={isMobile}/>
      </Suspense>
      <AuthSurfaceIsland islandId="gift-sheet" onGiftRequest={setGiftSheetRelease}>
        {(auth) => (
          <GiftBottomSheet
            open={Boolean(giftSheetRelease)}
            release={giftSheetRelease}
            senderUserId={auth.userId}
            isAdmin={auth.isAdminStable}
            isMobile={isMobile}
            onClose={() => setGiftSheetRelease(null)}
          />
        )}
      </AuthSurfaceIsland>
      <EntitlementSurfaceIsland islandId="album-tracklist-sheet">
        {(ent) => (
          <AuthSurfaceIsland islandId="album-tracklist-sheet" onGiftRequest={setGiftSheetRelease}>
            {(auth) => (
              <AlbumTracklistSheet
                open={Boolean(albumTracklistRelease)}
                album={albumTracklistRelease}
                catalogPlaybackLookup={getCatalogSurfaceRef().catalogPlaybackLookup}
                accountState={ent.entitlementAccountState}
                userId={auth.userId}
                isAdmin={auth.isAdmin}
                isMobile={isMobile}
                onClose={() => setAlbumTracklistRelease(null)}
                onLibraryChange={auth.handleLibraryChange}
              />
            )}
          </AuthSurfaceIsland>
        )}
      </EntitlementSurfaceIsland>

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
            style={{...stripePaymentOverlayStyle({ isMobile, padding: isMobile ? 0 : 16 }), background:"rgba(0,0,0,0.9)"}}
          >
            <motion.div
              {...(isMobile ? SHEET_UP : MODAL_CENTER)}
              onClick={(e) => e.stopPropagation()}
              style={{
                ...stripePaymentPanelStyle({ isMobile, maxWidth: 400 }),
                background:"#0a0a0a",
                padding: isMobile ? "20px 20px max(20px, env(safe-area-inset-bottom))" : 30,
                borderRadius: isMobile ? "20px 20px 0 0" : 20,
                border:"1px solid #222",
                alignSelf: isMobile ? "flex-end" : "center",
              }}
            >
              <motion.div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>Checkout</motion.div>
              <Elements stripe={getStripeClient()} options={{clientSecret,appearance:{theme:"night",variables:{colorPrimary:"#00ffff",colorBackground:"#0a0a0a",colorText:"#ffffff",borderRadius:"8px"}}}}>
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


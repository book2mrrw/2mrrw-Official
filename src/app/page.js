"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

// ─── Social links — update hrefs to your actual profiles ───────────────────
const SOCIALS = [
  {
    name: "YouTube",
    href: "https://youtube.com/@2MRRW",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    name: "Instagram",
    href: "https://instagram.com/2MRRW",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
      </svg>
    ),
  },
  {
    name: "TikTok",
    href: "https://tiktok.com/@2MRRW",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
      </svg>
    ),
  },
  {
    name: "Twitch",
    href: "https://twitch.tv/2MRRW",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
      </svg>
    ),
  },
  {
    name: "Patreon",
    href: "https://patreon.com/2MRRW",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M22.957 7.21c-.004-3.064-2.391-5.576-5.191-6.482-3.478-1.125-8.064-.962-11.384.604C3.357 2.755 1.044 5.6 1.044 8.972c0 3.256 2.01 6.08 5.146 7.103 3.109 1.012 6.784.67 9.729-.63 3.406-1.51 7.052-4.817 7.038-8.234z" />
      </svg>
    ),
  },
  {
    name: "X",
    href: "https://x.com/2MRRW",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
];

// ─── Music Videos — replace youtubeId values with your real YouTube video IDs
const musicVideos = [
  {
    id: "mv-1",
    title: "A2B",
    youtubeId: "YOUR_YOUTUBE_ID_HERE",
    description: "Official Music Video",
  },
  {
    id: "mv-2",
    title: "Hour Glass",
    youtubeId: "YOUR_YOUTUBE_ID_HERE",
    description: "Official Music Video",
  },
  {
    id: "mv-3",
    title: "W.2.D",
    youtubeId: "YOUR_YOUTUBE_ID_HERE",
    description: "Official Music Video",
  },
];

export default function Page() {
  const [cart, setCart] = useState([]);
  const [activeTab, setActiveTab] = useState("home");
  const [addedFlash, setAddedFlash] = useState(null);
  const [soundOn, setSoundOn] = useState(false);
  const [selectedSingle, setSelectedSingle] = useState(null);
  const [selectedAlbum, setSelectedAlbum] = useState(null);

  // Singles carousel index
  const [singleIndex, setSingleIndex] = useState(0);

  const [gateSubmitted, setGateSubmitted] = useState(false);
  const [gateName, setGateName] = useState("");
  const [gatePhone, setGatePhone] = useState("");
  const [gateEmail, setGateEmail] = useState("");
  const [gateError, setGateError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [clientSecret, setClientSecret] = useState(null);

  // Shows & blog state
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [blogPost, setBlogPost] = useState(null);
  const [blogComment, setBlogComment] = useState("");
  const [blogComments, setBlogComments] = useState({});

  useEffect(() => {
    const stored = localStorage.getItem("2mrrw_user");
    if (stored) {
      setCurrentUser(JSON.parse(stored));
      setGateSubmitted(true);
    }
  }, []);

  const singles = [
    {
      title: "Hour Glass",
      slug: "hour-glass",
      cover: "/images/singles/hourglass.jpg",
      price: 2.99,
      preview: "/audio/previews/hourglass-preview.mp3",
      full: "/audio/full/hourglass.mp3",
    },
    {
      title: "W.2.D",
      slug: "w2d",
      cover: "/images/singles/w2d.jpg",
      price: 2.99,
      preview: "/audio/previews/w2d-preview.mp3",
      full: "/audio/full/w2d.mp3",
    },
    {
      title: "Artificial",
      slug: "artificial",
      cover: "/images/singles/artificial.jpg",
      price: 2.99,
      preview: "/audio/previews/artificial-preview.mp3",
      full: "/audio/full/artificial.mp3",
    },
    {
      title: "Turnt Me 2 Dis",
      slug: "turnt-me-2-dis",
      cover: "/images/singles/turnt.jpg",
      price: 2.99,
      preview: "/audio/previews/turntme2dis-preview.mp3",
      full: "/audio/full/turntme2dis.mp3",
    },
  ];

  const albums = [
    {
      title: "T.B.H.",
      slug: "tbh",
      cover: "/images/albums/tbh.jpg",
      price: 9.99,
      date: "July 7, 2022",
      vinyl: 47.99,
      tracks: ["Glass Full","Up 2 Me","Unexpcted","All Yours","Locomotive","LEFT","Was Wrong","ArTiFICiaL"],
    },
    {
      title: "(A.D)",
      slug: "ad",
      cover: "/images/albums/ad.jpg",
      price: 9.99,
      date: "March 24, 2024",
      vinyl: 47.99,
      tracks: ["2mrrw's Ntro","Said N' Done","A.D.D","Perspective (2018)","Grand Scheme","A2B","Life Changes (2018)","Itself (2018)","Wastin Time","Like Me Or Not"],
    },
    {
      title: "Love Hz Vol.1",
      slug: "love-hz",
      cover: "/images/albums/lovehz.jpg",
      price: 12.99,
      date: "August 2026",
      vinyl: 47.99,
      tracks: ["Roll Call","W.2.D","All Of It","Knock On Wood","Stayed 2 Long","Hour Glass"],
    },
  ];

  const merch = [
    { title: "2MRRW Hoodie", slug: "hoodie", cover: "/images/merch/hoodie.jpg", price: 59.99 },
    { title: "2MRRW T-Shirt", slug: "shirt", cover: "/images/merch/shirt.jpg", price: 29.99 },
    { title: "2MRRW Hat", slug: "hat", cover: "/images/merch/hat.jpg", price: 24.99 },
  ];

  // Shows data
  const shows = [
    { id: "show-1", title: "2MRRW Live – Dallas", venue: "House of Blues Dallas", date: "2026-05-10", time: "8:00 PM", price: 25.00, tickets: 50 },
    { id: "show-2", title: "2MRRW Live – Houston", venue: "Warehouse Live", date: "2026-05-24", time: "9:00 PM", price: 25.00, tickets: 75 },
    { id: "show-3", title: "2MRRW Live – Atlanta", venue: "The Loft Atlanta", date: "2026-06-07", time: "8:30 PM", price: 30.00, tickets: 60 },
    { id: "show-4", title: "2MRRW Live – LA", venue: "The Troubadour", date: "2026-06-21", time: "9:00 PM", price: 35.00, tickets: 40 },
    { id: "show-5", title: "2MRRW Live – NYC", venue: "Bowery Ballroom", date: "2026-07-04", time: "8:00 PM", price: 35.00, tickets: 45 },
  ];

  // Blog posts data
  const blogPosts = [
    { id: "post-1", title: "The Making of Love Hz Vol.1", date: "April 2, 2026", author: "2MRRW", body: "Love Hz Vol.1 started as a series of late-night sessions in a home studio with nothing but a laptop, a MIDI keyboard, and a vision. Every track on that project represents a different frequency of love — the highs, the lows, the static in between. We wanted listeners to feel the entire spectrum.\n\nThe process took nearly 18 months. Some songs were written in 10 minutes, others were rebuilt from scratch a dozen times. What you hear is the version that survived. We hope it resonates with you the way it resonated with us when we finally pressed play for the first time." },
    { id: "post-2", title: "Why We Started 2MRRW", date: "March 15, 2026", author: "2MRRW", body: "2MRRW was never supposed to be a brand. It started as a reminder — tomorrow is always possible. No matter what today looks like, tomorrow holds something different.\n\nWe put that energy into every record, every show, every piece of merch. It's not just a name on a hoodie. It's a mindset we live by and want to share with everyone who connects with the music." },
    { id: "post-3", title: "Tour Prep: What Goes Into a Live Show", date: "February 28, 2026", author: "2MRRW", body: "People see the 90-minute set. They don't see the weeks of rehearsal, the production calls, the logistics of moving equipment across state lines. A live 2MRRW show is designed from the ground up — the lighting, the setlist order, the energy arc from opener to closer.\n\nWe treat every city like it's the only city. Dallas gets the same energy as NYC. That's the standard we hold ourselves to and always will." },
  ];

  const addToCart = (item) => {
    setCart((prev) => [...prev, item]);
    setAddedFlash(item.slug);
    setTimeout(() => setAddedFlash(null), 400);
  };

  const clearCart = () => setCart([]);

  const removeFromCart = (index) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const total = cart.reduce((sum, item) => sum + item.price, 0);

  const hoverIn = (e) => {
    e.currentTarget.style.transform = "scale(1.08)";
    e.currentTarget.style.filter = "brightness(1.15)";
    e.currentTarget.style.boxShadow = "0 0 18px rgba(0,255,255,0.6)";
  };

  const hoverOut = (e) => {
    e.currentTarget.style.transform = "scale(1)";
    e.currentTarget.style.filter = "brightness(1)";
    e.currentTarget.style.boxShadow = "none";
  };

  const buttonHoverIn = (e) => {
    e.currentTarget.style.boxShadow = "0 0 14px rgba(0,255,255,0.8)";
    e.currentTarget.style.borderColor = "#00ffff";
  };

  const buttonHoverOut = (e) => {
    e.currentTarget.style.boxShadow = "none";
    e.currentTarget.style.borderColor = "#333";
  };

  useEffect(() => {
    const els = document.querySelectorAll(".fade-on-scroll");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = 1;
          entry.target.style.transform = "translateY(0px)";
        }
      });
    });
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const handleGateSubmit = async () => {
    if (!gateName.trim() || !gatePhone.trim() || !gateEmail.trim()) {
      setGateError("Please fill out all fields.");
      return;
    }
    setGateError("");
    try {
      const res = await fetch("/api/register-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: gateName, phone: gatePhone, email: gateEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGateError(data.error || "Something went wrong.");
        return;
      }
      const user = { id: data.id, name: gateName, phone: gatePhone, email: gateEmail };
      localStorage.setItem("2mrrw_user", JSON.stringify(user));
      setCurrentUser(user);
      setGateSubmitted(true);
    } catch {
      setGateError("Network error. Please try again.");
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckingOut(true);
    setCheckoutError("");
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.error || data.message || "Checkout failed. Check your Stripe configuration.");
        setCheckingOut(false);
        return;
      }
      if (!data.clientSecret) {
        setCheckoutError("No client secret returned. Ensure your /api/create-payment-intent route returns { clientSecret }.");
        setCheckingOut(false);
        return;
      }
      setClientSecret(data.clientSecret);
    } catch (err) {
      setCheckoutError(`Network error: ${err.message}`);
      setCheckingOut(false);
    }
  };

  const addVinylToCart = (single) => {
    addToCart({
      title: `${single.title} – Vinyl`,
      slug: `${single.slug}-vinyl`,
      cover: single.cover,
      price: 47.99,
    });
  };

  // Calendar helpers
  const getDaysInMonth = (month, year) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (month, year) => new Date(year, month, 1).getDay();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const getShowsForDay = (day) => {
    return shows.filter((s) => {
      const d = new Date(s.date);
      return d.getFullYear() === calYear && d.getMonth() === calMonth && d.getDate() === day;
    });
  };

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
    else setCalMonth(calMonth - 1);
  };

  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
    else setCalMonth(calMonth + 1);
  };

  // Blog comment handler
  const handleAddComment = (postId) => {
    if (!blogComment.trim()) return;
    const name = currentUser ? currentUser.name : "Anonymous";
    const newComment = { name, text: blogComment, time: new Date().toLocaleString() };
    setBlogComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), newComment] }));
    setBlogComment("");
  };

  // Nav tabs — Music Videos sits before Shows & Events
  const tabs = [
    { id: "home",    label: "HOME" },
    { id: "singles", label: "SINGLES" },
    { id: "albums",  label: "ALBUMS" },
    { id: "shop",    label: "SHOP" },
    { id: "videos",  label: "MUSIC VIDEOS" },
    { id: "shows",   label: "SHOWS & EVENTS" },
    { id: "blog",    label: "BLOG" },
  ];

  // Carousel helpers
  const currentSingle = singles[singleIndex];
  const prevSingle = () => setSingleIndex((i) => (i === 0 ? singles.length - 1 : i - 1));
  const nextSingle = () => setSingleIndex((i) => (i === singles.length - 1 ? 0 : i + 1));

  return (
    <>
      {/* EMAIL GATE OVERLAY */}
      {!gateSubmitted && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 16, padding: 30,
        }}>
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "white", textShadow: "0 0 20px rgba(0,255,255,0.8)" }}>
            2MRRW
          </div>
          <p style={{ color: "#aaa", marginBottom: 10 }}>Enter your info to access the site</p>
          <input placeholder="Full Name" value={gateName} onChange={(e) => setGateName(e.target.value)}
            style={{ width: 280, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 14 }} />
          <input placeholder="Phone Number" value={gatePhone} onChange={(e) => setGatePhone(e.target.value)}
            style={{ width: 280, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 14 }} />
          <input placeholder="Email Address" value={gateEmail} onChange={(e) => setGateEmail(e.target.value)}
            style={{ width: 280, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 14 }} />
          {gateError && <p style={{ color: "red", fontSize: 13 }}>{gateError}</p>}
          <button onClick={handleGateSubmit}
            style={{ width: 280, padding: "12px 0", background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
            Enter Site
          </button>
        </div>
      )}

      {/* SINGLE MODAL */}
      {selectedSingle && (
        <div onClick={() => setSelectedSingle(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 8888, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#111", border: "1px solid #222", borderRadius: 20, padding: 30, width: 340, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <img src={selectedSingle.cover} style={{ width: 200, height: 200, borderRadius: 14, objectFit: "cover" }} />
            <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedSingle.title}</div>
            <div style={{ fontSize: 13, opacity: 0.5 }}>${selectedSingle.price.toFixed(2)}</div>
            <audio controls autoPlay style={{ width: "100%", marginTop: 4 }} src={selectedSingle.preview} />
            <button onClick={() => { addToCart(selectedSingle); setSelectedSingle(null); }}
              style={{ width: "100%", padding: "10px 0", background: "#1f1f1f", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
              Add to Cart – ${selectedSingle.price.toFixed(2)}
            </button>
            <button onClick={() => { addVinylToCart(selectedSingle); setSelectedSingle(null); }}
              style={{ width: "100%", padding: "10px 0", background: "#0a0a0a", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: "bold" }}>
              + Add Vinyl – $47.99 (Optional)
            </button>
            <button onClick={() => setSelectedSingle(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, marginTop: 4 }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* ALBUM MODAL */}
      {selectedAlbum && (
        <div onClick={() => setSelectedAlbum(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 8888, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#111", border: "1px solid #222", borderRadius: 20, padding: "22px 26px", width: 320, maxHeight: "65vh", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <img src={selectedAlbum.cover} style={{ width: 130, height: 130, borderRadius: 10, objectFit: "cover" }} />
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: 2, textAlign: "center" }}>{selectedAlbum.title}</div>
            <div style={{ fontSize: 11, opacity: 0.4, letterSpacing: 1 }}>{selectedAlbum.date}</div>
            <div style={{ width: "100%", marginTop: 4 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.4, marginBottom: 8, textTransform: "uppercase" }}>Track Listing</div>
              {selectedAlbum.tracks.map((track, i) => (
                <div key={i} style={{ padding: "6px 0", fontSize: 13, borderBottom: "1px solid #1a1a1a", color: "white" }}>
                  {i + 1}. {track}
                </div>
              ))}
            </div>
            <button onClick={() => { addToCart(selectedAlbum); setSelectedAlbum(null); }}
              style={{ width: "100%", padding: "10px 0", background: "#1f1f1f", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontSize: 13, marginTop: 6 }}>
              Add to Cart – ${selectedAlbum.price.toFixed(2)}
            </button>
            <button onClick={() => {
                addToCart({ title: `${selectedAlbum.title} – Vinyl`, slug: `${selectedAlbum.slug}-vinyl`, cover: selectedAlbum.cover, price: selectedAlbum.vinyl });
                setSelectedAlbum(null);
              }}
              style={{ width: "100%", padding: "10px 0", background: "#0a0a0a", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: "bold" }}>
              + Add Vinyl – ${selectedAlbum.vinyl.toFixed(2)} (Optional)
            </button>
            <button onClick={() => setSelectedAlbum(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, marginTop: 4 }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* TICKET MODAL */}
      {selectedEvent && (
        <div onClick={() => setSelectedEvent(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 8888, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#111", border: "1px solid #222", borderRadius: 20, padding: 30, width: 360, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>{selectedEvent.title}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>{selectedEvent.venue}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>
              {new Date(selectedEvent.date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · {selectedEvent.time}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#00ffff" }}>${selectedEvent.price.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: "#555" }}>{selectedEvent.tickets} tickets remaining</div>
            <button onClick={() => {
                addToCart({ title: `Ticket – ${selectedEvent.title}`, slug: selectedEvent.id, cover: null, price: selectedEvent.price });
                setSelectedEvent(null);
              }}
              style={{ width: "100%", padding: "12px 0", background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
              Add Ticket to Cart – ${selectedEvent.price.toFixed(2)}
            </button>
            <button onClick={() => setSelectedEvent(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, textAlign: "center" }}>
              Close
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", minHeight: "100vh", background: "#050505", color: "white" }}>
        <div style={{ flex: 3, padding: 30 }}>

          {/* HERO */}
          <div style={{ position: "relative", height: 380, marginBottom: 30, borderRadius: 20, overflow: "hidden", background: "black" }}>
            <video autoPlay muted loop playsInline style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", opacity: 0.35, filter: "blur(1px)" }}>
              <source src="/videos/A2B.mp4" type="video/mp4" />
            </video>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, black, transparent 60%)" }} />
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at center, transparent 30%, black 100%)" }} />

            {/* 2MRRW logo */}
            <div style={{ position: "absolute", bottom: 25, left: 25, fontSize: 42, fontWeight: 900, letterSpacing: 8, animation: "pulse 2.5s infinite", textShadow: "0 0 20px rgba(0,255,255,0.8)" }}>
              2MRRW
            </div>

            {/* SOCIAL BAR */}
            <div style={{ position: "absolute", bottom: 28, right: 25, display: "flex", gap: 16, alignItems: "center", zIndex: 10 }}>
              {SOCIALS.map((social) => (
                <a key={social.name} href={social.href} target="_blank" rel="noopener noreferrer" title={social.name}
                  style={{ color: "rgba(255,255,255,0.65)", transition: "transform 0.2s ease, color 0.2s ease, filter 0.2s ease", display: "flex", alignItems: "center", textDecoration: "none" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "scale(1.5)";
                    e.currentTarget.style.color = "#00ffff";
                    e.currentTarget.style.filter = "drop-shadow(0 0 6px rgba(0,255,255,0.8))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                    e.currentTarget.style.color = "rgba(255,255,255,0.65)";
                    e.currentTarget.style.filter = "none";
                  }}>
                  {social.svg}
                </a>
              ))}
            </div>
          </div>

          {/* DONATE BUTTON */}
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => window.open("https://www.paypal.com/donate", "_blank")}
              style={{ padding: "10px 22px", background: "#111", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontWeight: "bold", fontSize: 13, letterSpacing: 1 }}>
              ♥ Donate
            </button>
          </div>

          {/* SOUND TOGGLE */}
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setSoundOn(!soundOn)}
              style={{ padding: "6px 12px", background: "#111", color: "white", border: "1px solid #333", cursor: "pointer" }}>
              Sound: {soundOn ? "ON" : "OFF"}
            </button>
          </div>

          {/* ── STYLIZED PILL TABS ─────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 35, flexWrap: "wrap" }}>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: "8px 16px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 2,
                    cursor: "pointer",
                    border: isActive ? "1px solid #00ffff" : "1px solid #2a2a2a",
                    borderRadius: 30,
                    background: isActive
                      ? "linear-gradient(135deg, rgba(0,255,255,0.15), rgba(0,255,255,0.05))"
                      : "rgba(255,255,255,0.03)",
                    color: isActive ? "#00ffff" : "#555",
                    textShadow: isActive ? "0 0 10px rgba(0,255,255,0.6)" : "none",
                    boxShadow: isActive ? "0 0 12px rgba(0,255,255,0.2), inset 0 0 8px rgba(0,255,255,0.05)" : "none",
                    transition: "all 0.25s ease",
                    backdropFilter: "blur(4px)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "#444";
                      e.currentTarget.style.color = "#aaa";
                      e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "#2a2a2a";
                      e.currentTarget.style.color = "#555";
                      e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    }
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          {/* ── END STYLIZED TABS ──────────────────────────────────────────── */}

          {/* HOME TAB */}
          {activeTab === "home" && (
            <>
              <h2 className="section-heading">Latest Singles</h2>

              {/* ── SINGLE CAROUSEL ──────────────────────────────────────────── */}
              <div style={{
                display: "flex", alignItems: "center", gap: 20,
                background: "linear-gradient(135deg, #0e0e0e, #111)",
                border: "1px solid #1e1e1e", borderRadius: 20,
                padding: "28px 24px", marginBottom: 8,
                position: "relative", overflow: "hidden",
              }}>
                {/* subtle glow bg */}
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 320, height: 320, background: "radial-gradient(circle, rgba(0,255,255,0.04) 0%, transparent 70%)", pointerEvents: "none" }} />

                {/* LEFT ARROW */}
                <button onClick={prevSingle}
                  style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", color: "#555", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.color = "#00ffff"; e.currentTarget.style.boxShadow = "0 0 10px rgba(0,255,255,0.3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; e.currentTarget.style.boxShadow = "none"; }}>
                  ‹
                </button>

                {/* LARGE COVER ART */}
                <img src={currentSingle.cover} onClick={() => setSelectedSingle(currentSingle)} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
                  style={{ width: 260, height: 260, borderRadius: 16, objectFit: "cover", cursor: "pointer", transition: "0.25s", flexShrink: 0, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }} />

                {/* INFO + ACTIONS */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 2 }}>{currentSingle.title}</div>
                  <div style={{ fontSize: 13, color: "#555", letterSpacing: 1 }}>SINGLE</div>
                  <div style={{ fontSize: 16, color: "#00ffff", fontWeight: 700 }}>${currentSingle.price.toFixed(2)}</div>
                  {/* dot indicators */}
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    {singles.map((_, i) => (
                      <div key={i} onClick={() => setSingleIndex(i)}
                        style={{ width: i === singleIndex ? 20 : 6, height: 6, borderRadius: 3, background: i === singleIndex ? "#00ffff" : "#333", cursor: "pointer", transition: "all 0.3s ease", boxShadow: i === singleIndex ? "0 0 6px rgba(0,255,255,0.6)" : "none" }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                    <button onClick={() => setSelectedSingle(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
                      style={{ padding: "10px 18px", background: "#1f1f1f", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "0.25s" }}>
                      ▶ Preview
                    </button>
                    <button onClick={() => addToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
                      style={{ padding: "10px 18px", background: "#0a0a0a", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: "bold", transition: "0.25s" }}>
                      + Add to Cart
                    </button>
                  </div>
                </div>

                {/* RIGHT ARROW */}
                <button onClick={nextSingle}
                  style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", color: "#555", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.color = "#00ffff"; e.currentTarget.style.boxShadow = "0 0 10px rgba(0,255,255,0.3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; e.currentTarget.style.boxShadow = "none"; }}>
                  ›
                </button>
              </div>
              {/* ── END SINGLE CAROUSEL ───────────────────────────────────────── */}

              <div style={{ margin: "30px 0", height: 1, background: "#222" }} />
              <h2 className="section-heading" style={{ animationDelay: "0.15s" }}>Albums</h2>
              <Grid items={albums} type="albums" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} onSingleClick={setSelectedAlbum} />
            </>
          )}

          {/* SINGLES TAB */}
          {activeTab === "singles" && (
            <>
              <h2 className="section-heading">Singles</h2>
              <div style={{
                display: "flex", alignItems: "center", gap: 20,
                background: "linear-gradient(135deg, #0e0e0e, #111)",
                border: "1px solid #1e1e1e", borderRadius: 20,
                padding: "32px 28px", position: "relative", overflow: "hidden",
              }}>
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 360, height: 360, background: "radial-gradient(circle, rgba(0,255,255,0.04) 0%, transparent 70%)", pointerEvents: "none" }} />
                <button onClick={prevSingle}
                  style={{ width: 50, height: 50, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", color: "#555", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.color = "#00ffff"; e.currentTarget.style.boxShadow = "0 0 10px rgba(0,255,255,0.3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; e.currentTarget.style.boxShadow = "none"; }}>
                  ‹
                </button>
                <img src={currentSingle.cover} onClick={() => setSelectedSingle(currentSingle)} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
                  style={{ width: 300, height: 300, borderRadius: 18, objectFit: "cover", cursor: "pointer", transition: "0.25s", flexShrink: 0, boxShadow: "0 10px 50px rgba(0,0,0,0.7)" }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 2 }}>{currentSingle.title}</div>
                  <div style={{ fontSize: 13, color: "#555", letterSpacing: 1 }}>SINGLE · {singleIndex + 1} of {singles.length}</div>
                  <div style={{ fontSize: 18, color: "#00ffff", fontWeight: 700 }}>${currentSingle.price.toFixed(2)}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {singles.map((_, i) => (
                      <div key={i} onClick={() => setSingleIndex(i)}
                        style={{ width: i === singleIndex ? 24 : 7, height: 7, borderRadius: 4, background: i === singleIndex ? "#00ffff" : "#333", cursor: "pointer", transition: "all 0.3s ease", boxShadow: i === singleIndex ? "0 0 8px rgba(0,255,255,0.6)" : "none" }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                    <button onClick={() => setSelectedSingle(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
                      style={{ padding: "11px 20px", background: "#1f1f1f", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "0.25s" }}>
                      ▶ Preview
                    </button>
                    <button onClick={() => addToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
                      style={{ padding: "11px 20px", background: "#0a0a0a", color: "#00ffff", border: "1px solid #00ffff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: "bold", transition: "0.25s" }}>
                      + Add to Cart
                    </button>
                    <button onClick={() => addVinylToCart(currentSingle)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
                      style={{ padding: "11px 20px", background: "#0a0a0a", color: "#aaa", border: "1px solid #2a2a2a", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "0.25s" }}>
                      + Vinyl $47.99
                    </button>
                  </div>
                </div>
                <button onClick={nextSingle}
                  style={{ width: 50, height: 50, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", color: "#555", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.color = "#00ffff"; e.currentTarget.style.boxShadow = "0 0 10px rgba(0,255,255,0.3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; e.currentTarget.style.boxShadow = "none"; }}>
                  ›
                </button>
              </div>
            </>
          )}

          {activeTab === "albums" && (
            <Grid items={albums} type="albums" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} onSingleClick={setSelectedAlbum} />
          )}

          {activeTab === "shop" && (
            <Grid items={merch} type="products" addToCart={addToCart} hoverIn={hoverIn} hoverOut={hoverOut} buttonHoverIn={buttonHoverIn} buttonHoverOut={buttonHoverOut} />
          )}

          {/* ── MUSIC VIDEOS TAB ──────────────────────────────────────────── */}
          {activeTab === "videos" && (
            <>
              <h2 className="section-heading">Music Videos</h2>
              <p style={{ fontSize: 13, color: "#444", marginBottom: 28, letterSpacing: 1 }}>Official visuals from 2MRRW</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                {musicVideos.map((vid) => (
                  <div key={vid.id} style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 20, overflow: "hidden" }}>
                    {/* 16:9 responsive embed */}
                    <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
                      <iframe
                        src={`https://www.youtube.com/embed/${vid.youtubeId}`}
                        title={vid.title}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: "20px 20px 0 0" }}
                      />
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
          {/* ── END MUSIC VIDEOS TAB ──────────────────────────────────────── */}

          {/* SHOWS & EVENTS TAB */}
          {activeTab === "shows" && (
            <>
              <div style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 20, padding: 24, marginBottom: 30 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                  <button onClick={prevMonth} style={{ background: "none", border: "1px solid #333", color: "white", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>‹</button>
                  <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3 }}>{monthNames[calMonth]} {calYear}</div>
                  <button onClick={nextMonth} style={{ background: "none", border: "1px solid #333", color: "white", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>›</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
                  {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
                    <div key={d} style={{ textAlign: "center", fontSize: 11, color: "#555", paddingBottom: 6 }}>{d}</div>
                  ))}
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
                      <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                        {new Date(show.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {show.time}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#00ffff" }}>${show.price.toFixed(2)}</div>
                      <button onClick={() => setSelectedEvent(show)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
                        style={{ padding: "10px 20px", background: "#111", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontWeight: "bold", fontSize: 13, transition: "0.25s" }}>
                        Get Tickets
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* COMMUNITY BLOG TAB */}
          {activeTab === "blog" && (
            <>
              {blogPost ? (
                <div>
                  <button onClick={() => setBlogPost(null)} style={{ background: "none", border: "none", color: "#00ffff", cursor: "pointer", fontSize: 13, marginBottom: 20, padding: 0, letterSpacing: 1 }}>
                    ← BACK TO BLOG
                  </button>
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
                      <input placeholder="Leave a comment…" value={blogComment} onChange={(e) => setBlogComment(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddComment(blogPost.id)}
                        style={{ flex: 1, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 13 }} />
                      <button onClick={() => handleAddComment(blogPost.id)}
                        style={{ padding: "10px 18px", background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="section-heading" style={{ marginBottom: 24 }}>Community Blog</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {blogPosts.map((post) => (
                      <div key={post.id} onClick={() => setBlogPost(post)}
                        style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, cursor: "pointer", transition: "0.25s" }}
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

        </div>

        {/* CART */}
        <div style={{ flex: 1, borderLeft: "1px solid #222", padding: 25 }}>
          <h3>Cart</h3>
          {cart.length === 0 && <p style={{ opacity: 0.4 }}>Empty</p>}
          {cart.map((item, i) => (
            <div key={i} style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              {item.cover && <img src={item.cover} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
              <span style={{ fontSize: 13 }}>{item.title} – ${item.price.toFixed(2)}</span>
              <button onClick={() => removeFromCart(i)}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.textShadow = "0 0 8px rgba(255,255,255,0.8)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#666"; e.currentTarget.style.textShadow = "none"; }}
                style={{ background: "none", border: "none", color: "#666", fontSize: 16, cursor: "pointer", marginLeft: "auto", transition: "0.2s" }}>
                ×
              </button>
            </div>
          ))}
          <div style={{ marginTop: 20 }}><strong>Total: ${total.toFixed(2)}</strong></div>
          <button onClick={clearCart} style={{ marginTop: 15, width: "100%", padding: 14, background: "red", color: "white", fontWeight: "bold", border: "none", cursor: "pointer" }}>
            CLEAR CART
          </button>
          <button onClick={handleCheckout} disabled={checkingOut || cart.length === 0} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
            style={{ marginTop: 10, width: "100%", padding: 12, background: "#111", color: "white", border: "1px solid #333", cursor: "pointer", transition: "0.25s" }}>
            {checkingOut ? "Redirecting…" : "Checkout"}
          </button>
          {checkoutError && (
            <div style={{ marginTop: 8 }}>
              <p style={{ color: "#ff4d4d", fontSize: 12 }}>{checkoutError}</p>
              <p style={{ color: "#555", fontSize: 11, marginTop: 4 }}>
                If you see "no valid payment method", make sure your /api/create-payment-intent includes{" "}
                <code style={{ color: "#00ffff" }}>payment_method_types: ["card"]</code> in the PaymentIntent params.
              </p>
            </div>
          )}
          {currentUser && <p style={{ fontSize: 11, color: "#555", marginTop: 12, textAlign: "center" }}>Signed in as {currentUser.name}</p>}
        </div>
      </div>

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
        .section-heading {
          animation: fadeInUp 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
          animation-fill-mode: forwards;
        }
        .singles-row::-webkit-scrollbar { height: 4px; }
        .singles-row::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
        .singles-row::-webkit-scrollbar-thumb { background: #00ffff; border-radius: 4px; }
        .singles-row::-webkit-scrollbar-thumb:hover { background: #00cccc; }
      `}</style>

      {/* CHECKOUT MODAL */}
      {clientSecret && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#0a0a0a", padding: 30, borderRadius: 20, width: 400, border: "1px solid #222" }}>
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CheckoutForm onSuccess={() => { setClientSecret(null); setCheckingOut(false); clearCart(); }} />
            </Elements>
            <button onClick={() => { setClientSecret(null); setCheckingOut(false); }}
              style={{ marginTop: 10, width: "100%", padding: 10, background: "none", border: "1px solid #333", color: "#777", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ items, type, addToCart, hoverIn, hoverOut, buttonHoverIn, buttonHoverOut, onSingleClick }) {
  return (
    <div className="singles-row" style={{ display: "flex", overflowX: "auto", gap: 20, paddingBottom: 12, scrollbarWidth: "thin", scrollbarColor: "#00ffff #111" }}>
      {items.map((item) => (
        <div key={item.slug} style={{ position: "relative" }}>
          <img src={item.cover} onClick={() => onSingleClick ? onSingleClick(item) : null} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
            style={{ width: 180, height: 180, borderRadius: 14, cursor: "pointer", transition: "0.25s" }} />
          <div>{item.title}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>${item.price}</div>
          <button onClick={() => addToCart(item)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
            style={{ marginTop: 6, padding: "6px 10px", fontSize: 12, background: "#1f1f1f", color: "white", border: "1px solid #333", cursor: "pointer", borderRadius: 6, transition: "0.25s" }}>
            Add to Cart
          </button>
        </div>
      ))}
    </div>
  );
}

function Grid({ items, type, addToCart, hoverIn, hoverOut, buttonHoverIn, buttonHoverOut, onSingleClick }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 20 }}>
      {items.map((item) => (
        <div key={item.slug} style={{ position: "relative" }}>
          <img src={item.cover} onClick={() => onSingleClick ? onSingleClick(item) : null} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
            style={{ width: "100%", height: 200, borderRadius: 14, cursor: "pointer", transition: "0.25s", objectFit: "cover" }} />
          <div>{item.title}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>${item.price}</div>
          <button onClick={() => addToCart(item)} onMouseEnter={buttonHoverIn} onMouseLeave={buttonHoverOut}
            style={{ marginTop: 6, padding: "6px 10px", fontSize: 12, background: "#1f1f1f", color: "white", border: "1px solid #333", cursor: "pointer", borderRadius: 6, transition: "0.25s" }}>
            Add to Cart
          </button>
        </div>
      ))}
    </div>
  );
}

function CheckoutForm({ onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError("");
    const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (result.error) {
      setError(result.error.message || "Payment failed. Please try a different card.");
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button type="submit" disabled={!stripe || loading}
        style={{ marginTop: 20, width: "100%", padding: 12, background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer" }}>
        {loading ? "Processing…" : "Pay Now"}
      </button>
      {error && (
        <div style={{ marginTop: 10 }}>
          <p style={{ color: "#ff4d4d", fontSize: 12 }}>{error}</p>
          {error.toLowerCase().includes("payment method") && (
            <p style={{ color: "#555", fontSize: 11, marginTop: 4 }}>
              Tip: In your /api/create-payment-intent, add{" "}
              <code style={{ color: "#00ffff" }}>payment_method_types: ["card"]</code>{" "}
              to your PaymentIntent creation call.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
export default function Page() {
  const [cart, setCart] = useState([]);
  const [activeTab, setActiveTab] = useState("home");
  const [addedFlash, setAddedFlash] = useState(null);
  const [soundOn, setSoundOn] = useState(false);
  const [selectedSingle, setSelectedSingle] = useState(null);
  const [selectedAlbum, setSelectedAlbum] = useState(null);

  const [gateSubmitted, setGateSubmitted] = useState(false);
  const [gateName, setGateName] = useState("");
  const [gatePhone, setGatePhone] = useState("");
  const [gateEmail, setGateEmail] = useState("");
  const [gateError, setGateError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [clientSecret, setClientSecret] = useState(null);

  // ADDED: shows & blog state
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
      title: "A.D.",
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

  // ADDED: shows data
  const shows = [
    { id: "show-1", title: "2MRRW Live – Dallas", venue: "House of Blues Dallas", date: "2026-05-10", time: "8:00 PM", price: 25.00, tickets: 50 },
    { id: "show-2", title: "2MRRW Live – Houston", venue: "Warehouse Live", date: "2026-05-24", time: "9:00 PM", price: 25.00, tickets: 75 },
    { id: "show-3", title: "2MRRW Live – Atlanta", venue: "The Loft Atlanta", date: "2026-06-07", time: "8:30 PM", price: 30.00, tickets: 60 },
    { id: "show-4", title: "2MRRW Live – LA", venue: "The Troubadour", date: "2026-06-21", time: "9:00 PM", price: 35.00, tickets: 40 },
    { id: "show-5", title: "2MRRW Live – NYC", venue: "Bowery Ballroom", date: "2026-07-04", time: "8:00 PM", price: 35.00, tickets: 45 },
  ];

  // ADDED: blog posts data
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
        setCheckoutError(data.error || "Checkout failed");
        setCheckingOut(false);
        return;
      }

      setClientSecret(data.clientSecret);

    } catch (err) {
      setCheckoutError("Network error");
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

  // ADDED: calendar helpers
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

  // ADDED: blog comment handler
  const handleAddComment = (postId) => {
    if (!blogComment.trim()) return;
    const name = currentUser ? currentUser.name : "Anonymous";
    const newComment = { name, text: blogComment, time: new Date().toLocaleString() };
    setBlogComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), newComment] }));
    setBlogComment("");
  };

  return (
    <>
      {/* EMAIL GATE OVERLAY */}
      {!gateSubmitted && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.92)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          padding: 30,
        }}>
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "white", textShadow: "0 0 20px rgba(0,255,255,0.8)" }}>
            2MRRW
          </div>
          <p style={{ color: "#aaa", marginBottom: 10 }}>Enter your info to access the site</p>
          <input
            placeholder="Full Name"
            value={gateName}
            onChange={(e) => setGateName(e.target.value)}
            style={{
              width: 280,
              padding: "10px 14px",
              background: "#111",
              border: "1px solid #333",
              color: "white",
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <input
            placeholder="Phone Number"
            value={gatePhone}
            onChange={(e) => setGatePhone(e.target.value)}
            style={{
              width: 280,
              padding: "10px 14px",
              background: "#111",
              border: "1px solid #333",
              color: "white",
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          <input
            placeholder="Email Address"
            value={gateEmail}
            onChange={(e) => setGateEmail(e.target.value)}
            style={{
              width: 280,
              padding: "10px 14px",
              background: "#111",
              border: "1px solid #333",
              color: "white",
              borderRadius: 8,
              fontSize: 14,
            }}
          />
          {gateError && <p style={{ color: "red", fontSize: 13 }}>{gateError}</p>}
          <button
            onClick={handleGateSubmit}
            style={{
              width: 280,
              padding: "12px 0",
              background: "#00ffff",
              color: "#000",
              fontWeight: "bold",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Enter Site
          </button>
        </div>
      )}

      {/* SINGLE MODAL */}
      {selectedSingle && (
        <div
          onClick={() => setSelectedSingle(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 8888,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#111",
              border: "1px solid #222",
              borderRadius: 20,
              padding: 30,
              width: 340,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <img
              src={selectedSingle.cover}
              style={{ width: 200, height: 200, borderRadius: 14, objectFit: "cover" }}
            />
            <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedSingle.title}</div>
            <div style={{ fontSize: 13, opacity: 0.5 }}>${selectedSingle.price.toFixed(2)}</div>

            <audio
              controls
              autoPlay
              style={{ width: "100%", marginTop: 4 }}
              src={selectedSingle.preview}
            />

            <button
              onClick={() => { addToCart(selectedSingle); setSelectedSingle(null); }}
              style={{
                width: "100%",
                padding: "10px 0",
                background: "#1f1f1f",
                color: "white",
                border: "1px solid #333",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Add to Cart – ${selectedSingle.price.toFixed(2)}
            </button>

            <button
              onClick={() => { addVinylToCart(selectedSingle); setSelectedSingle(null); }}
              style={{
                width: "100%",
                padding: "10px 0",
                background: "#0a0a0a",
                color: "#00ffff",
                border: "1px solid #00ffff",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: "bold",
              }}
            >
              + Add Vinyl – $47.99 (Optional)
            </button>

            <button
              onClick={() => setSelectedSingle(null)}
              style={{
                background: "none",
                border: "none",
                color: "#555",
                cursor: "pointer",
                fontSize: 12,
                marginTop: 4,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ALBUM MODAL */}
      {selectedAlbum && (
        <div
          onClick={() => setSelectedAlbum(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 8888,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#111",
              border: "1px solid #222",
              borderRadius: 20,
              padding: "22px 26px",
              width: 320,
              maxHeight: "65vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <img
              src={selectedAlbum.cover}
              style={{ width: 130, height: 130, borderRadius: 10, objectFit: "cover" }}
            />
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: 2, textAlign: "center" }}>
              {selectedAlbum.title}
            </div>
            <div style={{ fontSize: 11, opacity: 0.4, letterSpacing: 1 }}>{selectedAlbum.date}</div>

            {/* TRACK LISTING */}
            <div style={{ width: "100%", marginTop: 4 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.4, marginBottom: 8, textTransform: "uppercase" }}>
                Track Listing
              </div>
              {selectedAlbum.tracks.map((track, i) => (
                <div
                  key={i}
                  style={{
                    padding: "6px 0",
                    fontSize: 13,
                    borderBottom: "1px solid #1a1a1a",
                    color: "white",
                  }}
                >
                  {i + 1}. {track}
                </div>
              ))}
            </div>

            {/* BUY BUTTONS */}
            <button
              onClick={() => { addToCart(selectedAlbum); setSelectedAlbum(null); }}
              style={{
                width: "100%",
                padding: "10px 0",
                background: "#1f1f1f",
                color: "white",
                border: "1px solid #333",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                marginTop: 6,
              }}
            >
              Add to Cart – ${selectedAlbum.price.toFixed(2)}
            </button>

            <button
              onClick={() => {
                addToCart({
                  title: `${selectedAlbum.title} – Vinyl`,
                  slug: `${selectedAlbum.slug}-vinyl`,
                  cover: selectedAlbum.cover,
                  price: selectedAlbum.vinyl,
                });
                setSelectedAlbum(null);
              }}
              style={{
                width: "100%",
                padding: "10px 0",
                background: "#0a0a0a",
                color: "#00ffff",
                border: "1px solid #00ffff",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: "bold",
              }}
            >
              + Add Vinyl – ${selectedAlbum.vinyl.toFixed(2)} (Optional)
            </button>

            <button
              onClick={() => setSelectedAlbum(null)}
              style={{
                background: "none",
                border: "none",
                color: "#555",
                cursor: "pointer",
                fontSize: 12,
                marginTop: 4,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ADDED: TICKET MODAL */}
      {selectedEvent && (
        <div
          onClick={() => setSelectedEvent(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 8888,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#111",
              border: "1px solid #222",
              borderRadius: 20,
              padding: 30,
              width: 360,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>{selectedEvent.title}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>{selectedEvent.venue}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>
              {new Date(selectedEvent.date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · {selectedEvent.time}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#00ffff" }}>${selectedEvent.price.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: "#555" }}>{selectedEvent.tickets} tickets remaining</div>
            <button
              onClick={() => {
                addToCart({ title: `Ticket – ${selectedEvent.title}`, slug: selectedEvent.id, cover: null, price: selectedEvent.price });
                setSelectedEvent(null);
              }}
              style={{
                width: "100%",
                padding: "12px 0",
                background: "#00ffff",
                color: "#000",
                fontWeight: "bold",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Add Ticket to Cart – ${selectedEvent.price.toFixed(2)}
            </button>
            <button
              onClick={() => setSelectedEvent(null)}
              style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, textAlign: "center" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", minHeight: "100vh", background: "#050505", color: "white" }}>
        <div style={{ flex: 3, padding: 30 }}>

          {/* HERO */}
          <div style={{
            position: "relative",
            height: 380,
            marginBottom: 30,
            borderRadius: 20,
            overflow: "hidden",
            background: "black"
          }}>
            <video autoPlay muted loop playsInline style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.35,
              filter: "blur(1px)"
            }}>
              <source src="/videos/A2B.mp4" type="video/mp4" />
            </video>
            <div style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to top, black, transparent 60%)"
            }} />
            <div style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(circle at center, transparent 30%, black 100%)"
            }} />
            <div style={{
              position: "absolute",
              bottom: 25,
              left: 25,
              fontSize: 42,
              fontWeight: 900,
              letterSpacing: 8,
              animation: "pulse 2.5s infinite",
              textShadow: "0 0 20px rgba(0,255,255,0.8)"
            }}>
              2MRRW
            </div>
          </div>

          {/* DONATE BUTTON */}
          <div style={{ marginBottom: 20 }}>
            <button
              onClick={() => window.open("https://www.paypal.com/donate", "_blank")}
              style={{
                padding: "10px 22px",
                background: "#111",
                color: "#00ffff",
                border: "1px solid #00ffff",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: 13,
                letterSpacing: 1,
              }}
            >
              ♥ Donate
            </button>
          </div>

          {/* SOUND TOGGLE */}
          <div style={{ marginBottom: 20 }}>
            <button
              onClick={() => setSoundOn(!soundOn)}
              style={{
                padding: "6px 12px",
                background: "#111",
                color: "white",
                border: "1px solid #333",
                cursor: "pointer"
              }}
            >
              Sound: {soundOn ? "ON" : "OFF"}
            </button>
          </div>

          {/* NAV — ADDED shows and blog */}
          <div style={{
            display: "flex",
            gap: 25,
            marginBottom: 35,
            fontSize: 14,
            letterSpacing: 2,
            borderBottom: "1px solid #333",
            paddingBottom: 10,
            flexWrap: "wrap",
          }}>
            {["home", "singles", "albums", "shop", "shows", "blog"].map((tab) => (
              <div
                key={tab}
                onClick={() => setActiveTab(tab)}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                style={{
                  cursor: "pointer",
                  opacity: activeTab === tab ? 1 : 0.4,
                  transition: "transform 0.2s",
                  display: "inline-block"
                }}
              >
                {tab === "shows" ? "SHOWS & EVENTS" : tab.toUpperCase()}
              </div>
            ))}
          </div>

          {activeTab === "home" && (
            <>
              <h2 className="fade-on-scroll" style={{ opacity: 0, transform: "translateY(20px)", transition: "1s" }}>
                Latest Singles
              </h2>
              <Row
                items={singles}
                type="singles"
                addToCart={addToCart}
                hoverIn={hoverIn}
                hoverOut={hoverOut}
                buttonHoverIn={buttonHoverIn}
                buttonHoverOut={buttonHoverOut}
                onSingleClick={setSelectedSingle}
              />
              <div style={{ margin: "30px 0", height: 1, background: "#222" }} />
              <h2 className="fade-on-scroll" style={{ opacity: 0, transform: "translateY(20px)", transition: "1s" }}>
                Albums
              </h2>
              <Grid
                items={albums}
                type="albums"
                addToCart={addToCart}
                hoverIn={hoverIn}
                hoverOut={hoverOut}
                buttonHoverIn={buttonHoverIn}
                buttonHoverOut={buttonHoverOut}
                onSingleClick={setSelectedAlbum}
              />
            </>
          )}

          {activeTab === "singles" && (
            <Grid
              items={singles}
              type="singles"
              addToCart={addToCart}
              hoverIn={hoverIn}
              hoverOut={hoverOut}
              buttonHoverIn={buttonHoverIn}
              buttonHoverOut={buttonHoverOut}
              onSingleClick={setSelectedSingle}
            />
          )}

          {activeTab === "albums" && (
            <Grid
              items={albums}
              type="albums"
              addToCart={addToCart}
              hoverIn={hoverIn}
              hoverOut={hoverOut}
              buttonHoverIn={buttonHoverIn}
              buttonHoverOut={buttonHoverOut}
              onSingleClick={setSelectedAlbum}
            />
          )}

          {activeTab === "shop" && (
            <Grid
              items={merch}
              type="products"
              addToCart={addToCart}
              hoverIn={hoverIn}
              hoverOut={hoverOut}
              buttonHoverIn={buttonHoverIn}
              buttonHoverOut={buttonHoverOut}
            />
          )}

          {/* ADDED: SHOWS & EVENTS TAB */}
          {activeTab === "shows" && (
            <>
              {/* CALENDAR HERO */}
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
                  {Array.from({ length: getFirstDayOfMonth(calMonth, calYear) }).map((_, i) => (
                    <div key={`empty-${i}`} />
                  ))}
                  {Array.from({ length: getDaysInMonth(calMonth, calYear) }).map((_, i) => {
                    const day = i + 1;
                    const dayShows = getShowsForDay(day);
                    const isToday = new Date().getDate() === day && new Date().getMonth() === calMonth && new Date().getFullYear() === calYear;
                    return (
                      <div
                        key={day}
                        onClick={() => dayShows.length > 0 && setSelectedEvent(dayShows[0])}
                        style={{
                          minHeight: 44,
                          borderRadius: 8,
                          background: dayShows.length > 0 ? "rgba(0,255,255,0.08)" : "transparent",
                          border: isToday ? "1px solid #00ffff" : dayShows.length > 0 ? "1px solid rgba(0,255,255,0.3)" : "1px solid #1a1a1a",
                          cursor: dayShows.length > 0 ? "pointer" : "default",
                          padding: 6,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 3,
                          transition: "0.2s",
                        }}
                      >
                        <span style={{ fontSize: 12, color: isToday ? "#00ffff" : "#aaa" }}>{day}</span>
                        {dayShows.map((s) => (
                          <span key={s.id} style={{ fontSize: 9, background: "#00ffff", color: "#000", borderRadius: 4, padding: "1px 4px", fontWeight: 700 }}>SHOW</span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* UPCOMING SHOWS LIST */}
              <h2 style={{ letterSpacing: 3, fontSize: 14, color: "#555", marginBottom: 16, textTransform: "uppercase" }}>Upcoming Shows</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {shows.map((show) => (
                  <div
                    key={show.id}
                    style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 14, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{show.title}</div>
                      <div style={{ fontSize: 12, color: "#aaa" }}>{show.venue}</div>
                      <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                        {new Date(show.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {show.time}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#00ffff" }}>${show.price.toFixed(2)}</div>
                      <button
                        onClick={() => setSelectedEvent(show)}
                        onMouseEnter={buttonHoverIn}
                        onMouseLeave={buttonHoverOut}
                        style={{ padding: "10px 20px", background: "#111", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontWeight: "bold", fontSize: 13, transition: "0.25s" }}
                      >
                        Get Tickets
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ADDED: COMMUNITY BLOG TAB */}
          {activeTab === "blog" && (
            <>
              {blogPost ? (
                <div>
                  <button
                    onClick={() => setBlogPost(null)}
                    style={{ background: "none", border: "none", color: "#00ffff", cursor: "pointer", fontSize: 13, marginBottom: 20, padding: 0, letterSpacing: 1 }}
                  >
                    ← BACK TO BLOG
                  </button>
                  <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 6, letterSpacing: 1 }}>{blogPost.title}</h1>
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 24 }}>{blogPost.date} · by {blogPost.author}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.9, color: "#ccc", whiteSpace: "pre-line", marginBottom: 40 }}>{blogPost.body}</div>
                  <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: 24 }}>
                    <h3 style={{ fontSize: 13, letterSpacing: 3, color: "#555", marginBottom: 16, textTransform: "uppercase" }}>Comments</h3>
                    {(blogComments[blogPost.id] || []).length === 0 && (
                      <p style={{ fontSize: 13, color: "#444", marginBottom: 20 }}>No comments yet. Be the first.</p>
                    )}
                    {(blogComments[blogPost.id] || []).map((c, i) => (
                      <div key={i} style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#00ffff", marginBottom: 4 }}>{c.name}</div>
                        <div style={{ fontSize: 13, color: "#ccc" }}>{c.text}</div>
                        <div style={{ fontSize: 10, color: "#444", marginTop: 6 }}>{c.time}</div>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                      <input
                        placeholder="Leave a comment…"
                        value={blogComment}
                        onChange={(e) => setBlogComment(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddComment(blogPost.id)}
                        style={{ flex: 1, padding: "10px 14px", background: "#111", border: "1px solid #333", color: "white", borderRadius: 8, fontSize: 13 }}
                      />
                      <button
                        onClick={() => handleAddComment(blogPost.id)}
                        style={{ padding: "10px 18px", background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                      >
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="fade-on-scroll" style={{ opacity: 0, transform: "translateY(20px)", transition: "1s", marginBottom: 24 }}>Community Blog</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {blogPosts.map((post) => (
                      <div
                        key={post.id}
                        onClick={() => setBlogPost(post)}
                        style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, cursor: "pointer", transition: "0.25s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00ffff"; e.currentTarget.style.boxShadow = "0 0 16px rgba(0,255,255,0.1)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e1e1e"; e.currentTarget.style.boxShadow = "none"; }}
                      >
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
            <div
              key={i}
              style={{
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                gap: 8
              }}
            >
              {item.cover && (
                <img
                  src={item.cover}
                  style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }}
                />
              )}

              <span style={{ fontSize: 13 }}>
                {item.title} – ${item.price.toFixed(2)}
              </span>

              <button
                onClick={() => removeFromCart(i)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#fff";
                  e.currentTarget.style.textShadow = "0 0 8px rgba(255,255,255,0.8)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#666";
                  e.currentTarget.style.textShadow = "none";
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#666",
                  fontSize: 16,
                  cursor: "pointer",
                  marginLeft: "auto",
                  transition: "0.2s"
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div style={{ marginTop: 20 }}>
            <strong>Total: ${total.toFixed(2)}</strong>
          </div>
          <button onClick={clearCart} style={{
            marginTop: 15,
            width: "100%",
            padding: 14,
            background: "red",
            color: "white",
            fontWeight: "bold",
            border: "none",
            cursor: "pointer"
          }}>
            CLEAR CART
          </button>
          <button
            onClick={handleCheckout}
            disabled={checkingOut || cart.length === 0}
            onMouseEnter={buttonHoverIn}
            onMouseLeave={buttonHoverOut}
            style={{
              marginTop: 10,
              width: "100%",
              padding: 12,
              background: "#111",
              color: "white",
              border: "1px solid #333",
              cursor: "pointer",
              transition: "0.25s"
            }}
          >
            {checkingOut ? "Redirecting…" : "Checkout"}
          </button>
          {checkoutError && <p style={{ color: "red", fontSize: 12, marginTop: 8 }}>{checkoutError}</p>}
          {currentUser && <p style={{ fontSize: 11, color: "#555", marginTop: 12, textAlign: "center" }}>Signed in as {currentUser.name}</p>}
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.85; }
          100% { transform: scale(1); opacity: 1; }
        }
        .singles-row::-webkit-scrollbar { height: 4px; }
        .singles-row::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
        .singles-row::-webkit-scrollbar-thumb { background: #00ffff; border-radius: 4px; }
        .singles-row::-webkit-scrollbar-thumb:hover { background: #00cccc; }
      `}</style>

      {/* CHECKOUT MODAL */}
      {clientSecret && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.9)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#0a0a0a",
              padding: 30,
              borderRadius: 20,
              width: 400,
              border: "1px solid #222",
            }}
          >
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CheckoutForm
                onSuccess={() => {
                  setClientSecret(null);
                  setCheckingOut(false);
                  clearCart();
                }}
              />
            </Elements>

            <button
              onClick={() => { setClientSecret(null); setCheckingOut(false); }}
              style={{
                marginTop: 10,
                width: "100%",
                padding: 10,
                background: "none",
                border: "1px solid #333",
                color: "#777",
                cursor: "pointer",
              }}
            >
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
          <img
            src={item.cover}
            onClick={() => onSingleClick ? onSingleClick(item) : null}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            style={{ width: 180, height: 180, borderRadius: 14, cursor: "pointer", transition: "0.25s" }}
          />
          <div>{item.title}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>${item.price}</div>
          <button
            onClick={() => addToCart(item)}
            onMouseEnter={buttonHoverIn}
            onMouseLeave={buttonHoverOut}
            style={{
              marginTop: 6,
              padding: "6px 10px",
              fontSize: 12,
              background: "#1f1f1f",
              color: "white",
              border: "1px solid #333",
              cursor: "pointer",
              borderRadius: 6,
              transition: "0.25s"
            }}
          >
            Add to Cart
          </button>
        </div>
      ))}
    </div>
  );
}

function Grid({ items, type, addToCart, hoverIn, hoverOut, buttonHoverIn, buttonHoverOut, onSingleClick }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
      gap: 20
    }}>
      {items.map((item) => (
        <div key={item.slug} style={{ position: "relative" }}>
          <img
            src={item.cover}
            onClick={() => onSingleClick ? onSingleClick(item) : null}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            style={{ width: "100%", height: 200, borderRadius: 14, cursor: "pointer", transition: "0.25s" }}
          />
          <div>{item.title}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>${item.price}</div>
          <button
            onClick={() => addToCart(item)}
            onMouseEnter={buttonHoverIn}
            onMouseLeave={buttonHoverOut}
            style={{
              marginTop: 6,
              padding: "6px 10px",
              fontSize: 12,
              background: "#1f1f1f",
              color: "white",
              border: "1px solid #333",
              cursor: "pointer",
              borderRadius: 6,
              transition: "0.25s"
            }}
          >
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

    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />

      <button
        type="submit"
        disabled={!stripe || loading}
        style={{
          marginTop: 20,
          width: "100%",
          padding: 12,
          background: "#00ffff",
          color: "#000",
          fontWeight: "bold",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        {loading ? "Processing…" : "Pay Now"}
      </button>

      {error && (
        <p style={{ color: "red", fontSize: 12, marginTop: 10 }}>
          {error}
        </p>
      )}
    </form>
  );
}
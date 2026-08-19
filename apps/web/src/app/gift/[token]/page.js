"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import GiftRevealExperience from "@/components/gifts/GiftRevealExperience";
import { hasSeenGiftReveal } from "@/lib/gifts/session-keys";

const VALID_GENDERS = ["male", "female"];
const VALID_AGE_RANGES = ["18-25", "25-40", "40-65"];

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "white",
  borderRadius: 10,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export default function GiftClaimPage() {
  const { token } = useParams();
  const router = useRouter();
  const { refreshAccountState, user, loading: authLoading, applySessionUser } = useAuth();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [emailMismatch, setEmailMismatch] = useState(false);
  const [revealPayload, setRevealPayload] = useState(null);
  const claimAttemptedRef = useRef(false);

  // Inline signup form state (for gift recipients without an account)
  const [password, setPassword] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [formError, setFormError] = useState("");
  const [existsHint, setExistsHint] = useState(false);
  const signupFlightRef = useRef(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/gifts/preview/${token}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gift not found");
      setPreview(data);
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void loadPreview();
  }, [token, loadPreview]);

  const beginReveal = useCallback(
    (payload) => {
      const giftMeta = preview?.gift;
      if (!giftMeta?.id) return;
      setRevealPayload({
        giftId: giftMeta.id,
        title: payload?.item_title || giftMeta.item_title,
        message: giftMeta.message,
        coverUrl: payload?.cover_url || preview?.cover_url,
        coverImageUrl: payload?.cover_image_url || preview?.cover_image_url,
        coverArtType: payload?.cover_art_type || preview?.cover_art_type,
        productSlug: payload?.product_slug || preview?.product_slug,
      });
    },
    [preview]
  );

  // Claim for already-logged-in users
  const claim = useCallback(async () => {
    setClaiming(true);
    setError("");
    setEmailMismatch(false);
    try {
      const res = await fetch(`/api/gifts/claim/${token}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (data.requiresSignup) {
        // Shouldn't happen since we now show inline form, but safety fallback
        router.push(`/join?gift=${token}`);
        return;
      }
      if (data.error === "email_mismatch") {
        setEmailMismatch(true);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Could not claim gift");
      await refreshAccountState({ reason: "purchase:completed", source: "gift/[token]", force: true });
      beginReveal(data);
    } catch (err) {
      setError(err.message);
      claimAttemptedRef.current = false;
    } finally {
      setClaiming(false);
    }
  }, [token, router, refreshAccountState, beginReveal]);

  // Inline signup + atomic claim for new recipients
  const handleSignupClaim = useCallback(async (e) => {
    e.preventDefault();
    setFormError("");
    setExistsHint(false);

    const recipientEmail = String(preview?.gift?.recipient_email || "").toLowerCase();
    if (!password || password.length < 8) { setFormError("Password must be at least 8 characters"); return; }
    if (!city.trim()) { setFormError("City is required"); return; }
    if (!state.trim()) { setFormError("State is required"); return; }
    if (!VALID_GENDERS.includes(gender)) { setFormError("Please select your gender"); return; }
    if (!VALID_AGE_RANGES.includes(ageRange)) { setFormError("Please select your age range"); return; }
    if (signupFlightRef.current) return;
    signupFlightRef.current = true;
    setClaiming(true);

    try {
      const res = await fetch("/api/gifts/claim-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: recipientEmail,
          password,
          giftToken: token,
          city: city.trim(),
          state: state.trim(),
          gender,
          age_range: ageRange,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.existsHint) {
          setExistsHint(true);
          setFormError("An account with this email already exists.");
        } else if (data.error === "email_mismatch") {
          setFormError(data.message || "This gift was sent to a different email address.");
        } else {
          setFormError(data.error || "Account creation failed. Please try again.");
        }
        return;
      }

      await applySessionUser(data.session);

      // If the server atomically claimed the gift, launch the reveal immediately
      if (data.gift?.gift_id) {
        setRevealPayload({
          giftId: data.gift.gift_id,
          title: data.gift.item_title || preview?.gift?.item_title,
          message: preview?.gift?.message,
          coverUrl: data.gift.cover_url || preview?.cover_url,
          coverImageUrl: data.gift.cover_image_url || preview?.cover_image_url,
          coverArtType: data.gift.cover_art_type || preview?.cover_art_type,
          productSlug: data.gift.product_slug || preview?.product_slug,
        });
      } else {
        // Atomic claim failed on the server; reload preview so the auto-claim effect fires
        await loadPreview();
      }
    } catch (err) {
      setFormError(err.message || "Something went wrong. Please try again.");
    } finally {
      signupFlightRef.current = false;
      setClaiming(false);
    }
  }, [preview, password, city, state, gender, ageRange, token, applySessionUser, loadPreview]);

  const state_ = preview?.state || "invalid";
  const gift = preview?.gift;
  const cover = preview?.cover_image_url || preview?.cover_url;
  const isRecipient = Boolean(user?.id && gift?.recipient_id === user.id);
  const revealSeen = gift?.id ? hasSeenGiftReveal(gift.id) : false;

  const giftEmail = String(gift?.recipient_email || "").toLowerCase();
  const userEmail = String(user?.email || "").toLowerCase();
  const emailWouldMismatch = Boolean(giftEmail && userEmail && giftEmail !== userEmail);

  // Auto-claim for already-logged-in correct recipients
  useEffect(() => {
    if (authLoading || loading || !user || !preview?.gift || revealSeen || revealPayload) return;
    if (emailWouldMismatch) return;
    if (state_ !== "valid" && !(state_ === "claimed" && isRecipient)) return;
    if (claimAttemptedRef.current) return;
    claimAttemptedRef.current = true;
    void claim();
  }, [authLoading, loading, user, preview, revealSeen, revealPayload, state_, isRecipient, emailWouldMismatch, claim, gift]);

  const handleRevealFinished = useCallback(() => {
    router.push("/");
  }, [router]);

  if (revealPayload?.giftId) {
    return (
      <GiftRevealExperience
        giftId={revealPayload.giftId}
        title={revealPayload.title}
        message={revealPayload.message}
        coverUrl={revealPayload.coverUrl}
        coverImageUrl={revealPayload.coverImageUrl}
        coverArtType={revealPayload.coverArtType}
        productSlug={revealPayload.productSlug}
        onFinished={handleRevealFinished}
      />
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#050505", color: "white", fontFamily: "sans-serif" }}>
      {/* Hero — blurred cover art for mystery */}
      <div style={{ minHeight: 260, position: "relative", overflow: "hidden", background: "linear-gradient(135deg, #0a0a12 0%, #050505 60%)" }}>
        {cover ? (
          <>
            <div style={{
              position: "absolute", inset: "-12px",
              backgroundImage: `url(${cover})`,
              backgroundSize: "cover", backgroundPosition: "center",
              filter: "blur(28px) brightness(0.35) saturate(0.6)",
              transform: "scale(1.1)",
            }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 0%, #050505 85%)" }} />
            {/* Foreground cover art: blurred to match the email teaser */}
            <div style={{
              position: "absolute", left: "50%", top: "50%",
              transform: "translate(-50%, -50%)",
              width: 130, height: 130, borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 8px 48px rgba(0,0,0,0.7)",
            }}>
              <img src={cover} alt="" aria-hidden style={{
                width: "100%", height: "100%", objectFit: "cover",
                filter: "blur(10px) brightness(0.65) saturate(0.75)",
                transform: "scale(1.08)",
              }} />
            </div>
            {/* Subtle "gift" label over the blur */}
            <div style={{
              position: "absolute", left: "50%", top: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center", pointerEvents: "none",
            }}>
              <span style={{ fontSize: 11, letterSpacing: 4, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", fontWeight: 700, textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}>
                Your gift
              </span>
            </div>
          </>
        ) : null}
      </div>

      <div style={{ maxWidth: 480, margin: "-60px auto 0", padding: "0 24px 60px", position: "relative" }}>
        {loading || authLoading ? (
          <p style={{ color: "#666", fontSize: 14 }}>Loading gift…</p>
        ) : null}

        {/* ── VALID STATE ──────────────────────────────────────────────── */}
        {!loading && state_ === "valid" ? (
          <>
            <p style={{ fontSize: 11, letterSpacing: 3, color: "#a259ff", textTransform: "uppercase", marginBottom: 8 }}>
              Gift from 2MRRW
            </p>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: "0 0 6px", lineHeight: 1.2 }}>
              You have a gift waiting
            </h1>
            {gift?.item_title ? (
              <div style={{ display: "inline-block", marginBottom: 14, padding: "4px 10px", borderRadius: 999, background: "#1a1a1a", fontSize: 11, color: "#aaa" }}>
                {gift.item_type || "release"} · {gift.item_title}
              </div>
            ) : null}
            {gift?.message ? (
              <div style={{ padding: 14, borderRadius: 12, background: "rgba(162,89,255,0.08)", border: "1px solid rgba(162,89,255,0.2)", marginBottom: 20, fontSize: 13, lineHeight: 1.7, color: "#ddd" }}>
                {gift.message}
              </div>
            ) : null}
            <p style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>Claim before {formatDate(gift?.expires_at)}</p>

            {/* ── Logged-in correct recipient ── */}
            {user && !emailWouldMismatch ? (
              <button
                type="button"
                onClick={() => void claim()}
                disabled={claiming}
                style={{ width: "100%", padding: "14px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", opacity: claiming ? 0.7 : 1, fontSize: 15 }}
              >
                {claiming ? "Opening your gift…" : "Open Your Gift"}
              </button>
            ) : user && emailWouldMismatch ? (
              /* ── Wrong account (admin viewing, etc.) ── */
              <div style={{ padding: 16, borderRadius: 14, background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)" }}>
                <p style={{ margin: "0 0 12px", fontSize: 14, color: "#ffaaaa", lineHeight: 1.6 }}>
                  This gift was sent to {giftEmail}. Sign in with that account to claim it.
                </p>
                <Link href={`/login?gift=${token}`} style={{ color: "#00ffff", fontSize: 13, fontWeight: 700 }}>
                  Sign in with the correct account →
                </Link>
              </div>
            ) : (
              /* ── Not logged in — inline sign-up form ── */
              <form onSubmit={handleSignupClaim} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>
                  Create your account to reveal your gift
                </div>

                {/* Email — pre-filled, read-only */}
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 5, letterSpacing: 1 }}>EMAIL</label>
                  <input
                    type="email"
                    value={giftEmail}
                    readOnly
                    style={{ ...inputStyle, color: "#aaa", cursor: "default", background: "rgba(255,255,255,0.03)" }}
                  />
                </div>

                {/* Password */}
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 5, letterSpacing: 1 }}>PASSWORD</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    required
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                </div>

                {/* City + State row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 5, letterSpacing: 1 }}>CITY</label>
                    <input
                      type="text"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      placeholder="Dallas"
                      required
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 5, letterSpacing: 1 }}>STATE</label>
                    <input
                      type="text"
                      value={state}
                      onChange={e => setState(e.target.value)}
                      placeholder="TX"
                      required
                      maxLength={2}
                      style={{ ...inputStyle, textTransform: "uppercase" }}
                    />
                  </div>
                </div>

                {/* Gender */}
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 8, letterSpacing: 1 }}>GENDER</label>
                  <div style={{ display: "flex", gap: 10 }}>
                    {VALID_GENDERS.map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGender(g)}
                        style={{
                          flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid",
                          borderColor: gender === g ? "#a259ff" : "rgba(255,255,255,0.1)",
                          background: gender === g ? "rgba(162,89,255,0.15)" : "rgba(255,255,255,0.03)",
                          color: gender === g ? "#c9b8ff" : "#888",
                          fontWeight: gender === g ? 700 : 400,
                          fontSize: 13, cursor: "pointer", textTransform: "capitalize",
                          fontFamily: "inherit",
                        }}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Age range */}
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 8, letterSpacing: 1 }}>AGE RANGE</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {VALID_AGE_RANGES.map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setAgeRange(r)}
                        style={{
                          flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid",
                          borderColor: ageRange === r ? "#00ffff" : "rgba(255,255,255,0.1)",
                          background: ageRange === r ? "rgba(0,255,255,0.08)" : "rgba(255,255,255,0.03)",
                          color: ageRange === r ? "#00ffff" : "#888",
                          fontWeight: ageRange === r ? 700 : 400,
                          fontSize: 13, cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {formError ? (
                  <div style={{ fontSize: 13, color: "#ff6b6b" }}>{formError}</div>
                ) : null}
                {existsHint ? (
                  <Link href={`/login?gift=${token}`} style={{ color: "#00ffff", fontSize: 13 }}>
                    Sign in to claim your gift →
                  </Link>
                ) : null}

                <button
                  type="submit"
                  disabled={claiming}
                  style={{
                    width: "100%", padding: "15px 0",
                    background: claiming ? "#555" : "#a259ff",
                    color: "#fff", fontWeight: 900, border: "none", borderRadius: 10,
                    cursor: claiming ? "wait" : "pointer", fontSize: 15, marginTop: 4,
                    fontFamily: "inherit",
                  }}
                >
                  {claiming ? "Setting up your account…" : "Reveal My Gift"}
                </button>

                <Link href={`/login?gift=${token}`} style={{ color: "#555", fontSize: 12, textAlign: "center" }}>
                  Already have an account? Sign in
                </Link>
              </form>
            )}
          </>
        ) : null}

        {/* ── OTHER STATES ───────────────────────────────────────────── */}
        {state_ === "expired" ? (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>This gift has expired</h1>
            <Link href="/" style={{ color: "#00ffff", fontSize: 14, marginTop: 16, display: "inline-block" }}>Back to storefront</Link>
          </>
        ) : null}

        {state_ === "revoked" ? (
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>This gift is no longer available</h1>
        ) : null}

        {state_ === "claimed" && !revealPayload ? (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>This gift has already been claimed</h1>
            {isRecipient ? (
              <Link href="/?tab=mymusic" style={{ color: "#00ffff", fontSize: 14 }}>View in your collection →</Link>
            ) : null}
          </>
        ) : null}

        {emailMismatch ? (
          <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.25)" }}>
            <p style={{ margin: "0 0 14px", fontSize: 14, color: "#ffaaaa", lineHeight: 1.6 }}>
              This gift was sent to {giftEmail || "a different email"}. Sign in with the correct account to claim it.
            </p>
            <Link
              href={`/login?gift=${token}`}
              style={{ display: "block", textAlign: "center", padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, borderRadius: 10, textDecoration: "none", fontSize: 14 }}
            >
              Sign in with the correct account
            </Link>
          </div>
        ) : null}

        {error && !emailMismatch ? (
          <p style={{ color: "#ff6b6b", fontSize: 13, marginTop: 16 }}>{error}</p>
        ) : null}
      </div>
    </main>
  );
}

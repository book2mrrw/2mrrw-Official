"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import GiftRevealExperience from "@/components/gifts/GiftRevealExperience";
import { hasSeenGiftReveal } from "@/lib/gifts/session-keys";

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function GiftClaimPage() {
  const { token } = useParams();
  const router = useRouter();
  const { refreshAccountState, signOut, user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [emailMismatch, setEmailMismatch] = useState(false);
  const [revealPayload, setRevealPayload] = useState(null);
  const claimAttemptedRef = useRef(false);

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
        router.push(`/join?gift=${token}`);
        return;
      }
      if (data.error === "email_mismatch") {
        setEmailMismatch(true);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Could not claim gift");
      await refreshAccountState({
        reason: "purchase:completed",
        source: "gift/[token]",
        force: true,
      });
      beginReveal(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setClaiming(false);
    }
  }, [token, router, refreshAccountState, beginReveal]);

  const state = preview?.state || "invalid";
  const gift = preview?.gift;
  const cover = preview?.cover_image_url || preview?.cover_url;
  const isRecipient = Boolean(user?.id && gift?.recipient_id === user.id);
  const revealSeen = gift?.id ? hasSeenGiftReveal(gift.id) : false;

  useEffect(() => {
    if (authLoading || loading || !user || !preview?.gift || revealSeen || revealPayload) return;
    if (state !== "valid" && !(state === "claimed" && isRecipient)) return;
    if (claimAttemptedRef.current) return;
    claimAttemptedRef.current = true;
    // For claimed+recipient: still call claim() — the API will re-grant the library item
    // if it was never written (idempotent upsert), then refreshAccountState fires so
    // the item reflects immediately without a manual page refresh.
    void claim();
  }, [
    authLoading,
    loading,
    user,
    preview,
    revealSeen,
    revealPayload,
    state,
    isRecipient,
    claim,
    gift,
  ]);

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
    <main
      style={{
        minHeight: "100vh",
        background: "#050505",
        color: "white",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          minHeight: 280,
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #0a0a12 0%, #050505 60%)",
        }}
      >
        {cover ? (
          <>
            <div
              style={{
                position: "absolute",
                inset: "-12px",
                backgroundImage: `url(${cover})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(22px) brightness(0.45) saturate(0.8)",
                transform: "scale(1.08)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg, transparent 0%, #050505 90%)",
              }}
            />
            <img
              src={cover}
              alt=""
              aria-hidden
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 140,
                height: 140,
                objectFit: "cover",
                borderRadius: 16,
                boxShadow: "0 8px 48px rgba(0,0,0,0.7)",
                opacity: 0.92,
              }}
            />
          </>
        ) : null}
      </div>
      <div style={{ maxWidth: 520, margin: "-80px auto 0", padding: "0 24px 48px", position: "relative" }}>
        {loading || authLoading ? (
          <p style={{ color: "#666", fontSize: 14 }}>Loading gift…</p>
        ) : null}

        {!loading && state === "valid" ? (
          <>
            <p style={{ fontSize: 11, letterSpacing: 3, color: "#a259ff", textTransform: "uppercase", marginBottom: 8 }}>
              Gift from 2MRRW
            </p>
            <h1 style={{ fontSize: 28, fontWeight: 900, margin: "0 0 8px" }}>You have a gift waiting</h1>
            {gift?.item_title ? (
              <div
                style={{
                  display: "inline-block",
                  marginBottom: 16,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "#1a1a1a",
                  fontSize: 11,
                  color: "#aaa",
                }}
              >
                {gift.item_type || "release"} · {gift.item_title}
              </div>
            ) : null}
            {gift?.message ? (
              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: "rgba(162,89,255,0.08)",
                  border: "1px solid rgba(162,89,255,0.2)",
                  marginBottom: 20,
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "#ddd",
                }}
              >
                {gift.message}
              </div>
            ) : null}
            <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Claim before {formatDate(gift?.expires_at)}</p>

            {user ? (
              <button
                type="button"
                onClick={() => void claim()}
                disabled={claiming}
                style={{
                  width: "100%",
                  padding: "14px 0",
                  background: "#00ffff",
                  color: "#000",
                  fontWeight: 900,
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  opacity: claiming ? 0.7 : 1,
                }}
              >
                {claiming ? "Opening your gift…" : "Open Your Gift"}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Link
                  href={`/join?gift=${token}`}
                  style={{
                    display: "block",
                    textAlign: "center",
                    padding: "14px 0",
                    background: "#00ffff",
                    color: "#000",
                    fontWeight: 900,
                    borderRadius: 10,
                    textDecoration: "none",
                  }}
                >
                  Create Account to Claim
                </Link>
                <Link href={`/login?gift=${token}`} style={{ color: "#00ffff", fontSize: 13, textAlign: "center" }}>
                  Already have an account? Sign in
                </Link>
              </div>
            )}
          </>
        ) : null}

        {state === "expired" ? (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>This gift has expired</h1>
            <Link href="/" style={{ color: "#00ffff", fontSize: 14, marginTop: 16, display: "inline-block" }}>
              Back to storefront
            </Link>
          </>
        ) : null}

        {state === "revoked" ? (
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>This gift is no longer available</h1>
        ) : null}

        {state === "claimed" && !revealPayload ? (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>This gift has already been claimed</h1>
            {isRecipient ? (
              <Link href="/?tab=mymusic" style={{ color: "#00ffff", fontSize: 14 }}>
                View in your collection →
              </Link>
            ) : null}
          </>
        ) : null}

        {emailMismatch ? (
          <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.25)" }}>
            <p style={{ margin: "0 0 14px", fontSize: 14, color: "#ffaaaa", lineHeight: 1.6 }}>
              This gift was sent to a different email address. Sign out and sign in with the correct account to claim it.
            </p>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.push(`/login?gift=${token}`);
              }}
              style={{ width: "100%", padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14 }}
            >
              Sign out &amp; sign in with the correct account
            </button>
          </div>
        ) : null}
        {error && !emailMismatch ? <p style={{ color: "#ff6b6b", fontSize: 13, marginTop: 16 }}>{error}</p> : null}
      </div>
    </main>
  );
}

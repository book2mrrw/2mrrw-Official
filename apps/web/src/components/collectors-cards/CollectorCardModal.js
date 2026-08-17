"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { benefitsForCard, editionLabel } from "./collectorCardCatalog";
import CheckoutForm from "@/components/payments/CheckoutForm";
import { stripePaymentOverlayStyle, stripePaymentPanelStyle } from "@/components/payments/stripePaymentShell";
import { useAuth } from "@/context/AuthContext";
import {
  cartLineFromCard,
  confirmCollectorPurchase,
  createCollectorPaymentIntent,
} from "@/lib/collectors-cards/purchase";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

export function CollectorCardModal({ card, remaining, onClose, isMobile, onPurchaseComplete }) {
  const { currentUser, owns, enterGuest, refreshAccountState, refreshLibrary } = useAuth();

  const [clientSecret, setClientSecret] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [showIdentity, setShowIdentity] = useState(false);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [identityPhone, setIdentityPhone] = useState("");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setClientSecret(null);
    setPurchaseError("");
    setShowIdentity(false);
    setPreparing(false);
  }, [card?.slug]);

  const resetPayment = useCallback(() => {
    setClientSecret(null);
    setPreparing(false);
    setPurchaseError("");
  }, []);

  if (!card) return null;

  const soldOut = remaining <= 0;
  const alreadyOwned = owns(card.slug);
  const benefits = benefitsForCard(card);
  const accent = card.accentColor;

  const startPaymentIntent = async () => {
    setPreparing(true);
    setPurchaseError("");
    try {
      const line = cartLineFromCard(card);
      if (!line) throw new Error("Invalid collector card");
      const secret = await createCollectorPaymentIntent([line]);
      setClientSecret(secret);
    } catch (err) {
      setPurchaseError(err.message || "Could not start checkout.");
    } finally {
      setPreparing(false);
    }
  };

  const ensureIdentity = async () => {
    if (currentUser) return true;
    if (!identityEmail.trim() || !identityPhone.trim()) {
      setPurchaseError("Enter email and phone before checkout.");
      return false;
    }
    setIdentityLoading(true);
    setPurchaseError("");
    try {
      await enterGuest({
        email: identityEmail.trim(),
        phone: identityPhone.trim(),
        name: identityName.trim(),
      });
      return true;
    } catch (err) {
      setPurchaseError(err.message || "Could not continue.");
      return false;
    } finally {
      setIdentityLoading(false);
    }
  };

  const handlePurchase = async () => {
    if (soldOut || alreadyOwned) return;
    if (!currentUser) {
      setShowIdentity(true);
      return;
    }
    await startPaymentIntent();
  };

  const handleIdentityContinue = async () => {
    const ok = await ensureIdentity();
    if (!ok) return;
    setShowIdentity(false);
    await startPaymentIntent();
  };

  const handleCheckoutSuccess = async (paymentIntentId) => {
    await confirmCollectorPurchase(paymentIntentId);
    await Promise.all([
      refreshAccountState({ reason: "collector:updated", source: "CollectorCardModal", force: true }),
      refreshLibrary({ reason: "collector:updated", source: "CollectorCardModal" }),
    ]);
    onPurchaseComplete?.(card.slug);
    resetPayment();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="collector-card-modal-title"
      onClick={onClose}
      style={{
        ...stripePaymentOverlayStyle({ isMobile, zIndex: 10000, padding: isMobile ? 0 : 24 }),
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...stripePaymentPanelStyle({ isMobile, maxWidth: 420 }),
          background: "#0d0d0d",
          border: `1px solid ${accent}33`,
          borderRadius: isMobile ? "20px 20px 0 0" : 24,
          padding: isMobile ? "20px 20px max(20px, env(safe-area-inset-bottom))" : 28,
          boxShadow: `0 0 60px ${accent}18`,
          alignSelf: isMobile ? "flex-end" : "center",
        }}
      >
        {!clientSecret && (
          <>
            <div style={{ position: "relative", marginBottom: 16 }}>
              {card.faceType === "video" && card.videoSrc ? (
                <video
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  data-cinematic-video="true"
                  src={card.videoSrc}
                  poster={card.artwork}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  style={{
                    width: "100%",
                    height: 220,
                    objectFit: "cover",
                    borderRadius: 14,
                    display: "block",
                  }}
                />
              ) : (
                <img
                  src={card.artwork}
                  alt=""
                  style={{
                    width: "100%",
                    height: 220,
                    objectFit: "cover",
                    borderRadius: 14,
                    display: "block",
                  }}
                />
              )}
            </div>

            <h2
              id="collector-card-modal-title"
              style={{
                fontSize: 20,
                fontWeight: 900,
                letterSpacing: 1,
                margin: "0 0 6px",
              }}
            >
              {card.modalTitle}
            </h2>

            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: accent }}>${card.price.toFixed(2)}</div>
              <div style={{ fontSize: 12, color: soldOut ? "#ff4d4d" : "#888" }}>
                {soldOut ? "Sold out" : alreadyOwned ? "Owned" : `${remaining} remaining · ${editionLabel(card)}`}
              </div>
            </div>

            <ul
              style={{
                listStyle: "none",
                margin: "0 0 20px",
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {benefits.map((line) => (
                <li
                  key={line}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    fontSize: 13,
                    color: "#ccc",
                    lineHeight: 1.5,
                    borderBottom: "1px solid #111",
                    paddingBottom: 8,
                  }}
                >
                  <span style={{ color: accent, flexShrink: 0 }}>✓</span>
                  {line}
                </li>
              ))}
            </ul>

            {showIdentity && !currentUser && (
              <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 10, color: "#777", letterSpacing: 2, textTransform: "uppercase" }}>
                  Account for unlock
                </div>
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={identityName}
                  onChange={(e) => setIdentityName(e.target.value)}
                  style={identityInputStyle}
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={identityEmail}
                  onChange={(e) => setIdentityEmail(e.target.value)}
                  style={identityInputStyle}
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={identityPhone}
                  onChange={(e) => setIdentityPhone(e.target.value)}
                  style={identityInputStyle}
                />
                <button
                  type="button"
                  onClick={handleIdentityContinue}
                  disabled={identityLoading || preparing}
                  style={{
                    padding: "11px 16px",
                    background: accent,
                    color: "#000",
                    fontWeight: 900,
                    border: "none",
                    borderRadius: 10,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {identityLoading || preparing ? "Preparing…" : "Continue to payment"}
                </button>
              </div>
            )}

            {purchaseError && (
              <p style={{ color: "#ff4d4d", fontSize: 12, marginBottom: 12 }}>{purchaseError}</p>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={showIdentity && !currentUser ? handleIdentityContinue : handlePurchase}
                disabled={soldOut || alreadyOwned || preparing || identityLoading}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  background: soldOut || alreadyOwned ? "#222" : accent,
                  color: soldOut || alreadyOwned ? "#555" : "#000",
                  fontWeight: 900,
                  border: "none",
                  borderRadius: 10,
                  cursor: soldOut || alreadyOwned ? "not-allowed" : "pointer",
                  fontSize: 14,
                  letterSpacing: 1,
                }}
              >
                {soldOut ? "Sold Out" : alreadyOwned ? "Owned" : preparing ? "Preparing…" : "Purchase"}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "12px 18px",
                  background: "transparent",
                  color: "#888",
                  border: "1px solid #333",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                Close
              </button>
            </div>
          </>
        )}

        {clientSecret && (
          <>
            <div style={{ fontSize: 11, color: accent, letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" }}>
              Collector checkout
            </div>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>{card.modalTitle}</div>
            <div style={{ fontSize: 13, color: "#777", marginBottom: 16 }}>
              ${card.price.toFixed(2)} · Wallets, Link, and card stay on this page.
            </div>
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: "night",
                  variables: {
                    colorPrimary: accent,
                    colorBackground: "#0a0a0a",
                    colorText: "#ffffff",
                    borderRadius: "8px",
                  },
                },
              }}
            >
              <CheckoutForm
                onSuccess={handleCheckoutSuccess}
                requiresShipping
                submitLabel={`Pay $${card.price.toFixed(2)}`}
              />
            </Elements>
            {purchaseError && (
              <p style={{ color: "#ff4d4d", fontSize: 12, marginTop: 10 }}>{purchaseError}</p>
            )}
            <button
              type="button"
              onClick={resetPayment}
              style={{
                marginTop: 10,
                width: "100%",
                padding: 10,
                background: "none",
                border: "1px solid #333",
                color: "#777",
                cursor: "pointer",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const identityInputStyle = {
  width: "100%",
  padding: "10px 12px",
  background: "#111",
  border: "1px solid #2a2a2a",
  borderRadius: 8,
  color: "#fff",
  fontSize: 13,
};

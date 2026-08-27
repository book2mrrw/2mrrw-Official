"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getStripeClient } from "@/lib/commerce/stripe-client";
import { Elements } from "@stripe/react-stripe-js";
import CheckoutForm from "@/components/payments/CheckoutForm";
import { stripePaymentOverlayStyle, stripePaymentPanelStyle } from "@/components/payments/stripePaymentShell";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";
import { ModalErrorBoundary } from "@/system/errors";

const PRESET_AMOUNTS = [5, 10, 20, 50];
const MIN_DOLLARS = 1;
const MAX_DOLLARS = 5000;
const OVERLAY_FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.22 } };
const SPRING_SOFT = { type: "spring", stiffness: 280, damping: 32 };
const MODAL_CENTER = { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.96 }, transition: SPRING_SOFT };
const SHEET_UP = { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" }, transition: SPRING_SOFT };

function parseCustomDollars(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const amount = Number(trimmed.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export default function DonateModal({ open, onClose, isMobile }) {
  const [step, setStep] = useState("amount");
  const [presetDollars, setPresetDollars] = useState(10);
  const [useCustom, setUseCustom] = useState(false);
  const [customDollars, setCustomDollars] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clientSecret, setClientSecret] = useState(null);
  const [amountCents, setAmountCents] = useState(null);

  const selectedDollars = useMemo(() => {
    if (useCustom) return parseCustomDollars(customDollars);
    return presetDollars;
  }, [useCustom, customDollars, presetDollars]);

  const resetState = () => {
    setStep("amount");
    setPresetDollars(10);
    setUseCustom(false);
    setCustomDollars("");
    setLoading(false);
    setError("");
    setClientSecret(null);
    setAmountCents(null);
  };

  useEffect(() => {
    if (!open) resetState();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    registerModal("donate-modal");
    return () => unregisterModal("donate-modal");
  }, [open]);

  const handleClose = () => {
    resetState();
    onClose?.();
  };

  const startPayment = async () => {
    const dollars = selectedDollars;
    if (!dollars || dollars < MIN_DOLLARS) {
      setError(`Enter at least $${MIN_DOLLARS}.`);
      return;
    }
    if (dollars > MAX_DOLLARS) {
      setError(`Maximum donation is $${MAX_DOLLARS.toLocaleString()}.`);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/donations/create-payment-intent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: Math.round(dollars * 100) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start donation.");
      if (!data.clientSecret) throw new Error("No payment secret returned.");
      setAmountCents(data.amountCents ?? Math.round(dollars * 100));
      setClientSecret(data.clientSecret);
      setStep("payment");
    } catch (err) {
      setError(err.message || "Donation failed.");
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = () => {
    setClientSecret(null);
    setStep("thanks");
  };

  const backToAmount = () => {
    setClientSecret(null);
    setStep("amount");
    setError("");
  };

  const amountLabel = amountCents != null ? `$${(amountCents / 100).toFixed(2)}` : null;

  return (
    <ModalErrorBoundary stackId="donate-modal" onClose={handleClose} resetKey={open ? "open" : "closed"}>
    <AnimatePresence>
      {open && (
        <motion.div
          key="donate-modal"
          {...OVERLAY_FADE}
          style={{
            ...stripePaymentOverlayStyle({ isMobile, padding: isMobile ? 0 : 16 }),
            background: "rgba(0,0,0,0.9)",
          }}
          onClick={handleClose}
        >
          <motion.div
            {...(isMobile ? SHEET_UP : MODAL_CENTER)}
            onClick={(e) => e.stopPropagation()}
            style={{
              ...stripePaymentPanelStyle({ isMobile, maxWidth: 400 }),
              background: "#0a0a0a",
              padding: isMobile ? "20px 20px max(20px, env(safe-area-inset-bottom))" : 30,
              borderRadius: isMobile ? "20px 20px 0 0" : 20,
              border: "1px solid #222",
              alignSelf: isMobile ? "flex-end" : "center",
            }}
          >
            {step === "thanks" ? (
              <>
                <div style={{ fontSize: 11, color: "#00ffff", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" }}>Thank you</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Your support means everything</div>
                <p style={{ fontSize: 13, color: "#888", lineHeight: 1.7, marginBottom: 20 }}>
                  {amountLabel ? `Your ${amountLabel} donation was received.` : "Your donation was received."} Thank you for supporting 2MRRW.
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  style={{ width: "100%", padding: 12, background: "#00ffff", color: "#000", fontWeight: "bold", border: "none", borderRadius: 8, cursor: "pointer" }}
                >
                  Close
                </button>
              </>
            ) : step === "payment" && clientSecret ? (
              <>
                <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 8, textTransform: "uppercase" }}>Donate</div>
                <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>{amountLabel || "One-time support"}</div>
                <p style={{ fontSize: 12, color: "#777", lineHeight: 1.6, marginBottom: 16 }}>Wallets, Link, and card stay in-app. No redirect.</p>
                <Elements
                  stripe={getStripeClient()}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: "night",
                      variables: { colorPrimary: "#00ffff", colorBackground: "#0a0a0a", colorText: "#ffffff", borderRadius: "8px" },
                    },
                  }}
                >
                  <CheckoutForm onSuccess={handlePaymentSuccess} requiresShipping={false} submitLabel="Donate" />
                </Elements>
                <button
                  type="button"
                  onClick={backToAmount}
                  style={{ marginTop: 10, width: "100%", padding: 10, background: "none", border: "1px solid #333", color: "#777", cursor: "pointer", borderRadius: 8 }}
                >
                  Change amount
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" }}>Donate</div>
                <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>Support 2MRRW</div>
                <p style={{ fontSize: 12, color: "#777", lineHeight: 1.6, marginBottom: 16 }}>Choose a one-time amount. Payment stays on this page.</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
                  {PRESET_AMOUNTS.map((amount) => {
                    const active = !useCustom && presetDollars === amount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => {
                          setUseCustom(false);
                          setPresetDollars(amount);
                          setError("");
                        }}
                        style={{
                          padding: "12px 0",
                          borderRadius: 8,
                          border: active ? "1px solid #00ffff" : "1px solid #333",
                          background: active ? "rgba(0,255,255,0.08)" : "#111",
                          color: active ? "#00ffff" : "#ccc",
                          fontWeight: 800,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        ${amount}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setUseCustom(true);
                    setError("");
                  }}
                  style={{
                    width: "100%",
                    marginBottom: useCustom ? 10 : 16,
                    padding: 10,
                    borderRadius: 8,
                    border: useCustom ? "1px solid #00ffff" : "1px solid #333",
                    background: useCustom ? "rgba(0,255,255,0.06)" : "transparent",
                    color: useCustom ? "#00ffff" : "#888",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Custom amount
                </button>
                {useCustom && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", fontSize: 10, color: "#666", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
                      Amount (USD)
                    </label>
                    <input
                      type="number"
                      min={MIN_DOLLARS}
                      max={MAX_DOLLARS}
                      step="0.01"
                      value={customDollars}
                      onChange={(e) => {
                        setCustomDollars(e.target.value);
                        setError("");
                      }}
                      placeholder="Enter amount"
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 8,
                        border: "1px solid #333",
                        background: "#111",
                        color: "#fff",
                        fontSize: 16,
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={startPayment}
                  disabled={loading || selectedDollars == null}
                  style={{
                    width: "100%",
                    padding: 12,
                    background: "#00ffff",
                    color: "#000",
                    fontWeight: "bold",
                    border: "none",
                    borderRadius: 8,
                    cursor: loading || selectedDollars == null ? "not-allowed" : "pointer",
                    opacity: loading || selectedDollars == null ? 0.6 : 1,
                  }}
                >
                  {loading ? "Loading…" : selectedDollars != null ? `Continue · $${selectedDollars.toFixed(selectedDollars % 1 ? 2 : 0)}` : "Continue"}
                </button>
                {error && <p style={{ color: "#ff4d4d", fontSize: 12, marginTop: 10 }}>{error}</p>}
                <button
                  type="button"
                  onClick={handleClose}
                  style={{ marginTop: 10, width: "100%", padding: 10, background: "none", border: "1px solid #333", color: "#777", cursor: "pointer", borderRadius: 8 }}
                >
                  Cancel
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </ModalErrorBoundary>
  );
}

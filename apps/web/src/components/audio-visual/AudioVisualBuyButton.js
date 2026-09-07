"use client";

/**
 * "Buy this one video, right here" — mirrors TicketCheckoutButton in
 * HomeClient.js exactly (own local clientSecret, own Elements instance),
 * deliberately bypassing the shared multi-item cart (`2mrrw_cart` in
 * HomeClient.js) — this is a single-item, in-context unlock, not a browse-
 * and-batch purchase. Reuses the same existing checkout plumbing every
 * other direct-buy flow on the platform already uses: POST
 * /api/create-payment-intent (already supports { video_id } cart lines via
 * resolveCartLines, see src/lib/commerce/resolve-cart.js), then the shared
 * CheckoutForm (Express Checkout + PaymentElement), then POST
 * /api/purchase/confirm for immediate fulfillment instead of waiting on the
 * Stripe webhook.
 */
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { Elements } from "@stripe/react-stripe-js";
import { getStripeClient } from "@/lib/commerce/stripe-client";

const CheckoutForm = dynamic(() => import("@/components/payments/CheckoutForm"), { ssr: false });

export function AudioVisualBuyButton({ videoId, priceCents, onPurchased }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const handleBuy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart: [{ video_id: videoId }] }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Checkout failed"); return; }
      if (data.clientSecret) setClientSecret(data.clientSecret);
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  const handleSuccess = useCallback(async (paymentIntentId) => {
    setConfirming(true);
    try {
      await fetch("/api/purchase/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId }),
      });
    } catch {
      // The webhook is the backup path for this exact case — a failed
      // in-page confirm call still gets fulfilled shortly after.
    } finally {
      setConfirming(false);
      onPurchased?.();
    }
  }, [onPurchased]);

  if (confirming) {
    return <div style={{ color: "#00ffff", fontSize: 12, textAlign: "center" }}>Unlocking…</div>;
  }

  if (clientSecret) {
    return (
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
        <CheckoutForm onSuccess={handleSuccess} requiresShipping={false} submitLabel={`Pay $${(priceCents / 100).toFixed(2)}`} />
      </Elements>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); handleBuy(); }}
        disabled={loading}
        style={{
          width: "100%", padding: "10px 0", background: loading ? "#1a1a1a" : "#00ffff",
          color: loading ? "#555" : "#000", fontWeight: 800, border: "none", borderRadius: 8,
          cursor: loading ? "wait" : "pointer", fontSize: 13,
        }}
      >
        {loading ? "Loading…" : `Unlock — $${(priceCents / 100).toFixed(2)}`}
      </button>
      {error && <div style={{ fontSize: 11, color: "#ff453a", textAlign: "center", marginTop: 6 }}>{error}</div>}
    </>
  );
}

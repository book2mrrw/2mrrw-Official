import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { fulfillCheckoutSession, fulfillPaymentIntent } from "@/lib/commerce/fulfill-purchase";

const LOG_PREFIX = "[stripe-webhook]";

/**
 * Canonical Stripe webhook handler.
 * Production endpoint: POST /api/webhook
 * Legacy aliases: /api/webhooks/stripe, /api/stripe/webhook
 */
export async function handleStripeWebhook(req) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error(`${LOG_PREFIX} STRIPE_WEBHOOK_SECRET is not set`);
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 503 }
    );
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    console.error(`${LOG_PREFIX} missing stripe-signature header`);
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error(`${LOG_PREFIX} signature verification failed:`, err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`${LOG_PREFIX} received`, event.id, event.type);

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        const result = await fulfillPaymentIntent(pi);
        if (!result) {
          throw new Error(
            `Fulfillment skipped for ${pi.id}: missing user_id in metadata or invalid status`
          );
        }
        console.log(`${LOG_PREFIX} fulfilled PI ${pi.id}`, {
          purchaseId: result.purchaseId,
          slugs: result.slugs,
        });
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        console.warn(`${LOG_PREFIX} payment failed`, pi.id, pi.last_payment_error?.message);
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.payment_status === "paid") {
          const result = await fulfillCheckoutSession(session);
          if (!result) {
            throw new Error(
              `Fulfillment skipped for session ${session.id}: missing user_id in metadata`
            );
          }
          console.log(`${LOG_PREFIX} fulfilled session ${session.id}`, {
            purchaseId: result.purchaseId,
            slugs: result.slugs,
          });
        }

        let items = [];
        try {
          items = JSON.parse(session.metadata?.items || "[]");
        } catch {
          items = [];
        }
        const merchItems = items.filter((item) => item.type === "merch");
        if (merchItems.length > 0) {
          await sendToPrintful(session, merchItems);
        }
        break;
      }

      default:
        console.log(`${LOG_PREFIX} ignored event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} handler error`, event.id, event.type, err.message, err.stack);
    return NextResponse.json(
      { error: "Webhook handler failed", eventId: event.id, type: event.type },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true, eventId: event.id, type: event.type });
}

async function sendToPrintful(session, merchItems) {
  try {
    const response = await fetch("https://api.printful.com/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: {
          name: session.customer_details?.name,
          address1: session.customer_details?.address?.line1,
          city: session.customer_details?.address?.city,
          state_code: session.customer_details?.address?.state,
          country_code: session.customer_details?.address?.country,
          zip: session.customer_details?.address?.postal_code,
          email: session.customer_details?.email,
        },
        items: merchItems.map((item) => ({
          variant_id: item.variant_id,
          quantity: item.quantity || 1,
        })),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`${LOG_PREFIX} Printful API error`, data);
      return;
    }
    console.log(`${LOG_PREFIX} Printful order created`, data?.result?.id || data);
  } catch (err) {
    console.error(`${LOG_PREFIX} Printful error:`, err.message);
  }
}

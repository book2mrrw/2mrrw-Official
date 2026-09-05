import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import crypto from "node:crypto";
import { emitServerEvent } from "@/lib/observability/server-events";
import { fulfillCheckoutSession, fulfillPaymentIntent } from "@/lib/commerce/fulfill-purchase";
import { revokeExtendedEntitlementsForPurchase } from "@/lib/commerce/revoke-entitlements";
import {
  handleCheckoutEntitlements,
  revokeAllEntitlementsForDispute,
  upsertMembershipFromSubscription,
} from "@/lib/commerce/stripe-entitlements";
import { getAdminClient } from "@/lib/supabase/admin";
import { invalidateUserEntitlementCache } from "@/lib/server/entitlement-cache";
import {
  sendTransactionalEmail,
  buildPurchaseConfirmationEmail,
  buildMembershipWelcomeEmail,
} from "@/lib/server/email";

const LOG_PREFIX = "[stripe-webhook]";

function resolvePaymentIntentId(event) {
  const obj = event?.data?.object;
  if (!obj) return null;
  if (event.type === "payment_intent.canceled") {
    return obj.id || null;
  }
  const pi = obj.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id || null;
}

/**
 * Revoke library access + extended entitlements for the purchase tied to a
 * payment intent. Safe to call more than once for the same payment intent —
 * every step (status flip, library delete, cache invalidation) is a no-op on
 * a purchase that's already refunded. Called both from the charge.refunded
 * webhook below AND synchronously from POST /api/refund (src/app/api/refund/
 * route.js) right after Stripe confirms the refund, so a customer's access is
 * revoked immediately rather than only whenever the webhook happens to land.
 */
export async function revokePurchaseByPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) {
    console.warn(`${LOG_PREFIX} revocation skipped: missing payment_intent id`);
    return;
  }

  const admin = getAdminClient();
  const { data: purchase, error: findErr } = await admin
    .from("purchases")
    .select("id, user_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (findErr) {
    console.warn(`${LOG_PREFIX} revocation lookup failed`, paymentIntentId, findErr.message);
    return;
  }

  if (!purchase) {
    console.warn(`${LOG_PREFIX} revocation: no purchase for PI ${paymentIntentId}`);
    return;
  }

  const { data: libraryRows, error: libErr } = await admin
    .from("library_items")
    .select("id, products(slug)")
    .eq("purchase_id", purchase.id);

  if (libErr) {
    console.warn(`${LOG_PREFIX} revocation library lookup failed`, purchase.id, libErr.message);
    return;
  }

  const slugs = (libraryRows || []).map((row) => row.products?.slug).filter(Boolean);

  const { error: statusErr } = await admin
    .from("purchases")
    .update({ status: "refunded" })
    .eq("id", purchase.id);

  if (statusErr) {
    console.warn(`${LOG_PREFIX} revocation status update failed`, purchase.id, statusErr.message);
    return;
  }

  const { error: deleteErr } = await admin
    .from("library_items")
    .delete()
    .eq("purchase_id", purchase.id);

  if (deleteErr) {
    console.warn(`${LOG_PREFIX} revocation library delete failed`, purchase.id, deleteErr.message);
    return;
  }

  let extended = null;
  try {
    extended = await revokeExtendedEntitlementsForPurchase({
      purchaseId: purchase.id,
      userId: purchase.user_id,
      slugs,
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} extended revocation failed`, purchase.id, err.message);
  }

  // Revoke succeeded: wipe tier + all per-slug cache entries so the next play event
  // hits the DB and is correctly denied rather than serving a cached grant.
  invalidateUserEntitlementCache(purchase.user_id, slugs).catch(() => {});

  console.warn(`${LOG_PREFIX} revoked purchase`, {
    paymentIntentId,
    userId: purchase.user_id,
    slugs,
    extended,
  });
}

/**
 * Canonical Stripe webhook handler.
 * Production endpoint: POST /api/webhook
 * Legacy aliases: /api/webhooks/stripe, /api/stripe/webhook
 */
export async function handleStripeWebhook(req) {
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
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
    emitServerEvent("warn", "stripe_webhook_signature_rejected", { correlationId });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  emitServerEvent("info", "stripe_webhook_received", { correlationId, stripeEventId: event.id, stripeEventType: event.type });

  const admin = getAdminClient();

  // Claim the event atomically before processing. INSERT with unique constraint on
  // event_id: if 23505, a concurrent handler already claimed it — return 200 immediately.
  // If processing fails below, we DELETE the claim so Stripe can retry.
  const { error: claimError } = await admin
    .from("processed_stripe_events")
    .insert({ event_id: event.id });

  if (claimError?.code === "23505") {
    emitServerEvent("info", "stripe_webhook_duplicate", { correlationId, stripeEventId: event.id, stripeEventType: event.type });
    return NextResponse.json({ received: true, duplicate: true, eventId: event.id, type: event.type });
  }
  if (claimError) {
    emitServerEvent("error", "stripe_webhook_idempotency_claim_failed",
      { correlationId, stripeEventId: event.id, stripeEventType: event.type }, claimError);
    return NextResponse.json(
      { error: "Webhook idempotency authority unavailable", eventId: event.id, type: event.type },
      { status: 503 }
    );
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object;

        // ── Ticket purchase — separate fulfillment path ──────────────────────
        if (pi.metadata?.payment_kind === "ticket") {
          await fulfillTicketPurchase(admin, pi);
          break;
        }

        // ── Live event pay-per-view — separate fulfillment path ──────────────
        if (pi.metadata?.payment_kind === "live_ppv") {
          await fulfillLivePpvPurchase(admin, pi);
          break;
        }

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
        // Send transactional email — non-fatal
        try {
          const to = pi.metadata?.email || pi.receipt_email;
          if (to) {
            const isSubscription = pi.metadata?.payment_kind === "subscription";
            const { subject, html, text } = isSubscription
              ? buildMembershipWelcomeEmail({ name: pi.metadata?.name || "" })
              : buildPurchaseConfirmationEmail({
                  name: pi.metadata?.name || "",
                  items: result.items || [],
                  amountCents: pi.amount_received ?? pi.amount,
                });
            await sendTransactionalEmail({ to, subject, html, text });
          }
        } catch (emailErr) {
          console.warn(`${LOG_PREFIX} post-PI email failed`, pi.id, emailErr?.message);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        console.warn(`${LOG_PREFIX} payment failed`, pi.id, pi.last_payment_error?.message);
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object;

        // Tickets and Live PPV moved to the in-page PaymentIntent + Elements
        // flow (see payment_intent.succeeded above) so payment never redirects
        // off this app to a Stripe-hosted page — neither creates a Checkout
        // Session anymore, so this event type carries no payment_kind === "ticket"
        // / "live_ppv" traffic to dispatch here any more.

        // ── Digital / merch purchase ─────────────────────────────────────────
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
          try {
            await handleCheckoutEntitlements({
              userId: session.metadata?.guest_user_id || session.metadata?.user_id,
              slugs: result.slugs,
              purchaseId: result.purchaseId,
            });
          } catch (entErr) {
            console.warn(`${LOG_PREFIX} checkout entitlements failed`, session.id, entErr.message);
          }
          // Send purchase confirmation email — non-fatal
          try {
            const to = session.customer_details?.email || session.customer_email || session.metadata?.email;
            if (to) {
              let items = [];
              try { items = JSON.parse(session.metadata?.items || "[]"); } catch {}
              const { subject, html, text } = buildPurchaseConfirmationEmail({
                name: session.customer_details?.name || "",
                items,
                amountCents: session.amount_total,
              });
              await sendTransactionalEmail({ to, subject, html, text });
            }
          } catch (emailErr) {
            console.warn(`${LOG_PREFIX} post-checkout email failed`, session.id, emailErr?.message);
          }
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

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        try {
          await upsertMembershipFromSubscription(subscription);
        } catch (subErr) {
          console.warn(`${LOG_PREFIX} subscription upsert failed`, subscription.id, subErr.message);
          throw subErr;
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        subscription.status = "canceled";
        try {
          await upsertMembershipFromSubscription(subscription);
        } catch (subErr) {
          console.warn(`${LOG_PREFIX} subscription delete revoke failed`, subscription.id, subErr.message);
          throw subErr;
        }
        break;
      }

      case "charge.refunded":
      case "payment_intent.canceled": {
        const paymentIntentId = resolvePaymentIntentId(event);
        await revokePurchaseByPaymentIntent(paymentIntentId);
        break;
      }

      case "charge.dispute.created": {
        const paymentIntentId = resolvePaymentIntentId(event);
        const admin = getAdminClient();
        const { data: purchase } = await admin
          .from("purchases")
          .select("id, user_id")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .maybeSingle();
        if (purchase?.user_id) {
          try {
            await revokeAllEntitlementsForDispute({
              userId: purchase.user_id,
              paymentIntentId,
            });
          } catch (disputeErr) {
            console.warn(`${LOG_PREFIX} dispute entitlement revoke failed`, disputeErr.message);
          }
        }
        await revokePurchaseByPaymentIntent(paymentIntentId);
        break;
      }

      default:
        console.log(`${LOG_PREFIX} ignored event type: ${event.type}`);
    }
  } catch (err) {
    emitServerEvent("error", "stripe_webhook_processing_failed",
      { correlationId, stripeEventId: event.id, stripeEventType: event.type }, err);
    // Roll back the claim so Stripe can retry this event.
    await admin.from("processed_stripe_events").delete().eq("event_id", event.id);
    return NextResponse.json(
      { error: "Webhook handler failed", eventId: event.id, type: event.type },
      { status: 500 }
    );
  }

  emitServerEvent("info", "stripe_webhook_processed", { correlationId, stripeEventId: event.id, stripeEventType: event.type });
  return NextResponse.json({ received: true, eventId: event.id, type: event.type });
}

// Tickets moved from a Stripe Checkout Session (redirect off-page) to an
// in-page PaymentIntent + Elements flow — this now reads a PaymentIntent
// object (`pi`), not a Checkout Session, so there is no `pi.customer_details`/
// `pi.payment_status`/`pi.amount_total` equivalent; everything needed was
// already captured into `pi.metadata` at /api/tickets/checkout creation time.
async function fulfillTicketPurchase(admin, pi) {
  const meta = pi.metadata || {};
  const userId  = meta.guest_user_id || meta.user_id;
  const showId  = meta.show_id;
  const qty     = Number(meta.quantity) || 1;
  const price   = Number(meta.price_cents) || 0;

  if (!userId || !showId) {
    console.warn(`${LOG_PREFIX} ticket fulfillment: missing user_id or show_id`, pi.id);
    return;
  }

  // Record the purchase — idempotent on a retried webhook delivery for the
  // same PaymentIntent (unique constraint on stripe_payment_intent_id).
  const { error: insertErr } = await admin.from("ticket_purchases").insert({
    user_id: userId,
    show_id: showId,
    stripe_payment_intent_id: pi.id,
    email: pi.receipt_email || meta.email || null,
    phone: meta.phone || null,
    quantity: qty,
    price_cents: price,
    status: "paid",
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      console.log(`${LOG_PREFIX} ticket already fulfilled (idempotent retry)`, pi.id);
      return;
    }
    console.error(`${LOG_PREFIX} ticket insert failed`, pi.id, insertErr.message);
    throw insertErr;
  }

  // Decrement available ticket count (non-fatal if it fails — purchase is already recorded)
  try {
    const { data: showRow } = await admin
      .from("shows_events")
      .select("tickets_available")
      .eq("id", showId)
      .single();
    if (showRow && showRow.tickets_available !== null) {
      await admin
        .from("shows_events")
        .update({ tickets_available: Math.max(0, showRow.tickets_available - qty) })
        .eq("id", showId);
    }
  } catch (decrErr) {
    console.warn(`${LOG_PREFIX} ticket count decrement failed`, showId, decrErr?.message);
  }

  // Confirmation email — non-fatal
  try {
    const to = pi.receipt_email || meta.email;
    if (to) {
      const showDate = meta.show_date
        ? new Date(meta.show_date + "T12:00:00").toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", year:"numeric" })
        : "";
      const { subject, html, text } = buildTicketConfirmationEmail({
        name: "",
        showName: meta.show_name || "2MRRW Live",
        location: meta.show_location || "",
        date: showDate,
        time: meta.show_time || "",
        quantity: qty,
        amountCents: pi.amount_received ?? pi.amount,
      });
      await sendTransactionalEmail({ to, subject, html, text });
    }
  } catch (emailErr) {
    console.warn(`${LOG_PREFIX} ticket confirmation email failed`, pi.id, emailErr?.message);
  }

  console.log(`${LOG_PREFIX} ticket fulfilled`, { paymentIntentId: pi.id, userId, showId, qty });
}

// Live PPV moved from a Stripe Checkout Session (redirect off-page) to an
// in-page PaymentIntent + Elements flow — this now reads a PaymentIntent
// object (`pi`), not a Checkout Session.
async function fulfillLivePpvPurchase(admin, pi) {
  const meta = pi.metadata || {};
  const userId = meta.user_id;
  const broadcastId = meta.broadcast_id;
  const amountCents = Number(meta.amount_cents) || pi.amount_received || pi.amount || 0;

  if (!userId || !broadcastId) {
    console.warn(`${LOG_PREFIX} live_ppv fulfillment: missing user_id or broadcast_id`, pi.id);
    return;
  }

  const { error: insertErr } = await admin.from("live_broadcast_purchases").insert({
    broadcast_id: broadcastId,
    user_id: userId,
    amount_cents: amountCents,
    stripe_payment_intent_id: pi.id,
    status: "paid",
  });

  if (insertErr) {
    // A retried webhook delivery for an already-fulfilled PaymentIntent hits
    // the (broadcast_id, user_id) paid-unique index — that's a success, not a
    // failure, so Stripe should not keep retrying it.
    if (insertErr.code === "23505") {
      console.log(`${LOG_PREFIX} live_ppv already fulfilled (idempotent retry)`, pi.id);
      return;
    }
    console.error(`${LOG_PREFIX} live_ppv insert failed`, pi.id, insertErr.message);
    throw insertErr;
  }

  console.log(`${LOG_PREFIX} live_ppv fulfilled`, { paymentIntentId: pi.id, userId, broadcastId, amountCents });
}

function buildTicketConfirmationEmail({ name, showName, location, date, time, quantity, amountCents }) {
  const total = amountCents ? `$${(amountCents / 100).toFixed(2)}` : "";
  const greeting = name ? `Hey ${name},` : "Hey,";
  const text = `${greeting}\n\nYour ticket${quantity > 1 ? "s are" : " is"} confirmed!\n\n${showName}\n${location}\n${date}${time ? ` · ${time}` : ""}\n\nQuantity: ${quantity}\nTotal: ${total}\n\nSee you there.\n\n— 2MRRW`;
  const html = `<p>${greeting}</p><p>Your ticket${quantity > 1 ? "s are" : " is"} confirmed.</p><h2>${showName}</h2><p>${location}<br/>${date}${time ? ` · ${time}` : ""}</p><p>Qty: ${quantity} · Total: ${total}</p><p>See you there.<br/>— 2MRRW</p>`;
  return { subject: `Your ticket — ${showName}`, html, text };
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

import { handleStripeWebhook } from "@/lib/commerce/handle-stripe-webhook";

/**
 * Legacy Stripe webhook alias — invokes the canonical handler DIRECTLY.
 *
 * INV-ENT-5: Stripe webhook delivery never depends on HTTP redirect following.
 *
 * This route previously returned a 308 to /api/webhook with the comment
 * "so no Stripe events are silently dropped". That was inverted: Stripe does not
 * follow redirects when delivering webhooks — any non-2xx is recorded as a failed
 * delivery and retried against the same URL, which redirects again. If the Stripe
 * Dashboard still pointed here, fulfilment, membership upserts, refunds and
 * dispute revocations never ran.
 *
 * Calling handleStripeWebhook() directly means signature verification, the
 * idempotency claim, and every event branch behave identically on all three
 * paths. The raw body is read inside the handler, so nothing is consumed here.
 *
 * Canonical endpoint remains /api/webhook — point the Stripe Dashboard there.
 */
export const runtime = "nodejs";

export async function POST(req) {
  return handleStripeWebhook(req);
}

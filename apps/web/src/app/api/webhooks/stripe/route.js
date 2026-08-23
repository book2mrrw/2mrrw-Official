import { handleStripeWebhook } from "@/lib/commerce/handle-stripe-webhook";

/**
 * Legacy Stripe webhook alias — invokes the canonical handler DIRECTLY.
 *
 * INV-ENT-5: Stripe webhook delivery never depends on HTTP redirect following.
 * See app/api/stripe/webhook/route.js for the full rationale — this route had the
 * same 308 defect.
 *
 * Canonical endpoint remains /api/webhook — point the Stripe Dashboard there.
 */
export const runtime = "nodejs";

export async function POST(req) {
  return handleStripeWebhook(req);
}

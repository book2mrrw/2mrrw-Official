import { handleStripeWebhook } from "@/lib/commerce/handle-stripe-webhook";

/** Canonical Stripe webhook — configure Stripe Dashboard to POST here only. */
export const runtime = "nodejs";

export async function POST(req) {
  return handleStripeWebhook(req);
}

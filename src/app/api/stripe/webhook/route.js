import { handleStripeWebhook } from "@/lib/commerce/handle-stripe-webhook";

/** Legacy alias → same handler as /api/webhook (for old Stripe Dashboard URLs). */
export const runtime = "nodejs";

export async function POST(req) {
  console.warn("[stripe-webhook] hit legacy path /api/stripe/webhook — update Stripe to /api/webhook");
  return handleStripeWebhook(req);
}

import { loadStripe } from "@stripe/stripe-js";

let stripeClientPromise = null;

/**
 * The single browser Stripe loader. Calling this is an explicit payment-surface
 * decision; importing application layout code never downloads Stripe.js.
 */
export function getStripeClient() {
  if (!stripeClientPromise) {
    stripeClientPromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  }
  return stripeClientPromise;
}

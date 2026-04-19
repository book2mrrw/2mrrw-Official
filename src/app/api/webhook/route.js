import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return new NextResponse("Webhook Error", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const items = JSON.parse(session.metadata.items);
    const merchItems = items.filter(item => item.type === "merch");
    if (merchItems.length > 0) {
      await sendToPrintful(session, merchItems);
    }
  }

  return new NextResponse("Success", { status: 200 });
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
          name: session.customer_details.name,
          address1: session.customer_details.address.line1,
          city: session.customer_details.address.city,
          state_code: session.customer_details.address.state,
          country_code: session.customer_details.address.country,
          zip: session.customer_details.address.postal_code,
          email: session.customer_details.email,
        },
        items: merchItems.map(item => ({
          variant_id: item.variant_id,
          quantity: item.quantity,
        })),
      }),
    });

    const data = await response.json();
    console.log("Printful Order:", data);
  } catch (err) {
    console.error("Printful Error:", err);
  }
}
import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  try {
    const { cart } = await req.json();

    const amount = Math.round(
      cart.reduce((sum, item) => sum + item.price, 0) * 100
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Payment intent error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
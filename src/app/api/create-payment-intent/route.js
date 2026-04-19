import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  try {
    const { cart } = await req.json();

    // Validate cart
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return NextResponse.json(
        { error: "Cart is empty or invalid" },
        { status: 400 }
      );
    }

    // Calculate total (in cents)
    const amount = Math.round(
      cart.reduce((sum, item) => {
        const price = Number(item.price) || 0;
        return sum + price;
      }, 0) * 100
    );

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Invalid payment amount" },
        { status: 400 }
      );
    }

    // Create PaymentIntent (FIXED)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
      payment_method_types: ["card"],
      metadata: {
        items: JSON.stringify(cart),
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
    });

  } catch (err) {
    console.error("Payment intent error:", err);

    return NextResponse.json(
      { error: err.message || "Payment failed" },
      { status: 500 }
    );
  }
}
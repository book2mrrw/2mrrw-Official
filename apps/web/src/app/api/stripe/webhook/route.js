import { NextResponse } from "next/server";

/** Legacy path — forward to active endpoint so no Stripe events are silently dropped. */
export const runtime = "nodejs";

export async function POST(req) {
  console.warn("[stripe-webhook] /api/stripe/webhook is a legacy path — update Stripe Dashboard to use /api/webhook");
  const url = new URL("/api/webhook", req.url);
  return NextResponse.redirect(url, { status: 308 });
}

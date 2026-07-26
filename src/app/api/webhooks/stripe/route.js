import { NextResponse } from "next/server";

/** Legacy path — decommissioned. Configure Stripe Dashboard to use /api/webhook only. */
export const runtime = "nodejs";

export async function POST() {
  console.error("[stripe-webhook] /api/webhooks/stripe is decommissioned — remove this endpoint from Stripe Dashboard");
  return NextResponse.json(
    { error: "This webhook endpoint is no longer active. Update Stripe Dashboard to POST to /api/webhook." },
    { status: 410 }
  );
}

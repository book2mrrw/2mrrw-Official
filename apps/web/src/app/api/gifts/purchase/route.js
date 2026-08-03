import { NextResponse } from "next/server";
import { createPendingGiftTransaction } from "@/lib/commerce/gift-transactions";
import { resolveCartLines } from "@/lib/commerce/resolve-cart";
import { getGuestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function POST(req) {
  const rl = await checkRateLimit(req, { routeKey: "gifts.purchase", limit: 5, windowSeconds: 60 });
  if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const guest = await getGuestUser();
    if (!guest?.id) {
      return NextResponse.json({ error: "Guest session required" }, { status: 401 });
    }

    const { recipientEmail, productSlug } = await req.json();
    if (!recipientEmail || !productSlug) {
      return NextResponse.json({ error: "recipientEmail and productSlug are required" }, { status: 400 });
    }

    const lines = await resolveCartLines({ cart: [{ slug: productSlug, qty: 1 }] });
    const line = lines[0];
    if (!line) {
      return NextResponse.json({ error: "Product not available" }, { status: 404 });
    }

    const txn = await createPendingGiftTransaction({
      purchaserUserId: guest.id,
      recipientEmail,
      productSlug,
      amountCents: line.amountCents
    });

    return NextResponse.json({
      transactionId: txn.id,
      amountCents: line.amountCents,
      productSlug: line.slug
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gift purchase failed" },
      { status: 400 }
    );
  }
}

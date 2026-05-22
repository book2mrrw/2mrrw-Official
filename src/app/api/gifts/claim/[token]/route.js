import { NextResponse } from "next/server";
import {
  claimGiftForUser,
  expireGiftIfNeeded,
  getFanSessionUser,
  getGiftByToken,
  giftPublicState,
} from "@/lib/gifts/helpers";

export async function POST(_req, { params }) {
  try {
    const token = (await params)?.token;
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    let gift = await getGiftByToken(token);
    if (!gift) {
      return NextResponse.json({ error: "not_found", message: "Gift not found" }, { status: 404 });
    }

    gift = await expireGiftIfNeeded(gift);
    const { state } = giftPublicState(gift);

    if (state === "expired") {
      return NextResponse.json({ error: "expired", message: "This gift has expired" }, { status: 410 });
    }
    if (state === "claimed") {
      return NextResponse.json({ error: "claimed", message: "This gift has already been claimed" }, { status: 409 });
    }
    if (state === "revoked") {
      return NextResponse.json({ error: "revoked", message: "This gift is no longer available" }, { status: 410 });
    }

    const user = await getFanSessionUser();
    if (!user) {
      return NextResponse.json({ requiresSignup: true, token }, { status: 401 });
    }

    const email = String(user.email || "").toLowerCase();
    const giftEmail = String(gift.recipient_email || "").toLowerCase();
    if (giftEmail && email && giftEmail !== email) {
      return NextResponse.json(
        {
          error: "email_mismatch",
          message: "Sign in with the email this gift was sent to.",
        },
        { status: 403 }
      );
    }

    const result = await claimGiftForUser(gift, user);

    return NextResponse.json({
      success: true,
      item_type: result.gift.item_type,
      item_id: result.product.id,
      item_title: result.gift.item_title || result.product.title,
    });
  } catch (err) {
    console.error("gift claim error:", err);
    return NextResponse.json({ error: err.message || "Claim failed" }, { status: 500 });
  }
}

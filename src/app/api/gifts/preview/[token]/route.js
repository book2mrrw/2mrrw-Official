import { NextResponse } from "next/server";
import { expireGiftIfNeeded, getGiftByToken, giftPublicState, resolveProductForGift } from "@/lib/gifts/helpers";

export async function GET(_req, { params }) {
  try {
    const token = (await params)?.token;
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    let gift = await getGiftByToken(token);
    if (!gift) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    gift = await expireGiftIfNeeded(gift);
    const { state } = giftPublicState(gift);
    const product = state === "valid" ? await resolveProductForGift(gift) : null;

    return NextResponse.json({
      state,
      gift: {
        id: gift.id,
        item_title: gift.item_title,
        item_type: gift.item_type,
        message: gift.message,
        expires_at: gift.expires_at,
        status: gift.status,
        recipient_id: gift.recipient_id,
      },
      cover_url: product?.cover_url || null,
    });
  } catch (err) {
    console.error("gift preview error:", err);
    return NextResponse.json({ error: err.message || "Preview failed" }, { status: 500 });
  }
}

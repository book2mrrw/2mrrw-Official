import { NextResponse } from "next/server";
import { expireGiftIfNeeded, getGiftByToken, giftPublicState, resolveProductForGift } from "@/lib/gifts/helpers";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { hashGiftLinkToken } from "@/lib/gifts/token-hash";
import { catalogCoverUrl } from "@/lib/media-urls";
import { getCanonicalReleaseBySlug } from "@/lib/media/canonical-catalog";

export async function GET(req, { params }) {
  try {
    const token = (await params)?.token;
    const limit = await checkRateLimit(req, {
      routeKey: "gifts.preview",
      limit: 30,
      windowSeconds: 60,
      identifier: hashGiftLinkToken(token),
    });
    if (!limit.allowed) {
      return rateLimitResponse(limit.retryAfterSeconds);
    }
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    let gift = await getGiftByToken(token);
    if (!gift) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    gift = await expireGiftIfNeeded(gift);
    const { state } = giftPublicState(gift);
    // Resolve product for any displayable state so the reveal always has cover art.
    const product = state !== "invalid" ? await resolveProductForGift(gift) : null;

    // Resolve cover using the same mechanism the storefront uses.
    // cover_url  → visual discovery URL (animated video for singles, image for others) — for CoverArt
    // cover_image_url → always the JPEG legacy cover — for CSS blurred backgrounds
    const canonical = product?.slug ? getCanonicalReleaseBySlug(product.slug) : null;
    const coverUrl = canonical?.cover || (product?.cover_url ? catalogCoverUrl(product.cover_url) : null) || null;
    const coverImageUrl = canonical?.legacy_cover || (product?.cover_url ? catalogCoverUrl(product.cover_url) : null) || null;
    const coverArtType = canonical?.coverArtType || null;

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
      cover_url: coverUrl,
      cover_image_url: coverImageUrl,
      cover_art_type: coverArtType,
      product_slug: product?.slug || null,
    });
  } catch (err) {
    console.error("gift preview error:", err);
    return NextResponse.json({ error: err.message || "Preview failed" }, { status: 500 });
  }
}

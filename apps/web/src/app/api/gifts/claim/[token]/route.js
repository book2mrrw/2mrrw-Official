import { NextResponse } from "next/server";
import {
  claimGiftForUser,
  expireGiftIfNeeded,
  getFanSessionUser,
  getGiftByToken,
  giftPublicState,
  resolveProductForGift,
} from "@/lib/gifts/helpers";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { invalidateAccountStateCache } from "@/lib/server/account-state-cache";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { hashGiftLinkToken } from "@/lib/gifts/token-hash";
import { catalogCoverUrl } from "@/lib/media-urls";
import { getCanonicalReleaseBySlug } from "@/lib/media/canonical-catalog";

export async function POST(req, { params }) {
  try {
    const token = (await params)?.token;
    const limit = await checkRateLimit(req, {
      routeKey: "gifts.claim",
      limit: 12,
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
      return NextResponse.json({ error: "not_found", message: "Gift not found" }, { status: 404 });
    }

    gift = await expireGiftIfNeeded(gift);
    const { state } = giftPublicState(gift);

    if (state === "expired") {
      return NextResponse.json({ error: "expired", message: "This gift has expired" }, { status: 410 });
    }

    if (state === "claimed") {
      // If the requesting user is the original recipient, ensure the library item exists
      // (it may have been missed if grantLibraryItems threw after the atomic gift update)
      // and return success so the client can refresh account state and show the reveal.
      const sessionUser = await getFanSessionUser();
      if (sessionUser && sessionUser.id === gift.recipient_id) {
        const product = await resolveProductForGift(gift);
        if (product) {
          await grantLibraryItems({
            userId: sessionUser.id,
            purchaseId: null,
            slugs: [product.slug],
            source: "gift",
            entitlementMetadata: { gift_id: gift.id },
          }).catch((err) => console.error("[gift-claim] recovery grant failed:", err?.message));
          invalidateAccountStateCache(sessionUser.id).catch(() => {});
        }
        const recoveryCanonical = product?.slug ? getCanonicalReleaseBySlug(product.slug) : null;
        const recoveryCoverUrl = recoveryCanonical?.cover || (product?.cover_url ? catalogCoverUrl(product.cover_url) : null) || null;
        const recoveryCoverImageUrl = recoveryCanonical?.legacy_cover || (product?.cover_url ? catalogCoverUrl(product.cover_url) : null) || null;
        return NextResponse.json({
          success: true,
          gift_id: gift.id,
          item_type: gift.item_type,
          item_id: product?.id || null,
          item_title: gift.item_title || product?.title || null,
          product_slug: product?.slug || null,
          cover_url: recoveryCoverUrl,
          cover_image_url: recoveryCoverImageUrl,
          cover_art_type: recoveryCanonical?.coverArtType || null,
        });
      }
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

    const freshCanonical = result.product?.slug ? getCanonicalReleaseBySlug(result.product.slug) : null;
    const freshCoverUrl = freshCanonical?.cover || (result.product?.cover_url ? catalogCoverUrl(result.product.cover_url) : null) || null;
    const freshCoverImageUrl = freshCanonical?.legacy_cover || (result.product?.cover_url ? catalogCoverUrl(result.product.cover_url) : null) || null;
    return NextResponse.json({
      success: true,
      gift_id: result.gift.id,
      item_type: result.gift.item_type,
      item_id: result.product.id,
      item_title: result.gift.item_title || result.product.title,
      product_slug: result.product.slug,
      cover_url: freshCoverUrl,
      cover_image_url: freshCoverImageUrl,
      cover_art_type: freshCanonical?.coverArtType || null,
    });
  } catch (err) {
    if (err?.code === "ALREADY_CLAIMED" || err?.status === 409) {
      return NextResponse.json({ error: "claimed", message: "This gift has already been claimed" }, { status: 409 });
    }
    console.error("gift claim error:", err);
    return NextResponse.json({ error: err.message || "Claim failed" }, { status: 500 });
  }
}

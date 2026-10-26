import { NextResponse } from "next/server";
import {
  claimGiftForUser,
  expireGiftIfNeeded,
  getFanSessionUser,
  getGiftByToken,
  giftPublicState,
  isGiftRecipient,
} from "@/lib/gifts/helpers";
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
      // Complete same-principal claims are read-only. Incomplete or cross-principal
      // claims return a verification requirement from the shared writer.
      const sessionUser = await getFanSessionUser();
      if (!sessionUser) {
        return NextResponse.json({ requiresSignup: true, token }, { status: 401 });
      }
      if (!isGiftRecipient(gift, sessionUser)) {
        return NextResponse.json(
          { error: "claimed", message: "This gift has already been claimed" },
          { status: 409 }
        );
      }

      const repaired = await claimGiftForUser(gift, sessionUser);
      const rc = repaired.product?.slug ? getCanonicalReleaseBySlug(repaired.product.slug) : null;
      const rCover = rc?.cover || (repaired.product?.cover_url ? catalogCoverUrl(repaired.product.cover_url) : null) || null;
      const rCoverImg = rc?.legacy_cover || (repaired.product?.cover_url ? catalogCoverUrl(repaired.product.cover_url) : null) || null;
      return NextResponse.json({
        success: true,
        gift_id: repaired.gift.id,
        item_type: repaired.gift.item_type,
        item_id: repaired.product?.id || null,
        item_title: repaired.gift.item_title || repaired.product?.title || null,
        product_slug: repaired.product?.slug || null,
        cover_url: rCover,
        cover_image_url: rCoverImg,
        cover_art_type: rc?.coverArtType || null,
      });
    }

    if (state === "revoked") {
      return NextResponse.json({ error: "revoked", message: "This gift is no longer available" }, { status: 410 });
    }

    const user = await getFanSessionUser();
    if (!user) {
      return NextResponse.json({ requiresSignup: true, token }, { status: 401 });
    }

    // Address compatibility is a hint. Only the shared proof boundary may grant.
    if (!isGiftRecipient(gift, user)) {
      return NextResponse.json(
        { error: "email_mismatch", message: "Sign in with the email this gift was sent to." },
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
    if (err?.code === "email_verification_required") return NextResponse.json({ error: err.code, message: "Verify your account email to claim this gift." }, { status: 409 });
    if (err?.code === "ALREADY_CLAIMED" || err?.status === 409) {
      return NextResponse.json({ error: "claimed", message: "This gift has already been claimed" }, { status: 409 });
    }
    // claimGiftForUser enforces authority itself, so its refusal must surface as
    // a 403 rather than falling through to a generic 500 that tells the
    // recipient nothing about what to do.
    if (err?.code === "EMAIL_MISMATCH" || err?.status === 403) {
      return NextResponse.json(
        { error: "email_mismatch", message: err.message || "Sign in with the email this gift was sent to." },
        { status: 403 }
      );
    }
    console.error("gift claim error:", err);
    return NextResponse.json({ error: err.message || "Claim failed" }, { status: 500 });
  }
}

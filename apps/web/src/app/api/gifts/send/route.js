import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { validateEmail, validatePhone } from "@/lib/auth/validation";
import { sendStorefrontGift } from "@/lib/gifts/send-gift";

export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_BODY" }, { status: 400 });
  }

  const releaseSlug = String(body.releaseSlug || "").trim();

  try {
    const user = await getFanSessionUser();
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "Sign in required", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    if (!isAdminUser(user)) {
      return NextResponse.json({ error: "Admin account required", code: "ADMIN_REQUIRED" }, { status: 403 });
    }

    if (!releaseSlug) {
      return NextResponse.json({ error: "Release is required", code: "RELEASE_REQUIRED" }, { status: 400 });
    }

    // Email and phone are both optional individually — at least one must be provided.
    let recipientEmail = null;
    const rawEmail = String(body.recipientEmail || "").trim();
    if (rawEmail) {
      const emailCheck = validateEmail(rawEmail);
      if (!emailCheck.ok) {
        return NextResponse.json({ error: emailCheck.error, code: "INVALID_EMAIL" }, { status: 400 });
      }
      recipientEmail = emailCheck.value;
    }

    let recipientPhone = null;
    const rawPhone = String(body.recipientPhone || "").trim();
    if (rawPhone) {
      const phoneCheck = validatePhone(rawPhone);
      if (!phoneCheck.ok) {
        return NextResponse.json({ error: phoneCheck.error, code: "INVALID_PHONE" }, { status: 400 });
      }
      recipientPhone = phoneCheck.value;
    }

    if (!recipientEmail && !recipientPhone) {
      return NextResponse.json({ error: "Recipient email or phone number is required", code: "RECIPIENT_CONTACT_REQUIRED" }, { status: 400 });
    }

    const productId = body.productId || body.product_id || null;

    console.info("[api/gifts/send] request", {
      releaseSlug,
      releaseType: body.releaseType || body.item_type || null,
      productId,
      senderId: user.id,
      hasEmail: Boolean(recipientEmail),
      hasPhone: Boolean(recipientPhone),
    });

    const result = await sendStorefrontGift({
      senderUser: user,
      releaseSlug,
      releaseTitle: body.releaseTitle || body.item_title,
      releaseType: body.releaseType || body.item_type,
      productId,
      recipientEmail,
      recipientPhone,
      recipientName: body.recipientName || null,
      message: body.message || null,
    });

    return NextResponse.json({
      success: true,
      gift: result.gift,
      giftLink: result.giftLink,
      delivered: result.delivered,
      emailSent: result.emailSent,
      smsSent: result.smsSent,
      recipientEmail: result.recipientEmail,
      recipientPhone: result.recipientPhone,
    });
  } catch (err) {
    const code = err?.code || "GIFT_SEND_FAILED";
    const status = err?.status || 500;
    const isDev = process.env.NODE_ENV !== "production";

    console.error("[api/gifts/send] error", {
      releaseSlug: releaseSlug || null,
      code,
      message: err?.message,
      details: err?.details || null,
    });

    const payload = {
      error: err.message || "Could not send gift",
      code,
    };
    if (isDev && err?.details) {
      payload.details = err.details;
    }

    return NextResponse.json(payload, { status });
  }
}

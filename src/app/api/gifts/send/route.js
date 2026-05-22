import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { validateEmail } from "@/lib/auth/validation";
import { sendStorefrontGift } from "@/lib/gifts/send-gift";

export async function POST(req) {
  try {
    const user = await getFanSessionUser();
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    if (!isAdminUser(user)) {
      return NextResponse.json({ error: "Admin account required" }, { status: 403 });
    }

    const body = await req.json();
    const emailCheck = validateEmail(body.recipientEmail);
    if (!emailCheck.ok) {
      return NextResponse.json({ error: emailCheck.error }, { status: 400 });
    }

    const releaseSlug = String(body.releaseSlug || "").trim();
    if (!releaseSlug) {
      return NextResponse.json({ error: "Release is required" }, { status: 400 });
    }

    const result = await sendStorefrontGift({
      senderUser: user,
      releaseSlug,
      releaseTitle: body.releaseTitle || body.item_title,
      releaseType: body.releaseType || body.item_type,
      recipientEmail: emailCheck.value,
      recipientName: body.recipientName || null,
      message: body.message || null,
    });

    return NextResponse.json({
      success: true,
      gift: result.gift,
      giftLink: result.giftLink,
      delivered: result.delivered,
      recipientEmail: result.recipientEmail,
    });
  } catch (err) {
    console.error("gift send error:", err);
    return NextResponse.json(
      { error: err.message || "Could not send gift" },
      { status: 500 }
    );
  }
}

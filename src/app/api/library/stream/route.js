import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanStreamProduct } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { resolvePlaybackKey } from "@/lib/playback/resolve-playback-key";
import {
  clearStreamSession,
  clearStreamSessionsForUserProduct,
  createStreamSession,
  findActiveStreamSession,
  insertStreamEvent,
  resolveProductIdBySlug,
  STREAM_SIGNED_URL_TTL_SECONDS,
} from "@/lib/playback/stream-pipeline";
import { createR2SignedGetUrl } from "@/lib/storage/r2";
import { getOrCreateStreamSignedUrl } from "@/lib/playback/stream-url-cache";

export const dynamic = "force-dynamic";

async function validateStreamEntitlement(user, slug) {
  const canStream = await userCanStreamProduct(user.id, slug, user);
  if (!canStream) {
    return NextResponse.json({ error: "Not entitled to stream this item" }, { status: 403 });
  }
  return null;
}

async function buildStreamResponse(req, user, slug, { force = false } = {}) {
  const denied = await validateStreamEntitlement(user, slug);
  if (denied) return denied;

  const admin = createAdminClient();
  const productId = await resolveProductIdBySlug(admin, slug);
  if (!productId) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!force) {
    const active = await findActiveStreamSession(admin, user.id, productId);
    if (active?.session_id) {
      return NextResponse.json(
        {
          error: "Already streaming on another device",
          code: "CONCURRENT_STREAM",
          sessionId: active.session_id,
        },
        { status: 409 }
      );
    }
  } else {
    await clearStreamSessionsForUserProduct(admin, user.id, productId);
  }

  const resolved = await resolvePlaybackKey(admin, slug);
  if (!resolved?.key) {
    return NextResponse.json({ error: "No downloadable asset for this item" }, { status: 404 });
  }

  const sessionId = await createStreamSession(admin, user.id, productId);
  const streamEventId = await insertStreamEvent(admin, user.id, productId);

  const url = await getOrCreateStreamSignedUrl(user.id, slug, () =>
    createR2SignedGetUrl(resolved.key, STREAM_SIGNED_URL_TTL_SECONDS)
  );

  const redirect = req.nextUrl.searchParams.get("redirect") === "1";
  if (redirect) {
    return NextResponse.redirect(url);
  }

  return NextResponse.json({
    url,
    expiresIn: STREAM_SIGNED_URL_TTL_SECONDS,
    sessionId: sessionId || null,
    streamEventId: streamEventId || null,
  });
}

export async function GET(req) {
  const slug = req.nextUrl.searchParams.get("slug");
  const redirect = req.nextUrl.searchParams.get("redirect") === "1";
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const user = await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "true";

  try {
    return await buildStreamResponse(req, user, slug, { force });
  } catch (err) {
    console.error("[library/stream] GET failed", { slug, userId: user.id, err: err?.message });
    return NextResponse.json({ error: "Stream unavailable" }, { status: 500 });
  }
}

export async function DELETE(req) {
  const slug = req.nextUrl.searchParams.get("slug");
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const user = await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    if (sessionId) {
      await clearStreamSession(admin, sessionId);
    } else {
      const productId = await resolveProductIdBySlug(admin, slug);
      if (productId) {
        await clearStreamSessionsForUserProduct(admin, user.id, productId);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[library/stream] DELETE failed", { slug, userId: user.id, err: err?.message });
    return NextResponse.json({ error: "Could not clear session" }, { status: 500 });
  }
}

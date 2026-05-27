import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanStreamProduct } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { getFanSessionUser } from "@/lib/auth/session-user";
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

/** Same-origin preflight; relative /api/library/stream fetch rarely needs CORS headers. */
export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

const R2_STREAM_DEBUG = process.env.R2_STREAM_DEBUG === "1";

function logStreamR2Env(context) {
  if (!R2_STREAM_DEBUG) return;
  console.info("[library/stream] r2 env (presence only)", {
    context,
    bucket: Boolean(process.env.CLOUDFLARE_R2_BUCKET_NAME),
    endpoint: Boolean(process.env.CLOUDFLARE_R2_ENDPOINT),
    accessKeyId: Boolean(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID),
    secretAccessKey: Boolean(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY),
    publicCdn: Boolean(process.env.NEXT_PUBLIC_R2_PUBLIC_URL),
  });
}

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
      await clearStreamSessionsForUserProduct(admin, user.id, productId);
    }
  } else {
    await clearStreamSessionsForUserProduct(admin, user.id, productId);
  }

  const resolved = await resolvePlaybackKey(admin, slug);
  if (!resolved?.key) {
    logStreamR2Env("no_playback_key");
    return NextResponse.json({ error: "No downloadable asset for this item" }, { status: 404 });
  }

  logStreamR2Env("signing");
  const sessionId = await createStreamSession(admin, user.id, productId);
  const streamEventId = await insertStreamEvent(admin, user.id, productId);

  const url = await getOrCreateStreamSignedUrl(user.id, slug, () =>
    createR2SignedGetUrl(resolved.key, STREAM_SIGNED_URL_TTL_SECONDS)
  );

  const redirect = req.nextUrl.searchParams.get("redirect") === "1";
  if (redirect) {
    const rangeHeader = req.headers.get("range");
    return NextResponse.redirect(url, {
      status: 302,
      headers: {
        ...(rangeHeader ? { "Range": rangeHeader } : {}),
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
      },
    });
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

  const user = await getFanSessionUser() ?? await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "true";

  try {
    logStreamR2Env("get");
    return await buildStreamResponse(req, user, slug, { force });
  } catch (err) {
    logStreamR2Env("get_error");
    console.error("[library/stream] GET failed", {
      stack: err?.stack,
      r2env: {
        endpoint: Boolean(process.env.CLOUDFLARE_R2_ENDPOINT),
        accessKey: Boolean(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID),
        secretKey: Boolean(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY),
        bucket: Boolean(process.env.CLOUDFLARE_R2_BUCKET_NAME),
      },
    });
    return NextResponse.json({ error: "Stream unavailable" }, { status: 500 });
  }
}

export async function DELETE(req) {
  const slug = req.nextUrl.searchParams.get("slug");
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const user = await getFanSessionUser() ?? await getGuestUser();
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

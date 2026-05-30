import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
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
import { clearMediaResolverCaches } from "@/lib/media/cache-invalidation";
import { proxySignedR2Get } from "@/lib/server/r2-stream-proxy";
import { libraryStreamRedirectSrc } from "@/lib/music-access";
import { isAdminUser } from "@/lib/auth/constants";
import { createServerTiming } from "@/lib/server/server-timing";

export const dynamic = "force-dynamic";

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
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

function withStreamTiming(req, response, timing) {
  return applyMediaCors(req, timing.apply(response));
}

async function validateStreamEntitlement(req, user, slug) {
  if (isAdminUser(user)) return null;
  const canStream = await userCanStreamProduct(user.id, slug, user);
  if (!canStream) {
    return applyMediaCors(
      req,
      NextResponse.json({ error: "Not entitled to stream this item" }, { status: 403 })
    );
  }
  return null;
}

async function buildStreamResponse(req, user, slug, { force = false, trackSlug = null, timing } = {}) {
  const denied = await validateStreamEntitlement(req, user, slug);
  timing?.mark("entitlement");
  if (denied) return denied;

  const admin = createAdminClient();

  let resolved = null;
  try {
    resolved = await resolvePlaybackKey(admin, slug, { trackSlug: trackSlug || undefined });
  } catch (resolveErr) {
    console.error("[library/stream] resolvePlaybackKey failed", {
      slug,
      trackSlug: trackSlug || null,
      message: resolveErr?.message,
    });
    return applyMediaCors(
      req,
      NextResponse.json(
        { error: "Media unavailable for this item", code: "MEDIA_UNAVAILABLE" },
        { status: 422 }
      )
    );
  }
  timing?.mark("resolve");

  const productId = resolved?.productId || (await resolveProductIdBySlug(admin, slug));
  timing?.mark("product");
  if (!productId) {
    return applyMediaCors(req, NextResponse.json({ error: "Product not found" }, { status: 404 }));
  }

  if (!resolved?.key) {
    logStreamR2Env("no_playback_key");
    console.warn("[library/stream] no audio in entity folder", {
      slug,
      trackSlug: trackSlug || null,
      entityFolder: resolved?.entityFolder || null,
    });
    return applyMediaCors(
      req,
      NextResponse.json(
        { error: "No downloadable asset for this item", code: "MEDIA_UNAVAILABLE" },
        { status: 404 }
      )
    );
  }

  if (!force) {
    const active = await findActiveStreamSession(admin, user.id, productId);
    if (active?.session_id) {
      await clearStreamSessionsForUserProduct(admin, user.id, productId);
    }
  } else {
    await clearStreamSessionsForUserProduct(admin, user.id, productId);
    if (process.env.NODE_ENV === "development") {
      clearMediaResolverCaches();
    }
  }
  timing?.mark("session");

  logStreamR2Env("signing");
  const sessionId = await createStreamSession(admin, user.id, productId);
  const streamEventId = await insertStreamEvent(admin, user.id, productId);

  const { url, cacheHit } = await getOrCreateStreamSignedUrl(user.id, slug, () =>
    createR2SignedGetUrl(resolved.key, STREAM_SIGNED_URL_TTL_SECONDS),
    trackSlug || null
  );
  timing?.mark("sign", cacheHit ? "cache_hit" : undefined);

  const redirect = req.nextUrl.searchParams.get("redirect") === "1";
  if (redirect) {
    const proxied = await proxySignedR2Get(req, url, { timing });
    return proxied;
  }

  const proxySrc = libraryStreamRedirectSrc(slug, {
    trackSlug: trackSlug || null,
  });

  return applyMediaCors(
    req,
    NextResponse.json({
      url: proxySrc,
      expiresIn: STREAM_SIGNED_URL_TTL_SECONDS,
      sessionId: sessionId || null,
      streamEventId: streamEventId || null,
    })
  );
}

/** HEAD uses the same entitlement + redirect proxy path as GET (Range-safe audio probes). */
export async function HEAD(req) {
  return GET(req);
}

export async function GET(req) {
  const timing = createServerTiming("stream");
  const slug = req.nextUrl.searchParams.get("slug");
  const trackSlug = req.nextUrl.searchParams.get("trackSlug");
  if (!slug) {
    return withStreamTiming(
      req,
      NextResponse.json({ error: "slug required" }, { status: 400 }),
      timing
    );
  }

  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  timing.mark("auth");
  if (!user) {
    return withStreamTiming(
      req,
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      timing
    );
  }

  const force = req.nextUrl.searchParams.get("force") === "true";

  try {
    logStreamR2Env("get");
    const response = await buildStreamResponse(req, user, slug, {
      force,
      trackSlug: trackSlug ? String(trackSlug).trim() : null,
      timing,
    });
    return withStreamTiming(req, response, timing);
  } catch (err) {
    logStreamR2Env("get_error");
    console.error("[library/stream] GET failed", {
      message: err?.message,
      slug,
    });
    return withStreamTiming(
      req,
      NextResponse.json(
        { error: "Stream unavailable", code: "MEDIA_UNAVAILABLE" },
        { status: 500 }
      ),
      timing
    );
  }
}

export async function DELETE(req) {
  const slug = req.nextUrl.searchParams.get("slug");
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!slug) {
    return applyMediaCors(req, NextResponse.json({ error: "slug required" }, { status: 400 }));
  }

  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  if (!user) {
    return applyMediaCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
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
    return applyMediaCors(req, NextResponse.json({ ok: true }));
  } catch (err) {
    console.error("[library/stream] DELETE failed", { slug, userId: user.id, err: err?.message });
    return applyMediaCors(
      req,
      NextResponse.json({ error: "Could not clear session" }, { status: 500 })
    );
  }
}

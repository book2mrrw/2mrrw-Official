import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanStreamProduct } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { resolvePlaybackKey } from "@/lib/playback/resolve-playback-key";
import { createR2SignedGetUrl } from "@/lib/storage/r2";
import { getOrCreateStreamSignedUrl } from "@/lib/playback/stream-url-cache";

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

  const canStream = await userCanStreamProduct(user.id, slug);
  if (!canStream) {
    return NextResponse.json({ error: "Not entitled to stream this item" }, { status: 403 });
  }

  const admin = createAdminClient();
  const resolved = await resolvePlaybackKey(admin, slug);
  if (!resolved?.key) {
    return NextResponse.json({ error: "No downloadable asset for this item" }, { status: 404 });
  }

  const url = await getOrCreateStreamSignedUrl(user.id, slug, () =>
    createR2SignedGetUrl(resolved.key, 3600)
  );

  if (redirect) {
    return NextResponse.redirect(url);
  }

  return NextResponse.json({ url, expiresIn: 3600 });
}

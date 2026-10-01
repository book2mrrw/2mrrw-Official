import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { folderForCategory, slugify, VAULT_SLUG_RE } from "@/lib/vault/vault-upload-contract";

export const dynamic = "force-dynamic";

/** Slugs become object keys, and a key that runs on forever is unreadable in
 *  storage. The section prefix is kept whole and the title is what gets cut. */
const MAX_SLUG_LENGTH = 64;

/**
 * Builds the storage name for an item so nobody has to type one.
 *
 * Composed from the section and the title -- "Archive Sessionz" plus "Studio
 * floor, 3am" gives archive-sessionz-studio-floor-3am. The section prefix is
 * not decoration: it keeps names from different sections out of each other's
 * way in a table where slug is globally unique.
 *
 * Uniqueness is resolved here rather than left to the upload, because the
 * upload path upserts on slug -- two items that happened to generate the same
 * name would mean the second silently replacing the first.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.slug",
    limit: 120,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { category, title } = body || {};
  const folder = folderForCategory(category);
  if (!folder) return NextResponse.json({ error: "Unknown vault section" }, { status: 400 });

  const titlePart = slugify(title);
  if (!titlePart) {
    return NextResponse.json({ error: "Give it a title first" }, { status: 400 });
  }

  const room = MAX_SLUG_LENGTH - folder.length - 1;
  const base = `${folder}-${titlePart.slice(0, Math.max(8, room))}`.replace(/-+$/, "");
  if (!VAULT_SLUG_RE.test(base)) {
    return NextResponse.json({ error: "That title has no letters or numbers in it" }, { status: 400 });
  }

  const admin = getAdminClient();
  // One query for the whole family rather than a probe per candidate.
  const { data: taken, error } = await admin
    .from("vault_content")
    .select("slug")
    .like("slug", `${base}%`);

  if (error) {
    console.error("vault slug lookup failed:", error);
    return NextResponse.json({ error: "Could not check the name" }, { status: 500 });
  }

  const used = new Set((taken || []).map((r) => r.slug));
  let slug = base;
  let n = 1;
  while (used.has(slug)) {
    n += 1;
    slug = `${base}-${n}`;
    if (n > 500) {
      return NextResponse.json({ error: "Too many items with that name" }, { status: 409 });
    }
  }

  return NextResponse.json({
    slug,
    base,
    // So the form can say "there's already one called that" instead of
    // quietly renaming behind the artist's back.
    disambiguated: slug !== base,
  });
}

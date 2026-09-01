import { NextResponse } from "next/server";
import { getOwnedSlugs } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";

export async function POST(req) {
  const user = await getGuestUser();
  const { slugs } = await req.json();

  if (!user) {
    return NextResponse.json({ owned: {} });
  }

  if (!Array.isArray(slugs) || slugs.length === 0) {
    return NextResponse.json({ owned: {} });
  }

  const ownedSet = await getOwnedSlugs(user.id);
  const owned = Object.fromEntries(slugs.map((s) => [s, ownedSet.has(s)]));
  return NextResponse.json({ owned });
}

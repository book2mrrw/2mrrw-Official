import { requireConsumerPrincipal } from "@/lib/auth/consumer-authority";
import { NextResponse } from "next/server";
import { getCatalogReleaseDetailFromDB } from "@/lib/media/catalog-db";
export const dynamic = "force-dynamic";
export async function GET(_request, { params }) {
  const principal = await requireConsumerPrincipal();
  if (!principal) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { slug } = await params;
  try {
    const release = await getCatalogReleaseDetailFromDB(slug);
    return release ? NextResponse.json({ release }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Release not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Credits could not be loaded" }, { status: 503 });
  }
}

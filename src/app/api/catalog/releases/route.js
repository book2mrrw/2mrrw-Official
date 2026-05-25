import { NextResponse } from "next/server";
import { getLatestControlSystemSingles } from "@/lib/control-system/releases";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const offset = (page - 1) * limit;

  const all = await getLatestControlSystemSingles({ limit: offset + limit });
  const tracks = all.slice(offset, offset + limit);
  const total = all.length;
  const hasMore = offset + tracks.length < total;

  return NextResponse.json({
    tracks,
    total,
    page,
    hasMore,
    limit,
  });
}

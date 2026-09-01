import { NextResponse } from "next/server";
import {
  getStorefrontCatalogFromDB,
  getStorefrontSinglesPageFromDB,
} from "@/lib/media/catalog-db";
import { toMobileCatalogReleases } from "@/lib/media/mobile-catalog-projection";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");

  if (view === "snapshot") {
    try {
      const catalog = await getStorefrontCatalogFromDB();
      if (!catalog) throw new Error("catalog_unavailable");
      return NextResponse.json({
        catalog,
        fallback: false,
        source: "supabase",
      }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      console.error("[catalog/releases] storefront snapshot read failed", {
        error: error?.message,
      });
      return NextResponse.json(
        { error: "catalog_unavailable", catalog: null, fallback: true },
        { status: 503, headers: NO_STORE_HEADERS }
      );
    }
  }

  if (view === "platform") {
    try {
      const catalog = await getStorefrontCatalogFromDB();
      if (!catalog) throw new Error("catalog_unavailable");
      const releases = toMobileCatalogReleases(catalog, request.nextUrl.origin);

      return NextResponse.json({
        releases,
        total: releases.length,
        fallback: false,
        source: "supabase",
      }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      console.error("[catalog/releases] mobile platform read failed", {
        error: error?.message,
      });
      return NextResponse.json(
        {
          error: "catalog_unavailable",
          releases: [],
          total: 0,
          fallback: true,
        },
        { status: 503, headers: NO_STORE_HEADERS }
      );
    }
  }

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const offset = (page - 1) * limit;

  try {
    const {
      releases: tracks,
      total,
      projectionTotal,
    } = await getStorefrontSinglesPageFromDB({
      offset,
      limit,
    });
    const hasMore = offset + limit < projectionTotal;

    return NextResponse.json({
      tracks,
      // Response-key compatibility for the mobile list transport. `tracks`
      // remains canonical for the existing web singles surface; detail and
      // hydration contracts are separate endpoints.
      releases: tracks,
      total,
      page,
      hasMore,
      limit,
      fallback: false,
      source: "supabase",
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[catalog/releases] canonical storefront read failed", {
      error: error?.message,
    });
    return NextResponse.json(
      {
        error: "catalog_unavailable",
        tracks: [],
        releases: [],
        total: 0,
        page,
        hasMore: false,
        limit,
        fallback: true,
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}

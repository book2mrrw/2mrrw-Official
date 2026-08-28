import DeepLinkRedirect from "@/components/music/DeepLinkRedirect";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireConsumerPrincipal } from "@/lib/auth/consumer-authority";
import { loginRedirectPath } from "@/lib/auth/route-access-policy";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const R2_CDN = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev";
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://2mrrw.com";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  if (!(await requireConsumerPrincipal())) redirect(loginRedirectPath(`/album/${slug}`));
  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from("products")
      .select("title, cover_url, slug")
      .eq("slug", slug)
      .maybeSingle();

    if (!data) return { title: "2MRRW" };

    const title = data.title ? `${data.title} — 2MRRW` : "2MRRW";
    const description = data.title
      ? `Stream ${data.title} by 2MRRW`
      : "Stream music from 2MRRW";
    const image = data.cover_url
      ? data.cover_url.startsWith("http")
        ? data.cover_url
        : `${R2_CDN}/${data.cover_url}`
      : "/icons/icon-512.png";
    const canonical = `${BASE_URL}/album/${slug}`;

    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        url: canonical,
        title,
        description,
        images: [{ url: image, width: 500, height: 500, alt: data.title || "2MRRW" }],
        type: "music.album",
        siteName: "2MRRW",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [image],
      },
    };
  } catch {
    return { title: "2MRRW" };
  }
}

export default async function AlbumDeepLinkPage({ params }) {
  const { slug } = await params;
  if (!(await requireConsumerPrincipal())) redirect(loginRedirectPath(`/album/${slug}`));
  return <DeepLinkRedirect type="album" />;
}

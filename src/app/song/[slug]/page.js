import DeepLinkRedirect from "@/components/music/DeepLinkRedirect";
import { createAdminClient } from "@/lib/supabase/admin";

const R2_CDN = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const admin = createAdminClient();
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

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: [{ url: image, width: 500, height: 500, alt: data.title || "2MRRW" }],
        type: "music.song",
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

export default function SongDeepLinkPage() {
  return <DeepLinkRedirect type="song" />;
}

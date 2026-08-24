import { revalidatePath } from "next/cache";

/**
 * Bust the storefront's ISR cache after any admin action that changes what a
 * release/track looks like. Every mutating admin route must call this — the
 * previous approach (hand-copying this 4-path block into each route) let two
 * routes (replace-master, upload/complete's audio branch) silently drift and
 * skip it entirely, so live-edited releases sat stale for up to an hour.
 */
export function revalidateStorefront(slug = null, releaseType = null) {
  try {
    revalidatePath("/");
    revalidatePath("/song/[slug]", "page");
    revalidatePath("/feature/[slug]", "page");
    revalidatePath("/album/[slug]", "page");
    if (slug) {
      const prefix = releaseType === "feature" ? "feature"
        : (["album", "ep", "mixtape"].includes(releaseType) ? "album" : "song");
      revalidatePath(`/${prefix}/${slug}`);
    }
  } catch (err) {
    console.warn("[revalidate-storefront] revalidatePath error (non-fatal)", err?.message);
  }
}

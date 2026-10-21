// Release identity always wins over a recording slug: a recording may remain
// legitimately available on another release after this one is deleted.
export function releaseSlugForItem(item) {
  return item?.albumSlug || item?.album_slug || item?.releaseSlug || item?.release_slug || item?.slug;
}

export function excludeDeletedReleases(items, deletedSlugs) {
  const deleted = deletedSlugs instanceof Set ? deletedSlugs : new Set(deletedSlugs || []);
  return (items || []).filter((item) => !deleted.has(releaseSlugForItem(item)));
}

export function releaseDeletionConfirmation(release) {
  return `Delete “${release.title || release.slug || "Untitled"}” (${release.release_type || "release"}${release.status === "draft" ? " draft" : ""})?\n\nThis removes the release from availability and active release lists. This is a persistent deletion, not unpublishing or archiving. Recordings, artwork, credits and purchase history are retained. There is no undo in this interface.`;
}

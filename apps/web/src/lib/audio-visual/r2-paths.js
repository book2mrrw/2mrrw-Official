/**
 * R2 storage-path convention for Audio Visualz content in the 2mrrw-media
 * bucket, confirmed directly by the user:
 *
 *   2MRRW Studios/{Content-Type Folder}/{slug}/...                (standalone)
 *   2MRRW Studios/{Content-Type Folder}/Seriez/{seriezSlug}/{episodeSlug}/...  (episodic)
 *
 * Isolated on purpose — this has nothing to do with, and never imports
 * from, the release/track R2 key convention in
 * src/app/api/admin/upload/presigned/route.js.
 */

export const CONTENT_TYPE_FOLDERS = Object.freeze({
  music_video: "Audio Visualz",
  podcast: "Podcast",
  interview: "Interview",
  movie: "Movie",
  documentary: "Documentary",
  vlog: "Vlog",
  concert: "Concert",
  short_film: "Short Filmz",
});

export function contentTypeFolder(videoType) {
  const folder = CONTENT_TYPE_FOLDERS[videoType];
  if (!folder) throw new Error(`contentTypeFolder: unknown video_type "${videoType}"`);
  return folder;
}

/**
 * @param {object} params
 * @param {string} params.videoType
 * @param {string} params.slug - the video's own slug
 * @param {string|null} [params.seriezSlug] - set only when this is an episode
 * @param {string|null} [params.episodeSlug] - set only when this is an episode (usually the same as slug)
 * @returns {string} a folder path ending in "/"
 */
export function audioVisualR2FolderPath({ videoType, slug, seriezSlug = null, episodeSlug = null }) {
  const typeFolder = contentTypeFolder(videoType);
  if (seriezSlug && episodeSlug) {
    return `2MRRW Studios/${typeFolder}/Seriez/${seriezSlug}/${episodeSlug}/`;
  }
  if (!slug) throw new Error("audioVisualR2FolderPath: slug is required for standalone content");
  return `2MRRW Studios/${typeFolder}/${slug}/`;
}

/**
 * R2 storage-path convention for Audio Visualz content in the 2mrrw-media
 * bucket — confirmed directly by the user, and duplicated here rather than
 * imported from apps/web/src/lib/audio-visual/r2-paths.js: the web app and
 * this worker are separate deployables with no shared module path (the same
 * reason derive-key.js/video-token.js duplicate the worker's key derivation
 * instead of importing it). Keep both copies' CONTENT_TYPE_FOLDERS and path
 * shape in sync by hand if either changes.
 *
 *   2MRRW Studios/{Content-Type Folder}/{slug}/...                (standalone)
 *   2MRRW Studios/{Content-Type Folder}/Seriez/{seriezSlug}/{episodeSlug}/...  (episodic)
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
 * @param {string} params.slug
 * @param {string|null} [params.seriezSlug]
 * @param {string|null} [params.episodeSlug]
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

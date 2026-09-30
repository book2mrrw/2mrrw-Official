export const VISUAL_MIN_SECONDS = 7;
export const VISUAL_MAX_SECONDS = 30;
export const VISUAL_MAX_BYTES = 5_000_000_000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function visualUploadType(filename) {
  return ({ mp4: 'video/mp4', mov: 'video/quicktime' })[String(filename || '').split('.').pop().toLowerCase()] || null;
}
export function visualSourceKey(trackId, versionId, filename) {
  if (!UUID_RE.test(trackId) || !UUID_RE.test(versionId) || !visualUploadType(filename)) throw new Error('Invalid visual upload');
  return `track-visuals/masters/${trackId}/${versionId}/source.${filename.split('.').pop().toLowerCase()}`;
}

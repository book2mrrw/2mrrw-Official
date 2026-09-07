/**
 * Browser-side upload transport for Audio Visualz assets — calls this
 * feature's own isolated presign/complete routes
 * (src/app/api/admin/audio-visual/upload/*), never
 * src/app/api/admin/upload/*. Reuses putFileToSignedR2 from
 * src/lib/media/r2-upload-client.js directly: that function is already
 * fully generic (raw XHR PUT to a signed URL, no release-specific logic),
 * the same category of shared infra as createR2SignedPutUrl/getPublicR2Url
 * already reused elsewhere in this feature — but uploadAssetToR2 in that
 * same file is hardcoded to POST /api/admin/upload/presigned, so it cannot
 * be reused here; this file is the isolated sibling.
 */
import { putFileToSignedR2, UploadTransportError } from "@/lib/media/r2-upload-client";

export { UploadTransportError };

/**
 * @param {object} params
 * @param {string} params.videoId
 * @param {"av-cover"|"av-cover-video"|"av-master"} params.assetType
 * @param {File} params.file
 * @param {(percent: number) => void} [params.onProgress]
 * @param {{ current: XMLHttpRequest|null }} [params.xhrRef]
 * @returns {Promise<{ key: string }>}
 */
export async function uploadAudioVisualAssetToR2({ videoId, assetType, file, onProgress, xhrRef }) {
  if (!(file instanceof Blob)) throw new TypeError("Audio Visualz upload requires a File or Blob");

  let presignRes;
  try {
    presignRes = await fetch("/api/admin/audio-visual/upload/presigned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, assetType, filename: file.name, size: file.size }),
    });
  } catch (cause) {
    throw new UploadTransportError("presign_network", "Could not request an upload URL", { cause });
  }
  const presignData = await presignRes.json().catch(() => ({}));
  if (!presignRes.ok) {
    throw new UploadTransportError("presign_rejected", presignData.error || "Upload authorization was rejected", { status: presignRes.status });
  }

  await putFileToSignedR2({ file, uploadUrl: presignData.uploadUrl, contentType: presignData.contentType, onProgress, xhrRef });

  return { key: presignData.key };
}

/**
 * @param {object} params
 * @param {string} params.videoId
 * @param {"av-cover"|"av-cover-video"|"av-master"} params.assetType
 * @param {string} params.key
 * @param {number} [params.durationSeconds] - required for av-cover-video only
 */
export async function completeAudioVisualUpload({ videoId, assetType, key, durationSeconds }) {
  const res = await fetch("/api/admin/audio-visual/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId, assetType, key, durationSeconds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new UploadTransportError("complete_rejected", data.error || "Upload completion was rejected", { status: res.status });
  }
  return data;
}

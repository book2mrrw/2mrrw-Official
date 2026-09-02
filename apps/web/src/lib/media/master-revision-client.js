"use client";

import { putFileToSignedR2, UploadTransportError } from "@/lib/media/r2-upload-client";

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Master replacement failed (HTTP ${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

/**
 * Stage and upload one File while preserving its release/track association for
 * the full operation. Public playback authority is not changed here.
 */
export async function stageMasterReplacement({
  releaseId,
  trackId,
  file,
  onProgress,
  xhrRef,
}) {
  if (!(file instanceof Blob)) throw new TypeError("Master replacement requires a File");
  const stageRes = await fetch(`/api/admin/releases/${releaseId}/replace-master/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trackId: trackId || null,
      filename: file.name,
      size: file.size,
    }),
  });
  const staged = await readJson(stageRes);

  try {
    await putFileToSignedR2({
      file,
      uploadUrl: staged.uploadUrl,
      contentType: staged.contentType,
      onProgress,
      xhrRef,
    });
  } catch (error) {
    const params = new URLSearchParams({ key: staged.key });
    fetch(`/api/admin/releases/${releaseId}/replace-master?${params}`, {
      method: "DELETE",
    }).catch(() => {});
    if (error instanceof UploadTransportError) error.replacementId = staged.replacementId;
    throw error;
  }

  return {
    replacementId: staged.replacementId,
    key: staged.key,
    contentType: staged.contentType,
    size: file.size,
  };
}

/**
 * Commit a staged master replacement. Synchronous — by the time this resolves,
 * the canonical audio file has already been swapped and is playable; there is
 * no further processing step to poll for.
 */
export async function beginMasterReplacement({ releaseId, trackId, replacementId, key, size }) {
  const res = await fetch(`/api/admin/releases/${releaseId}/replace-master`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replacementId, trackId: trackId || null, key, size }),
  });
  return readJson(res);
}

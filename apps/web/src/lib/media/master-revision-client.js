"use client";

import { putFileToSignedR2, UploadTransportError } from "@/lib/media/r2-upload-client";

const TERMINAL = new Set(["active", "failed", "cancelled", "retired"]);

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
    const params = new URLSearchParams({ replacementId: staged.replacementId });
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
  };
}

export async function beginMasterReplacement({ releaseId, replacementId }) {
  const res = await fetch(`/api/admin/releases/${releaseId}/replace-master`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replacementId }),
  });
  return readJson(res);
}

export async function getMasterReplacementStatus({ releaseId, replacementId, signal }) {
  const params = new URLSearchParams({ replacementId });
  const res = await fetch(`/api/admin/releases/${releaseId}/replace-master?${params}`, {
    cache: "no-store",
    signal,
  });
  return readJson(res);
}

/**
 * Short-lived operation status watcher. It is scoped to the open admin command,
 * never refreshes the storefront, and stops immediately at a terminal state.
 */
export function watchMasterReplacement({
  releaseId,
  replacementId,
  onStatus,
  onError,
  intervalMs = 3000,
}) {
  const controller = new AbortController();
  let timeoutId = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    controller.abort();
    if (timeoutId != null) clearTimeout(timeoutId);
  };

  const check = async () => {
    if (stopped) return;
    try {
      const status = await getMasterReplacementStatus({
        releaseId,
        replacementId,
        signal: controller.signal,
      });
      if (stopped) return;
      onStatus?.(status);
      if (TERMINAL.has(status.status)) return stop();
      timeoutId = setTimeout(check, intervalMs);
    } catch (error) {
      if (stopped || error?.name === "AbortError") return;
      onError?.(error);
      stop();
    }
  };

  check();
  return stop;
}

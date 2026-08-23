"use client";

/**
 * Single shared browser-side implementation of presign+PUT for direct-to-R2
 * admin uploads. R2 signs Content-Type into the presigned PUT URL, so the
 * actual PUT must send back exactly what the presign endpoint resolved —
 * never a value re-derived client-side (e.g. from `file.type`, which is
 * unreliable and empty for many .flac/.aiff files). This function always
 * uses the `contentType` echoed back by /api/admin/upload/presigned.
 */
export async function uploadAssetToR2({
  releaseType,
  slug,
  trackSlug,
  assetType,
  file,
  releaseId,
  onProgress,
  xhrRef,
}) {
  if (!(file instanceof Blob)) throw new TypeError("R2 upload requires a File or Blob");

  let presignRes;
  try {
    presignRes = await fetch("/api/admin/upload/presigned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        releaseType,
        slug,
        trackSlug,
        assetType,
        filename: file.name,
        size: file.size,
        releaseId,
      }),
    });
  } catch (cause) {
    throw new UploadTransportError("presign_network", "Could not request an upload URL", { cause });
  }
  const presignData = await presignRes.json().catch(() => ({}));
  if (!presignRes.ok) {
    throw new UploadTransportError(
      "presign_failed",
      presignData.error || `Upload authorization failed (HTTP ${presignRes.status})`,
      { status: presignRes.status }
    );
  }
  const { uploadUrl, key, contentType } = presignData;
  if (!uploadUrl || !key || !contentType) {
    throw new UploadTransportError("presign_invalid", "Upload authorization returned an incomplete response");
  }

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (xhrRef) xhrRef.current = xhr;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      const detail = String(xhr.responseText || "").trim().slice(0, 500);
      reject(new UploadTransportError("put_failed", `R2 upload failed (HTTP ${xhr.status})`, {
        status: xhr.status,
        detail: detail || undefined,
      }));
    };
    xhr.onerror = () => reject(new UploadTransportError("put_network", "Network error during R2 upload"));
    xhr.onabort = () => reject(new UploadTransportError("cancelled", "Upload cancelled"));
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(file);
  });

  return { key, contentType };
}

export class UploadTransportError extends Error {
  constructor(operation, message, { status, detail, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "UploadTransportError";
    this.operation = operation;
    if (status != null) this.status = status;
    if (detail) this.detail = detail;
  }
}

"use client";

import { memo } from "react";

function ImmersiveModalChrome({ onCloseClick }) {
  return (
    <div className="immersive-layer immersive-layer--chrome">
      <button
        type="button"
        className="modal-immersive-sheet-handle"
        aria-label="Close preview"
        onClick={onCloseClick}
      />
      <button
        type="button"
        className="preview-modal-close-btn modal-immersive-close"
        aria-label="Close preview"
        onClick={onCloseClick}
      >
        ✕
      </button>
    </div>
  );
}

export default memo(ImmersiveModalChrome);

"use client";

import { memo } from "react";
import ImmersiveModalAccessBadge from "@/components/preview/immersive/ImmersiveModalAccessBadge";

function ImmersiveModalChrome({ onCloseClick, trackAccess, canStream, palette }) {
  return (
    <div className="immersive-layer immersive-layer--chrome modal-immersive-chrome">
      <button
        type="button"
        className="modal-immersive-sheet-handle"
        aria-label="Close preview"
        onClick={onCloseClick}
      />
      <button
        type="button"
        className="preview-modal-close-btn modal-immersive-close modal-immersive-close--leading"
        aria-label="Close preview"
        onClick={onCloseClick}
      >
        ✕
      </button>
      <ImmersiveModalAccessBadge trackAccess={trackAccess} canStream={canStream} palette={palette} />
    </div>
  );
}

export default memo(ImmersiveModalChrome);

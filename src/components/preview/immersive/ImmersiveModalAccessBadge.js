"use client";

import { memo, useMemo } from "react";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

function ImmersiveModalAccessBadge({ trackAccess, canStream, palette }) {
  const label = useMemo(() => {
    if (trackAccess?.owned) return "✦ OWNED";
    if (canStream && trackAccess?.badge) return trackAccess.badge;
    if (canStream) return "FULL STREAM";
    return "PREVIEW";
  }, [trackAccess, canStream]);

  const preview = !canStream && !trackAccess?.owned;

  return (
    <div
      className={["modal-immersive-access-badge", preview ? "modal-immersive-access-badge--preview" : ""]
        .filter(Boolean)
        .join(" ")}
      style={paletteToCssVars(palette)}
    >
      {label}
    </div>
  );
}

export default memo(ImmersiveModalAccessBadge);

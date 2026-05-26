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

  const owned = Boolean(trackAccess?.owned || (canStream && trackAccess?.badge === "OWNED"));

  return (
    <div
      className={[
        "modal-immersive-access-badge",
        preview ? "modal-immersive-access-badge--preview" : "",
        owned ? "modal-immersive-access-badge--owned" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={paletteToCssVars(palette)}
    >
      {label}
    </div>
  );
}

export default memo(ImmersiveModalAccessBadge);

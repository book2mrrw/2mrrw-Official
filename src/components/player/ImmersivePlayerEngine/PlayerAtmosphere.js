"use client";

import { memo } from "react";

/** Site-wide vignette when immersive player modal is open */
function PlayerAtmosphere({ open = false }) {
  if (!open) return null;
  return (
    <div className="player-immersive-atmosphere" aria-hidden>
      <div className="player-immersive-atmosphere__vignette" />
      <div className="player-immersive-atmosphere__dim" />
    </div>
  );
}

export default memo(PlayerAtmosphere);

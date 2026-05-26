"use client";

import { memo, useCallback } from "react";

function CsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4 6l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12.5 Q6 11 9 12.5 Q12 14 15 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function PlayerCsBarButton({ active, onClick }) {
  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      onClick?.();
    },
    [onClick]
  );

  return (
    <button
      type="button"
      className={["player-bar-cs", active ? "player-bar-cs--active" : ""].filter(Boolean).join(" ")}
      onClick={handleClick}
      aria-label="Chopped and slowed mode"
      aria-pressed={active}
      style={{ touchAction: "manipulation" }}
    >
      <CsIcon />
    </button>
  );
}

export default memo(PlayerCsBarButton);

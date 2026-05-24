"use client";

import { useEffect } from "react";
import { PLAYER_BODY_CLASS } from "@/lib/player/constants";

/**
 * Toggle document.body classes for site-wide player atmosphere.
 */
export function usePlayerBodyState({ playing = false, expanded = false, modalOpen = false } = {}) {
  useEffect(() => {
    const { body } = document;
    if (playing) body.classList.add(PLAYER_BODY_CLASS.active, PLAYER_BODY_CLASS.navDim);
    else body.classList.remove(PLAYER_BODY_CLASS.active, PLAYER_BODY_CLASS.navDim);

    if (expanded) body.classList.add(PLAYER_BODY_CLASS.expanded);
    else body.classList.remove(PLAYER_BODY_CLASS.expanded);

    if (modalOpen) body.classList.add(PLAYER_BODY_CLASS.modalOpen, PLAYER_BODY_CLASS.navDim);
    else body.classList.remove(PLAYER_BODY_CLASS.modalOpen);

    return () => {
      body.classList.remove(
        PLAYER_BODY_CLASS.active,
        PLAYER_BODY_CLASS.expanded,
        PLAYER_BODY_CLASS.modalOpen,
        PLAYER_BODY_CLASS.navDim
      );
    };
  }, [playing, expanded, modalOpen]);
}

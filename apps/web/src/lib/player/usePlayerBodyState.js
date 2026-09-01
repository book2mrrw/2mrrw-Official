"use client";

import { useEffect } from "react";
import { PLAYER_BODY_CLASS } from "@/lib/player/constants";

const bodyStateClaims = {
  playing: 0,
  expanded: 0,
  modalOpen: 0,
};

function applyBodyStateClaims(body) {
  body.classList.toggle(PLAYER_BODY_CLASS.active, bodyStateClaims.playing > 0);
  body.classList.toggle(PLAYER_BODY_CLASS.expanded, bodyStateClaims.expanded > 0);
  body.classList.toggle(PLAYER_BODY_CLASS.modalOpen, bodyStateClaims.modalOpen > 0);
  body.classList.toggle(
    PLAYER_BODY_CLASS.navDim,
    bodyStateClaims.playing > 0 || bodyStateClaims.modalOpen > 0
  );
}

/**
 * Toggle document.body classes for site-wide player atmosphere.
 * Body scroll lock is owned by modalStackStore (ModalShell, sheets, expanded player).
 * Claims are reference-counted so one persistent surface cannot clear classes
 * still owned by the global player or another modal.
 */
export function usePlayerBodyState({ playing = false, expanded = false, modalOpen = false } = {}) {
  useEffect(() => {
    const { body } = document;
    if (playing) bodyStateClaims.playing += 1;
    if (expanded) bodyStateClaims.expanded += 1;
    if (modalOpen) bodyStateClaims.modalOpen += 1;
    applyBodyStateClaims(body);

    return () => {
      if (playing) bodyStateClaims.playing = Math.max(0, bodyStateClaims.playing - 1);
      if (expanded) bodyStateClaims.expanded = Math.max(0, bodyStateClaims.expanded - 1);
      if (modalOpen) bodyStateClaims.modalOpen = Math.max(0, bodyStateClaims.modalOpen - 1);
      applyBodyStateClaims(body);
    };
  }, [playing, expanded, modalOpen]);
}

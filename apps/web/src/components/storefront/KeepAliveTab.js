"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * A Home tab that is built the first time it is opened and then kept: leaving
 * it only hides it — exactly how the Home, Music and Live tabs already work —
 * so coming back never rebuilds its content, re-requests its images or
 * restarts its animations. Before its first visit it renders nothing, so tabs
 * the listener never opens cost nothing.
 *
 * Media with sound inside a tab stops when the tab is hidden (as it did when
 * leaving a tab unmounted it); muted animated artwork is left to its own
 * visibility handling, which resumes it on the same frame.
 */
export default function KeepAliveTab({ active, children }) {
  const [opened, setOpened] = useState(active);
  if (active && !opened) setOpened(true); // first visit builds the tab
  const panelRef = useRef(null);

  useLayoutEffect(() => {
    if (active || !panelRef.current) return;
    panelRef.current.querySelectorAll("video, audio").forEach((media) => {
      if (!media.paused && !media.muted) media.pause();
    });
  }, [active]);

  if (!opened && !active) return null;
  return (
    <div ref={panelRef} hidden={!active} aria-hidden={!active}>
      {children}
    </div>
  );
}

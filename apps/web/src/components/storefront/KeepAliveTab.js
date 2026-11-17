"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { PanelContext } from "@/hooks/usePanelLoadAhead";
import { createPanelHandle, getTabPrebuildQueue, warmBackgroundImages } from "@/lib/storefront/tab-prebuild";

// content-visibility, not display:none (globals.css): a hidden panel keeps its
// layout, scroll positions, decoded images and finished animations, so showing
// it again paints it exactly as it was left — nothing replays, reloads or
// fades back in.
const HIDDEN_CLASS = "tab-panel-hidden";
const noSubscribe = () => () => {};
const notPrepared = () => false;

/**
 * A Home tab that stays mounted; switching tabs only hides it.
 *
 * `lazy` panels are not built until they are first shown or prepared, which
 * for every panel with `prebuild` happens in idle time soon after the page
 * has loaded — so the listener never arrives at a tab that is still building.
 *
 * Media with sound inside a panel stops when the panel is hidden; muted
 * animated artwork is left to its own visibility handling, which resumes it on
 * the same frame.
 */
export function TabPanel({ active, as: Tag = "div", lazy = false, prebuild = true, className, children, ...rest }) {
  const [handle] = useState(createPanelHandle);
  // Only a lazy panel renders on being prepared (that is when it is built);
  // an always-mounted panel never re-renders for it — its media is driven
  // directly (usePanelLoadAhead).
  const prepared = useSyncExternalStore(lazy ? handle.subscribe : noSubscribe, lazy ? handle.isPrepared : notPrepared, notPrepared);
  const [shown, setShown] = useState(active);
  if (lazy && active && !shown) setShown(true);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!prebuild) return undefined;
    const queue = getTabPrebuildQueue();
    queue?.add(handle, { build: lazy });
    return () => queue?.remove(handle);
  }, [handle, prebuild, lazy]);

  // An opened panel's own off-screen media is prepared next.
  useEffect(() => {
    if (active && prebuild) getTabPrebuildQueue()?.add(handle, { first: true });
  }, [active, prebuild, handle]);

  // A tab built ahead of its first visit also fetches its CSS background art
  // (in idle time), so that is on screen the moment the tab opens too.
  useEffect(() => {
    if (!lazy || !prepared || shown || !panelRef.current) return undefined;
    const panel = panelRef.current;
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const id = idle(() => warmBackgroundImages(panel), { timeout: 2000 });
    return () => cancel(id);
  }, [lazy, prepared, shown]);

  const wasActiveRef = useRef(active);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!panel) return;
    if (!active) {
      panel.querySelectorAll("video, audio").forEach((media) => {
        if (!media.paused && !media.muted) media.pause();
      });
      return;
    }
    // Coming into view, the tab is shown as it already is. Chromium does not
    // run animations or transitions inside a hidden (content-visibility)
    // subtree, so whatever was built or changed while hidden would otherwise
    // start its fade-in on this frame and look like loading. One-shot
    // animations finish before the first paint; endless loops are untouched.
    if (!wasActive) {
      panel.getAnimations?.({ subtree: true }).forEach((animation) => {
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      });
    }
  }, [active]);

  if (lazy && !shown && !prepared) return null;
  return (
    <PanelContext.Provider value={handle}>
      <Tag
        ref={panelRef}
        {...rest}
        className={active ? className : [className, HIDDEN_CLASS].filter(Boolean).join(" ")}
        aria-hidden={!active || undefined}
        inert={!active}
      >
        {children}
      </Tag>
    </PanelContext.Provider>
  );
}

export default function KeepAliveTab({ active, prebuild = true, children }) {
  return (
    <TabPanel active={active} lazy prebuild={prebuild}>
      {children}
    </TabPanel>
  );
}

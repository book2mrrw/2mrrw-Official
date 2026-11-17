"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";

/** The enclosing tab panel's handle (see lib/storefront/tab-prebuild.js), provided by TabPanel. */
export const PanelContext = createContext(null);

/**
 * Load-ahead for media inside a tab panel. Once the panel is prepared its
 * media may load before it is visible — loading only, nothing plays until it
 * is on screen.
 *
 * Returns a ref that reads true once the panel is prepared, and calls
 * `onLoadAhead` at that moment (immediately if it already is). It never
 * re-renders the component: the media element is driven directly. Outside any
 * panel the ref stays false and the callback never runs.
 */
export function usePanelLoadAhead(onLoadAhead) {
  const handle = useContext(PanelContext);
  const preparedRef = useRef(handle?.isPrepared() ?? false);
  const callbackRef = useRef(onLoadAhead);

  useLayoutEffect(() => {
    callbackRef.current = onLoadAhead;
  });

  useEffect(() => {
    if (!handle) return undefined;
    const run = () => {
      preparedRef.current = true;
      callbackRef.current?.();
    };
    if (handle.isPrepared()) {
      run();
      return undefined;
    }
    return handle.subscribe(run);
  }, [handle]);

  return preparedRef;
}

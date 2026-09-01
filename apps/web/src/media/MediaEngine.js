/**
 * Imperative facade for the production media engine.
 *
 * AudioContext (`src/context/AudioContext.js`) owns the single `<audio>` element,
 * stream URLs, RAF progress, listening history, CS mode, and 403/409 handling.
 * This module is a naming alias + read-only snapshot API for non-React code.
 *
 * @see useMediaEngine — preferred React subscription hook
 */

import {
  getMediaEngineBridge,
  subscribeMediaEngine,
} from "./mediaEngineBridge";

export const MediaEngine = {
  /**
   * Latest engine snapshot from AudioProvider bridge, or null before mount.
   */
  getState() {
    return getMediaEngineBridge()?.getState?.() ?? null;
  },

  /**
   * Subscribe to snapshot updates (fires after AudioContext state sync).
   * @param {(snapshot: ReturnType<MediaEngine['getState']>) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    return subscribeMediaEngine(listener);
  },
};

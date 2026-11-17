/**
 * Home tabs are prepared before anyone opens them.
 *
 * Every tab panel registers here when it mounts. Once what is on screen has
 * finished loading, panels are prepared one at a time in idle time: a tab that
 * has not been built yet is built (hidden), and the media in a prepared panel
 * loads ahead instead of waiting to be scrolled or switched into view.
 * Preparing never plays anything. It pauses while a track is starting, so the
 * first audio bytes always go first.
 *
 * Order: a panel the listener just opened, then every tab still to be built
 * (on a slow device building is what decides whether a tab is there on
 * arrival), then media load-ahead for panels that are already built — each
 * group in page order.
 */

import {
  getAudioMediaPrioritySnapshot,
  subscribeAudioMediaPriority,
} from "@/lib/media/audio-media-priority";

const STEP_GAP_MS = 150;
const SETTLE_POLL_MS = 250;
const SETTLE_CAP_MS = 8000;

/** One panel's prepared flag. Prepared is permanent. */
export function createPanelHandle() {
  let prepared = false;
  const listeners = new Set();
  return {
    isPrepared: () => prepared,
    prepare() {
      if (prepared) return;
      prepared = true;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const RANK_OPENED = 0;
const RANK_BUILD = 1;
const RANK_LOAD_AHEAD = 2;

/** Prepares registered panels one by one; each step waits for the screen, audio and an idle slot. */
export function createTabPrebuildQueue({ whenScreenSettled, whenAudioIdle, nextIdle }) {
  const pending = []; // { handle, rank }, kept sorted by rank, page order within a rank
  let draining = null;

  async function drain() {
    await whenScreenSettled();
    while (pending.length) {
      await whenAudioIdle();
      await nextIdle();
      pending.shift()?.handle.prepare();
    }
    draining = null;
  }

  const indexOf = (handle) => pending.findIndex((entry) => entry.handle === handle);

  return {
    /**
     * `build`: the panel is not built yet (a lazy tab). `first`: the listener
     * just opened it, so it goes ahead of everything nobody has asked for yet.
     */
    add(handle, { first = false, build = false } = {}) {
      if (handle.isPrepared()) return;
      const rank = first ? RANK_OPENED : build ? RANK_BUILD : RANK_LOAD_AHEAD;
      const at = indexOf(handle);
      if (at >= 0) {
        if (pending[at].rank <= rank) return;
        pending.splice(at, 1);
      }
      const before = pending.findIndex((entry) => entry.rank > rank);
      pending.splice(before < 0 ? pending.length : before, 0, { handle, rank });
      draining ||= drain();
    },
    remove(handle) {
      const at = indexOf(handle);
      if (at >= 0) pending.splice(at, 1);
    },
    pendingCount: () => pending.length,
  };
}

function onScreen(el) {
  // Hidden tab panels keep their layout, so position alone would count their
  // media as visible; checkVisibility() knows the panel is hidden.
  if (el.checkVisibility && !el.checkVisibility()) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < window.innerHeight
    && rect.right > 0 && rect.left < window.innerWidth;
}

function mediaReady(el) {
  return el.tagName === "VIDEO" ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;
}

let screenSettled = null;
function whenScreenSettled() {
  screenSettled ||= new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const visible = [...document.querySelectorAll("img, video")].filter(onScreen);
      if ((visible.length && visible.every(mediaReady)) || Date.now() - startedAt >= SETTLE_CAP_MS) resolve();
      else setTimeout(check, SETTLE_POLL_MS);
    };
    setTimeout(check, SETTLE_POLL_MS);
  });
  return screenSettled;
}

function whenAudioIdle() {
  if (!getAudioMediaPrioritySnapshot().startupActive) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = subscribeAudioMediaPriority(() => {
      if (getAudioMediaPrioritySnapshot().startupActive) return;
      unsubscribe();
      resolve();
    });
  });
}

function nextIdle() {
  return new Promise((resolve) => {
    const afterGap = () => setTimeout(resolve, STEP_GAP_MS);
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(afterGap, { timeout: 1000 });
    else afterGap();
  });
}

const CSS_URL = /url\(\s*["']?([^"')]+?)["']?\s*\)/g;

/**
 * Fetches and decodes the CSS background images inside a hidden panel —
 * including ::before/::after — which the browser otherwise only requests when
 * the panel is first painted (the Vault door art arrived after the tab did).
 * Returns how many images it started.
 */
export function warmBackgroundImages(root) {
  const urls = new Set();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const pseudo of [null, "::before", "::after"]) {
      const value = getComputedStyle(el, pseudo).backgroundImage;
      if (!value || value === "none") continue;
      for (const match of value.matchAll(CSS_URL)) urls.add(match[1]);
    }
  }
  urls.forEach((url) => {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    image.decode?.().catch(() => {});
  });
  return urls.size;
}

let queue = null;

/** The page's queue (null on the server). */
export function getTabPrebuildQueue() {
  if (typeof window === "undefined") return null;
  queue ||= createTabPrebuildQueue({ whenScreenSettled, whenAudioIdle, nextIdle });
  return queue;
}

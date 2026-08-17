"use client";

/**
 * useVisualMode — OWNER of project-level Visual Mode toggle.
 *
 * Visual Mode is a session-scoped per-project boolean:
 *   OFF → show artwork for all tracks (default)
 *   ON  → show video player inside card for tracks that have a video asset
 *
 * State persists for the duration of the session (sessionStorage).
 * Key: `visualMode:{projectSlug}` — so each project has its own toggle.
 *
 * Syncs with InteractiveMediaState so all surfaces share the same value.
 *
 * @param {string} projectSlug
 * @returns {{ visualMode: boolean, toggleVisualMode: () => void, setVisualMode: (on: boolean) => void }}
 */

import { useCallback, useEffect, useState } from "react";
import { interactiveMediaState } from "@/media/InteractiveMediaState";

const _storageKey = (slug) => `visualMode:${slug}`;

function _readSession(slug) {
  if (typeof sessionStorage === "undefined" || !slug) return false;
  try {
    return sessionStorage.getItem(_storageKey(slug)) === "1";
  } catch { return false; }
}

function _writeSession(slug, on) {
  if (typeof sessionStorage === "undefined" || !slug) return;
  try {
    if (on) sessionStorage.setItem(_storageKey(slug), "1");
    else     sessionStorage.removeItem(_storageKey(slug));
  } catch {}
}

export function useVisualMode(projectSlug) {
  const [visualMode, setLocalMode] = useState(() => _readSession(projectSlug));

  // Sync IMS on mount
  useEffect(() => {
    const stored = _readSession(projectSlug);
    interactiveMediaState.setVisualMode(stored);
    setLocalMode(stored);
  }, [projectSlug]);

  // Subscribe to IMS changes (other surfaces toggling)
  useEffect(() => {
    return interactiveMediaState.subscribe((snap) => {
      setLocalMode(snap.visualMode);
    });
  }, []);

  const setVisualMode = useCallback((on) => {
    const v = Boolean(on);
    _writeSession(projectSlug, v);
    interactiveMediaState.setVisualMode(v);
    setLocalMode(v);
  }, [projectSlug]);

  const toggleVisualMode = useCallback(() => {
    const next = !interactiveMediaState.getSnapshot().visualMode;
    _writeSession(projectSlug, next);
    interactiveMediaState.setVisualMode(next);
    setLocalMode(next);
  }, [projectSlug]);

  return { visualMode, toggleVisualMode, setVisualMode };
}

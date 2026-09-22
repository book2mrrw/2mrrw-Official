"use client";

import { BroadcastListenerTransport } from "./listener-transport.js";
import { acquireExclusiveAudioFocus } from "@/lib/audio/exclusive-focus";
import { getAudioEngineRuntime } from "@/lib/playback/audio-engine-runtime";
import { getProductionPlaybackCore } from "@/lib/playback-core/production/wireProductionCore";

function waitForPause(audio) {
  if (!audio || audio.paused) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => { clearTimeout(timer); audio.removeEventListener("pause", onPause); error ? reject(error) : resolve(); };
    const onPause = () => finish();
    const timer = setTimeout(() => finish(new Error("Personal playback did not pause")), 3000);
    audio.addEventListener("pause", onPause, { once: true });
    if (audio.paused) finish();
  });
}

const personalFocus = {
  async acquire() {
    const lease = acquireExclusiveAudioFocus("broadcast");
    try {
      const { refs } = getAudioEngineRuntime();
      // Let any command already executing finish. Queued/new commands are held by the shared dispatcher.
      await refs.commandQueueRef.current.catch(() => {});
      if (!lease.isCurrent()) throw new Error("Audio handoff cancelled");
      const audio = refs.audioRef.current;
      const src = audio?.src;
      const wasPlaying = Boolean(audio && !audio.paused);
      const core = getProductionPlaybackCore();
      core.port.pause({ source: "broadcast" });
      await waitForPause(audio);
      return async ({ resumePersonal = true } = {}) => {
        if (!lease.release()) return;
        if (resumePersonal && wasPlaying && refs.audioRef.current === audio && audio.src === src) {
          core.port.resume({ source: "broadcast_return" });
        }
      };
    } catch (error) { lease.release(); throw error; }
  },
};

/** No React/provider owns this object; route and layout changes cannot recreate it. */
export function getBroadcastListener() {
  if (typeof window === "undefined") return null;
  if (!window.__2MRRW_BROADCAST_LISTENER__) {
    window.__2MRRW_BROADCAST_LISTENER__ = new BroadcastListenerTransport({
      focus: personalFocus,
      createAudio: () => {
        const audio = document.createElement("audio");
        audio.setAttribute("playsinline", "");
        audio.style.display = "none";
        document.body.appendChild(audio);
        return audio;
      },
    });
    const listener = window.__2MRRW_BROADCAST_LISTENER__;
    window.addEventListener("online", () => { if (listener.state.listening) void listener.refresh(); });
    window.addEventListener("pageshow", () => { if (listener.state.listening) void listener.refresh(); });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && listener.state.listening) void listener.refresh();
    });
  }
  return window.__2MRRW_BROADCAST_LISTENER__;
}

"use client";

import { attachStreamCommands } from "./PlaybackStreamCommands";
import { attachRecoveryCommands } from "./PlaybackRecoveryCommands";
import { attachCSCommands } from "./PlaybackCSCommands";
import { attachQueueCommands } from "./PlaybackQueueCommands";
import { attachTransportCommands } from "./PlaybackTransportCommands";

/**
 * createPlaybackCommands — B-5 thin factory.
 *
 * Builds the `self` service object and delegates command implementations to
 * five focused modules via the "attach" pattern. All inter-command calls use
 * `self.methodName()` so they resolve against the latest implementation at
 * call time, not a captured closure identity.
 *
 * Dep lifecycle: self._deps is updated every render via updateDeps(), so
 * every command reads fresh refs and callbacks without stale closures.
 */
export function createPlaybackCommands(initialDeps) {
  const self = {
    _deps: { ...initialDeps },

    updateDeps(deps) {
      Object.assign(self._deps, deps);
    },
  };

  // Each attach function mutates `self` by adding its command methods.
  // Order matters only where one group calls another that hasn't been attached yet —
  // but since all calls happen at runtime (not at attach time), order is irrelevant.
  attachStreamCommands(self);
  attachRecoveryCommands(self);
  attachCSCommands(self);
  attachQueueCommands(self);
  attachTransportCommands(self);

  return self;
}

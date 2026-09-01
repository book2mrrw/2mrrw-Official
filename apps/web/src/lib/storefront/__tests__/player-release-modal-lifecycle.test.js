import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

function source(relativePath) {
  return readFileSync(new URL(relativePath, `file://${WEB_ROOT}/`), "utf8");
}

test("global-player release intent never navigates or enters the route render tree", () => {
  const player = source("src/components/audio/GlobalAudioPlayerBar.js");
  const layout = source("src/app/layout.js");
  const home = source("src/app/HomeClient.js");

  assert.doesNotMatch(player, /from ["']next\/navigation["']/);
  assert.doesNotMatch(player, /router\.push|router\.replace|window\.location/);
  assert.doesNotMatch(player, /motion\.button|layoutId=/);
  assert.match(player, /primePlayerReleaseModal\(dockCurrentTrack\)/);
  assert.match(player, /return openPlayerReleaseModal\(dockCurrentTrack\)/);

  assert.doesNotMatch(layout, /ReleaseModalMotionRoot|LayoutGroup/);
  assert.match(layout, /<PlayerReleaseModalHost \/>/);
  assert.match(layout, /<GlobalAudioPlayerBar \/>/);

  assert.doesNotMatch(home, /setPlayerReleaseModalBridge|playerReleaseArtworkLayoutId/);
});

test("player modal is a persistent isolated host and click only changes its open state", () => {
  const host = source("src/components/player/PlayerReleaseModalHost.js");
  const modal = source("src/components/preview/ImmersivePreviewModal.js");
  const bridge = source("src/lib/storefront/player-release-modal-bridge.js");

  assert.match(host, /useSyncExternalStore\(/);
  assert.match(host, /open=\{snapshot\.open\}/);
  assert.match(host, /\bpersistent\b/);
  assert.doesNotMatch(host, /router\.|window\.location/);

  assert.match(modal, /data-persistent-modal=/);
  assert.match(modal, /PersistentCoverVideo/);
  assert.match(modal, /useMediaEngine\(\{ active: open \}\)/);

  assert.doesNotMatch(bridge, /router\.|window\.location|\.playQueue\(|\.playTrack\(/);
  assert.match(bridge, /open: sameRelease \? snapshot\.open : false/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const css = read("src/app/globals.css");
const rule = (selector) => css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)) + 1);

test("loading is a light on the play button's exact circumference, layered over it", () => {
  const ring = rule(".player-signature-ring__buffer");
  assert.match(ring, /inset: 0;/, "exactly the button's edge, not offset around it");
  assert.match(ring, /pointer-events: none;/);
  assert.match(ring, /mask: radial-gradient\(farthest-side, transparent calc\(100% - 2\.5px\), #000 calc\(100% - 2px\)\);/);
  assert.match(ring, /animation: playerRingOrbit 1s linear infinite;/);
  // Its own centred rotation: the old spin carried translateX(-50%) from the
  // floating spinner and pushed the ring half a button to the left.
  assert.match(css, /@keyframes playerRingOrbit \{\s*to \{\s*transform: rotate\(360deg\);/);
  assert.doesNotMatch(css, /playerBufferSpin|player-immersive-buffer-indicator/);
  const on = rule(".player-signature-ring--buffering .player-signature-ring__buffer");
  assert.match(on, /opacity: 1;/);
  assert.match(on, /transition-delay: 120ms;/, "no flash for a load that is instant");
});

test("the ring is always mounted (fades out instead of vanishing) and recovery uses it too", () => {
  const ring = read("src/components/player/ImmersivePlayerEngine/SignaturePlayRing.js");
  assert.match(ring, /<span className="player-signature-ring__buffer" aria-hidden \/>/);
  assert.doesNotMatch(ring, /isBuffering \? <span className="player-signature-ring__buffer"/);
  assert.match(ring, /aria-busy=\{isBuffering \|\| undefined\}/);
  const bar = read("src/components/audio/GlobalAudioPlayerBar.js");
  assert.match(bar, /isBuffering=\{isBuffering \|\| playbackOrchestrationState === "RECOVERING" \|\|/);
  assert.match(bar, /\{playbackOrchestrationState === "RECOVERING" \? "Buffering" : ""\}/);
});

test("arriving at the Vault centres the vault before paint", () => {
  const home = read("src/app/HomeClient.js");
  assert.match(home, /<div data-vault-stage style=\{\{marginTop:28\}\}>/);
  const effect = home.slice(home.indexOf('if (activeTab !== "vault") return;'), home.indexOf("}, [activeTab]);", home.indexOf('if (activeTab !== "vault") return;')));
  assert.match(home, /useLayoutEffect\(\(\) => \{\s*if \(activeTab !== "vault"\) return;/);
  assert.match(effect, /scroller\?\.querySelector\("\[data-vault-stage\] \.vault-door-gate"\)/);
  assert.match(effect, /\(scroller\.clientHeight - gate\.offsetHeight\) \/ 2/);
});

test("the loading ring cannot stay on over audible music: advancing time clears buffering", () => {
  const handlers = read("src/lib/playback/PlaybackEventHandlers.js");
  const onTime = handlers.slice(handlers.indexOf("const onTime = () => {"), handlers.indexOf("persistPlayback(\"progress\");", handlers.indexOf("const onTime = () => {")));
  assert.match(onTime, /audibilitySampleRef\.current\.frozenSince === null &&\s*!audio\.seeking &&\s*audio\.readyState >= 3 &&\s*playbackStateMachine\.getContext\(\)\.isBuffering/);
  assert.match(onTime, /patchState\(\{ isBuffering: false, playbackNetworkState: "playing" \}\);\s*playbackStateMachine\.transition\(PLAYBACK_ORCHESTRATION_EVENTS\.BUFFER_END\);/);
  // The watchdog reads the same authority the ring does.
  assert.match(handlers, /if \(playbackStateMachine\.getContext\(\)\.isBuffering \|\| stateRef\.current\?\.isBuffering\) \{/);
});

test("a patch that only clears buffering is never skipped as 'no change'", async () => {
  const { playbackUiStateEqual } = await import("@/lib/playback/playback-track-utils");
  const playing = { currentTrackId: "w2d", isPlaying: true, isBuffering: true, queue: [], queueIndex: 0 };
  assert.equal(playbackUiStateEqual(playing, { ...playing, isBuffering: false }), false);
  assert.equal(playbackUiStateEqual(playing, { ...playing }), true);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("NAV-01/NAV-02 internal exits use soft navigation", () => {
  const home = read("src/app/HomeClient.js");
  const storefront = read("src/components/home/HomeStorefront.js");
  const subscribe = read("src/app/subscribe/page.js");

  assert.doesNotMatch(home, /window\.location\.assign\(COLLECTORS_CARDS_ROUTE\)/);
  assert.doesNotMatch(storefront, /window\.location\.href\s*=\s*COLLECTORS_CARDS_ROUTE/);
  assert.doesNotMatch(subscribe, /window\.location\.href\s*=\s*["']\/["']/);
  assert.match(home, /router\.push\(COLLECTORS_CARDS_ROUTE\)/);
  assert.match(storefront, /router\.push\(COLLECTORS_CARDS_ROUTE\)/);
  assert.match(subscribe, /router\.push\(["']\/["']\)/);
});

test("BOOT-03/BOOT-04 hydration and guest identity never cover the public shell", () => {
  const rootComponent = read("src/components/auth/AppAuthRoot.js");
  assert.doesNotMatch(rootComponent, /BOOT_PLACEHOLDER|showAuthGate|variant=["']root["']/);
  assert.match(rootComponent, /return children/);
});

test("BOOT-02/CAT-03 storefront tracks use one set-based query", () => {
  const catalog = read("src/lib/media/catalog-db.js");
  assert.match(catalog, /\.in\("product_id", productIds\)/);
  assert.match(catalog, /tracksByProductId\.get\(row\.id\)/);
  assert.doesNotMatch(catalog, /fetchTracksForProduct\(/);
});

test("SYS-05 admin preview object URLs have replacement and unmount revocation", () => {
  for (const relativePath of [
    "src/components/admin/UploadWizard.js",
    "src/components/admin/InlineReleasesManager.js",
  ]) {
    const source = read(relativePath);
    assert.match(source, /URL\.createObjectURL/);
    assert.match(source, /URL\.revokeObjectURL/);
    assert.match(source, /useEffect\(\(\) => \(\) =>/);
  }
});

test("BOOT-07/SYS-01 Stripe has one explicit, payment-scoped loader", () => {
  const layout = read("src/app/layout.js");
  const stripeClient = read("src/lib/commerce/stripe-client.js");
  assert.doesNotMatch(layout, /StripeProvider|@stripe\/stripe-js/);
  assert.match(stripeClient, /export function getStripeClient/);

  const sourceFiles = [
    "src/app/HomeClient.js",
    "src/app/subscribe/page.js",
    "src/components/payments/DonateModal.js",
    "src/components/collectors-cards/CollectorCardModal.js",
  ];
  for (const relativePath of sourceFiles) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /loadStripe|NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/);
    assert.match(source, /getStripeClient/);
  }
});

test("SLICE-1D production PLAY/PAUSE/RESUME/SEEK enter Playback Core", () => {
  const publicApi = read("src/lib/playback/usePlaybackPublicApi.js");
  const keyboard = read("src/lib/playback/keyboard-shortcuts.js");
  const audioContext = read("src/context/AudioContext.js");

  assert.match(publicApi, /getProductionPlaybackCore/);
  assert.match(publicApi, /playbackPort\.play\(/);
  assert.match(publicApi, /playbackPort\.pause\(/);
  assert.match(publicApi, /playbackPort\.resume\(/);
  assert.match(publicApi, /playbackPort\.seek\(/);
  assert.match(publicApi, /requestAuthoritativePlay/);
  assert.match(audioContext, /requestAuthoritativePlay:\s*publicApi\.requestAuthoritativePlay/);
  assert.doesNotMatch(
    publicApi,
    /dispatchPlaybackCommand\(\s*PLAYBACK_COMMANDS\.(?:PLAY_TRACK|PAUSE|RESUME|SEEK)/,
  );

  assert.match(keyboard, /getProductionPlaybackCore/);
  assert.match(keyboard, /playbackCore\.port\.pause\(/);
  assert.match(keyboard, /playbackCore\.port\.resume\(/);
  assert.match(keyboard, /playbackCore\.port\.seek\(/);
});

test("SLICE-1D Core authority mode survives payload loss to the executor", () => {
  const adapter = read("src/lib/playback-core/adapters/PlaybackCoreAdapter.js");
  const dispatcher = read("src/lib/playback/command-dispatcher.js");
  const executor = read("src/lib/playback/command-executor.js");
  const stream = read("src/lib/playback/PlaybackStreamCommands.js");
  const transport = read("src/lib/playback/PlaybackTransportCommands.js");

  assert.match(adapter, /effectAuthorityMode:\s*PhysicalEffectAuthorityMode\.CORE/);
  assert.match(dispatcher, /effectAuthorityMode/);
  assert.match(dispatcher, /const command = \{[\s\S]*effectAuthorityMode/);
  assert.match(executor, /command\.effectAuthorityMode === PhysicalEffectAuthorityMode\.CORE/);
  assert.match(stream, /\.\.\.physicalEffectContext/);
  assert.match(transport, /effectContext\.effectAuthorityMode\s*\?\?\s*PhysicalEffectAuthorityMode\.CORE_CURRENT/);
});

test("SLICE-1D active-deck modules have no raw play() bypass", () => {
  const activeDeckFiles = [
    "src/lib/audio/WebAudioEngine.js",
    "src/lib/playback/PlaybackCSCommands.js",
    "src/lib/playback/PlaybackEventHandlers.js",
    "src/lib/playback/PlaybackHelperService.js",
    "src/lib/playback/PlaybackQueueCommands.js",
    "src/lib/playback/PlaybackRecoveryCommands.js",
    "src/lib/playback/PlaybackStreamCommands.js",
    "src/lib/playback/PlaybackTransportCommands.js",
    "src/lib/playback/usePlaybackEffects.js",
    "src/lib/playback/usePlaybackPublicApi.js",
  ];

  for (const relativePath of activeDeckFiles) {
    const executableSource = read(relativePath)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      // This is an intent submission, not a physical media-element effect.
      .replace(/\b(?:playbackCore\.port|playbackPort)\.play\s*\(/g, "governedCorePlay(");
    assert.doesNotMatch(
      executableSource,
      /\b[A-Za-z_$][\w$]*\.play\s*\(/,
      `${relativePath} must use the governed audio-element leaf`,
    );
    assert.doesNotMatch(
      executableSource,
      /effectAuthorityMode:\s*(?:"LEGACY"|PhysicalEffectAuthorityMode\.LEGACY)/,
      `${relativePath} must not bypass the session's Core effect authority`,
    );
  }
});

test("SLICE-1D legacy queue navigation promotes every new selection through Core", () => {
  const queueCommands = read("src/lib/playback/PlaybackQueueCommands.js");
  const publicApi = read("src/lib/playback/usePlaybackPublicApi.js");
  const reducer = read("src/lib/playback-core/desired/DesiredStateReducer.js");

  assert.doesNotMatch(queueCommands, /self\.playTrackInternal\(/);
  assert.match(queueCommands, /requestAuthoritativePlay/);
  assert.match(publicApi, /PLAYBACK_COMMANDS\.SET_QUEUE/);
  assert.doesNotMatch(
    publicApi,
    /dispatchPlaybackCommand\(\s*PLAYBACK_COMMANDS\.PLAY_QUEUE/,
  );
  assert.doesNotMatch(reducer, /intent\.mediaEntry|optionalExecutionTargetPatch/);
});

test("SLICE-1D protected transport keeps dependency direction Core -> media", () => {
  const protectedTransportFiles = [
    "src/lib/audio/audio-element-utils.js",
    "src/lib/audio/physical-effect-authority.js",
    "src/lib/audio/WebAudioEngine.js",
    "src/lib/playback/PlaybackStreamCommands.js",
    "src/lib/playback/PlaybackTransportCommands.js",
    "src/lib/playback/PlaybackQueueCommands.js",
    "src/lib/playback/command-dispatcher.js",
    "src/lib/playback/command-executor.js",
  ];

  for (const relativePath of protectedTransportFiles) {
    assert.doesNotMatch(
      read(relativePath),
      /(?:@\/lib\/playback-core|\.\.\/playback-core|from\s+["'][^"']*playback-core)/,
      `${relativePath} must not import Playback Core internals`,
    );
  }
});

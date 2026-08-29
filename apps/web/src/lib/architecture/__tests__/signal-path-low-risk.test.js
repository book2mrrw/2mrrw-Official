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

test("BOOT-03/BOOT-04 hydration is UX-only while server authority gates the consumer shell", () => {
  const rootComponent = read("src/components/auth/AppAuthRoot.js");
  const middleware = read("middleware.js");
  const policy = read("src/lib/auth/route-access-policy.js");
  assert.doesNotMatch(rootComponent, /BOOT_PLACEHOLDER|showAuthGate|variant=["']root["']/);
  assert.match(rootComponent, /return children/);
  assert.match(middleware, /resolveRouteAccessDecision/);
  assert.match(middleware, /supabase|updateSession/);
  assert.match(policy, /return \{ accessClass: RouteAccessClass\.AUTHENTICATED_CONSUMER, rule: "default-protected" \}/);
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

test("UI-01 Recently Played stays compact without resizing adjacent My Music shelves", () => {
  const source = read("src/components/music/MyMusicTab.js");
  const recentlyPlayedStart = source.indexOf("function RecentlyPlayedSection");
  const recentlyAddedStart = source.indexOf("function RecentlyAddedRow");

  assert.ok(recentlyPlayedStart >= 0, "Recently Played section must exist");
  assert.ok(recentlyAddedStart > recentlyPlayedStart, "Recently Added must follow Recently Played");

  const recentlyPlayed = source.slice(recentlyPlayedStart, recentlyAddedStart);
  const recentlyAdded = source.slice(recentlyAddedStart);

  assert.match(recentlyPlayed, /const cardWidth = isMobile \? 144 : 164/);
  assert.match(recentlyPlayed, /flex: `0 0 \$\{cardWidth\}px`/);
  assert.match(recentlyPlayed, /aspectRatio: "1"/);
  assert.match(recentlyAdded, /width: 130/);
});

test("UI-02 tab navigation retains mounted surfaces and per-tab scroll identity", () => {
  const home = read("src/app/HomeClient.js");
  const musicTabs = read("src/components/storefront/MusicTabCatalogPanels.js");

  assert.match(home, /function PersistentTabMount/);
  assert.match(home, /tabScrollPositionsRef\.current\.set/);
  assert.match(home, /tabScrollPositionsRef\.current\.get\(activeTab\)/);
  assert.doesNotMatch(home, /\{activeTab==="(?:shop|vault|help|blog|vision|circle|innercircle|account)"\s*&&\s*\(/);
  assert.match(musicTabs, /MUSIC_TAB_IDS\.map/);
  assert.match(musicTabs, /data-persistent-tab=\{tabId\}/);
  assert.doesNotMatch(musicTabs, /if \(!mountedTabsRef\.current\.has/);
});

test("UI-03 release actions and Audio Visual controls retain stable DOM identity", () => {
  const actions = read("src/components/music/ReleaseCardPlayButton.js");
  const latestRow = read("src/components/home/LatestSinglesStyleRow.js");
  const features = read("src/components/home/FeaturesRail.js");
  const catalog = read("src/components/home/CatalogGrid.js");
  const audioVisuals = read("src/components/home/AudioVisualsSection.js");
  const homeCatalog = read("src/components/storefront/HomeStorefrontCatalogMedia.js");

  assert.match(actions, /data-persistent-release-actions="true"/);
  assert.match(actions, /data-release-action-slot="playback"/);
  assert.match(actions, /data-release-action-slot="library"/);
  assert.match(actions, /data-release-action-slot="purchase"/);
  assert.match(actions, /data-release-action-icon="play"/);
  assert.match(actions, /data-release-action-icon="pause"/);
  assert.doesNotMatch(actions, /\{showPlay\s*\?\s*<ReleaseCardPlayButton/);

  assert.match(latestRow, /data-persistent-card-actions="true"/);
  assert.match(features, /data-persistent-card-actions="true"/);
  assert.match(catalog, /data-persistent-card-actions="true"/);
  assert.match(homeCatalog, /id="home-mixtapes-eps"[\s\S]*source="home_mixtape_ep_card"[\s\S]*cardMedia="cover"/);

  assert.match(audioVisuals, /data-persistent-audio-visual-player="true"/);
  assert.match(audioVisuals, /data-persistent-audio-visual-poster="true"/);
  assert.match(audioVisuals, /data-persistent-audio-visual-control="true"/);
  assert.match(audioVisuals, /data-audio-visual-icon="play"/);
  assert.match(audioVisuals, /data-audio-visual-icon="pause"/);
  assert.doesNotMatch(audioVisuals, /key=\{featuredId\}/);
  assert.doesNotMatch(audioVisuals, /\{isActive\s*&&\s*\(/);
  assert.doesNotMatch(audioVisuals, /\{!isActive\s*&&\s*\(/);
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

test("production playback startup policy stays short, bounded, and audio-first", () => {
  const policy = read("src/lib/hls/playback-quality-policy.js");
  const engine = read("src/lib/audio/HLSEngine.js");
  const stream = read("src/lib/playback/PlaybackStreamCommands.js");
  const prefetcher = read("src/lib/audio/hls-segment-prefetcher.js");
  const overlay = read("src/components/music/VisualMomentOverlay.js");
  const playerBar = read("src/components/audio/GlobalAudioPlayerBar.js");
  const persistentVisual = read("src/lib/media/persistent-visual-lifecycle.js");
  const singles = read("src/components/home/LatestSinglesStyleRow.js");
  const coverArt = read("src/components/ui/CoverArt.js");
  const ambientBackground = read("src/components/home/AmbientPlaybackBackground.js");

  assert.match(policy, /AUDIO_SEGMENT_DURATION_SECONDS\s*=\s*2/);
  assert.match(policy, /AUDIO_FORWARD_BUFFER_SECONDS\s*=\s*30/);
  assert.match(engine, /maxBufferLength:\s*AUDIO_FORWARD_BUFFER_SECONDS/);
  assert.match(engine, /abrEwmaDefaultEstimate:\s*AUDIO_INITIAL_BANDWIDTH_ESTIMATE/);
  assert.match(stream, /hlsDidLoad\s*\?\s*AUDIO_STARTUP_BUFFER_SECONDS\s*:\s*3/);
  assert.match(prefetcher, /prefetchedSeconds\s*>=\s*AUDIO_PREFETCH_BUFFER_SECONDS/);
  assert.match(overlay, /preload="none"/);
  assert.match(playerBar, /createPersistentVisualLifecycle/);
  assert.doesNotMatch(playerBar, /const timer = setTimeout|removeAttribute\("src"\)|\.load\(\)/);
  assert.doesNotMatch(stream, /audio-media-priority|beginAudioStartupPriority|audioMediaPriorityLease/);
  assert.match(singles, /<CoverArt/);
  assert.doesNotMatch(singles, /useAudioMediaPriority|removeAttribute\("src"\)|\.load\(\)/);
  assert.match(coverArt, /createPersistentVisualLifecycle/);
  assert.match(coverArt, /data-persistent-media="video"/);
  assert.doesNotMatch(coverArt, /useAudioMediaPriority|removeAttribute\("src"\)|\.load\(\)/);
  assert.match(persistentVisual, /video\.play\(\)/);
  assert.doesNotMatch(
    persistentVisual,
    /subscribeAudioMediaPriority|IntersectionObserver|VRM\.|video\.pause\(|removeAttribute\("src"\)|\.load\(\)/
  );
  assert.match(ambientBackground, /<CoverArt/);
  assert.doesNotMatch(ambientBackground, /useAudioMediaPriority|removeAttribute\("src"\)|\.load\(\)/);
  assert.doesNotMatch(ambientBackground, /autoPlay/);
  assert.doesNotMatch(ambientBackground, /preload="auto"/);
});

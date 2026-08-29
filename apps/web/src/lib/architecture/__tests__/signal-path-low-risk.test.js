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

test("UI-04 the canonical scroller retains release, embedded-video, and live compositor surfaces", () => {
  const home = read("src/app/HomeClient.js");
  const css = read("src/app/globals.css");
  const storefront = read("src/components/home/HomeStorefront.js");
  const latestRow = read("src/components/home/LatestSinglesStyleRow.js");
  const features = read("src/components/home/FeaturesRail.js");
  const catalog = read("src/components/home/CatalogGrid.js");
  const actions = read("src/components/music/ReleaseCardPlayButton.js");
  const coverArt = read("src/components/ui/CoverArt.js");
  const audioVisuals = read("src/components/home/AudioVisualsSection.js");
  const live = read("src/components/home/LiveCountdownDisplays.js");
  const livePanel = read("src/components/home/LivePanel.js");
  const scrollShell = read("src/components/storefront/ScrollPaddingShell.js");

  assert.match(home, /data-main-scroll/);
  assert.doesNotMatch(home, /data-main-scroll[\s\S]{0,160}WebkitOverflowScrolling/);
  assert.match(css, /\[data-main-scroll\][\s\S]*will-change:\s*scroll-position/);
  assert.match(css, /\[data-persistent-media\][\s\S]*content-visibility:\s*visible\s*!important/);
  assert.match(css, /\[data-persistent-release-actions\]/);
  assert.match(css, /\[data-persistent-audio-visual-player\]/);
  assert.match(css, /\[data-persistent-live-player\]/);

  for (const source of [latestRow, features, catalog]) {
    assert.match(source, /data-scroll-persistent-card="release"/);
  }
  assert.doesNotMatch(actions, /transition:\s*"all/);
  assert.doesNotMatch(coverArt, /transition:\s*"opacity 180ms ease"/);

  assert.match(audioVisuals, /data-scroll-persistent-surface="audio-visuals-player"/);
  assert.match(audioVisuals, /data-persistent-audio-visual-frame="true"/);
  assert.match(live, /data-persistent-live-surface="home-live"/);
  assert.match(live, /data-persistent-live-player="true"/);
  assert.match(livePanel, /data-persistent-live-surface="desktop-countdown"/);

  assert.doesNotMatch(storefront, /from "framer-motion"/);
  assert.doesNotMatch(storefront, /<motion\./);
  assert.doesNotMatch(scrollShell, /from "framer-motion"/);
  assert.doesNotMatch(scrollShell, /<motion\./);
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

test("SLICE-2 Core is the sole canonical Transport writer", () => {
  const commitGate = read("src/lib/playback-core/commands/CommitGate.js");
  const stateMachine = read("src/media/PlaybackStateMachine.js");
  const authority = read("src/lib/playback-core/transport/TransportAuthority.js");
  const productionFiles = fs.readdirSync(path.join(root, "src/lib/playback-core"), { recursive: true })
    .filter((entry) => typeof entry === "string" && entry.endsWith(".js") && !entry.includes("__tests__"));

  const directCommitCallers = productionFiles.filter((entry) => {
    const source = read(path.join("src/lib/playback-core", entry));
    return /\._applyCommit\(/.test(source);
  });
  assert.deepEqual(directCommitCallers, [path.join("commands", "CommitGate.js")]);
  assert.match(authority, /#commitGate\.propose\(/);
  assert.match(authority, /domain:\s*Domain\.TRANSPORT/);
  assert.match(stateMachine, /_CORE_TRANSPORT_KEYS/);
  assert.match(stateMachine, /patch\s*=\s*businessPatch/);
  assert.doesNotMatch(stateMachine, /this\.context\s*=\s*Object\.assign\([^\n]*coreTransportProjection/);
  assert.doesNotMatch(stateMachine, /\._applyCommit\(/);
  assert.doesNotMatch(commitGate, /catch[\s\S]{0,120}PlaybackStateMachine/);
});

test("SLICE-2 physical media events are injected observations, not authority", () => {
  const engine = read("src/lib/audio/WebAudioEngine.js");
  const handlers = read("src/lib/playback/PlaybackEventHandlers.js");
  const port = read("src/lib/playback/transport-observation-port.js");

  for (const domEvent of [
    "play", "pause", "waiting", "stalled", "playing", "seeking",
    "seeked", "ended", "error",
  ]) {
    assert.match(engine, new RegExp(`\\["${domEvent}"`), `${domEvent} must be forwarded`);
  }
  for (const observation of [
    "PHYSICAL_PLAY", "PHYSICAL_PAUSE", "PHYSICAL_WAITING", "PHYSICAL_STALLED",
    "PHYSICAL_PLAYING", "PHYSICAL_SEEKING", "PHYSICAL_SEEKED",
    "PHYSICAL_ENDED", "PHYSICAL_ERROR",
  ]) {
    assert.match(handlers, new RegExp(`TO\\.${observation}`), `${observation} must reach Core`);
  }
  assert.doesNotMatch(engine, /playback-core|TransportAuthority|CommitGate/);
  assert.match(port, /installTransportObservationSink/);
  assert.match(port, /TRANSPORT_AUTHORITY_UNAVAILABLE/);
});

test("SLICE-2 production UI consumes Core Transport without legacy-domain mixing", () => {
  const context = read("src/context/AudioContext.js");
  const globalPlayer = read("src/components/audio/GlobalAudioPlayerBar.js");
  const mediaEngine = read("src/media/useMediaEngine.js");

  assert.match(context, /useProductionTransportStatus/);
  assert.match(context, /useProductionTransportTimeline/);
  assert.doesNotMatch(context, /playbackStateMachine\.getTransportSnapshot/);
  assert.doesNotMatch(context, /playbackStateMachine\.getProgressSnapshot/);
  assert.match(globalPlayer, /useProductionTransportStatus/);
  assert.doesNotMatch(globalPlayer, /usePlaybackStateMachine/);
  assert.match(mediaEngine, /const isPlaying = Boolean\(audio\.isPlaying\)/);
  assert.doesNotMatch(
    mediaEngine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    /readElementPlaying|bridgePlaying|audiblyPlaying/,
  );
});

test("SLICE-3 production ownership is TRANSPORT=CORE and SELECTION=CORE", () => {
  const wiring = read("src/lib/playback-core/production/wireProductionCore.js");
  const registry = read("src/lib/playback-core/ownership/DomainOwnershipRegistry.js");
  assert.match(wiring, /_transferDomainToCore\(Domain\.TRANSPORT\)/);
  assert.match(wiring, /_transferDomainToCore\(Domain\.SELECTION\)/);
  assert.doesNotMatch(registry, /^\s*transferToLegacy\s*\(/m);
  // Registry still DEFAULTS every domain to LEGACY — production wiring is what
  // transfers TRANSPORT and SELECTION; CAPABILITY/CONTINUITY/MEDIA_PREPARATION
  // remain LEGACY, unaffected by Slice 3.
  assert.match(registry, /\[Domain\.SELECTION,\s*DomainOwner\.LEGACY\]/);
  assert.doesNotMatch(registry, /transferToCore\(Domain\.SELECTION\)/);
});

test("SLICE-3 Core is the sole canonical Selection writer", () => {
  const commitGate = read("src/lib/playback-core/commands/CommitGate.js");
  const stateMachine = read("src/media/PlaybackStateMachine.js");
  const authority = read("src/lib/playback-core/selection/SelectionAuthority.js");
  const productionFiles = fs.readdirSync(path.join(root, "src/lib/playback-core"), { recursive: true })
    .filter((entry) => typeof entry === "string" && entry.endsWith(".js") && !entry.includes("__tests__"));

  const directCommitCallers = productionFiles.filter((entry) => {
    const source = read(path.join("src/lib/playback-core", entry));
    return /\._applyCommit\(/.test(source);
  });
  assert.deepEqual(directCommitCallers, [path.join("commands", "CommitGate.js")]);
  assert.match(authority, /#commitGate\.propose\(/);
  assert.match(authority, /domain:\s*Domain\.SELECTION/);
  assert.match(stateMachine, /_CORE_SELECTION_IDENTITY_KEYS/);
  assert.match(stateMachine, /coreSelectionProjection/);
  assert.doesNotMatch(stateMachine, /\._applyCommit\(/);

  const protectedSelectionFiles = [
    "src/lib/playback/PlaybackQueueCommands.js",
    "src/lib/playback/PlaybackTransportCommands.js",
    "src/lib/playback/PlaybackStreamCommands.js",
    "src/lib/playback/command-dispatcher.js",
    "src/lib/playback/command-executor.js",
  ];
  for (const relativePath of protectedSelectionFiles) {
    assert.doesNotMatch(
      read(relativePath),
      /(?:@\/lib\/playback-core|\.\.\/playback-core|from\s+["'][^"']*playback-core)/,
      `${relativePath} must not import Playback Core internals`,
    );
  }
});

test("SLICE-3 ADDENDUM: canonical Selection bridge subscribes lazily, never at module construction", () => {
  // PlaybackStateMachine is a module-load-time singleton, constructed long
  // before getProductionPlaybackCore() ever wires and installs the Selection
  // sink (that happens inside a hook body, during AudioProvider's render).
  // Subscribing to Core Selection inside the constructor would permanently
  // bind to "no sink installed" — see selection-bridge-lifecycle.test.mjs for
  // the full regression proof (negative control + real lifecycle).
  const stateMachine = read("src/media/PlaybackStateMachine.js");

  const ctorMatch = stateMachine.match(/class PlaybackStateMachine \{\s*constructor\(\) \{[\s\S]*?\r?\n  \}\r?\n/);
  assert.ok(ctorMatch, "could not isolate PlaybackStateMachine's constructor body");
  const constructorBody = ctorMatch[0];
  assert.doesNotMatch(constructorBody, /subscribeCanonicalSelection/, "constructor must not subscribe to Core Selection eagerly");
  assert.doesNotMatch(constructorBody, /_ensureSelectionBridgeSubscribed\(/, "constructor must not establish the Selection bridge eagerly");

  // Exactly one production call site for the real subscription — inside the
  // lazy bridge method itself, never duplicated elsewhere.
  const subscribeCallCount = (stateMachine.match(/subscribeCanonicalSelection\(/g) || []).length;
  assert.equal(subscribeCallCount, 1);
  assert.match(stateMachine, /_ensureSelectionBridgeSubscribed\(\)\s*\{[\s\S]*?subscribeCanonicalSelection/);

  // The bridge is established only from real subscriber entry points, not
  // from imperative reads (getContext/getContextSnapshot must stay eager-safe).
  assert.match(stateMachine, /subscribeContext\(listener\)\s*\{\s*this\._ensureSelectionBridgeSubscribed\(\);/);
  assert.match(stateMachine, /subscribeIdentity\(listener\)\s*\{\s*this\._ensureSelectionBridgeSubscribed\(\);/);
  const getContextDefAt = stateMachine.indexOf("getContext() {");
  assert.ok(getContextDefAt >= 0, "could not locate getContext() method definition");
  assert.doesNotMatch(
    stateMachine.slice(getContextDefAt, getContextDefAt + 200),
    /_ensureSelectionBridgeSubscribed/,
  );
});

test("SLICE-4D production ownership is TRANSPORT=CORE, SELECTION=CORE, CONTINUITY=CORE", () => {
  const wiring = read("src/lib/playback-core/production/wireProductionCore.js");
  const registry = read("src/lib/playback-core/ownership/DomainOwnershipRegistry.js");
  assert.match(wiring, /_transferDomainToCore\(Domain\.TRANSPORT\)/);
  assert.match(wiring, /_transferDomainToCore\(Domain\.SELECTION\)/);
  assert.match(wiring, /_transferDomainToCore\(Domain\.CONTINUITY\)/);
  assert.doesNotMatch(registry, /^\s*transferToLegacy\s*\(/m);
  // CAPABILITY/MEDIA_PREPARATION remain LEGACY, unaffected by Slice 4D — the
  // registry's default map still starts every domain LEGACY; only production
  // wiring transfers TRANSPORT/SELECTION/CONTINUITY.
  assert.match(registry, /\[Domain\.CAPABILITY,\s*DomainOwner\.LEGACY\]/);
  assert.match(registry, /\[Domain\.MEDIA_PREPARATION,\s*DomainOwner\.LEGACY\]/);
});

test("SLICE-4D Core is the sole canonical Continuity writer; restore is a proposal, never authority", () => {
  const commitGate = read("src/lib/playback-core/commands/CommitGate.js");
  const authority = read("src/lib/playback-core/continuity/ContinuityAuthority.js");
  const productionFiles = fs.readdirSync(path.join(root, "src/lib/playback-core"), { recursive: true })
    .filter((entry) => typeof entry === "string" && entry.endsWith(".js") && !entry.includes("__tests__"));

  const directCommitCallers = productionFiles.filter((entry) => {
    const source = read(path.join("src/lib/playback-core", entry));
    return /\._applyCommit\(/.test(source);
  });
  assert.deepEqual(directCommitCallers, [path.join("commands", "CommitGate.js")]);
  assert.match(authority, /#commitGate\.propose\(/);
  assert.match(authority, /domain:\s*Domain\.CONTINUITY/);

  // Continuity never becomes Selection/Transport authority itself — it
  // delegates. The only Selection-shaped call this file may make is
  // restoreSelection() on an INJECTED SelectionAuthority instance.
  assert.doesNotMatch(authority, /domain:\s*Domain\.(SELECTION|TRANSPORT)/);
  assert.match(authority, /#selectionAuthority\.restoreSelection\(/);
  assert.doesNotMatch(authority, /#selectionAuthority\.(setQueueAndSelect|selectIndex|selectMedia|next|previous|removeItem|insertItem|reorderQueue|replaceQueue|clearQueue)\(/);

  // Position restore validates only — it must never touch a physical element
  // or dispatch a play/seek call itself.
  assert.doesNotMatch(authority, /\baudio\.(play|pause)\(/);
  assert.doesNotMatch(authority, /\.currentTime\s*=/);

  const protectedContinuityFiles = [
    "src/lib/playback/session-memory.js",
    "src/lib/playback/position-memory.js",
    "src/system/recovery/usePlaybackRecovery.js",
    "src/system/recovery/useSessionRecovery.js",
    "src/system/recovery/recoveryStore.js",
  ];
  for (const relativePath of protectedContinuityFiles) {
    assert.doesNotMatch(
      read(relativePath),
      /(?:@\/lib\/playback-core|\.\.\/playback-core|from\s+["'][^"']*playback-core)/,
      `${relativePath} must not import Playback Core internals`,
    );
  }
});

test("SLICE-4D recovery-event restore uses the atomic RESTORE_SELECTION transition, never the legacy setQueue command", () => {
  const bridge = read("src/components/system/AudioPhase10Bridge.js");
  assert.doesNotMatch(bridge, /dispatchPlaybackCommand\(\s*["']setQueue["']/, "recovery restore must not use the legacy setQueue command");
  assert.match(bridge, /proposeContinuitySelectionRestore\(/);
  assert.match(bridge, /beginContinuitySelectionRestore\(/);
  // The deferred seek path (waits for the engine to stabilize, up to 5s)
  // must re-validate before every seek call, not just seek(targetTime)
  // unconditionally — closes the stale-deferred-seek gap found during audit.
  assert.doesNotMatch(bridge, /\bseek\(targetTime\)/, "deferred seek must re-validate via attemptSeek, not seek(targetTime) directly");
  assert.match(bridge, /validateContinuityPositionRestore\(/);
});

test("SLICE-4D page-load session restore is captured before its async fetch and routed through Continuity", () => {
  const effects = read("src/lib/playback/usePlaybackEffects.js");
  assert.match(effects, /beginContinuitySelectionRestore\(\s*\{\s*source:\s*["']session-restore["']\s*\}\s*\)/);
  assert.match(effects, /proposeContinuitySelectionRestore\(/);
  assert.match(effects, /validateContinuityCandidate\(/);
  assert.doesNotMatch(
    effects,
    /(?:@\/lib\/playback-core|\.\.\/playback-core|from\s+["'][^"']*playback-core)/,
    "usePlaybackEffects.js must not import Playback Core internals",
  );
});

test("SLICE-4D restore never grants protected playback; entitlement is always re-checked downstream", () => {
  // Selection is a pure sequencing domain — it has no isPlaying/playing field
  // at all, so restoring Selection (via Continuity) can never by itself start
  // audio for a track the user isn't entitled to. Playback only ever starts
  // through the Transport domain / legacy play path, both independent of and
  // downstream from any restore proposal.
  const selectionAuthority = read("src/lib/playback-core/selection/SelectionAuthority.js");
  assert.doesNotMatch(selectionAuthority, /isPlaying/);

  // The one legacy entry point a Continuity-driven restore actually calls
  // post-restore (resumePlaybackTransport) must keep re-checking entitlement
  // before it resolves a real stream, and must never itself flip isPlaying
  // to true — actually starting audio remains a separate, later, user- or
  // stream-driven action that goes through its own entitlement-gated path.
  // (Other functions in this same file, like recoverAudioHard, legitimately
  // set isPlaying:true after confirmed audibility — this assertion is scoped
  // to resumePlaybackTransport's own body only, not the whole file.)
  const recovery = read("src/lib/playback/PlaybackRecoveryCommands.js");
  const fnStart = recovery.indexOf("self.resumePlaybackTransport = async function resumePlaybackTransport");
  assert.ok(fnStart >= 0, "resumePlaybackTransport must exist");
  const fnEnd = recovery.indexOf("\r\n}", fnStart);
  const fnBody = recovery.slice(fnStart, fnEnd >= 0 ? fnEnd : undefined);
  assert.match(fnBody, /isEntitledFullPlaybackTrack\(track\)/);
  assert.match(fnBody, /isPlaying:\s*false/);
  assert.doesNotMatch(fnBody, /isPlaying:\s*true/);
});

test("SLICE-2 timeline keeps the physical clock and throttles only presentation commits", () => {
  const helper = read("src/lib/playback/PlaybackHelperService.js");
  const handlers = read("src/lib/playback/PlaybackEventHandlers.js");
  const authority = read("src/lib/playback-core/transport/TransportAuthority.js");
  assert.match(helper, /const t = audio\.currentTime \|\| 0/);
  assert.match(handlers, /position:\s*audio\.currentTime \|\| 0/);
  assert.match(authority, /PRESENTATION_TIMELINE_INTERVAL_MS = 250/);
  assert.doesNotMatch(authority, /position\s*\+=|setInterval\([^)]*position/);
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

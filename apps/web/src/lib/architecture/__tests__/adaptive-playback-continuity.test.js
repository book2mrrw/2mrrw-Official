import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("a circuit-breaker reset aborts the abandoned command's stream fetch, not just its queue slot", () => {
  // Regression for: when the watchdog trips the breaker on a command timeout,
  // the finally block already clears activeCommandRef once that command's own
  // promise settles — but nothing cancelled its still-running network fetch
  // unless the *next* dispatched command happened to be a navigation-type
  // command. A same-type or unrelated next command left the old fetch free to
  // resolve late and mutate shared refs after a newer command had taken over.
  const dispatcher = read("src/lib/playback/command-dispatcher.js");
  const breakerBlockAt = dispatcher.indexOf("if (queueCircuitOpenRef.current) {");
  const queueResetAt = dispatcher.indexOf("commandQueueRef.current = Promise.resolve();", breakerBlockAt);
  const abortAt = dispatcher.indexOf("activeStreamAbortRef.current?.abort();", breakerBlockAt);
  assert.ok(
    breakerBlockAt > -1 && queueResetAt > breakerBlockAt && abortAt > queueResetAt,
    "the breaker-reset block must unconditionally abort the abandoned stream fetch"
  );
});

test("a lapsed entitlement downgrades an in-progress stream instead of playing it out in full", () => {
  // Regression for: Effect 5 (entitlement sync) handled upgrades (preview ->
  // full stream) but had no symmetric branch for a downgrade (subscription
  // lapses, admin revokes, chargeback) — a queued track kept its full-stream
  // URL forever, and the currently-playing track played to its natural end
  // with no enforcement at all. Fix reuses the existing, already-proven
  // PREVIEW_HARD_CAP_SEC fade/pause in PlaybackEventHandlers.onTime — it
  // reads currentTrack.metadata.access.previewOnly live on every tick, so
  // patching that flag is enough; no new pause/fade logic was written.
  const effects = read("src/lib/playback/usePlaybackEffects.js");
  assert.match(effects, /const justLostStream = prev\?\.canStream && !fresh\.canStream;/);
  const perTrackAt = effects.indexOf("const justLostStream");
  const freshSrcAt = effects.indexOf("justLostStream", perTrackAt + 1);
  assert.ok(freshSrcAt > perTrackAt, "the resolved freshSrc must actually branch on justLostStream");
  assert.match(effects, /wasStreamable && updatedCurrent\?\.metadata\?\.access\?\.previewOnly/);
  const handlers = read("src/lib/playback/PlaybackEventHandlers.js");
  assert.match(handlers, /const track = stateRef\.current\.currentTrack;/);
  assert.match(handlers, /previewOnly && audio\.currentTime >= PREVIEW_HARD_CAP_SEC/);
});

test("session restore never clobbers audio that's already playing, from either the local or server branch", () => {
  // Regression for: a guest plays a preview track, then logs in. Session
  // Restore (Effect 3) fires for the first time with a real user.id. Its
  // server-fetch branch already refused to overwrite active playback
  // (hasStarted || isPlaying), but the local-session branch had no such
  // guard — it would silently swap the UI to the logged-in user's old saved
  // queue while the <audio> element kept playing the guest's track underneath,
  // untouched. Both branches must carry the identical guard.
  const effects = read("src/lib/playback/usePlaybackEffects.js");
  const restoreStart = effects.indexOf("Effect 3: Session Restore");
  const localBranchAt = effects.indexOf("if (local?.queue?.length) {", restoreStart);
  const localGuardAt = effects.indexOf(
    "if (stateRef.current.hasStarted || stateRef.current.isPlaying) return;",
    localBranchAt
  );
  const localApplyAt = effects.indexOf("applySession(local);", localBranchAt);
  assert.ok(
    localBranchAt > -1 && localGuardAt > localBranchAt && localApplyAt > localGuardAt,
    "the local-session branch must check hasStarted/isPlaying before applySession(local)"
  );
  const serverGuardAt = effects.indexOf(
    "if (stateRef.current.hasStarted || stateRef.current.isPlaying) return;",
    localApplyAt
  );
  assert.ok(serverGuardAt > localApplyAt, "the server-fetch branch's own guard must still be present");
});

test("an MFA misconfiguration lockout actually reaches Sentry, not just console logs", () => {
  // Regression for: emitServerEvent only calls Sentry.captureException when a
  // 4th `error` argument is passed, even at "error" severity — denyAdminAuthority
  // never passed one, so a misconfigured HUMAN_ADMIN_MFA_REQUIRED (which locks
  // out every admin platform-wide) would only ever produce a console.error line
  // in Vercel's logs once Sentry is configured, not an alert anyone would see.
  const guard = read("src/lib/auth/admin-api-guard.js");
  assert.match(guard, /diagnostic\.code === "ADMIN_AUTH_MFA_CONFIGURATION_ERROR"\s*\n\s*\? new Error/);
  assert.match(guard, /emitServerEvent\(diagnostic\.level, "admin_authority_denied", eventData, captureError\)/);
});

test("preview modal bottom sheets respect safe-area insets on every edge", () => {
  // Regression for: 7 bottom sheets used hardcoded 28-32px bottom padding
  // (coincidentally close to an iPhone portrait home-indicator inset) and no
  // left/right inset at all — on a rotated notched phone, where the safe area
  // shifts to the side edges, content could sit under the curved corner.
  const modal = read("src/components/preview/ImmersivePreviewModal.js");
  const bsheetOpens = modal.match(/<div className="bsheet" style=\{\{[^}]*\}\}>/g) || [];
  assert.ok(bsheetOpens.length >= 6, "expected at least 6 bottom sheets in this file");
  for (const tag of bsheetOpens) {
    assert.match(tag, /env\(safe-area-inset-bottom\)/, `${tag} missing bottom inset`);
    assert.match(tag, /env\(safe-area-inset-left\)/, `${tag} missing left inset`);
    assert.match(tag, /env\(safe-area-inset-right\)/, `${tag} missing right inset`);
  }
});

test("collector-card serial activation is rate-limited per IP as well as per user", () => {
  // Regression for: activateCollectorCardBySerial only checks a printed,
  // short, sequential serial + a free-text name — no proof of possession.
  // The per-user rate limit alone doesn't stop enumeration spread across many
  // accounts from the same origin. This doesn't fully close the gap (that
  // needs a second physical secret on the card itself, which already-printed
  // cards don't have), but it raises the cost from trivial automation to
  // meaningfully harder, without touching the physical cards.
  const route = read("src/app/api/collector-card/activate/route.js");
  assert.match(route, /routeKey: "collector-card-activate"/);
  assert.match(route, /routeKey: "collector-card-activate-ip"/);
  const userLimitAt = route.indexOf('routeKey: "collector-card-activate"');
  const ipLimitAt = route.indexOf('routeKey: "collector-card-activate-ip"');
  const activateCallAt = route.indexOf("activateCollectorCardBySerial({");
  assert.ok(userLimitAt > -1 && ipLimitAt > userLimitAt && activateCallAt > ipLimitAt,
    "both rate limits must be checked before the activation attempt itself");
});

test("a refund revokes access synchronously instead of waiting on the webhook alone", () => {
  // Regression for: POST /api/refund only flipped purchases.status; the actual
  // library/entitlement revocation happened exclusively in the charge.refunded
  // webhook handler. A delayed or missed webhook meant a refunded customer
  // kept full access with no reconciliation path. Fix: export the webhook's
  // already-idempotent revocation function and call it synchronously here too.
  const refundRoute = read("src/app/api/refund/route.js");
  const webhookLib = read("src/lib/commerce/handle-stripe-webhook.js");
  assert.match(webhookLib, /export async function revokePurchaseByPaymentIntent/);
  assert.match(refundRoute, /import \{ revokePurchaseByPaymentIntent \} from "@\/lib\/commerce\/handle-stripe-webhook"/);
  const refundedAt = refundRoute.indexOf('status: "refunded"');
  const revokeCallAt = refundRoute.indexOf("revokePurchaseByPaymentIntent(purchase.stripe_payment_intent_id)");
  assert.ok(refundedAt > -1 && revokeCallAt > refundedAt,
    "revocation must run after the purchase is marked refunded, not before or never");
});

test("admin pages resolve their admin gate server-side, not by reading the session cookie in JS", () => {
  // Regression for: 8 admin pages each spun up their own throwaway browser
  // Supabase client and called auth.getSession() to decide isAdmin — a
  // pattern that only works when the real session cookie is JS-readable.
  // They now share one hook (useAdminGate) backed by /api/auth/mfa-session,
  // which resolves admin status server-side regardless of cookie flags.
  const hook = read("src/hooks/useAdminGate.js");
  assert.match(hook, /\/api\/auth\/mfa-session/);
  const pages = [
    "src/app/admin/page.js",
    "src/app/admin/releases/page.js",
    "src/app/admin/visual-layer/page.js",
    "src/app/admin/gifts/page.js",
    "src/app/admin/shows/page.js",
    "src/app/admin/upload/page.js",
    "src/app/admin/analytics/page.js",
    "src/app/admin/media/page.js",
  ];
  for (const page of pages) {
    const source = read(page);
    assert.match(source, /import \{ useAdminGate \} from "@\/hooks\/useAdminGate"/, `${page} must use the shared admin gate`);
    assert.doesNotMatch(source, /\.auth\.getSession\(\)/, `${page} must not read the session client-side anymore`);
  }
});

test("MyMusicTab can never again silently default to desktop density on touch devices", () => {
  // Regression for: MusicTabCatalogPanels never passed isMobile, so every
  // isMobile-ternary in MyMusicTab resolved to its desktop branch on every
  // phone and foldable, clipping owned content behind the fixed bottom nav.
  // The fix makes the component derive a correct default itself instead of
  // trusting a caller to remember the prop, using the same (hover:hover) and
  // (pointer:fine) signal the storefront CSS already gates desktop chrome on.
  const tab = read("src/components/music/MyMusicTab.js");
  const hook = read("src/hooks/usePointerCapability.js");
  assert.match(hook, /hover: hover\) and \(pointer: fine\)/);
  assert.match(hook, /useSyncExternalStore/);
  assert.match(tab, /import \{ usePointerCapability \} from "@\/hooks\/usePointerCapability"/);
  assert.match(tab, /isMobile:\s*isMobileProp/);
  assert.match(tab, /const isMobile = isMobileProp \?\? !hasFinePointer;/);
});

test("responsive geometry never selects a different storefront React tree", () => {
  const home = read("src/app/HomeClient.js");
  const storefront = read("src/components/home/HomeStorefront.js");
  const carousel = read("src/components/home/CarouselUI.js");
  const countdown = read("src/components/home/LiveCountdownDisplays.js");

  assert.match(home, /className="storefront-adaptive-shell"/);
  assert.match(home, /className="storefront-primary-rail"/);
  assert.match(home, /className="storefront-main-column"/);
  assert.match(home, /className="storefront-cart-rail"/);
  assert.match(home, /className="storefront-mobile-ui"/);
  assert.doesNotMatch(home, /setIsMobile|useState\([^)]*(?:innerWidth|matchMedia)/);
  assert.doesNotMatch(home, /addEventListener\(["']resize["'][\s\S]{0,300}set[A-Z]/);
  for (const source of [storefront, carousel, countdown]) {
    assert.doesNotMatch(source, /\bisMobile\b/);
  }
});

test("capacity ranges are CSS-only and preserve compact, expanded, and large shells", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /@container catalog-grid \(max-width: 560px\)/);
  assert.match(css, /@container storefront-main \(min-width: 600px\)/);
  assert.match(css, /@media \(min-width: 840px\)[\s\S]*grid-template-columns: clamp\(196px, 19vw, 220px\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 1180px\)[\s\S]*grid-template-columns: 220px minmax\(0, 1fr\) clamp\(220px, 20vw, 248px\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test("desktop-only chrome (nav rail, cart rail) requires a fine pointer, not just raw width", () => {
  // A foldable phone unfolded to a wide viewport is still a touch-only device.
  // Raw min-width alone must never be sufficient to switch on nav-rail/cart-rail
  // desktop chrome — it must also require (hover: hover) and (pointer: fine),
  // which real desktop/mouse sessions have and touch-only large viewports do not.
  const css = read("src/app/globals.css");
  assert.match(
    css,
    /@media \(min-width: 840px\) and \(hover: hover\) and \(pointer: fine\)/,
    "nav rail must stay gated behind a fine pointer, not width alone"
  );
  assert.match(
    css,
    /@media \(min-width: 1180px\) and \(hover: hover\) and \(pointer: fine\)/,
    "cart rail must stay gated behind a fine pointer, not width alone"
  );
});

test("playback authority and release modal remain rooted above adaptive content", () => {
  const layout = read("src/app/layout.js");
  const audioProviderStart = layout.indexOf("<AudioProvider>");
  const children = layout.indexOf("{children}", audioProviderStart);
  const player = layout.indexOf("<GlobalAudioPlayerBar />", children);
  const modal = layout.indexOf("<PlayerReleaseModalHost />", children);

  assert.ok(audioProviderStart > -1 && children > audioProviderStart);
  assert.ok(player > children && modal > children);
  assert.equal((layout.match(/<AudioProvider>/g) || []).length, 1);
  assert.equal((layout.match(/<GlobalAudioPlayerBar \/>/g) || []).length, 1);
});

test("adaptive player chrome mutates only CSS inset during geometry changes", () => {
  const player = read("src/components/audio/GlobalAudioPlayerBar.js");
  assert.match(player, /ResizeObserver/);
  assert.match(player, /--player-bar-inset/);
  assert.doesNotMatch(player, /ResizeObserver[\s\S]{0,600}(?:setCurrentTrack|playQueue|dispatchPlaybackCommand|\.load\(\))/);
});

test("core playback lib has no resize/orientation/posture listener wired to any playback entrypoint", () => {
  // Rotation/fold is a geometry event, not a playback event. None of the files that
  // actually own stream/entitlement resolution or the <audio> element lifecycle may
  // listen for resize/orientation/posture at all — that keeps the audio domain
  // provably independent of the presentation domain, regardless of what the CSS
  // layout is doing.
  const files = [
    "src/context/AudioContext.js",
    "src/lib/playback/audio-engine-runtime.js",
    "src/lib/playback/command-dispatcher.js",
    "src/lib/playback/PlaybackStreamCommands.js",
    "src/lib/playback/PlaybackEventHandlers.js",
    "src/lib/playback/usePlaybackEffects.js",
  ];
  const forbidden = /addEventListener\(\s*["'](resize|orientationchange)["']|screen\.orientation|visualViewport|viewport-segment/;
  for (const file of files) {
    assert.doesNotMatch(read(file), forbidden, `${file} must not observe geometry/posture`);
  }
});

test("playback mode subscriptions are isolated to the Flow State panel", () => {
  const bridge = read("src/components/storefront/HomeStorefrontFlowMode.js");
  const storefront = read("src/components/home/HomeStorefront.js");
  assert.doesNotMatch(bridge, /usePlaybackChromeLayout/);
  assert.match(storefront, /const HomeFlowStateIsland = memo/);
  assert.match(storefront, /HomeFlowStateIsland[\s\S]*usePlaybackChromeLayout/);
});

test("Media Session publishes static artwork and guards revision races", () => {
  const artwork = read("src/lib/media-session-artwork.js");
  const helpers = read("src/lib/playback/PlaybackHelperService.js");

  assert.doesNotMatch(helpers, /type:\s*["']video\/mp4["']/);
  assert.doesNotMatch(artwork, /sizes:\s*["'](?:96|128|256|512|1024)x/);
  assert.match(artwork, /mediaSessionTrackIdentity/);
  assert.match(helpers, /_mediaSessionUpdateEpoch/);
  assert.match(helpers, /updateEpoch !== self\._mediaSessionUpdateEpoch/);
  assert.match(helpers, /Number\.isFinite\(playbackRate\)/);
});

test("replace-master keeps public pointers stable until the upload is verified", () => {
  // The pointer must never move on unverified bytes. Originally this was
  // enforced across two requests (stage inserts an immutable revision row;
  // a later worker verifies and promotes it via promote_audio_master_revision).
  // That table was never deployed to production, so no replacement ever took
  // effect (see the "replace-master commits by copying to the canonical key"
  // test in admin-upload-hardening.test.js). The same never-flip-on-unverified-
  // bytes guarantee now holds within one synchronous commit request instead:
  // getR2ObjectMetadata() verifies byte length + content type BEFORE copyR2Object
  // moves the file to its canonical key, which happens BEFORE the pointer column
  // is updated. The legacy migration's RPC previously enforced the same
  // ordering across the async path — it's kept in migration history (never
  // applied to production) but the worker's own references to it are gone
  // (see the next test); that branch could never run again, so leaving it in
  // place was a landmine, not a harmless historical artifact.
  const migration = read("supabase/migrations/20260901000000_audio_master_revision_authority.sql");
  const stage = read("src/app/api/admin/releases/[id]/replace-master/stage/route.js");
  const commit = read("src/app/api/admin/releases/[id]/replace-master/route.js");
  const authority = read("src/lib/media/master-revision-authority.js");

  assert.match(stage, /buildMasterRevisionKeys/);
  assert.match(authority, /revisions\/\$\{revisionId\}/);
  const verifyAt = commit.indexOf("getR2ObjectMetadata");
  const copyAt = commit.indexOf("copyR2Object(key, destKey)");
  const pointerAt = commit.search(/\.from\(\s*["']tracks["']\s*\)\s*\n\s*\.update\(\{\s*audio_r2_key/);
  assert.ok(verifyAt > -1 && copyAt > verifyAt && pointerAt > copyAt,
    "verification must precede the R2 copy, which must precede the pointer update");
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.promote_audio_master_revision/);
  assert.match(migration, /previous_master_key/);
  assert.match(migration, /retire_after/);
  assert.match(migration, /public storefront projection changed while replacement was processing/);
});

test("the HLS worker no longer carries dead references to the never-deployed master-revision schema", () => {
  // Regression for: markJobFailed selected hls_transcode_jobs.master_revision_id
  // — a column that only exists in the never-applied migration — meaning every
  // failed transcode job of ANY kind (not just master-audio replacements) could
  // hit a "column does not exist" error in production. markJobComplete had the
  // same landmine via a conditional promote_audio_master_revision RPC call.
  // Since the rewritten replace-master flow never sets master_revision_id on a
  // job again, these branches were pure dead weight — removed entirely rather
  // than left as a trap for if that field is ever reintroduced.
  const worker = read("workers/hls-transcoder/src/db.js");
  assert.doesNotMatch(worker, /master_revision_id|audio_master_revisions|promote_audio_master_revision/);
});

test("promoting a replaced master audio clears the durable playback-key cache atomically", () => {
  // Regression for: replacing a track's master audio in Manage Releases silently
  // didn't change what played. promote_audio_master_revision() correctly flips
  // tracks/catalog_tracks/products pointers, but resolvePlaybackKeyUncached()
  // checks playback_key_resolution_cache FIRST and that table has no TTL — so it
  // must be cleared in the SAME transaction as the pointer flip, not left to a
  // best-effort HTTP webhook from the external transcoder worker that can be
  // unconfigured (missing APP_URL/HLS_WORKER_API_TOKEN) or silently fail.
  const migration = read(
    "supabase/migrations/20260902000000_promote_audio_master_revision_clears_playback_cache.sql"
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.promote_audio_master_revision/);
  assert.match(
    migration,
    /DELETE FROM public\.playback_key_resolution_cache[\s\S]{0,300}v_revision\.release_slug/,
    "the cache clear must run inside promote_audio_master_revision itself, not only in the worker's webhook"
  );
});

test("Current Release edits retain the known-good editor route and refresh the mounted catalog in place", () => {
  const route = read("src/app/api/admin/releases/[id]/route.js");
  const catalogSurface = read("src/components/storefront/catalog-surface-context.js");

  assert.doesNotMatch(route, /rpc\("commit_current_release_edit"/);
  assert.match(route, /const finalStatus = lifecycleUpdates\.status \|\| release\.status/);
  assert.match(catalogSurface, /applyCatalogSnapshot|replaceCatalogSnapshot|catalogMutationRevision/);
  assert.doesNotMatch(catalogSurface, /router\.refresh\(/);
});

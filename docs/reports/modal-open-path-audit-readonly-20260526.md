# Modal open-path audit (read-only, 2026-05-26)

Source: agent transcript `f3ff5935-e93e-47e0-a4ff-3e1b7f573abe` (parent `22ed5f23-e4b1-454c-aaaa-196208826de1`).

---

Findings from a read-only audit:

- `openSingleModal` exists in `/Users/recharge/artist-platform/src/app/page.js`.
- It closes the feature modal if open, sets selected single, opens preview modal, clears selected release detail, conditionally defers playback while auth is loading, otherwise plays track and fetches release detail.
- `src/app/page.js` imports and renders `ImmersivePreviewModal` (no `SingleModal` usage in JSX there).
- In `/Users/recharge/artist-platform/src/components/preview/ImmersivePreviewModal.js`, the bottom export is `export default function ImmersivePreviewModal(...)`, not `export default ImmersivePreviewModal` and not `SingleModal`.
- In `/Users/recharge/artist-platform/src/components/music/ReleaseCardPlayButton.js`, there is no explicit “cover tap handler”; the interactive handler in this file is `handlePlay`, wired to the button `onClick`.

### 1) `openSingleModal` in `src/app/page.js`

Path: `/Users/recharge/artist-platform/src/app/page.js`

```1090:1115:/Users/recharge/artist-platform/src/app/page.js
const openSingleModal = useCallback((single) => {
  if (featureModalOpen) {
    setFeatureModalOpen(false);
    setFeatureModalItem(null);
    setFeatureReleaseDetail(null);
    featureModalPlaySlugRef.current = null;
  }
  setSelectedSingle(single);
  setPreviewModalOpen(true);
  setSelectedReleaseDetail(null);
  if (!single?.slug) return;
  const playbackTrack = toPlaybackTrack(
    single,
    { ...accountState, userId: currentUser?.id },
    "preview_modal"
  );
  if (authLoading) {
    modalPlaySlugRef.current = single.slug;
    return;
  }
  modalPlaySlugRef.current = null;
  if (playbackTrack?.src) void playTrack(playbackTrack);
  void getControlSystemReleaseDetail({ slug: single.slug, fallbackRelease: single }).then((detail) => {
    if (detail) setSelectedReleaseDetail(detail);
  });
}, [nowPlaying, featureModalOpen, accountState, authLoading, currentUser?.id, playTrack]);
```

It references neither old component names nor `SingleModal` directly; this function operates state/playback only.

---

### 2) Bottom export in `ImmersivePreviewModal.js`

Path: `/Users/recharge/artist-platform/src/components/preview/ImmersivePreviewModal.js`

```837:842:/Users/recharge/artist-platform/src/components/preview/ImmersivePreviewModal.js
export default function ImmersivePreviewModal({ track, onClose }) {
  if (!track) return null;
  const canStream = Boolean(track?.metadata?.access?.canStream);
  const access = canStream ? "full" : "preview";
  return <SingleModal track={track} access={access} onClose={onClose} />;
}
```

Export is **`export default function ImmersivePreviewModal`**.

---

### 3) Modal render JSX in `src/app/page.js`

Path: `/Users/recharge/artist-platform/src/app/page.js`

```1540:1573:/Users/recharge/artist-platform/src/app/page.js
<AnimatePresence>
  {previewModalOpen && selectedSingle && (
    <ImmersivePreviewModal
      key="immersive-preview-modal"
      single={selectedSingle}
      releaseDetail={selectedReleaseDetail}
      isMobile={isMobile}
      trackAccess={selectedSingleAccess}
      userId={currentUser?.id}
      isAdmin={isAdmin}
      onGift={handlePreviewGift}
      onLibraryChange={handlePreviewLibraryChange}
      onClose={closeSingleModal}
      onAddToCart={addToCart}
      onAddVinyl={addVinylToCart}
    />
  )}
  {featureModalOpen && featureModalItem && (
    <ImmersivePreviewModal
      key="immersive-feature-modal"
      single={featureModalItem}
      releaseDetail={featureReleaseDetail}
      isMobile={isMobile}
      trackAccess={featureModalAccess}
      userId={currentUser?.id}
      isAdmin={isAdmin}
      onGift={handleFeaturePreviewGift}
      onLibraryChange={handlePreviewLibraryChange}
      onClose={closeFeatureModal}
      onAddToCart={addToCart}
      onAddVinyl={addVinylToCart}
    />
  )}
</AnimatePresence>
```

Yes, it **is rendered** (twice). No `SingleModal` usage in this JSX block.

Also relevant open trigger in same file:

```1880:1883:/Users/recharge/artist-platform/src/app/page.js
<div
  key={single.slug}
  data-single-card
  onClick={() => openSingleModal(singleUi)}
```

---

### 4) Cover tap handler in `ReleaseCardPlayButton.js`

Path: `/Users/recharge/artist-platform/src/components/music/ReleaseCardPlayButton.js`

No dedicated “cover tap” handler is defined in this file. The tap/click handler present is `handlePlay`, and it is called from button `onClick`.

```37:77:/Users/recharge/artist-platform/src/components/music/ReleaseCardPlayButton.js
const handlePlay = useCallback(
  (e) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTapRef.current < 300) return;
    lastTapRef.current = now;
    if (onPlayClick) {
      onPlayClick(e, item);
      return;
    }
    const track = toPlaybackTrack(item, { ...accountState, userId }, source);
    if (!track.src) return;
    const sameTrack =
      hasStarted &&
      (currentTrack?.slug === track.slug || currentTrack?.id === track.id);
    if (sameTrack) {
      void toggle();
      return;
    }
    if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
    void playQueue([track], 0);
    if (track.metadata?.access?.canStream) {
      upgradeTimerRef.current = setTimeout(() => {
        void upgradeToFullStream();
      }, 2000);
    }
  },
  [
    accountState,
    currentTrack?.id,
    currentTrack?.slug,
    hasStarted,
    item,
    onPlayClick,
    playQueue,
    source,
    toggle,
    upgradeToFullStream,
    userId,
  ]
);
```

```91:95:/Users/recharge/artist-platform/src/components/music/ReleaseCardPlayButton.js
<button
  type="button"
  aria-label={playAriaLabel}
  onClick={handlePlay}
```

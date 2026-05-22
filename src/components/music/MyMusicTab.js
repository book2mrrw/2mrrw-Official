"use client";

import { memo, useCallback, useMemo } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { useMusicLibrary } from "@/hooks/useMusicLibrary";
import { membershipHasPremiumAccess } from "@/lib/commerce/entitlements";
import { resolveContentAccess, resolveTrackAccess } from "@/lib/music-access";
import { albumTracksForPlayback, toPlaybackTrack } from "@/lib/music-playback";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import PlaylistSection from "@/components/music/PlaylistSection";

function LibraryCarousel({ title, items, accountState, userId, onPlay, onOpen, onLibraryChange, isMobile }) {
  if (!items?.length) return null;
  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>{title}</div>
      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          paddingBottom: 8,
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {items.map((item) => {
          const access = resolveContentAccess(item, accountState);
          const locked = access.subscriptionLocked && !access.owned;
          return (
            <div
              key={item.slug}
              style={{
                flex: "0 0 auto",
                width: isMobile ? 148 : 168,
                scrollSnapAlign: "start",
                background: "#0a0a0a",
                border: "1px solid #1a1a1a",
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <div style={{ position: "relative" }}>
                {item.cover && (
                  <img src={item.cover} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block", opacity: locked ? 0.55 : 1 }} />
                )}
                <div style={{ position: "absolute", top: 8, left: 8 }}>
                  <MusicAccessBadge label={access.badge} compact />
                </div>
              </div>
              <div style={{ padding: "10px 12px 12px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, lineHeight: 1.3 }}>{item.title}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={!access.canStream || locked}
                    onClick={() => onPlay(item, access)}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      background: access.canStream && !locked ? "#00ffff" : "#222",
                      color: access.canStream && !locked ? "#000" : "#666",
                      border: "none",
                      borderRadius: 8,
                      cursor: access.canStream && !locked ? "pointer" : "not-allowed",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {locked ? "Locked" : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen?.(item)}
                    style={{ padding: "8px 10px", background: "#111", color: "#888", border: "1px solid #222", borderRadius: 8, cursor: "pointer", fontSize: 10 }}
                  >
                    Open
                  </button>
                  {userId && (
                    <MusicPlusButton
                      track={item}
                      userId={userId}
                      access={access}
                      isMobile={isMobile}
                      onLibraryChange={onLibraryChange}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MyMusicTab({
  singles = [],
  albums = [],
  isMobile,
  onSwitchTab,
  onGoToAccount,
  onDiscoverSingles,
  onDiscoverVault,
  onOpenSingle,
  onOpenAlbum,
}) {
  const goAccount = onGoToAccount || (() => onSwitchTab?.("account"));
  const goSingles = onDiscoverSingles || (() => onSwitchTab?.("singles"));
  const goVault = onDiscoverVault || (() => onSwitchTab?.("vault"));
  const {
    user,
    accountState,
    loading,
    ownedSingles,
    ownedAlbums,
    subscriptionItems,
    collectorItems,
    recentlyPlayed,
    lastPlayed,
    refresh,
  } = useMusicLibrary({ singles, albums });

  const { playTrack, playQueue, resume } = useAudioPlayer();
  const membershipActive = membershipHasPremiumAccess(accountState?.membership);
  const subscriptionLocked = Boolean(accountState?.membership && !membershipActive);

  const catalogTracks = useMemo(() => {
    const map = new Map();
    [...ownedSingles, ...singles].forEach((item) => {
      if (item?.slug) map.set(item.slug, { ...item, ...(singles.find((s) => s.slug === item.slug) || {}) });
    });
    return [...map.values()].filter((t) => t.preview || t.audio || t.src);
  }, [ownedSingles, singles]);

  const playItem = useCallback(
    (item, access, resumeAt = 0) => {
      if (!access?.canStream) return;
      const track = toPlaybackTrack(item, { ...accountState, userId: user?.id }, "my_music");
      void playTrack(track, { resumeAt });
    },
    [accountState, playTrack]
  );

  const playAlbum = useCallback(
    (album) => {
      const access = resolveTrackAccess(album, accountState);
      if (!access.canStream) return;
      const tracks = albumTracksForPlayback(album, { ...accountState, userId: user?.id }, "my_music_album");
      if (!tracks.length) {
        playItem(album, access);
        return;
      }
      void playQueue(tracks, 0);
    },
    [accountState, playItem, playQueue]
  );

  const playPlaylist = useCallback(
    (playlist) => {
      const tracks = (playlist.tracks || []).filter((t) => t.src || t.preview);
      if (!tracks.length) return;
      void playQueue(tracks, 0);
    },
    [playQueue]
  );

  const resumeLast = useCallback(() => {
    if (!lastPlayed) return;
    const catalog = singles.find((s) => s.slug === lastPlayed.slug) || lastPlayed;
    const access = resolveTrackAccess(catalog, accountState);
    playItem(catalog, access, lastPlayed.completed ? 0 : Number(lastPlayed.positionSeconds || 0));
    void resume();
  }, [accountState, lastPlayed, playItem, resume, singles]);

  if (!user) {
    return (
      <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, padding: "48px 32px", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Enter email + phone to access your library</div>
        <div style={{ fontSize: 13, color: "#555", marginBottom: 24, lineHeight: 1.6 }}>
          Stream your owned music, playlists, and continue listening — all in one place.
        </div>
        <button
          type="button"
          onClick={() => onSwitchTab?.("account")}
          style={{ padding: "12px 28px", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14 }}
        >
          Go to Account
        </button>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#555", fontSize: 13 }}>Loading your library…</div>;
  }

  const hasAnyContent =
    ownedSingles.length > 0 ||
    ownedAlbums.length > 0 ||
    subscriptionItems.length > 0 ||
    collectorItems.length > 0 ||
    recentlyPlayed.length > 0;

  return (
    <div style={{ paddingBottom: isMobile ? 100 : 40 }}>
      {lastPlayed && (
        <section
          style={{
            marginBottom: 28,
            padding: "18px 20px",
            borderRadius: 16,
            background: "linear-gradient(135deg, rgba(0,255,255,0.08), rgba(162,89,255,0.06))",
            border: "1px solid rgba(0,255,255,0.2)",
          }}
        >
          <div style={{ fontSize: 10, color: "#00ffff", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>Continue Listening</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {lastPlayed.cover && <img src={lastPlayed.cover} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{lastPlayed.title}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>Pick up where you left off</div>
            </div>
            <button type="button" onClick={resumeLast} style={{ padding: "10px 18px", background: "#00ffff", color: "#000", border: "none", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontSize: 12 }}>
              Resume
            </button>
          </div>
        </section>
      )}

      <PlaylistSection
        userId={user?.id}
        catalogTracks={catalogTracks}
        onPlayPlaylist={playPlaylist}
        subscriptionLocked={subscriptionLocked}
      />

      <LibraryCarousel
        title="Recently Played"
        items={recentlyPlayed}
        accountState={accountState}
        userId={user?.id}
        onPlay={playItem}
        onOpen={(item) => onOpenSingle?.(singles.find((s) => s.slug === item.slug) || item)}
        onLibraryChange={refresh}
        isMobile={isMobile}
      />

      <LibraryCarousel
        title="Owned Singles"
        items={ownedSingles.map((item) => ({ ...item, ...(singles.find((s) => s.slug === item.slug) || {}) }))}
        accountState={accountState}
        userId={user?.id}
        onPlay={playItem}
        onOpen={(item) => onOpenSingle?.(singles.find((s) => s.slug === item.slug) || item)}
        onLibraryChange={refresh}
        isMobile={isMobile}
      />

      <section style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>Owned Albums</div>
        {ownedAlbums.length === 0 ? (
          <div style={{ fontSize: 13, color: "#555" }}>No owned albums yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ownedAlbums.map((album) => {
              const merged = { ...album, ...(albums.find((a) => a.slug === album.slug) || {}) };
              const access = resolveContentAccess(merged, accountState);
              return (
                <div key={album.slug} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 14, flexWrap: "wrap" }}>
                  {merged.cover && <img src={merged.cover} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover" }} />}
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{merged.title || album.title}</div>
                    <MusicAccessBadge label={access.badge} compact />
                  </div>
                  <button type="button" disabled={!access.canStream} onClick={() => playAlbum(merged)} style={{ padding: "8px 16px", background: access.canStream ? "#00ffff" : "#222", color: access.canStream ? "#000" : "#666", border: "none", borderRadius: 8, cursor: access.canStream ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 800 }}>
                    Play Album
                  </button>
                  <button type="button" onClick={() => onOpenAlbum?.(merged)} style={{ padding: "8px 14px", background: "transparent", color: "#888", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
                    Tracklist
                  </button>
                  {user?.id && (
                    <MusicPlusButton track={merged} userId={user.id} access={access} isMobile={isMobile} deepLinkType="album" onLibraryChange={refresh} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {subscriptionItems.length > 0 && (
        <LibraryCarousel
          title="Subscription Library"
          items={subscriptionItems.map((item) => ({ ...item, ...(singles.find((s) => s.slug === item.slug) || albums.find((a) => a.slug === item.slug) || {}) }))}
          accountState={accountState}
          userId={user?.id}
          onPlay={playItem}
          onLibraryChange={refresh}
          isMobile={isMobile}
        />
      )}

      {collectorItems.length > 0 && (
        <LibraryCarousel
          title="Collector Unlocks"
          items={collectorItems.map((item) => ({ ...item, ...(singles.find((s) => s.slug === item.slug) || {}) }))}
          accountState={accountState}
          userId={user?.id}
          onPlay={playItem}
          onLibraryChange={refresh}
          isMobile={isMobile}
        />
      )}

      {!hasAnyContent && (
        <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, padding: "40px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Your library is empty</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 20 }}>Purchase singles or albums to start streaming here.</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={goSingles} style={{ padding: "10px 22px", background: "#111", color: "#00ffff", border: "1px solid #00ffff44", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              Discover Singles
            </button>
            <button type="button" onClick={goVault} style={{ padding: "10px 22px", background: "#111", color: "#a259ff", border: "1px solid #a259ff44", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              Vault Drops
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={() => refresh()} style={{ marginTop: 8, background: "none", border: "none", color: "#444", fontSize: 11, cursor: "pointer", letterSpacing: 1 }}>
        Refresh library
      </button>
    </div>
  );
}

export default memo(MyMusicTab);

"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { useMusicLibrary } from "@/hooks/useMusicLibrary";
import { membershipHasPremiumAccess } from "@/lib/commerce/entitlements";
import { resolveContentAccess, resolveTrackAccess } from "@/lib/music-access";
import { albumTracksForPlayback, toPlaybackTrack } from "@/lib/music-playback";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import PlaylistSection from "@/components/music/PlaylistSection";
import CoverArt from "@/components/ui/CoverArt";
import GiftIcon from "@/components/gifts/GiftIcon";
import GiftsSentSection from "@/components/gifts/GiftsSentSection";
import { useListeningHistory } from "@/hooks/useListeningHistory";

const SORT_STORAGE_KEY = "mymusic_sort_pref";

const SORT_OPTIONS = [
  { id: "recent", label: "Recently Added" },
  { id: "az", label: "A-Z" },
  { id: "za", label: "Z-A" },
];

function readSortPref() {
  if (typeof window === "undefined") return "recent";
  try {
    const v = localStorage.getItem(SORT_STORAGE_KEY);
    return SORT_OPTIONS.some((o) => o.id === v) ? v : "recent";
  } catch {
    return "recent";
  }
}

function sortOwnedSingles(items, sortId) {
  const list = [...items];
  if (sortId === "az") {
    return list.sort((a, b) => String(a.title || a.slug).localeCompare(String(b.title || b.slug)));
  }
  if (sortId === "za") {
    return list.sort((a, b) => String(b.title || b.slug).localeCompare(String(a.title || a.slug)));
  }
  return list.sort((a, b) => {
    const ta = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
    const tb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
    return tb - ta;
  });
}

function CollectionRailPlaceholder({ label }) {
  return (
    <div
      style={{
        padding: "18px 16px",
        borderRadius: 14,
        border: "1px dashed #222",
        background: "rgba(255,255,255,0.015)",
        color: "#555",
        fontSize: 12,
        letterSpacing: 0.3,
        marginBottom: 28,
      }}
    >
      {label}
    </div>
  );
}

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
                {item.cover ? (
                  <CoverArt
                    src={item.cover}
                    type={item.coverArtType}
                    alt=""
                    width="100%"
                    style={{
                      aspectRatio: "1",
                      display: "block",
                      opacity: locked ? 0.55 : 1,
                    }}
                  />
                ) : null}
                <div style={{ position: "absolute", top: 8, left: 8 }}>
                  <MusicAccessBadge label={access.badge} compact />
                </div>
              </div>
              <div style={{ padding: "10px 12px 12px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: item.gifted || item.source === "gift" ? 4 : 8, lineHeight: 1.3 }}>{item.title}</div>
                {item.gifted || item.source === "gift" ? (
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    marginBottom: 8,
                    padding: "3px 8px",
                    background: "linear-gradient(135deg,rgba(162,89,255,0.15),rgba(0,191,255,0.08))",
                    border: "1px solid rgba(162,89,255,0.3)",
                    borderRadius: 20,
                    animation: "giftBadgePulse 3s ease-in-out infinite",
                  }}>
                    <GiftIcon
                      size={12}
                      style={{
                        animation: "giftIconSpin 4s ease-in-out infinite",
                      }}
                    />
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#a259ff",
                      letterSpacing: 1,
                      textTransform: "uppercase",
                    }}>
                      Gift from 2MRRW
                    </span>
                  </div>
                ) : null}
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
                      showOfflineDownload={false}
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

function RecentlyAddedRow({ items, onPlay, accountState }) {
  if (!items?.length) return null;
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>
        Recently Added
      </div>
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
          return (
            <button
              key={item.slug}
              type="button"
              onClick={() => onPlay(item)}
              style={{
                flex: "0 0 auto",
                width: 130,
                scrollSnapAlign: "start",
                background: "#0a0a0a",
                border: "1px solid #1a1a1a",
                borderRadius: 12,
                padding: 0,
                overflow: "hidden",
                cursor: "pointer",
                textAlign: "left",
                color: "inherit",
              }}
            >
              <div style={{ position: "relative" }}>
                {item.cover ? (
                  <CoverArt
                    src={item.cover}
                    type={item.coverArtType}
                    alt=""
                    width={130}
                    height={130}
                  />
                ) : (
                  <div
                    style={{
                      width: 130,
                      height: 130,
                      background: "linear-gradient(135deg, rgba(0,255,255,0.12), rgba(162,89,255,0.12))",
                      borderBottom: "1px solid #222",
                    }}
                  />
                )}
                <div style={{ position: "absolute", top: 8, left: 8 }}>
                  <MusicAccessBadge label={access.badge} compact />
                </div>
              </div>
              <div
                style={{
                  padding: "8px 10px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.title}
              </div>
            </button>
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
  isAdmin = false,
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
    library,
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

  const {
    continueListening,
    recentlyPlayedRail,
    recentlyAddedRail,
  } = useListeningHistory({ accountState, singles, albums });

  const activeContinue = continueListening || lastPlayed;
  const activeRecentlyPlayed = recentlyPlayedRail.length ? recentlyPlayedRail : recentlyPlayed;

  const { playTrack, playQueue, resume, setShuffle } = useAudioPlayer();
  const membershipActive = membershipHasPremiumAccess(accountState?.membership);
  const subscriptionLocked = Boolean(accountState?.membership && !membershipActive);
  const [sortPref, setSortPref] = useState("recent");
  const [sortSheetOpen, setSortSheetOpen] = useState(false);

  useEffect(() => {
    setSortPref(readSortPref());
  }, []);

  useEffect(() => {
    if (user && !loading) {
      void refresh();
    }
  }, [user, loading, refresh]);

  const setSort = useCallback((id) => {
    setSortPref(id);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setSortSheetOpen(false);
  }, []);

  const sortedOwnedSingles = useMemo(
    () => sortOwnedSingles(ownedSingles, sortPref),
    [ownedSingles, sortPref]
  );

  const mergedOwnedSingles = useMemo(
    () =>
      sortedOwnedSingles.map((item) => ({
        ...item,
        ...(singles.find((s) => s.slug === item.slug) || {}),
      })),
    [sortedOwnedSingles, singles]
  );

  const recentlyAddedSingles = useMemo(() => {
    if (!ownedSingles.length) return [];
    const byPurchase = [...ownedSingles].sort((a, b) => {
      const ta = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
      const tb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
      return tb - ta;
    });
    return byPurchase
      .slice(0, 5)
      .map((item) => ({ ...item, ...(singles.find((s) => s.slug === item.slug) || {}) }));
  }, [ownedSingles, singles]);

  const catalogTracks = useMemo(() => {
    const map = new Map();
    [...ownedSingles, ...singles].forEach((item) => {
      if (item?.slug) map.set(item.slug, { ...item, ...(singles.find((s) => s.slug === item.slug) || {}) });
    });
    return [...map.values()].filter((t) => t.preview || t.audio || t.src);
  }, [ownedSingles, singles]);

  const playItem = useCallback(
    (item, access, resumeAt = 0) => {
      const resolvedAccess = access || resolveTrackAccess(item, accountState);
      if (!resolvedAccess?.canStream) return;
      const track = toPlaybackTrack(item, { ...accountState, userId: user?.id }, "my_music");
      void playTrack(track, { resumeAt });
    },
    [accountState, playTrack, user?.id]
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
    [accountState, playItem, playQueue, user?.id]
  );

  const playPlaylist = useCallback(
    (playlist) => {
      const catalogBySlug = new Map(catalogTracks.map((t) => [t.slug, t]));
      const refs = (playlist.tracks || []).length
        ? playlist.tracks
        : (playlist.trackIds || []).map((id) => catalogBySlug.get(id)).filter(Boolean);
      let tracks = refs
        .map((item) => {
          const merged = { ...catalogBySlug.get(item.slug), ...item };
          return toPlaybackTrack(merged, { ...accountState, userId: user?.id }, "playlist");
        })
        .filter((t) => t.src);
      if (!tracks.length) return;
      if (playlist.shuffle) {
        tracks = [...tracks].sort(() => Math.random() - 0.5);
        setShuffle(true);
      }
      void playQueue(tracks, 0);
    },
    [accountState, catalogTracks, playQueue, setShuffle, user?.id]
  );

  const resumeLast = useCallback(() => {
    if (!activeContinue) return;
    const catalog = singles.find((s) => s.slug === activeContinue.slug) || activeContinue;
    const access = resolveTrackAccess(catalog, accountState);
    playItem(catalog, access, activeContinue.completed ? 0 : Number(activeContinue.positionSeconds || 0));
    void resume();
  }, [accountState, activeContinue, playItem, resume, singles]);

  const sortLabel = SORT_OPTIONS.find((o) => o.id === sortPref)?.label || "Recently Added";

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#555", fontSize: 13 }}>Loading your collection…</div>;
  }

  const hasAnyContent =
    ownedSingles.length > 0 ||
    ownedAlbums.length > 0 ||
    subscriptionItems.length > 0 ||
    collectorItems.length > 0 ||
    activeRecentlyPlayed.length > 0 ||
    isAdmin;

  return (
    <div style={{ paddingBottom: isMobile ? 160 : 40 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 className="section-heading" style={{ margin: 0, fontSize: isMobile ? 17 : 22 }}>
            My Music Collection
          </h2>
          <div className="collection-vault-frame">Owned · Playlists · Gifts</div>
        </div>
        <button
          type="button"
          onClick={() => setSortSheetOpen(true)}
          style={{
            background: "#111",
            border: "1px solid #222",
            color: "#ccc",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: 0.5,
            padding: "8px 14px",
            borderRadius: 8,
          }}
        >
          {sortLabel} ▾
        </button>
      </div>

      {sortSheetOpen && (
        <div
          role="dialog"
          aria-label="Sort library"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 7000,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setSortSheetOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#0d0d0d",
              borderTop: "1px solid #222",
              borderRadius: "16px 16px 0 0",
              padding: "16px 20px max(24px, env(safe-area-inset-bottom, 0px))",
            }}
          >
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12, fontWeight: 700 }}>
              Sort by
            </div>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSort(opt.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 4px",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid #1a1a1a",
                  color: sortPref === opt.id ? "#00ffff" : "#ccc",
                  fontSize: 15,
                  fontWeight: sortPref === opt.id ? 800 : 500,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeContinue ? (
        <section
          style={{
            marginBottom: 32,
            padding: "18px 20px",
            borderRadius: 16,
            background: "linear-gradient(135deg, rgba(0,255,255,0.08), rgba(162,89,255,0.06))",
            border: "1px solid rgba(0,255,255,0.2)",
          }}
        >
          <div style={{ fontSize: 10, color: "#00ffff", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>Continue Listening</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {activeContinue.cover && <img src={activeContinue.cover} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{activeContinue.title}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>Pick up where you left off</div>
            </div>
            <button type="button" onClick={resumeLast} style={{ padding: "10px 18px", background: "#00ffff", color: "#000", border: "none", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontSize: 12 }}>
              Resume
            </button>
          </div>
        </section>
      ) : (
        <CollectionRailPlaceholder label="Continue Listening — your last session will appear here." />
      )}

      {activeRecentlyPlayed.length > 0 ? (
        <LibraryCarousel
          title="Recently Played"
          items={activeRecentlyPlayed}
          accountState={accountState}
          userId={user?.id}
          onPlay={playItem}
          onOpen={(item) => onOpenSingle?.(singles.find((s) => s.slug === item.slug) || item)}
          onLibraryChange={refresh}
          isMobile={isMobile}
        />
      ) : (
        <CollectionRailPlaceholder label="Recently Played — tracks you stream will collect here." />
      )}

      {recentlyAddedSingles.length > 0 || recentlyAddedRail.length > 0 ? (
        <RecentlyAddedRow
          items={recentlyAddedSingles.length ? recentlyAddedSingles : recentlyAddedRail}
          accountState={accountState}
          onPlay={(item) => {
            const access = resolveTrackAccess(item, accountState);
            playItem(item, access);
          }}
        />
      ) : (
        <CollectionRailPlaceholder label="Recently Added — new collection items will land here." />
      )}

      <PlaylistSection
        userId={user?.id}
        catalogTracks={catalogTracks}
        onPlayPlaylist={playPlaylist}
        subscriptionLocked={subscriptionLocked}
        isMobile={isMobile}
      />

      <LibraryCarousel
        title="Owned Singles"
        items={mergedOwnedSingles}
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
                    <MusicPlusButton track={merged} userId={user.id} access={access} isMobile={isMobile} deepLinkType="album" showOfflineDownload={false} onLibraryChange={refresh} />
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

      {isAdmin ? (
        <section style={{ marginBottom: 32 }}>
          <GiftsSentSection compact title="Gifts sent" />
        </section>
      ) : null}

      {library?.filter((item) => item.gifted || item.source === "gift").length > 0 ? (
        <section style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 11,
              color: "#555",
              letterSpacing: 2,
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            Gifts received
          </div>
          <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>
            {library
              .filter((item) => item.gifted || item.source === "gift")
              .slice(0, 6)
              .map((item) => item.title)
              .filter(Boolean)
              .join(" · ")}
          </div>
        </section>
      ) : null}

      {!hasAnyContent && (
        <div style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 20, padding: "40px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Your collection is empty</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 20 }}>Own singles or albums to build your personal collection.</div>
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
        Refresh collection
      </button>
    </div>
  );
}

export default memo(MyMusicTab);

"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAudioPlayer } from "@/context/AudioContext";
import { useMusicLibrary } from "@/hooks/useMusicLibrary";
import { membershipHasPremiumAccess } from "@/lib/commerce/entitlements";
import { resolveContentAccess, resolveTrackAccess } from "@/lib/music-access";
import { albumTracksForPlayback, playableReleaseQueue, toInstantStartTrack, toPlaybackTrack } from "@/lib/music-playback";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";
import { queueOfflineDownload, removeOfflineCache, isOfflineCached } from "@/lib/offline-cache";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import PlaylistSection from "@/components/music/PlaylistSection";
import CoverArt from "@/components/ui/CoverArt";
import GiftIcon from "@/components/gifts/GiftIcon";
import GiftsSentSection from "@/components/gifts/GiftsSentSection";
import { useListeningHistory } from "@/hooks/useListeningHistory";
import { buildRecommendations } from "@/lib/recommendations";

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

function DownloadButton({ status, onDownload, onRemove }) {
  if (!status || status === "idle" || status === "error") {
    return (
      <button
        type="button"
        aria-label="Download for offline"
        title={status === "error" ? "Download failed — tap to retry" : "Download for offline"}
        onClick={onDownload}
        style={{
          padding: "8px 8px",
          background: status === "error" ? "rgba(255,60,60,0.1)" : "#111",
          color: status === "error" ? "#ff5555" : "#888",
          border: `1px solid ${status === "error" ? "#ff5555" : "#222"}`,
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 11,
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ↓
      </button>
    );
  }
  if (status === "downloading") {
    return (
      <button
        type="button"
        disabled
        aria-label="Downloading…"
        style={{
          padding: "8px 8px",
          background: "#111",
          color: "#00ffff",
          border: "1px solid #222",
          borderRadius: 8,
          cursor: "not-allowed",
          fontSize: 11,
          flexShrink: 0,
          lineHeight: 1,
          opacity: 0.7,
        }}
      >
        …
      </button>
    );
  }
  // cached — tap to remove
  return (
    <button
      type="button"
      aria-label="Remove offline download"
      title="Saved offline — tap to remove"
      onClick={onRemove}
      style={{
        padding: "8px 8px",
        background: "rgba(0,255,136,0.08)",
        color: "#00ff88",
        border: "1px solid rgba(0,255,136,0.25)",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 11,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      ✓
    </button>
  );
}

function LibraryCarousel({
  title,
  items,
  accountState,
  userId,
  onPlay,
  onOpen,
  onEnqueue,
  onLibraryChange,
  isMobile,
  highlightSlug,
  listeningMap,
  onPlayAll,
  onShuffle,
  activeSlug,
  isPlaying,
  onToggle,
  downloadStates,
  onDownload,
  onRemoveDownload,
}) {
  if (!items?.length) return null;
  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>{title}</div>
        {(onPlayAll || onShuffle) ? (
          <div style={{ display: "flex", gap: 6 }}>
            {onPlayAll ? (
              <button
                type="button"
                onClick={onPlayAll}
                onMouseEnter={() => {
                  const first = items[0];
                  if (!first) return;
                  const track = toPlaybackTrack(first, { ...accountState, userId }, "library_all");
                  if (track?.src) {
                    const { startTrack } = toInstantStartTrack(track);
                    if (startTrack?.src) getPagePlaybackActionsBridge()?.hintUpcomingPlay?.(startTrack);
                  }
                }}
                onTouchStart={() => {
                  const first = items[0];
                  if (!first) return;
                  const track = toPlaybackTrack(first, { ...accountState, userId }, "library_all");
                  if (track?.src) {
                    const { startTrack } = toInstantStartTrack(track);
                    if (startTrack?.src) getPagePlaybackActionsBridge()?.hintUpcomingPlay?.(startTrack);
                  }
                }}
                style={{ padding: "5px 10px", background: "#111", border: "1px solid #333", color: "#ccc", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}
              >
                Play All
              </button>
            ) : null}
            {onShuffle ? (
              <button type="button" onClick={onShuffle} style={{ padding: "5px 10px", background: "#111", border: "1px solid #333", color: "#ccc", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>
                Shuffle
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          paddingBottom: 8,
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorX: "contain",
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          touchAction: "pan-x",
        }}
      >
        {items.map((item) => {
          const access = resolveContentAccess(item, accountState);
          const locked = access.subscriptionLocked && !access.owned;
          const highlighted = highlightSlug && item.slug === highlightSlug;
          const history = listeningMap?.get(item.slug);
          const showBar = history && history.positionSeconds > 0 && history.durationSeconds > 0 && !history.completed;
          const barPct = showBar ? Math.min(100, (history.positionSeconds / history.durationSeconds) * 100) : 0;
          const isActive = activeSlug === item.slug;
          const canPlay = access.canStream && !locked;
          return (
            <div
              key={item.slug}
              className={highlighted ? "gift-collection-highlight" : undefined}
              style={{
                flex: "0 0 auto",
                width: isMobile ? 148 : 168,
                scrollSnapAlign: "start",
                background: "#0a0a0a",
                border: isActive ? "1px solid rgba(0,255,255,0.45)" : "1px solid #1a1a1a",
                borderRadius: 14,
                overflow: "hidden",
                boxShadow: isActive ? "0 0 12px rgba(0,255,255,0.12)" : undefined,
                touchAction: "pan-x pan-y manipulation",
              }}
            >
              <div
                role={onOpen ? "button" : undefined}
                tabIndex={onOpen ? 0 : undefined}
                onClick={onOpen ? () => onOpen(item) : undefined}
                onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(item); } } : undefined}
                style={{ position: "relative", cursor: onOpen ? "pointer" : undefined }}
              >
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
                {isActive && isPlaying ? (
                  <div style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.65)",
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    gap: 2,
                    padding: "4px 4px 3px",
                    boxSizing: "border-box",
                  }}>
                    {[1, 0.6, 0.85].map((h, i) => (
                      <div
                        key={i}
                        style={{
                          width: 3,
                          height: `${h * 10}px`,
                          background: "#00ffff",
                          borderRadius: 1,
                          animation: `collectionBarBounce ${0.6 + i * 0.15}s ease-in-out infinite alternate`,
                        }}
                      />
                    ))}
                  </div>
                ) : null}
                {showBar ? (
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(0,0,0,0.45)" }}>
                    <div style={{ width: `${barPct}%`, height: "100%", background: "#00ffff" }} />
                  </div>
                ) : null}
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
                    disabled={!canPlay}
                    onClick={() => {
                      if (isActive && onToggle) {
                        onToggle();
                      } else {
                        onPlay(item, access);
                      }
                    }}
                    onMouseEnter={() => {
                      if (!canPlay) return;
                      const track = toPlaybackTrack(item, { ...accountState, userId }, "library_item");
                      if (track?.src) {
                        const { startTrack } = toInstantStartTrack(track);
                        if (startTrack?.src) getPagePlaybackActionsBridge()?.hintUpcomingPlay?.(startTrack);
                      }
                    }}
                    onTouchStart={() => {
                      if (!canPlay) return;
                      const track = toPlaybackTrack(item, { ...accountState, userId }, "library_item");
                      if (track?.src) {
                        const { startTrack } = toInstantStartTrack(track);
                        if (startTrack?.src) getPagePlaybackActionsBridge()?.hintUpcomingPlay?.(startTrack);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      background: canPlay ? "#00ffff" : "#222",
                      color: canPlay ? "#000" : "#666",
                      border: "none",
                      borderRadius: 8,
                      cursor: canPlay ? "pointer" : "not-allowed",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {locked ? "Locked" : isActive && isPlaying ? "Pause" : isActive ? "Resume" : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen?.(item)}
                    style={{ padding: "8px 10px", background: "#111", color: "#888", border: "1px solid #222", borderRadius: 8, cursor: "pointer", fontSize: 10 }}
                  >
                    Open
                  </button>
                  {onEnqueue && canPlay ? (
                    <button
                      type="button"
                      aria-label="Add to queue"
                      onClick={() => onEnqueue(item)}
                      style={{ padding: "8px 8px", background: "#111", color: "#888", border: "1px solid #222", borderRadius: 8, cursor: "pointer", fontSize: 10, flexShrink: 0 }}
                    >
                      +Q
                    </button>
                  ) : null}
                  {onDownload && canPlay ? (
                    <DownloadButton
                      status={downloadStates?.[item.slug] ?? "idle"}
                      onDownload={() => onDownload(item)}
                      onRemove={() => onRemoveDownload?.(item.slug)}
                    />
                  ) : null}
                  <MusicPlusButton
                    track={item}
                    userId={userId}
                    access={access}
                    onLibraryChange={onLibraryChange}
                  />
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
          touchAction: "pan-x",
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

function OwnedReleaseList({
  title,
  items,
  catalog,
  accountState,
  userId,
  isMobile,
  onPlayAlbum,
  onOpenAlbum,
  onOpenAlbumTracklist,
  onLibraryChange,
  listeningMap,
  activeSlug,
  isPlaying,
  onToggleAlbum,
}) {
  if (!items?.length) {
    return (
      <section style={{ marginBottom: 32 }}>
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
          {title}
        </div>
        <div style={{ fontSize: 13, color: "#555" }}>No owned releases yet.</div>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 32, width: "100%", minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>
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
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", minWidth: 0 }}>
        {items.map((album) => {
          const merged = { ...album, ...(catalog.find((a) => a.slug === album.slug) || {}) };
          const access = resolveContentAccess(merged, accountState);
          const history = listeningMap?.get(merged.slug);
          const showBar = history && history.positionSeconds > 0 && history.durationSeconds > 0 && !history.completed;
          const barPct = showBar ? Math.min(100, (history.positionSeconds / history.durationSeconds) * 100) : 0;
          const isActive = activeSlug === merged.slug;
          return (
            <div
              key={album.slug}
              style={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                alignItems: isMobile ? "stretch" : "center",
                gap: isMobile ? 12 : 14,
                padding: "14px 16px",
                background: "#0a0a0a",
                border: isActive ? "1px solid rgba(0,255,255,0.45)" : "1px solid #1a1a1a",
                borderRadius: 14,
                width: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                boxShadow: isActive ? "0 0 12px rgba(0,255,255,0.08)" : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  minWidth: 0,
                  flex: 1,
                }}
              >
                {merged.cover ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => (onOpenAlbumTracklist || onOpenAlbum)?.(merged)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (onOpenAlbumTracklist || onOpenAlbum)?.(merged); } }}
                    style={{ flexShrink: 0, cursor: "pointer", position: "relative" }}
                  >
                    <CoverArt
                      src={merged.cover}
                      type={merged.coverArtType}
                      alt=""
                      width={52}
                      height={52}
                      style={{ borderRadius: 8 }}
                    />
                    {showBar ? (
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(0,0,0,0.5)", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
                        <div style={{ width: `${barPct}%`, height: "100%", background: "#00ffff" }} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      marginBottom: 6,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: isActive ? "#00ffff" : undefined,
                    }}
                  >
                    {merged.title || album.title}
                  </div>
                  <MusicAccessBadge label={access.badge} compact />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: isMobile ? "wrap" : "nowrap",
                  width: isMobile ? "100%" : "auto",
                  flexShrink: 0,
                }}
              >
                <button
                  type="button"
                  disabled={!access.canStream}
                  onClick={() => {
                    if (isActive && onToggleAlbum) {
                      onToggleAlbum();
                    } else {
                      onPlayAlbum?.(merged);
                    }
                  }}
                  style={{
                    flex: isMobile ? "1 1 120px" : "0 0 auto",
                    minHeight: 44,
                    padding: "8px 16px",
                    background: access.canStream ? "#00ffff" : "#222",
                    color: access.canStream ? "#000" : "#666",
                    border: "none",
                    borderRadius: 8,
                    cursor: access.canStream ? "pointer" : "not-allowed",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {isActive && isPlaying ? "Pause" : isActive ? "Resume" : "Play Album"}
                </button>
                <button
                  type="button"
                  onClick={() => (onOpenAlbumTracklist || onOpenAlbum)?.(merged)}
                  style={{
                    flex: isMobile ? "1 1 100px" : "0 0 auto",
                    minHeight: 44,
                    padding: "8px 14px",
                    background: "transparent",
                    color: "#888",
                    border: "1px solid #333",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Tracklist
                </button>
                <MusicPlusButton track={merged} userId={userId} access={access} onLibraryChange={onLibraryChange} />
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
  mixtapesAndEps = [],
  isMobile,
  isAdmin = false,
  highlightSlug = null,
  onSwitchTab,
  onGoToAccount,
  onDiscoverSingles,
  onDiscoverVault,
  onOpenSingle,
  onOpenAlbum,
  onOpenAlbumTracklist,
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
    ownedMixtapes,
    ownedEps,
    subscriptionItems,
    collectorItems,
    recentlyPlayed,
    lastPlayed,
    refresh,
  } = useMusicLibrary({ singles, albums, mixtapesAndEps });

  const multiTrackCatalog = useMemo(
    () => [...albums, ...(mixtapesAndEps || [])],
    [albums, mixtapesAndEps]
  );

  const {
    continueListening,
    recentlyPlayedRail,
    recentlyAddedRail,
  } = useListeningHistory({ accountState, singles, albums: multiTrackCatalog, userId: user?.id });

  const activeContinue = continueListening || lastPlayed;
  const activeRecentlyPlayed = recentlyPlayedRail.length ? recentlyPlayedRail : recentlyPlayed;

  const { playTrack, playQueue, resume, setShuffle, currentTrack, isPlaying, toggle, enqueueTrack, dispatchPlaybackCommand } = useAudioPlayer();
  const membershipActive =
    Boolean(accountState?.subscriberActive) || membershipHasPremiumAccess(accountState?.membership);
  const subscriptionLocked = Boolean(accountState?.membership && !membershipActive);
  const hasVaultAccess = Boolean(accountState?.vaultAccess);
  const hasCollectorCard = Boolean(accountState?.collectorCard);
  const [sortPref, setSortPref] = useState("recent");
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [downloadStates, setDownloadStates] = useState({});

  useEffect(() => {
    setSortPref(readSortPref());
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

  // Seed download states from IDB on mount so cached badges survive page reload.
  useEffect(() => {
    if (!user?.id || !mergedOwnedSingles.length) return;
    const initial = {};
    for (const item of mergedOwnedSingles) {
      if (item.slug && isOfflineCached(user.id, item.slug)) {
        initial[item.slug] = "cached";
      }
    }
    if (Object.keys(initial).length) {
      setDownloadStates((prev) => ({ ...prev, ...initial }));
    }
  }, [user?.id, mergedOwnedSingles]);

  const handleDownload = useCallback(async (item) => {
    if (!user?.id || !item?.slug) return;
    setDownloadStates((prev) => ({ ...prev, [item.slug]: "downloading" }));
    try {
      // Use the proxy path (no redirect) to fetch full audio bytes cross-session-safely.
      const streamUrl = `/api/library/stream?slug=${encodeURIComponent(item.slug)}`;
      await queueOfflineDownload(user.id, item, { streamUrl });
      setDownloadStates((prev) => ({ ...prev, [item.slug]: "cached" }));
    } catch {
      setDownloadStates((prev) => ({ ...prev, [item.slug]: "error" }));
    }
  }, [user?.id]);

  const handleRemoveDownload = useCallback((slug) => {
    if (!user?.id || !slug) return;
    removeOfflineCache(user.id, slug);
    setDownloadStates((prev) => ({ ...prev, [slug]: "idle" }));
  }, [user?.id]);

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

  const recentlyAddedSingles = useMemo(() => {
    const permanent = library?.filter((item) => item.source === "purchase" || item.source === "gift" || item.gifted) || ownedSingles;
    if (!permanent.length) return [];
    const byPurchase = [...permanent].sort((a, b) => {
      const ta = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
      const tb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
      return tb - ta;
    });
    return byPurchase
      .slice(0, 5)
      .map((item) => ({ ...item, ...(singles.find((s) => s.slug === item.slug) || {}) }));
  }, [library, ownedSingles, singles]);

  const catalogTracks = useMemo(() => {
    const map = new Map();
    [...ownedSingles, ...singles].forEach((item) => {
      if (item?.slug) map.set(item.slug, { ...item, ...(singles.find((s) => s.slug === item.slug) || {}) });
    });
    return [...map.values()].filter((t) => t.preview || t.audio || t.src);
  }, [ownedSingles, singles]);

  // Must be defined before playItem so playItem's dep array can reference it without TDZ.
  const listeningMap = useMemo(() => {
    const map = new Map();
    for (const row of activeRecentlyPlayed) {
      if (row.slug && row.positionSeconds > 0 && row.durationSeconds > 0) {
        map.set(row.slug, { positionSeconds: row.positionSeconds, durationSeconds: row.durationSeconds, completed: row.completed });
      }
    }
    return map;
  }, [activeRecentlyPlayed]);

  const recommendations = useMemo(
    () =>
      buildRecommendations({
        accountState,
        singles,
        albums,
        mixtapesAndEps,
        recentlyPlayedRail: activeRecentlyPlayed,
      }),
    [accountState, singles, albums, mixtapesAndEps, activeRecentlyPlayed]
  );

  const playItem = useCallback(
    (item, access, resumeAt) => {
      const resolvedAccess = access || resolveTrackAccess(item, accountState);
      if (!resolvedAccess?.canStream) return;
      const track = toPlaybackTrack(item, { ...accountState, userId: user?.id }, "my_music");
      const savedPosition = resumeAt !== undefined
        ? resumeAt
        : (() => {
            const h = listeningMap.get(item.slug);
            return h && !h.completed && h.positionSeconds > 5 ? h.positionSeconds : 0;
          })();
      if (savedPosition > 0) {
        void playTrack(track, { resumeAt: savedPosition });
        return;
      }
      const { startTrack, needsUpgrade } = toInstantStartTrack(track);
      void playQueue([startTrack], 0);
      if (needsUpgrade) {
        const upgradeSlug = startTrack.slug;
        setTimeout(() => {
          const b = getPagePlaybackActionsBridge();
          if (b?.currentTrack?.slug === upgradeSlug) void b.dispatchPlaybackCommand("upgradeStream");
        }, 2000);
      }
    },
    [accountState, dispatchPlaybackCommand, playQueue, playTrack, user?.id, listeningMap]
  );

  const playAlbum = useCallback(
    (album) => {
      const access = resolveTrackAccess(album, accountState);
      if (!access.canStream) return;
      const tracks = albumTracksForPlayback(album, { ...accountState, userId: user?.id }, "my_music_album");
      const playable = playableReleaseQueue(tracks, { ...accountState, userId: user?.id });
      if (!playable.length) {
        playItem(album, access);
        return;
      }
      const { startTrack, needsUpgrade } = toInstantStartTrack(playable[0]);
      const instantPlayable = needsUpgrade ? [startTrack, ...playable.slice(1)] : playable;
      void playQueue(instantPlayable, 0);
      if (needsUpgrade) {
        const upgradeSlug = startTrack.slug;
        setTimeout(() => {
          const b = getPagePlaybackActionsBridge();
          if (b?.currentTrack?.slug === upgradeSlug) void b.dispatchPlaybackCommand("upgradeStream");
        }, 2000);
      }
    },
    [accountState, dispatchPlaybackCommand, playItem, playQueue, user?.id]
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
        const arr = [...tracks];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        tracks = arr;
        setShuffle(true);
      }
      const { startTrack, needsUpgrade } = toInstantStartTrack(tracks[0]);
      const instantTracks = needsUpgrade ? [startTrack, ...tracks.slice(1)] : tracks;
      void playQueue(instantTracks, 0);
      if (needsUpgrade) {
        const upgradeSlug = startTrack.slug;
        setTimeout(() => {
          const b = getPagePlaybackActionsBridge();
          if (b?.currentTrack?.slug === upgradeSlug) void b.dispatchPlaybackCommand("upgradeStream");
        }, 2000);
      }
    },
    [accountState, catalogTracks, dispatchPlaybackCommand, playQueue, setShuffle, user?.id]
  );

  const resumeLast = useCallback(() => {
    if (!activeContinue) return;
    const catalog = singles.find((s) => s.slug === activeContinue.slug) || activeContinue;
    const access = resolveTrackAccess(catalog, accountState);
    playItem(catalog, access, activeContinue.completed ? 0 : Number(activeContinue.positionSeconds || 0));
  }, [accountState, activeContinue, playItem, singles]);

  const playAllSingles = useCallback((shuffle = false) => {
    const playable = mergedOwnedSingles
      .filter((item) => resolveTrackAccess(item, accountState).canStream)
      .map((item) => toPlaybackTrack(item, { ...accountState, userId: user?.id }, "my_music_all"));
    if (!playable.length) return;
    let ordered = playable;
    if (shuffle) {
      ordered = [...playable];
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
    }
    if (shuffle) setShuffle(true);
    const { startTrack, needsUpgrade } = toInstantStartTrack(ordered[0]);
    const instantOrdered = needsUpgrade ? [startTrack, ...ordered.slice(1)] : ordered;
    void playQueue(instantOrdered, 0);
    if (needsUpgrade) {
        const upgradeSlug = startTrack.slug;
        setTimeout(() => {
          const b = getPagePlaybackActionsBridge();
          if (b?.currentTrack?.slug === upgradeSlug) void b.dispatchPlaybackCommand("upgradeStream");
        }, 2000);
      }
  }, [mergedOwnedSingles, accountState, dispatchPlaybackCommand, user?.id, playQueue, setShuffle]);

  const sortLabel = SORT_OPTIONS.find((o) => o.id === sortPref)?.label || "Recently Added";

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#555", fontSize: 13 }}>Loading your collection…</div>;
  }

  const hasAnyContent =
    ownedSingles.length > 0 ||
    ownedAlbums.length > 0 ||
    ownedMixtapes.length > 0 ||
    ownedEps.length > 0 ||
    subscriptionItems.length > 0 ||
    collectorItems.length > 0 ||
    activeRecentlyPlayed.length > 0 ||
    isAdmin;

  return (
    <div
      style={{
        paddingBottom: isMobile ? 160 : 40,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflowX: "hidden",
        boxSizing: "border-box",
      }}
    >
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
          <div className="collection-vault-frame">Owned · Streaming · Collector</div>
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
            {activeContinue.cover && (
              <CoverArt
                src={activeContinue.cover}
                type={activeContinue.coverArtType}
                alt=""
                width={56}
                height={56}
                style={{ borderRadius: 10 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{activeContinue.title}</div>
              {activeContinue.positionSeconds > 0 && activeContinue.durationSeconds > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ height: 3, background: "rgba(0,0,0,0.35)", borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.min(100, (activeContinue.positionSeconds / activeContinue.durationSeconds) * 100)}%`,
                        height: "100%",
                        background: "#00ffff",
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>Pick up where you left off</div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>Pick up where you left off</div>
              )}
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
          onPlay={(item, access) => {
            const queue = activeRecentlyPlayed
              .filter((s) => resolveTrackAccess(s, accountState).canStream)
              .map((s) => toPlaybackTrack({ ...s, ...(singles.find((x) => x.slug === s.slug) || {}) }, { ...accountState, userId: user?.id }, "my_music_recent"));
            const idx = queue.findIndex((t) => t.slug === item.slug);
            if (idx >= 0 && queue.length > 1) {
              void playQueue(queue, idx);
            } else {
              playItem(item, access);
            }
          }}
          onOpen={(item) => onOpenSingle?.(singles.find((s) => s.slug === item.slug) || item)}
          onLibraryChange={refresh}
          isMobile={isMobile}
          listeningMap={listeningMap}
          activeSlug={currentTrack?.slug}
          isPlaying={isPlaying}
          onToggle={toggle}
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

      {recommendations.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 16 }}>
            For You
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {recommendations.map((rec) => (
              <button
                key={rec.slug}
                type="button"
                onClick={() => {
                  if (rec.type === "album" && rec.item) {
                    onOpenAlbum?.(rec.item);
                  } else if (rec.albumSlug) {
                    const album = [...albums, ...mixtapesAndEps].find((a) => a.slug === rec.albumSlug);
                    if (album) onOpenAlbum?.(album);
                  } else {
                    const single = singles.find((s) => s.slug === rec.slug);
                    if (single) onOpenSingle?.(single);
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "10px 0", cursor: "pointer", textAlign: "left", width: "100%" }}
              >
                {rec.cover && (
                  <img src={rec.cover} alt="" width={44} height={44} style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: "#fff", fontSize: isMobile ? 13 : 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {rec.title}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 2 }}>
                    {rec.albumTitle ? `${rec.albumTitle} · Track` : rec.type === "album" ? "Album" : "Single"}
                  </div>
                </div>
                <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12, flexShrink: 0 }}>▶</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
          Streaming Library
        </div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
          {membershipActive
            ? "Playlists and catalog access included with your subscription."
            : "Subscribe to build playlists and stream the full catalog."}
        </div>
        <PlaylistSection
          userId={user?.id}
          catalogTracks={catalogTracks}
          onPlayPlaylist={playPlaylist}
          subscriptionLocked={subscriptionLocked}
          isMobile={isMobile}
        />
        {subscriptionItems.length > 0 ? (
          <LibraryCarousel
            title="Included with subscription"
            items={subscriptionItems.map((item) => ({
              ...item,
              ...(singles.find((s) => s.slug === item.slug) || albums.find((a) => a.slug === item.slug) || {}),
            }))}
            accountState={accountState}
            userId={user?.id}
            onPlay={playItem}
            onLibraryChange={refresh}
            isMobile={isMobile}
            listeningMap={listeningMap}
            activeSlug={currentTrack?.slug}
            isPlaying={isPlaying}
            onToggle={toggle}
          />
        ) : null}
      </section>

      <section style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
          Purchased / Owned
        </div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
          Permanent purchases and gifts — yours even if your subscription ends.
        </div>

      <LibraryCarousel
        title="Owned Singles"
        items={mergedOwnedSingles}
        accountState={accountState}
        userId={user?.id}
        onPlay={(item, access) => {
          const queue = mergedOwnedSingles
            .filter((s) => resolveTrackAccess(s, accountState).canStream)
            .map((s) => toPlaybackTrack(s, { ...accountState, userId: user?.id }, "my_music"));
          const idx = queue.findIndex((t) => t.slug === item.slug);
          if (idx >= 0 && queue.length > 1) {
            void playQueue(queue, idx);
          } else {
            playItem(item, access);
          }
        }}
        onEnqueue={(item) => {
          const track = toPlaybackTrack(item, { ...accountState, userId: user?.id }, "my_music");
          enqueueTrack(track);
        }}
        onOpen={(item) => onOpenSingle?.(singles.find((s) => s.slug === item.slug) || item)}
        onLibraryChange={refresh}
        isMobile={isMobile}
        highlightSlug={highlightSlug}
        listeningMap={listeningMap}
        onPlayAll={mergedOwnedSingles.length ? () => playAllSingles(false) : undefined}
        onShuffle={mergedOwnedSingles.length > 1 ? () => playAllSingles(true) : undefined}
        activeSlug={currentTrack?.slug}
        isPlaying={isPlaying}
        onToggle={toggle}
        downloadStates={downloadStates}
        onDownload={handleDownload}
        onRemoveDownload={handleRemoveDownload}
      />

      <OwnedReleaseList
        title="Owned Mixtapes"
        items={ownedMixtapes}
        catalog={multiTrackCatalog}
        accountState={accountState}
        userId={user?.id}
        isMobile={isMobile}
        onPlayAlbum={playAlbum}
        onOpenAlbum={onOpenAlbum}
        onOpenAlbumTracklist={onOpenAlbumTracklist}
        onLibraryChange={refresh}
        listeningMap={listeningMap}
        activeSlug={currentTrack?.slug}
        isPlaying={isPlaying}
        onToggleAlbum={toggle}
      />

      <OwnedReleaseList
        title="Owned EPs"
        items={ownedEps}
        catalog={multiTrackCatalog}
        accountState={accountState}
        userId={user?.id}
        isMobile={isMobile}
        onPlayAlbum={playAlbum}
        onOpenAlbum={onOpenAlbum}
        onOpenAlbumTracklist={onOpenAlbumTracklist}
        onLibraryChange={refresh}
        listeningMap={listeningMap}
        activeSlug={currentTrack?.slug}
        isPlaying={isPlaying}
        onToggleAlbum={toggle}
      />

      <OwnedReleaseList
        title="Owned Albums"
        items={ownedAlbums}
        catalog={multiTrackCatalog}
        accountState={accountState}
        userId={user?.id}
        isMobile={isMobile}
        onPlayAlbum={playAlbum}
        onOpenAlbum={onOpenAlbum}
        onOpenAlbumTracklist={onOpenAlbumTracklist}
        onLibraryChange={refresh}
        listeningMap={listeningMap}
        activeSlug={currentTrack?.slug}
        isPlaying={isPlaying}
        onToggleAlbum={toggle}
      />
      </section>

      <section style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
          Collector / Vault
        </div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>
          {hasCollectorCard || hasVaultAccess
            ? "Collector card and vault-tier exclusives."
            : "Activate a collector card or unlock vault access for exclusive releases."}
        </div>
        {collectorItems.length > 0 ? (
          <LibraryCarousel
            title="Collector unlocks"
            items={collectorItems.map((item) => ({ ...item, ...(singles.find((s) => s.slug === item.slug) || {}) }))}
            accountState={accountState}
            userId={user?.id}
            onPlay={playItem}
            onLibraryChange={refresh}
            isMobile={isMobile}
          />
        ) : (
          <CollectionRailPlaceholder label="Collector unlocks appear here after card activation." />
        )}
        {(hasCollectorCard || hasVaultAccess) && (
          <button
            type="button"
            onClick={goVault}
            style={{
              marginTop: 12,
              padding: "10px 18px",
              background: "#111",
              color: "#a259ff",
              border: "1px solid #a259ff44",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Open Vault
          </button>
        )}
        {!hasCollectorCard ? (
          <Link
            href="/collector/activate"
            style={{
              display: "inline-block",
              marginTop: 10,
              fontSize: 11,
              color: "#666",
              letterSpacing: 0.5,
            }}
          >
            Activate collector card →
          </Link>
        ) : null}
      </section>

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

"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { PlusIcon, BookmarkIcon, PlaylistIcon } from "@/components/music/MusicIcons";

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  height: 52,
  width: "100%",
  padding: "0 22px",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid rgba(255,255,255,.06)",
  color: "#fff",
  fontFamily: "'DM Mono', monospace",
  fontSize: 13,
  cursor: "pointer",
  textAlign: "left",
};

function OptionRow({ icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...rowStyle,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.background = "rgba(255,255,255,.04)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "rgba(255,255,255,.75)" }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function MusicOptionsSheet({
  open,
  onClose,
  track,
  access,
  sheetBg = "#0a0a0a",
  userId,
  inLib = false,
  playlists = [],
  onShare,
  onAddToLibrary,
  onAddToPlaylist,
  onCreateAndAdd,
  newPlaylistTitle = "",
  onNewPlaylistTitleChange,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!open) return null;

  const canStream = Boolean(access?.canStream);
  const artist = track?.artist || track?.artistName || "2MRRW";
  const title = track?.title || "Track";

  const closeAll = () => {
    setPickerOpen(false);
    onClose?.();
  };

  return createPortal(
    <div
      role="presentation"
      onClick={closeAll}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        role="dialog"
        aria-label="Track actions"
        onClick={(e) => e.stopPropagation()}
        className="bsheet"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          background: sheetBg,
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="sheet-hdl" onClick={closeAll} role="button" tabIndex={0} aria-label="Close" onKeyDown={(e) => e.key === "Enter" && closeAll()} />

        {!pickerOpen ? (
          <>
            <div style={{ padding: "4px 22px 14px" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#fff", fontWeight: 600 }}>{title}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "rgba(255,255,255,.4)", marginTop: 4, letterSpacing: ".06em" }}>
                {artist}
              </div>
            </div>

            <OptionRow icon={<PlusIcon size={20} />} label="Share" onClick={onShare} />

            {canStream ? (
              <>
                <OptionRow
                  icon={<BookmarkIcon />}
                  label={inLib ? "In Library" : "Add to Library"}
                  onClick={onAddToLibrary}
                  disabled={!userId || inLib}
                />
                <OptionRow
                  icon={<PlaylistIcon />}
                  label="Add to Playlist"
                  onClick={() => setPickerOpen(true)}
                  disabled={!userId}
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ padding: "4px 22px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#fff", fontWeight: 600 }}>Add to Playlist</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "rgba(255,255,255,.4)", marginTop: 4 }}>{title}</div>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,.45)",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  cursor: "pointer",
                  letterSpacing: ".1em",
                }}
              >
                BACK
              </button>
            </div>
            {playlists.slice(0, 8).map((pl) => (
              <OptionRow
                key={pl.id}
                icon={<PlaylistIcon />}
                label={pl.title}
                onClick={() => {
                  onAddToPlaylist?.(pl.id);
                  closeAll();
                }}
                disabled={!userId}
              />
            ))}
            <div style={{ display: "flex", gap: 8, padding: "12px 22px 4px" }}>
              <input
                value={newPlaylistTitle}
                onChange={(e) => onNewPlaylistTitleChange?.(e.target.value)}
                placeholder="New playlist name"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 8,
                  color: "white",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  onCreateAndAdd?.();
                  closeAll();
                }}
                disabled={!userId || !newPlaylistTitle?.trim()}
                style={{
                  padding: "10px 14px",
                  background: "rgba(255,255,255,.12)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  opacity: !userId || !newPlaylistTitle?.trim() ? 0.45 : 1,
                }}
              >
                Create
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

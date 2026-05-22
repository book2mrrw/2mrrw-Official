"use client";

export function ActionRow({ label, hint, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 0",
        background: "none",
        border: "none",
        borderBottom: "1px solid #1a1a1a",
        color: disabled ? "#444" : "#eee",
        cursor: disabled ? "default" : "pointer",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {label}
      {hint && <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{hint}</div>}
    </button>
  );
}

export default function PlusActionSheet({
  open,
  onClose,
  track,
  isMobile,
  inLib,
  offlineQueued,
  access,
  userId,
  playlists = [],
  newPlaylistTitle,
  onNewPlaylistTitleChange,
  onAddToLibrary,
  onAddToPlaylist,
  onCreateAndAdd,
  onOffline,
  onShare,
}) {
  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={onClose}
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
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#0d0d0d",
          border: "1px solid #222",
          borderRadius: "16px 16px 0 0",
          padding: isMobile ? "16px 16px calc(16px + env(safe-area-inset-bottom))" : 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>{track?.title}</div>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 16 }}>Library actions</div>

        <ActionRow label="Add to Library" onClick={onAddToLibrary} disabled={!userId || inLib} />
        <div style={{ fontSize: 10, color: "#444", letterSpacing: 1.5, margin: "12px 0 8px", textTransform: "uppercase" }}>
          Add to Playlist
        </div>
        {playlists.slice(0, 6).map((pl) => (
          <ActionRow key={pl.id} label={pl.title} onClick={() => onAddToPlaylist(pl.id)} disabled={!userId} />
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={newPlaylistTitle}
            onChange={(e) => onNewPlaylistTitleChange(e.target.value)}
            placeholder="New playlist name"
            style={{
              flex: 1,
              padding: "8px 10px",
              background: "#111",
              border: "1px solid #2a2a2a",
              borderRadius: 8,
              color: "white",
              fontSize: 12,
            }}
          />
          <button
            type="button"
            onClick={onCreateAndAdd}
            disabled={!userId || !newPlaylistTitle.trim()}
            style={{
              padding: "8px 12px",
              background: "#00ffff",
              color: "#000",
              border: "none",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 11,
              cursor: "pointer",
              opacity: !userId || !newPlaylistTitle.trim() ? 0.5 : 1,
            }}
          >
            Create
          </button>
        </div>

        <ActionRow
          label={offlineQueued ? "Offline queued" : "Download for Offline Playback"}
          hint={offlineQueued ? "In-app only · queued" : access?.canOffline ? "In-app cache (MVP)" : "Requires subscription or ownership"}
          onClick={onOffline}
          disabled={!userId || !access?.canOffline || offlineQueued}
        />
        <ActionRow label="Share Song" onClick={onShare} />
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "12px 0",
            background: "transparent",
            border: "1px solid #333",
            borderRadius: 10,
            color: "#888",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

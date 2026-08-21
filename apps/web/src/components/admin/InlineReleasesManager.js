"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { UploadWizard } from "@/components/admin/UploadWizard";

// ── Design tokens ────────────────────────────────────────────────────────────────
const C = {
  bg:           "#050505",
  surface:      "#0d0d0d",
  surface2:     "#121212",
  border:       "rgba(255,255,255,0.06)",
  border2:      "rgba(255,255,255,0.12)",
  accent:       "#00ffff",
  accentDim:    "rgba(0,255,255,0.07)",
  accentBorder: "rgba(0,255,255,0.20)",
  purple:       "#a259ff",
  text:         "#e8e8e8",
  muted:        "rgba(255,255,255,0.45)",
  muted2:       "rgba(255,255,255,0.28)",
  success:      "#32d74b",
  warn:         "#ff9f0a",
  error:        "#ff453a",
};

const STATUS_COLORS = {
  published: C.success,
  scheduled: C.warn,
  draft:     C.muted2,
  failed:    C.error,
};

const TYPE_LABELS = {
  single:  "Single",
  feature: "Feature",
  album:   "Album",
  ep:      "EP",
  mixtape: "Mixtape",
};

const SLUG_PREFIX = {
  single:  "/song/",
  feature: "/feature/",
  album:   "/album/",
  ep:      "/album/",
  mixtape: "/album/",
};

// ── Shared atoms ─────────────────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.muted2, textTransform: "uppercase", marginBottom: 7 }}>
      {children}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 18 }}>
      {label && <Label>{label}</Label>}
      {children}
      {hint && <div style={{ fontSize: 11, color: C.muted2, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function Inp({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
        borderRadius: 8, color: C.text, fontSize: 14, padding: "10px 13px",
        outline: "none", boxSizing: "border-box", fontFamily: "inherit",
      }}
    />
  );
}

function Sel({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
        borderRadius: 8, color: C.text, fontSize: 14, padding: "10px 13px",
        outline: "none", boxSizing: "border-box", fontFamily: "inherit",
      }}
    >
      {children}
    </select>
  );
}

function Btn({ onClick, children, variant = "primary", disabled = false, small = false }) {
  const variants = {
    primary:   { background: C.accent,   color: "#000" },
    secondary: { background: C.surface2, color: C.text, border: `1px solid ${C.border2}` },
    danger:    { background: C.error,    color: "#fff" },
    warn:      { background: C.warn,     color: "#000" },
    ghost:     { background: "none",     color: C.muted, border: `1px solid ${C.border}` },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        border: "none", borderRadius: 8,
        padding: small ? "7px 14px" : "11px 22px",
        fontSize: small ? 11 : 13,
        fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit", transition: "opacity 0.15s",
        ...variants[variant],
      }}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
      color: STATUS_COLORS[status] || C.muted2,
      background: `${STATUS_COLORS[status] || C.muted2}18`,
      borderRadius: 5, padding: "3px 8px",
    }}>
      {status?.toUpperCase()}
    </span>
  );
}

// ── Release List View ────────────────────────────────────────────────────────────
function ReleaseListView({ releases, loading, error, filter, onFilter, onRefresh, onEdit, onNew, lastResult }) {
  const filtered = releases.filter((r) => {
    if (filter === "all")       return true;
    if (filter === "published") return r.status === "published";
    if (filter === "scheduled") return r.status === "scheduled";
    if (filter === "draft")     return r.status === "draft";
    return true;
  });

  return (
    <div style={{ padding: "28px 0 80px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: C.accent, textTransform: "uppercase", marginBottom: 6 }}>
            Admin
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: 0 }}>Manage Releases</h1>
        </div>
        <Btn onClick={onNew}>+ Upload New Release</Btn>
      </div>

      {/* Last publish success banner */}
      {lastResult && (
        <div style={{
          background: "rgba(50,215,75,0.08)", border: `1px solid rgba(50,215,75,0.3)`,
          borderRadius: 10, padding: "14px 18px", marginBottom: 20,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>🎉</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.success }}>
              {lastResult.status === "scheduled" ? "Release Scheduled!" : "Release is Live!"}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>
              Slug: <span style={{ color: C.accent }}>{lastResult.slug}</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["all", "published", "scheduled", "draft"].map((f) => (
          <button
            key={f}
            onClick={() => onFilter(f)}
            style={{
              background: filter === f ? C.accentDim : C.surface2,
              border: `1px solid ${filter === f ? C.accentBorder : C.border}`,
              borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 700,
              color: filter === f ? C.accent : C.muted, cursor: "pointer",
              textTransform: "capitalize", letterSpacing: "0.05em", fontFamily: "inherit",
            }}
          >
            {f === "all"
              ? `All (${releases.length})`
              : `${f.charAt(0).toUpperCase() + f.slice(1)} (${releases.filter((r) => r.status === f).length})`}
          </button>
        ))}
        <button
          onClick={onRefresh}
          style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 14px", fontSize: 12, color: C.muted2, cursor: "pointer", fontFamily: "inherit" }}
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(255,69,58,0.08)", border: `1px solid rgba(255,69,58,0.3)`, borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: C.error }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}>Loading releases…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>No releases found.</div>
          {filter === "all" && <Btn onClick={onNew}>Upload Your First Release</Btn>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((rel) => {
            const prefix    = SLUG_PREFIX[rel.release_type] || "/song/";
            const isLive    = rel.status === "published" && rel.storefront_visible;
            const isScheduled = rel.status === "scheduled";

            return (
              <div
                key={rel.id}
                style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 12, padding: "16px 20px",
                  display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                }}
              >
                {/* Info */}
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                      {rel.title || <span style={{ color: C.muted2, fontStyle: "italic" }}>Untitled</span>}
                    </div>
                    <StatusBadge status={rel.status} />
                  </div>
                  <div style={{ fontSize: 12, color: C.muted2 }}>
                    {TYPE_LABELS[rel.release_type] || rel.release_type} · {rel.slug}
                  </div>
                  {isScheduled && rel.scheduled_at && (
                    <div style={{ fontSize: 11, color: C.warn, marginTop: 3 }}>
                      Scheduled: {new Date(rel.scheduled_at).toLocaleString()}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.muted2, marginTop: 3 }}>
                    {rel.track_counts?.ready}/{rel.track_counts?.total} tracks ready
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
                  {isLive && rel.slug && (
                    <a
                      href={prefix + rel.slug}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 7,
                        padding: "7px 13px", fontSize: 11, color: C.accent, textDecoration: "none",
                        fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.04em",
                      }}
                    >
                      View Live ↗
                    </a>
                  )}
                  <button
                    onClick={() => onEdit(rel)}
                    style={{
                      background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 7,
                      padding: "7px 13px", fontSize: 11, color: C.muted, cursor: "pointer",
                      fontFamily: "inherit", fontWeight: 700, letterSpacing: "0.04em",
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Release Editor Panel ─────────────────────────────────────────────────────────
// Full inline editing for an existing release: metadata, cover, audio, lyrics
function ReleaseEditorPanel({ release: relStub, onBack, onSaved }) {
  const [detail,    setDetail]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [section,   setSection]   = useState("metadata"); // metadata | cover | audio | lyrics
  const [saving,    setSaving]    = useState(false);
  const [saveMsg,   setSaveMsg]   = useState(null);

  // Editable metadata form state — populated from detail on load
  const [editTitle,   setEditTitle]   = useState("");
  const [editPrice,   setEditPrice]   = useState("");
  const [editGenre,   setEditGenre]   = useState("");
  const [editDate,    setEditDate]    = useState("");

  // Per-track lyrics state (keyed by track id)
  const [trackLyrics, setTrackLyrics] = useState({});

  // Cover upload state
  const [coverState,     setCoverState]     = useState({ status: "idle", error: null });
  const [coverPreview,   setCoverPreview]   = useState(null);

  // Audio replace state (per track)
  const [audioReplacing, setAudioReplacing] = useState(null); // track id being replaced
  const [audioPhase,     setAudioPhase]     = useState("select"); // select | uploading | confirming | done | error
  const [audioProgress,  setAudioProgress]  = useState(0);
  const [audioNewKey,    setAudioNewKey]    = useState(null);
  const [audioError,     setAudioError]     = useState("");
  const audioXhrRef = useRef(null);

  const GENRES = ["R&B","Hip-Hop","Pop","Alternative R&B","Soul","Neo-Soul","Trap","Rap","Electronic","Other"];

  // Load detail
  useEffect(() => {
    if (!relStub?.id) return;
    setLoading(true);
    fetch(`/api/admin/releases/${relStub.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setDetail(d);
        setEditTitle(d.product?.title  || "");
        setEditPrice(d.product?.price_cents ? (d.product.price_cents / 100).toFixed(2) : "");
        setEditGenre(d.product?.genre  || "");
        setEditDate(d.release?.release_date || "");
        // Seed lyrics map
        const lyricsMap = {};
        for (const t of (d.tracks || [])) {
          lyricsMap[t.id] = t.lyrics || "";
        }
        setTrackLyrics(lyricsMap);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [relStub?.id]);

  // ── Save metadata ──────────────────────────────────────────────────────────────
  const saveMetadata = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/releases/${relStub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:        editTitle,
          price:        editPrice,
          genre:        editGenre,
          release_date: editDate,
        }),
      });
      const json = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(json.errors?.[0] || "Save failed");
      setSaveMsg("Saved successfully");
      onSaved();
    } catch (err) {
      setSaveMsg("Error: " + err.message);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  // ── Save lyrics ────────────────────────────────────────────────────────────────
  const saveLyrics = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const track_lyrics = Object.entries(trackLyrics).map(([id, lyrics]) => ({ id, lyrics }));
      const res = await fetch(`/api/admin/releases/${relStub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_lyrics }),
      });
      const json = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(json.errors?.[0] || "Save failed");
      setSaveMsg("Lyrics saved");
    } catch (err) {
      setSaveMsg("Error: " + err.message);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  // ── Cover upload ───────────────────────────────────────────────────────────────
  const uploadCover = useCallback(async (file) => {
    if (!file || !detail) return;
    setCoverState({ status: "uploading", error: null });
    setCoverPreview(null);
    try {
      const presignRes = await fetch("/api/admin/upload/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseType: detail.release.release_type,
          slug:        detail.release.slug,
          assetType:   "cover",
          filename:    file.name,
          contentType: file.type || "image/jpeg",
          size:        file.size,
        }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || "Failed to get upload URL");
      const { uploadUrl, key } = presignData;

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onload  = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "image/jpeg");
        xhr.send(file);
      });

      const completeRes = await fetch("/api/admin/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseId:   relStub.id,
          key,
          assetType:   "cover",
          releaseType: detail.release.release_type,
          slug:        detail.release.slug,
        }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error || "Complete failed");

      setCoverPreview(URL.createObjectURL(file));
      setCoverState({ status: "ready", error: null });
      setSaveMsg("Cover updated");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setCoverState({ status: "error", error: err.message });
    }
  }, [detail, relStub?.id]);

  const pickCover = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
    input.onchange = (e) => { if (e.target.files?.[0]) uploadCover(e.target.files[0]); };
    input.click();
  };

  // ── Audio replace ──────────────────────────────────────────────────────────────
  const startAudioReplace = (track) => {
    setAudioReplacing(track);
    setAudioPhase("select");
    setAudioNewKey(null);
    setAudioError("");
    setAudioProgress(0);
  };

  const pickAndUploadAudio = useCallback(async (file) => {
    if (!file || !audioReplacing || !detail) return;
    setAudioPhase("uploading");
    setAudioProgress(0);

    const isMultiTrack = ["album", "ep", "mixtape"].includes(detail.release.release_type);
    const trackSlug    = isMultiTrack ? audioReplacing.slug : null;

    try {
      const presignRes = await fetch("/api/admin/upload/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseType: detail.release.release_type,
          slug:        detail.release.slug,
          trackSlug,
          assetType:   "audio",
          filename:    file.name,
          contentType: file.type || "audio/wav",
          size:        file.size,
          releaseId:   relStub.id,
        }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || "Failed to get upload URL");
      const { uploadUrl, key } = presignData;

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        audioXhrRef.current = xhr;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setAudioProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload  = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.open("PUT", uploadUrl);
        xhr.send(file);
      });

      setAudioNewKey(key);
      setAudioPhase("confirming");
    } catch (err) {
      setAudioError(err.message);
      setAudioPhase("error");
    }
  }, [audioReplacing, detail, relStub?.id]);

  const confirmAudioReplace = async () => {
    setAudioPhase("uploading");
    try {
      const res = await fetch(`/api/admin/releases/${relStub.id}/replace-master`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: audioNewKey, track_id: audioReplacing?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Replace master failed");
      setAudioPhase("done");
      onSaved();
    } catch (err) {
      setAudioError(err.message);
      setAudioPhase("error");
    }
  };

  const cancelAudioReplace = () => {
    setAudioReplacing(null);
    setAudioPhase("select");
  };

  // ── Render ─────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        Loading…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={{ padding: "40px 0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <button onClick={onBack} style={backBtnStyle}>← Back</button>
        <div style={{ color: C.error, fontSize: 13, marginTop: 16 }}>{error || "Failed to load release"}</div>
      </div>
    );
  }

  const sections = ["metadata", "cover", "audio", "lyrics"];

  return (
    <div style={{ padding: "28px 0 80px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <button onClick={onBack} style={backBtnStyle}>← All Releases</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>
            {detail.product?.title || detail.release.slug}
          </h2>
          <StatusBadge status={detail.release.status} />
          <span style={{ fontSize: 12, color: C.muted2 }}>{TYPE_LABELS[detail.release.release_type]}</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted2, marginTop: 4 }}>/{detail.release.slug}</div>
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
        {sections.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            style={{
              background: section === s ? C.accentDim : C.surface2,
              border: `1px solid ${section === s ? C.accentBorder : C.border}`,
              borderRadius: 7, padding: "8px 16px", fontSize: 12, fontWeight: 700,
              color: section === s ? C.accent : C.muted, cursor: "pointer",
              textTransform: "capitalize", letterSpacing: "0.05em", fontFamily: "inherit",
            }}
          >
            {s === "metadata" ? "Info" : s === "cover" ? "Cover Art" : s === "audio" ? "Audio" : "Lyrics"}
          </button>
        ))}
      </div>

      {/* Global save message */}
      {saveMsg && (
        <div style={{
          background: saveMsg.startsWith("Error") ? "rgba(255,69,58,0.08)" : "rgba(50,215,75,0.08)",
          border: `1px solid ${saveMsg.startsWith("Error") ? "rgba(255,69,58,0.3)" : "rgba(50,215,75,0.3)"}`,
          borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13,
          color: saveMsg.startsWith("Error") ? C.error : C.success,
        }}>
          {saveMsg}
        </div>
      )}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "28px" }}>

        {/* ── INFO / METADATA ── */}
        {section === "metadata" && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 20, marginTop: 0 }}>Release Info</h3>
            <Field label="Title">
              <Inp value={editTitle} onChange={setEditTitle} placeholder="Release title" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Price (USD)">
                <Inp type="number" value={editPrice} onChange={setEditPrice} placeholder="2.99" />
              </Field>
              <Field label="Genre">
                <Sel value={editGenre} onChange={setEditGenre}>
                  <option value="">Select genre…</option>
                  {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </Sel>
              </Field>
            </div>
            <Field label="Original Release Date">
              <Inp type="date" value={editDate} onChange={setEditDate} />
            </Field>
            <div style={{ marginTop: 8 }}>
              <Btn onClick={saveMetadata} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Btn>
            </div>
          </div>
        )}

        {/* ── COVER ART ── */}
        {section === "cover" && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 8, marginTop: 0 }}>Cover Art</h3>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>
              Upload a replacement cover — JPG, PNG, or WEBP, square recommended. Replaces the existing cover immediately.
            </p>

            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
              {/* Preview box */}
              <div
                onClick={coverState.status !== "uploading" ? pickCover : undefined}
                style={{
                  width: 160, height: 160, flexShrink: 0, borderRadius: 12,
                  background: C.surface2,
                  border: `2px dashed ${coverState.status === "ready" ? C.success : coverState.status === "error" ? C.error : C.border2}`,
                  cursor: coverState.status !== "uploading" ? "pointer" : "default",
                  overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {coverPreview ? (
                  <img src={coverPreview} alt="cover preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ textAlign: "center", padding: 16 }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🖼</div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      {coverState.status === "uploading" ? "Uploading…" : "Tap to upload"}
                    </div>
                    {detail.release.cover_art_r2_key && (
                      <div style={{ fontSize: 10, color: C.muted2, marginTop: 6, wordBreak: "break-all" }}>
                        {detail.release.cover_art_r2_key}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <Btn onClick={pickCover} variant="secondary" disabled={coverState.status === "uploading"}>
                  {coverState.status === "ready" ? "✓ Uploaded — Replace Again" : coverState.status === "uploading" ? "Uploading…" : "Choose New Cover"}
                </Btn>
                {coverState.status === "ready" && (
                  <div style={{ fontSize: 12, color: C.success, marginTop: 8 }}>Cover updated successfully</div>
                )}
                {coverState.status === "error" && (
                  <div style={{ fontSize: 12, color: C.error, marginTop: 8 }}>{coverState.error}</div>
                )}
                <div style={{ fontSize: 12, color: C.muted2, marginTop: 12 }}>
                  Max 20 MB · square preferred
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── AUDIO ── */}
        {section === "audio" && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 8, marginTop: 0 }}>Replace Master Audio</h3>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>
              Upload a new master WAV / FLAC / AIFF. The old master is archived. HLS transcoding re-queues automatically.
            </p>

            {detail.tracks.length === 0 && (
              <div style={{ color: C.muted2, fontSize: 13 }}>No tracks found for this release.</div>
            )}

            {detail.tracks.map((track) => (
              <div key={track.id} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                      {detail.tracks.length > 1 ? `${track.position}. ` : ""}{track.title || track.slug}
                    </div>
                    <div style={{ fontSize: 11, color: track.has_audio ? C.success : C.muted2, marginTop: 3 }}>
                      {track.has_audio ? "✓ Audio on file" : "No audio"}
                    </div>
                  </div>
                  {audioReplacing?.id !== track.id && (
                    <button
                      onClick={() => startAudioReplace(track)}
                      style={{
                        background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 7,
                        padding: "8px 14px", fontSize: 11, color: C.muted, cursor: "pointer",
                        fontFamily: "inherit", fontWeight: 700,
                      }}
                    >
                      Replace Master
                    </button>
                  )}
                </div>

                {/* Inline replace flow for this track */}
                {audioReplacing?.id === track.id && (
                  <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                    {audioPhase === "select" && (
                      <div>
                        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
                          Select new master. Old key will be archived in history.
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.accept = ".wav,.flac,.aiff,.aif,audio/wav,audio/flac,audio/aiff";
                              input.onchange = (e) => { if (e.target.files?.[0]) pickAndUploadAudio(e.target.files[0]); };
                              input.click();
                            }}
                            style={{ background: C.accent, border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12, fontWeight: 700, color: "#000", cursor: "pointer", fontFamily: "inherit" }}
                          >
                            Select File
                          </button>
                          <button onClick={cancelAudioReplace} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontSize: 12, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {audioPhase === "uploading" && (
                      <div>
                        <div style={{ fontSize: 12, color: C.accent, fontWeight: 700, marginBottom: 8 }}>
                          {audioNewKey ? "Replacing…" : `Uploading… ${audioProgress}%`}
                        </div>
                        {!audioNewKey && (
                          <div style={{ background: C.surface, borderRadius: 4, height: 5, overflow: "hidden" }}>
                            <div style={{ background: C.accent, width: `${audioProgress}%`, height: "100%", transition: "width 0.2s" }} />
                          </div>
                        )}
                      </div>
                    )}
                    {audioPhase === "confirming" && (
                      <div>
                        <div style={{ background: "rgba(255,159,10,0.08)", border: `1px solid rgba(255,159,10,0.3)`, borderRadius: 8, padding: "12px 14px", marginBottom: 12, fontSize: 12, color: C.warn }}>
                          This replaces the current master and re-queues HLS transcoding. Continue?
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={confirmAudioReplace} style={{ background: C.warn, border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12, fontWeight: 700, color: "#000", cursor: "pointer", fontFamily: "inherit" }}>Replace Now</button>
                          <button onClick={() => { setAudioPhase("select"); setAudioNewKey(null); }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontSize: 12, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {audioPhase === "done" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 14 }}>✅</span>
                        <span style={{ fontSize: 12, color: C.success, fontWeight: 700 }}>Master replaced. HLS re-queued.</span>
                        <button onClick={cancelAudioReplace} style={{ background: "none", border: "none", color: C.muted2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Close</button>
                      </div>
                    )}
                    {audioPhase === "error" && (
                      <div>
                        <div style={{ fontSize: 12, color: C.error, marginBottom: 8 }}>{audioError}</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => { setAudioPhase("select"); setAudioError(""); }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}>Try Again</button>
                          <button onClick={cancelAudioReplace} style={{ background: "none", border: "none", color: C.muted2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── LYRICS ── */}
        {section === "lyrics" && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 8, marginTop: 0 }}>Lyrics</h3>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
              Stored internally — not displayed on the fan site. Preserves verse/chorus structure.
            </p>

            {detail.tracks.length === 0 && (
              <div style={{ color: C.muted2, fontSize: 13 }}>No tracks found for this release.</div>
            )}

            {detail.tracks.map((track) => (
              <div key={track.id} style={{ marginBottom: 20 }}>
                {detail.tracks.length > 1 && (
                  <Label>{track.position}. {track.title || track.slug}</Label>
                )}
                <textarea
                  value={trackLyrics[track.id] || ""}
                  onChange={(e) => setTrackLyrics((prev) => ({ ...prev, [track.id]: e.target.value }))}
                  placeholder={"[Verse 1]\n...\n\n[Chorus]\n..."}
                  rows={detail.tracks.length > 1 ? 8 : 14}
                  style={{
                    width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
                    borderRadius: 8, color: C.text, fontSize: 13, padding: "12px 14px",
                    outline: "none", boxSizing: "border-box", fontFamily: "inherit",
                    resize: "vertical", lineHeight: 1.7,
                  }}
                />
              </div>
            ))}

            {detail.tracks.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <Btn onClick={saveLyrics} disabled={saving}>{saving ? "Saving…" : "Save Lyrics"}</Btn>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const backBtnStyle = {
  background: "none", border: "none", color: C.muted2, fontSize: 11, cursor: "pointer",
  padding: 0, fontFamily: "inherit", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase",
};

// ── Root component ────────────────────────────────────────────────────────────────
// Rendered inline in the "manage-releases" tab within HomeClient.
// Auth is already confirmed by the AuthSurfaceIsland wrapper in HomeClient,
// but we double-check here for safety.
export default function InlineReleasesManager() {
  const { isAdmin } = useAuth();

  const [view,         setView]         = useState("list");     // "list" | "upload" | "edit"
  const [releases,     setReleases]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [filter,       setFilter]       = useState("all");
  const [editingRelease, setEditingRelease] = useState(null);
  const [lastResult,   setLastResult]   = useState(null);

  const loadReleases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/admin/releases");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load releases");
      setReleases(json.releases || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadReleases();
  }, [isAdmin, loadReleases]);

  if (!isAdmin) return null;

  // ── Upload view ────────────────────────────────────────────────────────────────
  if (view === "upload") {
    return (
      <UploadWizard
        onComplete={(result) => {
          setLastResult(result);
          loadReleases();
          setView("list");
        }}
        onDismiss={() => setView("list")}
      />
    );
  }

  // ── Edit view ──────────────────────────────────────────────────────────────────
  if (view === "edit" && editingRelease) {
    return (
      <ReleaseEditorPanel
        release={editingRelease}
        onBack={() => setView("list")}
        onSaved={() => loadReleases()}
      />
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────────
  return (
    <ReleaseListView
      releases={releases}
      loading={loading}
      error={error}
      filter={filter}
      onFilter={setFilter}
      onRefresh={loadReleases}
      onNew={() => { setLastResult(null); setView("upload"); }}
      onEdit={(rel) => { setEditingRelease(rel); setView("edit"); }}
      lastResult={lastResult}
    />
  );
}

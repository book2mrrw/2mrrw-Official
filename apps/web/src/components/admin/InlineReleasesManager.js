"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { catalogCoverUrl } from "@/lib/media-urls";
import { UploadWizard } from "@/components/admin/UploadWizard";
import { uploadAssetToR2 } from "@/lib/media/r2-upload-client";

// ── Design tokens ────────────────────────────────────────────────────────────────
const C = {
  bg:           "#050505",
  surface:      "#0d0d0d",
  surface2:     "#111",
  surface3:     "#161616",
  border:       "rgba(255,255,255,0.06)",
  border2:      "rgba(255,255,255,0.12)",
  accent:       "#00ffff",
  accentDim:    "rgba(0,255,255,0.07)",
  accentBorder: "rgba(0,255,255,0.22)",
  purple:       "#a259ff",
  text:         "#e8e8e8",
  muted:        "rgba(255,255,255,0.45)",
  muted2:       "rgba(255,255,255,0.28)",
  muted3:       "rgba(255,255,255,0.14)",
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

const SLUG_PREFIXES = {
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
  const styles = {
    primary:     { background: C.accent,      color: "#000", border: "none" },
    secondary:   { background: C.surface2,    color: C.text, border: `1px solid ${C.border2}` },
    danger:      { background: C.error,       color: "#fff", border: "none" },
    warn:        { background: C.warn,        color: "#000", border: "none" },
    ghost:       { background: "none",        color: C.muted, border: `1px solid ${C.border}` },
    accentGhost: { background: C.accentDim,   color: C.accent, border: `1px solid ${C.accentBorder}` },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        borderRadius: 8, padding: small ? "7px 14px" : "11px 22px",
        fontSize: small ? 11 : 13, fontWeight: 800, letterSpacing: "0.06em",
        textTransform: "uppercase", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, fontFamily: "inherit", transition: "opacity 0.15s",
        ...styles[variant],
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

function SaveMsg({ msg }) {
  if (!msg) return null;
  const isErr = msg.startsWith("Error") || msg.startsWith("Failed");
  return (
    <div style={{
      background: isErr ? "rgba(255,69,58,0.08)" : "rgba(50,215,75,0.08)",
      border: `1px solid ${isErr ? "rgba(255,69,58,0.3)" : "rgba(50,215,75,0.3)"}`,
      borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13,
      color: isErr ? C.error : C.success,
    }}>
      {msg}
    </div>
  );
}

function ProgressBar({ pct }) {
  return (
    <div style={{ background: C.surface, borderRadius: 4, height: 5, overflow: "hidden", marginTop: 8 }}>
      <div style={{ background: C.accent, width: `${pct}%`, height: "100%", transition: "width 0.2s" }} />
    </div>
  );
}

// ── Price options ─────────────────────────────────────────────────────────────────
const PRICE_OPTIONS = {
  single:  ["2.99", "5.99", "7.99", "14.99", "19.99"],
  feature: ["2.99", "5.99", "7.99", "14.99", "19.99"],
  album:   ["12.99", "15.99", "19.99", "29.99", "49.99", "79.99"],
  ep:      ["9.99", "15.99", "19.99", "49.99", "79.99"],
  mixtape: ["9.99", "15.99", "19.99", "49.99", "79.99"],
};

function PriceSelector({ releaseType, value, onChange }) {
  const options = PRICE_OPTIONS[releaseType] || PRICE_OPTIONS.single;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          style={{
            background: value === opt ? C.accentDim : C.surface2,
            border: `2px solid ${value === opt ? C.accent : C.border2}`,
            borderRadius: 8, padding: "9px 16px", cursor: "pointer",
            fontSize: 13, fontWeight: 700, color: value === opt ? C.accent : C.text,
            fontFamily: "inherit",
          }}
        >
          ${opt}
        </button>
      ))}
    </div>
  );
}

// ── Home Landing ─────────────────────────────────────────────────────────────────
function HomeLanding({ releaseCount, onUpload, onMyReleases }) {
  return (
    <div style={{ padding: "36px 0 80px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: C.accent, textTransform: "uppercase", marginBottom: 8 }}>Admin</div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: C.text, margin: 0, lineHeight: 1.1 }}>Manage Releases</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>Upload new music or manage your existing catalog.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, maxWidth: 680 }}>

        {/* Upload New Release */}
        <button
          onClick={onUpload}
          style={{
            background: "linear-gradient(135deg, rgba(0,255,255,0.10) 0%, rgba(0,255,255,0.03) 100%)",
            border: `1px solid ${C.accentBorder}`,
            borderRadius: 16, padding: "28px 24px", cursor: "pointer", textAlign: "left",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = "rgba(0,255,255,0.14)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.accentBorder; e.currentTarget.style.background = "linear-gradient(135deg, rgba(0,255,255,0.10) 0%, rgba(0,255,255,0.03) 100%)"; }}
        >
          <div style={{ fontSize: 30, marginBottom: 12 }}>＋</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.accent, marginBottom: 6 }}>Upload New Release</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            Single, Feature, Album, EP, or Mixtape — master audio, artwork, lyrics, credits.
          </div>
        </button>

        {/* My Releases */}
        <button
          onClick={onMyReleases}
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16, padding: "28px 24px", cursor: "pointer", textAlign: "left",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.background = C.surface2; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surface; }}
        >
          <div style={{ fontSize: 30, marginBottom: 12 }}>📂</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>My Releases</span>
            {releaseCount > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted2, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 8px" }}>
                {releaseCount}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            View all releases. Update cover art, audio, lyrics, metadata. Propagates to every page instantly.
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Release List View ────────────────────────────────────────────────────────────
function ReleaseListView({ releases, loading, error, filter, onFilter, onRefresh, onEdit, onNew, onBack, lastResult }) {
  const counts = {
    all:       releases.length,
    published: releases.filter((r) => r.status === "published").length,
    scheduled: releases.filter((r) => r.status === "scheduled").length,
    draft:     releases.filter((r) => r.status === "draft").length,
  };

  const filtered = filter === "all"
    ? releases
    : releases.filter((r) => r.status === filter);

  return (
    <div style={{ padding: "28px 0 80px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <button onClick={onBack} style={backBtnStyle}>← Manage Releases</button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0 }}>My Releases</h1>
          <Btn onClick={onNew} small>+ Upload New</Btn>
        </div>
      </div>

      {/* Last publish success */}
      {lastResult && (
        <div style={{ background: "rgba(50,215,75,0.08)", border: "1px solid rgba(50,215,75,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <span>🎉</span>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.success }}>
              {lastResult.status === "scheduled" ? "Release Scheduled!" : "Release is Live!"}
            </span>
            {lastResult.slug && (
              <span style={{ fontSize: 12, color: C.muted, marginLeft: 10 }}>{lastResult.slug}</span>
            )}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {["all", "published", "scheduled", "draft"].map((f) => (
          <button
            key={f}
            onClick={() => onFilter(f)}
            style={{
              background: filter === f ? C.accentDim : C.surface2,
              border: `1px solid ${filter === f ? C.accentBorder : C.border}`,
              borderRadius: 7, padding: "7px 13px", fontSize: 11, fontWeight: 700,
              color: filter === f ? C.accent : C.muted, cursor: "pointer",
              textTransform: "capitalize", letterSpacing: "0.05em", fontFamily: "inherit",
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
        <button
          onClick={onRefresh}
          style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 12px", fontSize: 11, color: C.muted2, cursor: "pointer", fontFamily: "inherit" }}
        >
          ↻
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.3)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: C.error }}>
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
            const coverSrc = rel.cover_art_r2_key ? catalogCoverUrl(rel.cover_art_r2_key) : null;
            const prefix   = SLUG_PREFIXES[rel.release_type] || "/song/";
            const isLive   = rel.status === "published" && rel.storefront_visible;
            const dateStr  = rel.release_date
              ? new Date(rel.release_date + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
              : rel.created_at
                ? new Date(rel.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short" })
                : "—";

            return (
              <div
                key={rel.id}
                style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 12, padding: "14px 18px",
                  display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                }}
              >
                {/* Cover thumbnail */}
                <div style={{
                  width: 56, height: 56, borderRadius: 8, flexShrink: 0,
                  background: C.surface2, overflow: "hidden",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1px solid ${C.border}`,
                }}>
                  {coverSrc
                    ? <img src={coverSrc} alt={rel.title || rel.slug} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 20 }}>🎵</span>
                  }
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                      {rel.title || <span style={{ color: C.muted2, fontStyle: "italic" }}>Untitled</span>}
                    </div>
                    <StatusBadge status={rel.status} />
                  </div>
                  <div style={{ fontSize: 11, color: C.muted2 }}>
                    {TYPE_LABELS[rel.release_type] || rel.release_type} · {dateStr}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted3, marginTop: 2 }}>
                    {rel.track_counts?.ready ?? "?"}/{rel.track_counts?.total ?? "?"} tracks ready
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                  {isLive && rel.slug && (
                    <a
                      href={prefix + rel.slug}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        background: C.accentDim, border: `1px solid ${C.accentBorder}`,
                        borderRadius: 7, padding: "6px 12px", fontSize: 11, color: C.accent,
                        textDecoration: "none", fontWeight: 700, fontFamily: "inherit",
                      }}
                    >
                      View ↗
                    </a>
                  )}
                  <button
                    onClick={() => onEdit(rel)}
                    style={{
                      background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 7,
                      padding: "6px 14px", fontSize: 11, color: C.muted, cursor: "pointer",
                      fontFamily: "inherit", fontWeight: 700,
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
function ReleaseEditorPanel({ release: relStub, onBack, onSaved }) {
  const [detail,     setDetail]     = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(null);
  const [section,    setSection]    = useState("metadata");
  const [saving,     setSaving]     = useState(false);
  const [saveMsg,    setSaveMsg]    = useState(null);

  // Metadata form state
  const [editTitle,  setEditTitle]  = useState("");
  const [editPrice,  setEditPrice]  = useState("");
  const [editGenre,  setEditGenre]  = useState("");
  const [editDate,   setEditDate]   = useState("");

  // Lyrics (keyed by track id)
  const [trackLyrics, setTrackLyrics] = useState({});

  // Static cover upload state
  const [coverState,   setCoverState]   = useState({ status: "idle", error: null, pct: 0 });
  const [coverPreview, setCoverPreview] = useState(null);

  // Animated cover (MP4) upload state
  const [mp4State,   setMp4State]   = useState({ status: "idle", error: null, pct: 0 });
  const [mp4Preview, setMp4Preview] = useState(null);

  // Audio replace state
  const [audioReplacing,  setAudioReplacing]  = useState(null);
  const [audioPhase,      setAudioPhase]      = useState("idle"); // idle | uploading | confirming | done | error
  const [audioProgress,   setAudioProgress]   = useState(0);
  const [audioNewKey,     setAudioNewKey]     = useState(null);
  const [audioError,      setAudioError]      = useState("");
  const audioXhrRef = useRef(null);

  const GENRES = ["R&B","Hip-Hop","Pop","Alternative R&B","Soul","Neo-Soul","Trap","Rap","Melodic Rap","Pop/R&B","Hiphop/R&B","Electronic","Other"];

  // ── Load release detail ────────────────────────────────────────────────────────
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
        const lMap = {};
        for (const t of (d.tracks || [])) lMap[t.id] = t.lyrics || "";
        setTrackLyrics(lMap);
        // Seed cover preview from stub
        if (relStub.cover_art_r2_key) setCoverPreview(catalogCoverUrl(relStub.cover_art_r2_key));
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [relStub?.id, relStub?.cover_art_r2_key]);

  const showMsg = useCallback((msg) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 3500);
  }, []);

  // ── Metadata save ─────────────────────────────────────────────────────────────
  const saveMetadata = async () => {
    setSaving(true);
    try {
      const res  = await fetch(`/api/admin/releases/${relStub.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title: editTitle, price: editPrice, genre: editGenre, release_date: editDate }),
      });
      const json = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(json.errors?.[0] || "Save failed");
      showMsg("Saved — changes live on storefront");
      onSaved();
    } catch (err) {
      showMsg("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Lyrics save ───────────────────────────────────────────────────────────────
  const saveLyrics = async () => {
    setSaving(true);
    try {
      const track_lyrics = Object.entries(trackLyrics).map(([id, lyrics]) => ({ id, lyrics }));
      const res  = await fetch(`/api/admin/releases/${relStub.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ track_lyrics }),
      });
      const json = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(json.errors?.[0] || "Save failed");
      showMsg("Lyrics saved");
    } catch (err) {
      showMsg("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Generic asset upload (cover JPEG or cover MP4) ────────────────────────────
  // presigned → XHR PUT with progress → complete → revalidation fires server-side
  const uploadAsset = useCallback(async ({ file, assetType, setState, setPreview }) => {
    if (!file || !detail) return;
    setState({ status: "uploading", error: null, pct: 0 });
    setPreview(URL.createObjectURL(file));

    try {
      // 1-2. Presign + XHR PUT to R2, with progress tracking
      const { key } = await uploadAssetToR2({
        releaseType: detail.release.release_type,
        slug:        detail.release.slug,
        assetType,
        file,
        onProgress:  (pct) => setState((s) => ({ ...s, pct })),
      });

      // 3. Complete — writes to DB; server-side revalidatePath fires automatically
      const completeRes  = await fetch("/api/admin/upload/complete", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          releaseId:   relStub.id,
          key,
          assetType,
          releaseType: detail.release.release_type,
          slug:        detail.release.slug,
        }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error || "Upload complete failed");

      setState({ status: "done", error: null, pct: 100 });
      showMsg(`${assetType === "cover" ? "Cover" : "Animated cover"} updated — live on storefront`);
      onSaved();
    } catch (err) {
      setPreview(null);
      setState({ status: "error", error: err.message, pct: 0 });
    }
  }, [detail, relStub, showMsg, onSaved]);

  const pickFile = (accept, handler) => {
    const inp    = document.createElement("input");
    inp.type     = "file";
    inp.accept   = accept;
    inp.onchange = (e) => { if (e.target.files?.[0]) handler(e.target.files[0]); };
    inp.click();
  };

  // ── Audio replace ─────────────────────────────────────────────────────────────
  const startAudioReplace = (track) => {
    setAudioReplacing(track);
    setAudioPhase("idle");
    setAudioNewKey(null);
    setAudioError("");
    setAudioProgress(0);
  };

  const uploadAudio = useCallback(async (file) => {
    if (!file || !audioReplacing || !detail) return;
    setAudioPhase("uploading");
    setAudioProgress(0);
    const isMulti   = ["album","ep","mixtape"].includes(detail.release.release_type);
    const trackSlug = isMulti ? audioReplacing.slug : null;

    try {
      const { key } = await uploadAssetToR2({
        releaseType: detail.release.release_type,
        slug:        detail.release.slug,
        trackSlug,
        assetType:   "audio",
        file,
        releaseId:   relStub.id,
        onProgress:  setAudioProgress,
        xhrRef:      audioXhrRef,
      });

      setAudioNewKey(key);
      setAudioPhase("confirming");
    } catch (err) {
      setAudioError(err.message);
      setAudioPhase("error");
    }
  }, [audioReplacing, detail, relStub]);

  const confirmAudioReplace = async () => {
    setAudioPhase("uploading");
    try {
      const res  = await fetch(`/api/admin/releases/${relStub.id}/replace-master`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ key: audioNewKey, track_id: audioReplacing?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Replace master failed");
      setAudioPhase("done");
      showMsg("Master replaced — HLS re-queued, playback cache cleared");
      onSaved();
    } catch (err) {
      setAudioError(err.message);
      setAudioPhase("error");
    }
  };

  const cancelAudioReplace = () => { setAudioReplacing(null); setAudioPhase("idle"); };

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        Loading release…
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div style={{ padding: "40px 0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <button onClick={onBack} style={backBtnStyle}>← My Releases</button>
        <div style={{ color: C.error, fontSize: 13, marginTop: 16 }}>{loadError || "Failed to load release"}</div>
      </div>
    );
  }

  const sectionDefs = [
    { id: "metadata", label: "Info" },
    { id: "cover",    label: "Cover Art" },
    { id: "audio",    label: "Audio" },
    { id: "lyrics",   label: "Lyrics" },
  ];

  return (
    <div style={{ padding: "28px 0 80px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

      {/* Header with inline cover art thumbnail */}
      <div style={{ marginBottom: 22 }}>
        <button onClick={onBack} style={backBtnStyle}>← My Releases</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
          <div style={{
            width: 60, height: 60, borderRadius: 10, overflow: "hidden", flexShrink: 0,
            background: C.surface2, border: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {coverPreview
              ? <img src={coverPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ fontSize: 24 }}>🎵</span>
            }
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, color: C.text, margin: 0 }}>
                {detail.product?.title || detail.release.slug}
              </h2>
              <StatusBadge status={detail.release.status} />
              <span style={{ fontSize: 11, color: C.muted2 }}>{TYPE_LABELS[detail.release.release_type]}</span>
            </div>
            <div style={{ fontSize: 11, color: C.muted3, marginTop: 3 }}>/{detail.release.slug}</div>
          </div>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {sectionDefs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            style={{
              background: section === id ? C.accentDim : C.surface2,
              border: `1px solid ${section === id ? C.accentBorder : C.border}`,
              borderRadius: 7, padding: "8px 16px", fontSize: 12, fontWeight: 700,
              color: section === id ? C.accent : C.muted, cursor: "pointer",
              fontFamily: "inherit", letterSpacing: "0.05em",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <SaveMsg msg={saveMsg} />

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "28px" }}>

        {/* ── INFO ── */}
        {section === "metadata" && (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 20, marginTop: 0 }}>Release Info</h3>
            <Field label="Title">
              <Inp value={editTitle} onChange={setEditTitle} placeholder="Release title" />
            </Field>
            <Field label="Price (USD)">
              <PriceSelector
                releaseType={detail?.release?.release_type}
                value={editPrice}
                onChange={setEditPrice}
              />
            </Field>
            <Field label="Genre">
              <Sel value={editGenre} onChange={setEditGenre}>
                <option value="">Select…</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </Sel>
            </Field>
            <Field label="Original Release Date">
              <Inp type="date" value={editDate} onChange={setEditDate} />
            </Field>
            <Btn onClick={saveMetadata} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Btn>
          </div>
        )}

        {/* ── COVER ART ── */}
        {section === "cover" && (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 6, marginTop: 0 }}>Cover Art</h3>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 26 }}>
              Changes propagate to every page, every carousel, and every player immediately on save.
            </p>

            {/* Static cover */}
            <div style={{ marginBottom: 32 }}>
              <Label>Static Cover · JPEG / PNG / WEBP</Label>
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div
                  onClick={coverState.status !== "uploading" ? () => pickFile("image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp", (f) => uploadAsset({ file: f, assetType: "cover", setState: setCoverState, setPreview: setCoverPreview })) : undefined}
                  style={{
                    width: 120, height: 120, flexShrink: 0, borderRadius: 12,
                    background: C.surface2,
                    border: `2px dashed ${coverState.status === "done" ? C.success : coverState.status === "error" ? C.error : C.border2}`,
                    cursor: coverState.status !== "uploading" ? "pointer" : "default",
                    overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {coverPreview
                    ? <img src={coverPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ textAlign: "center", padding: 12 }}>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>🖼</div>
                        <div style={{ fontSize: 10, color: C.muted }}>
                          {coverState.status === "uploading" ? `${coverState.pct}%` : "Tap to upload"}
                        </div>
                      </div>
                  }
                </div>
                <div>
                  <Btn
                    variant="secondary" small
                    disabled={coverState.status === "uploading"}
                    onClick={() => pickFile("image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp", (f) => uploadAsset({ file: f, assetType: "cover", setState: setCoverState, setPreview: setCoverPreview }))}
                  >
                    {coverState.status === "uploading" ? `Uploading ${coverState.pct}%…` : coverState.status === "done" ? "✓ Replace Again" : "Choose Image"}
                  </Btn>
                  {coverState.status === "uploading" && <ProgressBar pct={coverState.pct} />}
                  {coverState.status === "error" && <div style={{ fontSize: 11, color: C.error, marginTop: 6 }}>{coverState.error}</div>}
                  {coverState.status === "done" && <div style={{ fontSize: 11, color: C.success, marginTop: 6 }}>Updated on all surfaces</div>}
                  <div style={{ fontSize: 11, color: C.muted2, marginTop: 8 }}>Square recommended · Max 20 MB</div>
                </div>
              </div>
            </div>

            {/* Animated cover MP4 */}
            <div>
              <Label>Animated Cover Loop · MP4</Label>
              <p style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
                Shown in the catalog grid, carousels, and immersive player on motion-enabled surfaces. Stored as a short silent loop (max 500 MB).
              </p>
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{
                  width: 120, height: 120, flexShrink: 0, borderRadius: 12,
                  background: C.surface2,
                  border: `2px dashed ${mp4State.status === "done" ? C.success : mp4State.status === "error" ? C.error : C.border2}`,
                  overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {mp4Preview
                    ? <video src={mp4Preview} autoPlay loop muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ textAlign: "center", padding: 12 }}>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>🎬</div>
                        <div style={{ fontSize: 10, color: C.muted }}>
                          {mp4State.status === "uploading" ? `${mp4State.pct}%` : "No animated cover"}
                        </div>
                      </div>
                  }
                </div>
                <div>
                  <Btn
                    variant="secondary" small
                    disabled={mp4State.status === "uploading"}
                    onClick={() => pickFile("video/mp4,.mp4", (f) => uploadAsset({ file: f, assetType: "cover-mp4", setState: setMp4State, setPreview: setMp4Preview }))}
                  >
                    {mp4State.status === "uploading" ? `Uploading ${mp4State.pct}%…` : mp4State.status === "done" ? "✓ Replace MP4" : "Upload MP4 Loop"}
                  </Btn>
                  {mp4State.status === "uploading" && <ProgressBar pct={mp4State.pct} />}
                  {mp4State.status === "error" && <div style={{ fontSize: 11, color: C.error, marginTop: 6 }}>{mp4State.error}</div>}
                  {mp4State.status === "done" && <div style={{ fontSize: 11, color: C.success, marginTop: 6 }}>Live on motion surfaces</div>}
                  <div style={{ fontSize: 11, color: C.muted2, marginTop: 8 }}>Silent loop · Max 500 MB</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── AUDIO ── */}
        {section === "audio" && (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 6, marginTop: 0 }}>Replace Master Audio</h3>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
              Upload WAV / FLAC / AIFF. Old master archived (up to 10 generations). HLS re-queues automatically. Playback cache clears immediately.
            </p>

            {detail.tracks.length === 0 && (
              <div style={{ color: C.muted2, fontSize: 13 }}>No tracks found for this release.</div>
            )}

            {detail.tracks.map((track) => (
              <div key={track.id} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                      {detail.tracks.length > 1 ? `${track.position}. ` : ""}{track.title || track.slug}
                    </div>
                    <div style={{ fontSize: 11, color: track.has_audio ? C.success : C.muted2, marginTop: 2 }}>
                      {track.has_audio ? "✓ Audio on file" : "No audio yet"}
                      {track.upload_status && track.upload_status !== "ready" ? ` · ${track.upload_status}` : ""}
                    </div>
                  </div>
                  {audioReplacing?.id !== track.id && (
                    <button
                      onClick={() => startAudioReplace(track)}
                      style={{ background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "7px 14px", fontSize: 11, color: C.muted, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}
                    >
                      Replace Master
                    </button>
                  )}
                </div>

                {/* Inline replace flow for this track */}
                {audioReplacing?.id === track.id && (
                  <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                    {audioPhase === "idle" && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={() => pickFile(".wav,.flac,.aiff,.aif,audio/wav,audio/flac,audio/aiff", uploadAudio)}
                          style={{ background: C.accent, border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12, fontWeight: 700, color: "#000", cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Select New Master
                        </button>
                        <button onClick={cancelAudioReplace} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontSize: 12, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                      </div>
                    )}
                    {audioPhase === "uploading" && (
                      <div>
                        <div style={{ fontSize: 12, color: C.accent, fontWeight: 700 }}>
                          {audioNewKey ? "Replacing…" : `Uploading… ${audioProgress}%`}
                        </div>
                        {!audioNewKey && <ProgressBar pct={audioProgress} />}
                      </div>
                    )}
                    {audioPhase === "confirming" && (
                      <div>
                        <div style={{ background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: C.warn }}>
                          Upload complete. Replace current master and re-queue HLS? Old master archived.
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={confirmAudioReplace} style={{ background: C.warn, border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12, fontWeight: 700, color: "#000", cursor: "pointer", fontFamily: "inherit" }}>Yes, Replace Now</button>
                          <button onClick={() => { setAudioPhase("idle"); setAudioNewKey(null); }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontSize: 12, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {audioPhase === "done" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span>✅</span>
                        <span style={{ fontSize: 12, color: C.success, fontWeight: 700 }}>Master replaced — HLS re-queued, cache cleared</span>
                        <button onClick={cancelAudioReplace} style={{ background: "none", border: "none", color: C.muted2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
                      </div>
                    )}
                    {audioPhase === "error" && (
                      <div>
                        <div style={{ fontSize: 12, color: C.error, marginBottom: 8 }}>{audioError}</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => { setAudioPhase("idle"); setAudioError(""); }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}>Try Again</button>
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
            <h3 style={{ fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 6, marginTop: 0 }}>Lyrics</h3>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>Preserves verse/chorus structure.</p>

            {detail.tracks.length === 0 && (
              <div style={{ color: C.muted2, fontSize: 13 }}>No tracks found.</div>
            )}

            {detail.tracks.map((track) => (
              <div key={track.id} style={{ marginBottom: 20 }}>
                {detail.tracks.length > 1 && <Label>{track.position}. {track.title || track.slug}</Label>}
                <textarea
                  value={trackLyrics[track.id] || ""}
                  onChange={(e) => setTrackLyrics((p) => ({ ...p, [track.id]: e.target.value }))}
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
              <Btn onClick={saveLyrics} disabled={saving}>{saving ? "Saving…" : "Save Lyrics"}</Btn>
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
// View state machine: "home" ⟶ "upload" or "list" ⟶ "edit"
// Auth is gated by AuthSurfaceIsland in HomeClient; double-checked here via useAuth().
export default function InlineReleasesManager() {
  const { isAdmin } = useAuth();

  const [view,           setView]           = useState("home"); // "home" | "upload" | "list" | "edit"
  const [releases,       setReleases]       = useState([]);
  const [releasesLoaded, setReleasesLoaded] = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [loadError,      setLoadError]      = useState(null);
  const [filter,         setFilter]         = useState("all");
  const [editingRelease, setEditingRelease] = useState(null);
  const [lastResult,     setLastResult]     = useState(null);

  const loadReleases = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res  = await fetch("/api/admin/releases");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load releases");
      setReleases(json.releases || []);
      setReleasesLoaded(true);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

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
        onDismiss={() => setView(releasesLoaded ? "list" : "home")}
      />
    );
  }

  // ── Edit view ──────────────────────────────────────────────────────────────────
  if (view === "edit" && editingRelease) {
    return (
      <ReleaseEditorPanel
        release={editingRelease}
        onBack={() => setView("list")}
        onSaved={loadReleases}
      />
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <ReleaseListView
        releases={releases}
        loading={loading}
        error={loadError}
        filter={filter}
        onFilter={setFilter}
        onRefresh={loadReleases}
        onNew={() => setView("upload")}
        onBack={() => setView("home")}
        onEdit={(rel) => { setEditingRelease(rel); setView("edit"); }}
        lastResult={lastResult}
      />
    );
  }

  // ── Home landing ───────────────────────────────────────────────────────────────
  return (
    <HomeLanding
      releaseCount={releases.length}
      onUpload={() => setView("upload")}
      onMyReleases={() => {
        if (!releasesLoaded) loadReleases();
        setView("list");
      }}
    />
  );
}

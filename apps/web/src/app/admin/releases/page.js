"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { uploadAssetToR2 } from "@/lib/media/r2-upload-client";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "book2mrrw@gmail.com").toLowerCase();
function isAdmin(session) {
  return (session?.user?.email?.toLowerCase() || "") === ADMIN_EMAIL;
}

const C = {
  bg:           "#050505",
  surface:      "#0d0d0d",
  surface2:     "#121212",
  border:       "rgba(255,255,255,0.06)",
  border2:      "rgba(255,255,255,0.12)",
  accent:       "#00ffff",
  accentDim:    "rgba(0,255,255,0.07)",
  accentBorder: "rgba(0,255,255,0.20)",
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

// ── Replace Master Modal ───────────────────────────────────────────────────────
function ReplaceMasterModal({ release, onClose }) {
  const [phase, setPhase] = useState("select"); // select | uploading | confirming | done | error
  const [progress, setProgress] = useState(0);
  const [newKey, setNewKey] = useState(null);
  const [filename, setFilename] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [trackId, setTrackId] = useState(null);
  const [tracks, setTracks] = useState([]);
  const xhrRef = useRef(null);

  // Load tracks for multi-track releases
  useEffect(() => {
    if (!release) return;
    fetch(`/api/admin/releases/${release.id}/status`)
      .then((r) => r.json())
      .then((d) => {
        setTracks(d.tracks || []);
        if (d.tracks?.length === 1) setTrackId(d.tracks[0].id);
      })
      .catch(() => {});
  }, [release]);

  const isMultiTrack = ["album", "ep", "mixtape"].includes(release?.release_type);

  const pickAndUpload = async (file) => {
    if (!file) return;
    setPhase("uploading");
    setProgress(0);
    setFilename(file.name);

    try {
      const trackSlug = isMultiTrack && trackId ? (tracks.find((t) => t.id === trackId)?.slug || null) : null;
      const { key } = await uploadAssetToR2({
        releaseType: release.release_type,
        slug: release.slug,
        trackSlug,
        assetType: "audio",
        file,
        releaseId: release.id,
        onProgress: setProgress,
        xhrRef,
      });

      setNewKey(key);
      setPhase("confirming");
    } catch (err) {
      setErrMsg(err.message);
      setPhase("error");
    }
  };

  const confirmReplace = async () => {
    setPhase("uploading");
    try {
      const res = await fetch(`/api/admin/releases/${release.id}/replace-master`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newKey, track_id: trackId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Replace master failed");
      setPhase("done");
    } catch (err) {
      setErrMsg(err.message);
      setPhase("error");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 16,
        padding: "32px", width: "100%", maxWidth: 480,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>Replace Master Audio</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
          <strong style={{ color: C.text }}>{release?.title || release?.slug}</strong>
          {" · "}
          {TYPE_LABELS[release?.release_type] || release?.release_type}
        </div>

        {isMultiTrack && tracks.length > 1 && phase === "select" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Select Track</div>
            <select
              value={trackId || ""}
              onChange={(e) => setTrackId(e.target.value)}
              style={{ width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.text, fontSize: 14, padding: "10px 13px", outline: "none", fontFamily: "inherit" }}
            >
              <option value="">Choose a track…</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>{t.slug}</option>
              ))}
            </select>
          </div>
        )}

        {phase === "select" && (
          <>
            <div style={{ background: C.surface2, border: `2px dashed ${C.border2}`, borderRadius: 10, padding: "28px 20px", textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: C.muted }}>Upload new master WAV / FLAC / AIFF</div>
              <div style={{ fontSize: 11, color: C.muted2, marginTop: 4 }}>Max 2 GB. Old master will be archived in history.</div>
            </div>
            <button
              onClick={() => {
                if (isMultiTrack && !trackId && tracks.length > 1) { alert("Select a track first."); return; }
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".wav,.flac,.aiff,.aif,audio/wav,audio/flac,audio/aiff";
                input.onchange = (e) => { if (e.target.files?.[0]) pickAndUpload(e.target.files[0]); };
                input.click();
              }}
              style={{
                width: "100%", background: C.accent, border: "none", borderRadius: 9,
                padding: "13px 0", fontSize: 13, fontWeight: 700, color: "#000",
                cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
              }}
            >
              Select New Master
            </button>
          </>
        )}

        {phase === "uploading" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 13, color: C.accent, fontWeight: 700, marginBottom: 12 }}>
              {newKey ? "Confirming…" : `Uploading… ${progress}%`}
            </div>
            {!newKey && (
              <div style={{ background: C.surface2, borderRadius: 4, height: 6, overflow: "hidden" }}>
                <div style={{ background: C.accent, width: `${progress}%`, height: "100%", transition: "width 0.2s" }} />
              </div>
            )}
            {filename && <div style={{ fontSize: 11, color: C.muted2, marginTop: 8 }}>{filename}</div>}
          </div>
        )}

        {phase === "confirming" && (
          <div>
            <div style={{ background: "rgba(255,159,10,0.08)", border: `1px solid rgba(255,159,10,0.3)`, borderRadius: 8, padding: "14px 16px", marginBottom: 20, fontSize: 13, color: C.warn }}>
              This will replace the current master audio and re-queue HLS transcoding. The old master key will be archived in history. Continue?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setPhase("select"); setNewKey(null); }}
                style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 9, padding: "12px 0", fontSize: 13, color: C.text, cursor: "pointer", fontFamily: "inherit" }}
              >
                Cancel
              </button>
              <button
                onClick={confirmReplace}
                style={{ flex: 1, background: C.warn, border: "none", borderRadius: 9, padding: "12px 0", fontSize: 13, fontWeight: 700, color: "#000", cursor: "pointer", letterSpacing: "0.06em", fontFamily: "inherit" }}
              >
                Replace Master
              </button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.success, marginBottom: 6 }}>Master replaced successfully</div>
            <div style={{ fontSize: 12, color: C.muted }}>HLS transcoding has been re-queued. The new audio will be live once transcoding completes.</div>
            <button
              onClick={onClose}
              style={{ marginTop: 20, background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 9, padding: "10px 24px", fontSize: 13, color: C.text, cursor: "pointer", fontFamily: "inherit" }}
            >
              Close
            </button>
          </div>
        )}

        {phase === "error" && (
          <div>
            <div style={{ fontSize: 13, color: C.error, marginBottom: 16 }}>{errMsg || "Unknown error"}</div>
            <button
              onClick={() => { setPhase("select"); setNewKey(null); setErrMsg(""); }}
              style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 9, padding: "10px 20px", fontSize: 13, color: C.text, cursor: "pointer", fontFamily: "inherit" }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Replace Cover Modal ────────────────────────────────────────────────────────
function ReplaceCoverModal({ release, onClose }) {
  const [phase, setPhase] = useState("select");
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState("");

  const pickAndUpload = async (file) => {
    if (!file) return;
    setPhase("uploading");
    setProgress(0);

    try {
      const { key } = await uploadAssetToR2({
        releaseType: release.release_type,
        slug: release.slug,
        assetType: "cover",
        file,
        onProgress: setProgress,
      });

      const completeRes = await fetch("/api/admin/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId: release.id, key, assetType: "cover", releaseType: release.release_type, slug: release.slug }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error || "Cover update failed");

      setPhase("done");
    } catch (err) {
      setErrMsg(err.message);
      setPhase("error");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 16, padding: "32px", width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>Replace Cover Art</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
          <strong style={{ color: C.text }}>{release?.title || release?.slug}</strong>
          {" · "}
          {TYPE_LABELS[release?.release_type] || release?.release_type}
        </div>

        {phase === "select" && (
          <>
            <div style={{ background: C.surface2, border: `2px dashed ${C.border2}`, borderRadius: 10, padding: "28px 20px", textAlign: "center", marginBottom: 16, fontSize: 13, color: C.muted }}>
              JPG · PNG · WEBP — square recommended — max 20 MB
            </div>
            <button
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
                input.onchange = (e) => { if (e.target.files?.[0]) pickAndUpload(e.target.files[0]); };
                input.click();
              }}
              style={{ width: "100%", background: C.accent, border: "none", borderRadius: 9, padding: "13px 0", fontSize: 13, fontWeight: 700, color: "#000", cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit" }}
            >
              Select Cover Image
            </button>
          </>
        )}

        {phase === "uploading" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 13, color: C.accent, fontWeight: 700, marginBottom: 12 }}>Uploading… {progress}%</div>
            <div style={{ background: C.surface2, borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ background: C.accent, width: `${progress}%`, height: "100%", transition: "width 0.2s" }} />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.success, marginBottom: 6 }}>Cover art updated</div>
            <div style={{ fontSize: 12, color: C.muted }}>File saved to the canonical cover art folder.</div>
            <button onClick={onClose} style={{ marginTop: 20, background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 9, padding: "10px 24px", fontSize: 13, color: C.text, cursor: "pointer", fontFamily: "inherit" }}>Close</button>
          </div>
        )}

        {phase === "error" && (
          <div>
            <div style={{ fontSize: 13, color: C.error, marginBottom: 16 }}>{errMsg || "Unknown error"}</div>
            <button onClick={() => { setPhase("select"); setErrMsg(""); }} style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 9, padding: "10px 20px", fontSize: 13, color: C.text, cursor: "pointer", fontFamily: "inherit" }}>Try Again</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Swipe-to-Delete Row ────────────────────────────────────────────────────────
// Swipe left to reveal a delete zone. Haptic buzz fires exactly once at the
// threshold. Releasing past threshold commits the delete; before snaps back.
// touchAction:"pan-y" lets vertical scroll pass through normally.
function SwipeDeleteRow({ children, onDelete, showBorder }) {
  const [offsetX, setOffsetX]   = useState(0);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef      = useRef(null);
  const currentOffRef  = useRef(0);
  const buzzedRef      = useRef(false);
  const committedRef   = useRef(false);

  const THRESHOLD = 110; // px left-drag before delete commits

  const onTouchStart = (e) => {
    if (committedRef.current) return;
    startXRef.current = e.touches[0].clientX;
    buzzedRef.current = false;
    setDragging(true);
  };

  const onTouchMove = (e) => {
    if (startXRef.current === null || committedRef.current) return;
    const raw = e.touches[0].clientX - startXRef.current;
    if (raw > 6) { startXRef.current = null; setDragging(false); return; } // ignore right-swipe
    const abs = Math.abs(Math.min(raw, 0));
    // elastic resistance past threshold
    const clamped = abs <= THRESHOLD ? -abs : -(THRESHOLD + (abs - THRESHOLD) * 0.22);
    currentOffRef.current = clamped;
    setOffsetX(clamped);
    const p = Math.min(1, abs / THRESHOLD);
    setProgress(p);
    if (p >= 1 && !buzzedRef.current) {
      buzzedRef.current = true;
      try { navigator.vibrate?.([35, 12, 35]); } catch {}
    }
  };

  const onTouchEnd = () => {
    setDragging(false);
    startXRef.current = null;
    if (committedRef.current) return;
    if (currentOffRef.current <= -THRESHOLD) {
      committedRef.current = true;
      setOffsetX(-(typeof window !== "undefined" ? window.innerWidth : 600));
      setTimeout(onDelete, 320);
    } else {
      setOffsetX(0);
      setProgress(0);
    }
  };

  const atThreshold = progress >= 1;
  const showLabel   = progress > 0.25;

  return (
    <div style={{
      position: "relative",
      overflow: "hidden",
      borderBottom: showBorder ? `1px solid ${C.border}` : "none",
    }}>
      {/* Delete zone — fades in as content slides left */}
      <div style={{
        position: "absolute", inset: 0,
        background: `rgba(255,69,58,${Math.min(0.18, progress * 0.22)})`,
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        paddingRight: 22,
        pointerEvents: "none",
      }}>
        {showLabel && (
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: atThreshold ? C.error : `rgba(255,69,58,${0.35 + progress * 0.55})`,
            transition: dragging ? "none" : "color 0.15s",
          }}>
            {atThreshold ? "× DELETE" : "slide to delete"}
          </span>
        )}
      </div>
      {/* Sliding content */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: dragging ? "none" : "transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          background: C.surface,
          position: "relative", zIndex: 1,
          willChange: "transform",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AdminReleasesPage() {
  const router = useRouter();
  const [checked,  setChecked]  = useState(false);
  const [releases, setReleases] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [replacing, setReplacing] = useState(null); // release object for modal
  const [replacingCover, setReplacingCover] = useState(null); // release object for cover modal
  const [filter,   setFilter]   = useState("all");
  const [deleting, setDeleting] = useState(null); // slug being deleted (for loading state)

  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    sb.auth.getSession().then(({ data: d }) => {
      if (!isAdmin(d.session)) { router.replace("/"); return; }
      setChecked(true);
      loadReleases();
    });
  }, [router]);

  const loadReleases = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/releases");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setReleases(json.releases || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteRelease = async (rel, skipConfirm = false) => {
    if (!skipConfirm) {
      const isDraft = rel.status === "draft";
      const label = isDraft ? "Delete this draft?" : "Take down this release? It will be hidden from the storefront.";
      if (!window.confirm(label)) return;
    }
    setDeleting(rel.slug);
    try {
      const url = rel.source === "catalog"
        ? `/api/admin/releases/${rel.id}?source=catalog`
        : `/api/admin/releases/${rel.id}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      await loadReleases();
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const SLUG_PREFIX = {
    single:  "/song/",
    feature: "/feature/",
    album:   "/album/",
    ep:      "/album/",
    mixtape: "/album/",
  };

  const filtered = releases.filter((r) => {
    if (filter === "all")        return true;
    if (filter === "published")  return r.status === "published";
    if (filter === "scheduled")  return r.status === "scheduled";
    if (filter === "draft")      return r.status === "draft";
    return true;
  });

  if (!checked) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 28, height: 28, border: `2px solid rgba(0,255,255,0.2)`, borderTopColor: C.accent, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "40px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            <a href="/admin" style={{ fontSize: 11, color: C.muted2, textDecoration: "none", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase" }}>← Admin</a>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: "6px 0 0" }}>Manage Releases</h1>
          </div>
          <button
            onClick={() => router.push("/admin/upload")}
            style={{
              background: C.accent, border: "none", borderRadius: 9, padding: "11px 22px",
              fontSize: 13, fontWeight: 700, color: "#000", cursor: "pointer", letterSpacing: "0.06em",
              textTransform: "uppercase", fontFamily: "inherit",
            }}
          >
            + Upload Release
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {["all", "published", "scheduled", "draft"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? C.accentDim : C.surface2,
                border: `1px solid ${filter === f ? C.accentBorder : C.border}`,
                borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 700,
                color: filter === f ? C.accent : C.muted, cursor: "pointer",
                textTransform: "capitalize", letterSpacing: "0.05em", fontFamily: "inherit",
              }}
            >
              {f === "all" ? `All (${releases.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${releases.filter((r) => r.status === f).length})`}
            </button>
          ))}
          <button
            onClick={loadReleases}
            style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 14px", fontSize: 12, color: C.muted2, cursor: "pointer", fontFamily: "inherit" }}
          >
            ↻ Refresh
          </button>
        </div>

        {error && (
          <div style={{ background: "rgba(255,69,58,0.08)", border: `1px solid rgba(255,69,58,0.3)`, borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: C.error }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}>Loading releases…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}>No releases found.</div>
        ) : (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 90px 100px 110px 180px",
              padding: "10px 20px",
              borderBottom: `1px solid ${C.border}`,
              fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: C.muted2, textTransform: "uppercase",
            }}>
              <div>Title / Slug</div>
              <div>Type</div>
              <div>Status</div>
              <div>Tracks</div>
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>

            {filtered.map((rel, i) => {
              const prefix = SLUG_PREFIX[rel.release_type] || "/song/";
              const isLive = rel.status === "published" && rel.storefront_visible;
              const isScheduled = rel.status === "scheduled";
              const isDraft = rel.status === "draft";
              const showBorder = i < filtered.length - 1;
              const swipeable = isDraft || isScheduled;

              const rowEl = (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 90px 100px 110px 180px",
                    padding: "14px 20px",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                      {rel.title || <span style={{ color: C.muted2, fontStyle: "italic" }}>Untitled</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted2 }}>{rel.slug}</div>
                    {isScheduled && rel.scheduled_at && (
                      <div style={{ fontSize: 11, color: C.warn, marginTop: 2 }}>
                        Scheduled: {new Date(rel.scheduled_at).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 12, color: C.muted }}>{TYPE_LABELS[rel.release_type] || rel.release_type}</div>

                  <div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: STATUS_COLORS[rel.status] || C.muted2,
                      background: `${STATUS_COLORS[rel.status] || C.muted2}18`,
                      borderRadius: 5, padding: "3px 8px",
                    }}>
                      {rel.status?.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: C.muted }}>
                    {rel.track_counts.ready}/{rel.track_counts.total} ready
                  </div>

                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {isLive && rel.slug && (
                      <a
                        href={prefix + rel.slug}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 6,
                          padding: "5px 10px", fontSize: 11, color: C.accent, textDecoration: "none", fontWeight: 700,
                        }}
                      >
                        View Live
                      </a>
                    )}
                    {(isLive || isScheduled) && (
                      <>
                        <button
                          onClick={() => setReplacing(rel)}
                          style={{
                            background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 6,
                            padding: "5px 10px", fontSize: 11, color: C.muted, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          Replace Master
                        </button>
                        <button
                          onClick={() => setReplacingCover(rel)}
                          style={{
                            background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 6,
                            padding: "5px 10px", fontSize: 11, color: C.muted, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          Replace Cover
                        </button>
                      </>
                    )}
                    {rel.status === "draft" && (
                      <button
                        onClick={() => router.push("/admin/upload")}
                        style={{
                          background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 6,
                          padding: "5px 10px", fontSize: 11, color: C.muted2, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        New Upload
                      </button>
                    )}
                    {rel.status === "draft" && (
                      <button
                        onClick={() => deleteRelease(rel)}
                        disabled={deleting === rel.slug}
                        style={{
                          background: "rgba(255,69,58,0.10)", border: `1px solid rgba(255,69,58,0.30)`, borderRadius: 6,
                          padding: "5px 10px", fontSize: 11, color: C.error, cursor: "pointer", fontFamily: "inherit",
                          opacity: deleting === rel.slug ? 0.5 : 1,
                        }}
                      >
                        {deleting === rel.slug ? "Deleting…" : "Delete Draft"}
                      </button>
                    )}
                    {(isLive || isScheduled) && (
                      <button
                        onClick={() => deleteRelease(rel)}
                        disabled={deleting === rel.slug}
                        style={{
                          background: "rgba(255,159,10,0.10)", border: `1px solid rgba(255,159,10,0.30)`, borderRadius: 6,
                          padding: "5px 10px", fontSize: 11, color: C.warn, cursor: "pointer", fontFamily: "inherit",
                          opacity: deleting === rel.slug ? 0.5 : 1,
                        }}
                      >
                        {deleting === rel.slug ? "Taking Down…" : "Take Down"}
                      </button>
                    )}
                  </div>
                </div>
              );

              if (swipeable) {
                return (
                  <SwipeDeleteRow
                    key={rel.id}
                    onDelete={() => deleteRelease(rel, true)}
                    showBorder={showBorder}
                  >
                    {rowEl}
                  </SwipeDeleteRow>
                );
              }
              return (
                <div key={rel.id} style={{ borderBottom: showBorder ? `1px solid ${C.border}` : "none" }}>
                  {rowEl}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {replacing && (
        <ReplaceMasterModal
          release={replacing}
          onClose={() => { setReplacing(null); loadReleases(); }}
        />
      )}
      {replacingCover && (
        <ReplaceCoverModal
          release={replacingCover}
          onClose={() => { setReplacingCover(null); loadReleases(); }}
        />
      )}
    </div>
  );
}

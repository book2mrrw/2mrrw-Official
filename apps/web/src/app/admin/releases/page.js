"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";
import { SUPABASE_URL } from "@/lib/supabase/supabase-url";
import { uploadAssetToR2 } from "@/lib/media/r2-upload-client";
import {
  beginMasterReplacement,
  stageMasterReplacement,
  watchMasterReplacement,
} from "@/lib/media/master-revision-client";
import { signalCatalogMutation } from "@/lib/storefront/catalog-refresh-store";

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
  const [phase, setPhase] = useState("select"); // select | confirming | uploading | processing | done | error
  const [progress, setProgress] = useState(0);
  const [filename, setFilename] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [trackId, setTrackId] = useState(null);
  const [tracks, setTracks] = useState([]);
  const xhrRef = useRef(null);
  const fileInputRef = useRef(null);
  const selectedFileRef = useRef(null);
  const watchStopRef = useRef(null);

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

  useEffect(() => () => {
    selectedFileRef.current = null;
    watchStopRef.current?.();
    xhrRef.current?.abort?.();
  }, []);

  const isMultiTrack = ["album", "ep", "mixtape"].includes(release?.release_type);

  const selectFile = (file) => {
    if (!file) return;
    selectedFileRef.current = file;
    setProgress(0);
    setFilename(file.name);
    setErrMsg("");
    setPhase("confirming");
  };

  const confirmReplace = async () => {
    const file = selectedFileRef.current;
    if (!file) {
      setErrMsg("Choose a master file first");
      setPhase("error");
      return;
    }
    setPhase("uploading");
    try {
      const staged = await stageMasterReplacement({
        releaseId: release.id,
        trackId,
        file,
        onProgress: setProgress,
        xhrRef,
      });
      setPhase("processing");
      await beginMasterReplacement({
        releaseId: release.id,
        replacementId: staged.replacementId,
      });
      watchStopRef.current = watchMasterReplacement({
        releaseId: release.id,
        replacementId: staged.replacementId,
        onStatus: (status) => {
          if (status.status === "active") {
            selectedFileRef.current = null;
            signalCatalogMutation("release_master_promoted");
            setPhase("done");
          } else if (["failed", "cancelled"].includes(status.status)) {
            selectedFileRef.current = null;
            setErrMsg(status.error || "Processing failed; the previous master remains live");
            setPhase("error");
          }
        },
        onError: (error) => {
          setErrMsg(`${error.message}. Processing may still be running; reopen this release to check.`);
          setPhase("error");
        },
      });
    } catch (err) {
      selectedFileRef.current = null;
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

        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,.flac,.aiff,.aif,audio/wav,audio/flac,audio/aiff"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] || null;
            event.currentTarget.value = "";
            if (file) selectFile(file);
          }}
        />

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
              <div style={{ fontSize: 11, color: C.muted2, marginTop: 4 }}>Max 2 GB. The current master stays live until the new revision is fully validated.</div>
            </div>
            <button
              onClick={() => {
                if (isMultiTrack && !trackId && tracks.length > 1) { alert("Select a track first."); return; }
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                  fileInputRef.current.click();
                }
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
              {`Uploading immutable revision… ${progress}%`}
            </div>
            <div style={{ background: C.surface2, borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ background: C.accent, width: `${progress}%`, height: "100%", transition: "width 0.2s" }} />
            </div>
            {filename && <div style={{ fontSize: 11, color: C.muted2, marginTop: 8 }}>{filename}</div>}
          </div>
        )}

        {phase === "confirming" && (
          <div>
            <div style={{ background: "rgba(255,159,10,0.08)", border: `1px solid rgba(255,159,10,0.3)`, borderRadius: 8, padding: "14px 16px", marginBottom: 20, fontSize: 13, color: C.warn }}>
              Stage <strong>{filename}</strong> as a new immutable revision? The current master and active playback remain unchanged until transcoding and validation finish.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { selectedFileRef.current = null; setFilename(""); setPhase("select"); }}
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

        {phase === "processing" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 14, color: C.warn, fontWeight: 700, marginBottom: 8 }}>Validating and transcoding…</div>
            <div style={{ fontSize: 12, color: C.muted }}>The current master remains authoritative. This screen will confirm only after atomic promotion.</div>
          </div>
        )}

        {phase === "done" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.success, marginBottom: 6 }}>Master validated and promoted</div>
            <div style={{ fontSize: 12, color: C.muted }}>The master pointer and HLS manifest changed together. Existing playback sessions were not interrupted.</div>
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
              onClick={() => { selectedFileRef.current = null; setFilename(""); setPhase("select"); setErrMsg(""); }}
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
        releaseId: release.id,
        revisioned: true,
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
  const rowRef         = useRef(null);
  const revealedRef    = useRef(false);

  const thresholds = () => {
    const width = rowRef.current?.getBoundingClientRect().width || 360;
    return { reveal: width * 0.28, commit: width * 0.60 };
  };

  const onTouchStart = (e) => {
    if (committedRef.current) return;
    startXRef.current = e.touches[0].clientX;
    buzzedRef.current = false;
    revealedRef.current = false;
    setDragging(true);
  };

  const onTouchMove = (e) => {
    if (startXRef.current === null || committedRef.current) return;
    const raw = e.touches[0].clientX - startXRef.current;
    if (raw > 6) { startXRef.current = null; setDragging(false); return; } // ignore right-swipe
    const abs = Math.abs(Math.min(raw, 0));
    const { reveal, commit } = thresholds();
    const clamped = abs <= commit ? -abs : -(commit + (abs - commit) * 0.18);
    currentOffRef.current = clamped;
    setOffsetX(clamped);
    const p = Math.min(1, abs / commit);
    setProgress(p);
    if (abs >= reveal && !revealedRef.current) {
      revealedRef.current = true;
      try { navigator.vibrate?.(16); } catch {}
    }
    if (p >= 1 && !buzzedRef.current) {
      buzzedRef.current = true;
      try { navigator.vibrate?.([45, 18, 55]); } catch {}
    }
  };

  const onTouchEnd = () => {
    setDragging(false);
    startXRef.current = null;
    if (committedRef.current) return;
    if (Math.abs(currentOffRef.current) >= thresholds().commit) {
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
    <div ref={rowRef} style={{
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
            <span style={{ fontSize: 18, marginRight: 7, display: "inline-block", transform: `rotate(${progress * -8}deg) scale(${0.85 + progress * .25})` }}>▰</span>
            {atThreshold ? "DUMP IT" : "DUMP"}
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
  const [undoDump, setUndoDump] = useState(null);

  useEffect(() => {
    const sb = createBrowserClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY
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
      const archive = rel.source !== "catalog" && rel.status !== "draft";
      const res = await fetch(url, archive
        ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive" }) }
        : { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      if (json.staged) {
        setReleases((current) => current.filter((item) => item.id !== rel.id));
        setUndoDump(rel);
        setTimeout(() => setUndoDump((current) => current?.id === rel.id ? null : current), 10_000);
      } else await loadReleases();
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const undoDraftDump = async () => {
    if (!undoDump) return;
    const rel = undoDump;
    setUndoDump(null);
    const res = await fetch(`/api/admin/releases/${rel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "undo_dump" }) });
    if (!res.ok) { const json = await res.json(); alert(json.error || "Undo failed"); return; }
    await loadReleases();
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
              const swipeable = isDraft;

              const rowEl = (
                <div
                  role={isDraft ? "button" : undefined}
                  tabIndex={isDraft ? 0 : undefined}
                  aria-label={isDraft ? `Continue draft ${rel.title || "untitled release"}` : undefined}
                  onClick={isDraft ? () => router.push(`/admin/upload?draft=${rel.id}`) : undefined}
                  onKeyDown={isDraft ? (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/admin/upload?draft=${rel.id}`); }
                  } : undefined}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 90px 100px 110px 180px",
                    padding: "14px 20px",
                    alignItems: "center",
                    cursor: isDraft ? "pointer" : "default",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                      {rel.title || <span style={{ color: C.muted2, fontStyle: "italic" }}>Untitled</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted2 }}>{rel.slug}</div>
                    {isDraft && (rel.draft_genre || rel.price_cents || rel.release_date) && (
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                        {[rel.draft_genre, rel.price_cents ? `$${(rel.price_cents / 100).toFixed(2)}` : null, rel.release_date ? `Original: ${new Date(`${rel.release_date}T00:00:00`).toLocaleDateString()}` : null, Number.isInteger(rel.draft_step_index) ? `Step ${rel.draft_step_index + 1}` : null].filter(Boolean).join(" Â· ")}
                      </div>
                    )}
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

                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}
                  >
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
                        onClick={() => router.push(`/admin/upload?draft=${rel.id}`)}
                        style={{
                          background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 6,
                          padding: "5px 10px", fontSize: 11, color: C.muted2, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        Continue Draft
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
      {undoDump ? (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)", zIndex: 1000, display: "flex", alignItems: "center", gap: 18, background: "rgba(12,12,12,.96)", border: `1px solid ${C.accentBorder}`, boxShadow: "0 16px 50px rgba(0,0,0,.55)", borderRadius: 12, padding: "13px 16px", color: C.text, fontSize: 13 }}>
          <span>Draft dumped</span>
          <button type="button" onClick={undoDraftDump} style={{ background: "none", border: 0, color: C.accent, fontWeight: 900, cursor: "pointer", letterSpacing: ".06em" }}>UNDO</button>
        </div>
      ) : null}
    </div>
  );
}

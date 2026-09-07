"use client";

/**
 * "Manage Audio Visualz" — the in-page ("no redirect"), Audio Visualz-only
 * admin surface, mirroring InlineReleasesManager.js's shape (home → upload
 * → list view-state machine, same C design tokens, same inline-style
 * approach) but a fully separate, isolated component. Never imports
 * anything from the release/track upload pipeline — only this feature's
 * own routes (draft, seriez, upload/presigned, upload/complete,
 * audio-visuals list).
 *
 * Episode numbering is never predetermined — for a Seriez attachment, the
 * next episode number is always fetched from what already exists
 * (max(episode_number)+1 for that season, via
 * /api/admin/audio-visual/seriez/[id]/next-episode) and offered as an
 * editable default, matching the confirmed intent: episodes get added "as
 * I go" without the admin tracking a count, but a batch of episodes that
 * are all ready at once can also be uploaded together in one pass.
 *
 * Scope of this first pass: create a video (any of the 8 content types,
 * optionally standalone/new-Seriez/existing-Seriez-by-id), upload its
 * static cover (required), motion cover (optional), and master content
 * file, and see it appear in the list. Deferred, deliberately, not
 * silently: genre/credits/cast editing, browsing existing Seriez by name
 * (v1 takes a Seriez id directly), and a dedicated edit-existing-video view
 * beyond re-uploading assets.
 */
import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { uploadAudioVisualAssetToR2, completeAudioVisualUpload } from "@/lib/audio-visual/upload-client";
import { IMAGE_COVER_ACCEPT, VIDEO_COVER_ACCEPT, AV_MASTER_ACCEPT } from "@/lib/media/admin-upload-contract";

const C = {
  bg: "#050505", surface: "#0d0d0d", surface2: "#111", surface3: "#161616",
  border: "rgba(255,255,255,0.06)", border2: "rgba(255,255,255,0.12)",
  accent: "#00ffff", accentDim: "rgba(0,255,255,0.07)", accentBorder: "rgba(0,255,255,0.22)",
  text: "#e8e8e8", muted: "rgba(255,255,255,0.45)", muted2: "rgba(255,255,255,0.28)", muted3: "rgba(255,255,255,0.14)",
  success: "#32d74b", warn: "#ff9f0a", error: "#ff453a",
};

const CONTENT_TYPES = [
  { value: "music_video", label: "Audio Visualz (Music Video)" },
  { value: "podcast", label: "Podcast" },
  { value: "interview", label: "Exclusive Interview" },
  { value: "movie", label: "Movie" },
  { value: "documentary", label: "Documentary" },
  { value: "vlog", label: "Vlog" },
  { value: "concert", label: "Concert" },
  { value: "short_film", label: "Short Filmz" },
];

const backBtnStyle = {
  background: "none", border: "none", color: C.muted2, fontSize: 11, cursor: "pointer",
  padding: 0, fontFamily: "inherit", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase",
};

function Btn({ onClick, children, small, disabled, variant = "primary" }) {
  const palette = variant === "primary"
    ? { bg: C.accentDim, border: C.accentBorder, color: C.accent }
    : { bg: C.surface2, border: C.border2, color: C.muted };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 8,
        padding: small ? "8px 16px" : "11px 22px", fontSize: small ? 11 : 13, fontWeight: 700,
        color: palette.color, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 8,
  padding: "11px 14px", fontSize: 14, color: C.text, fontFamily: "inherit", boxSizing: "border-box",
};

// ── Track picker ─────────────────────────────────────────────────────────
// Lets the admin find a track by browsing titles (Singles / Features /
// Albums / Mixtapes & EPs) instead of pasting a raw tracks.id UUID. Only
// wizard releases (source: "releases") are offered — legacy catalog
// releases key their tracklist off catalog_tracks.id, which isn't a valid
// audio_visuals.track_id (that column FKs to public.tracks only).
const RELEASE_TABS = [
  { key: "single", label: "Singles", match: (t) => t === "single" },
  { key: "feature", label: "Features", match: (t) => t === "feature" },
  { key: "album", label: "Albums", match: (t) => t === "album" || t === "deluxe" },
  { key: "mixtape", label: "Mixtapes & EPs", match: (t) => t === "ep" || t === "mixtape" },
];

const pickerRowStyle = {
  display: "block", width: "100%", textAlign: "left", fontFamily: "inherit", cursor: "pointer",
  background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: "10px 14px", marginBottom: 8,
};

function TrackPicker({ onPick, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [releases, setReleases] = useState([]);
  const [activeTab, setActiveTab] = useState("single");
  const [openRelease, setOpenRelease] = useState(null);
  const [tracks, setTracks] = useState(null); // null = not drilled in yet
  const [tracksLoading, setTracksLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/releases")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setReleases((data.releases || []).filter((r) => r.source === "releases" && r.title));
      })
      .catch(() => { if (!cancelled) setError("Failed to load releases"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const openReleaseTracks = useCallback((release) => {
    setOpenRelease(release);
    setTracks(null);
    setTracksLoading(true);
    fetch(`/api/admin/releases/${release.id}`)
      .then((r) => r.json())
      .then((data) => {
        const list = data.tracks || [];
        if (list.length === 1) {
          onPick({ trackId: list[0].id, title: list[0].title || release.title });
        } else {
          setTracks(list);
        }
      })
      .catch(() => setError("Failed to load tracklist"))
      .finally(() => setTracksLoading(false));
  }, [onPick]);

  const activeMatch = RELEASE_TABS.find((t) => t.key === activeTab).match;
  const filtered = releases.filter((r) => activeMatch(r.release_type));

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9500, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: "min(520px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.text }}>
              {openRelease ? `Pick a track — ${openRelease.title}` : "Pick a release"}
            </h3>
            <button onClick={onClose} style={{ ...backBtnStyle, fontSize: 16 }}>✕</button>
          </div>
          {!openRelease && (
            <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
              {RELEASE_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    flexShrink: 0, padding: "7px 14px", borderRadius: 999, fontSize: 11, fontWeight: 800,
                    letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
                    border: `1px solid ${activeTab === t.key ? C.accentBorder : C.border2}`,
                    background: activeTab === t.key ? C.accentDim : "transparent",
                    color: activeTab === t.key ? C.accent : C.muted,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: "0 20px 20px", overflowY: "auto" }}>
          {error && <div style={{ color: C.error, fontSize: 13, marginBottom: 12 }}>{error}</div>}
          {openRelease ? (
            <>
              <button onClick={() => { setOpenRelease(null); setTracks(null); }} style={{ ...backBtnStyle, marginBottom: 12 }}>← Back to releases</button>
              {tracksLoading ? (
                <div style={{ color: C.muted, fontSize: 13, padding: "20px 0" }}>Loading tracklist…</div>
              ) : tracks && tracks.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13, padding: "20px 0" }}>No tracks yet for this release.</div>
              ) : (
                (tracks || []).map((t) => (
                  <button key={t.id} onClick={() => onPick({ trackId: t.id, title: t.title || openRelease.title })} style={pickerRowStyle}>
                    <span style={{ fontSize: 11, color: C.muted2, fontWeight: 700, marginRight: 10 }}>{t.position}.</span>
                    <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{t.title || "(untitled track)"}</span>
                  </button>
                ))
              )}
            </>
          ) : loading ? (
            <div style={{ color: C.muted, fontSize: 13, padding: "20px 0" }}>Loading releases…</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13, padding: "20px 0" }}>Nothing here yet.</div>
          ) : (
            filtered.map((r) => (
              <button key={r.id} onClick={() => openReleaseTracks(r)} style={pickerRowStyle}>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>{r.title}</div>
                <div style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>
                  {r.slug}{r.track_counts ? ` · ${r.track_counts.total} track${r.track_counts.total === 1 ? "" : "s"}` : ""}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Home landing ─────────────────────────────────────────────────────────
function HomeLanding({ count, onUpload, onList }) {
  return (
    <div style={{ padding: "36px 0 80px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: C.accent, textTransform: "uppercase", marginBottom: 8 }}>Admin</div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: C.text, margin: 0, lineHeight: 1.1 }}>Manage Audio Visualz</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>Upload music videos, podcasts, interviews, movies, documentaries, vlogs, concerts, and short filmz.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, maxWidth: 680 }}>
        <button onClick={onUpload} style={{ background: "linear-gradient(135deg, rgba(0,255,255,0.10) 0%, rgba(0,255,255,0.03) 100%)", border: `1px solid ${C.accentBorder}`, borderRadius: 16, padding: "28px 24px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
          <div style={{ fontSize: 30, marginBottom: 12 }}>＋</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.accent, marginBottom: 6 }}>Upload New</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>Pick a content type, then upload cover art and the master file.</div>
        </button>
        <button onClick={onList} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "28px 24px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
          <div style={{ fontSize: 30, marginBottom: 12 }}>📂</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>My Audio Visualz</span>
            {count > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.muted2, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 8px" }}>{count}</span>}
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>View everything uploaded so far.</div>
        </button>
      </div>
    </div>
  );
}

// ── List view ────────────────────────────────────────────────────────────
function AudioVisualListView({ items, loading, error, onRefresh, onNew, onBack }) {
  return (
    <div style={{ padding: "28px 0 80px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ marginBottom: 22 }}>
        <button onClick={onBack} style={backBtnStyle}>← Manage Audio Visualz</button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0 }}>My Audio Visualz</h1>
          <Btn onClick={onNew} small>+ Upload New</Btn>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button onClick={onRefresh} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 12px", fontSize: 11, color: C.muted2, cursor: "pointer", fontFamily: "inherit" }}>↻</button>
      </div>
      {error && (
        <div style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.3)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: C.error }}>{error}</div>
      )}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Nothing uploaded yet.</div>
          <Btn onClick={onNew}>Upload Your First One</Btn>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => {
            const coverSrc = item.poster_url || null;
            const typeLabel = CONTENT_TYPES.find((t) => t.value === item.video_type)?.label || item.video_type;
            return (
              <div key={item.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ width: 56, height: 56, borderRadius: 8, flexShrink: 0, background: C.surface2, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${C.border}` }}>
                  {coverSrc ? <img src={coverSrc} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 20 }}>🎬</span>}
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 3 }}>{item.title || <span style={{ color: C.muted2, fontStyle: "italic" }}>Untitled</span>}</div>
                  <div style={{ fontSize: 11, color: C.muted2 }}>
                    {typeLabel} · {item.publication_state}
                    {item.seriez_id ? ` · S${item.season_number}E${item.episode_number}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Upload flow ──────────────────────────────────────────────────────────
function UploadFlow({ onComplete, onDismiss }) {
  const [step, setStep] = useState("details"); // "details" | "assets" | "done"
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [title, setTitle] = useState("");
  const [videoType, setVideoType] = useState("music_video");
  const [trackId, setTrackId] = useState("");
  const [linkedTrackLabel, setLinkedTrackLabel] = useState("");
  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  const [seriezMode, setSeriezMode] = useState("standalone"); // "standalone" | "new" | "existing"
  const [seriezTitle, setSeriezTitle] = useState("");
  const [existingSeriezId, setExistingSeriezId] = useState("");
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [episodeNumberTouched, setEpisodeNumberTouched] = useState(false);
  const [batchMode, setBatchMode] = useState(false);

  const [video, setVideo] = useState(null); // single mode: { video_id, slug, video_type }
  const [batchResults, setBatchResults] = useState([]); // batch mode: [{ title, slug }]

  const [coverFile, setCoverFile] = useState(null);
  const [motionCoverFile, setMotionCoverFile] = useState(null);
  const [masterFile, setMasterFile] = useState(null);
  const [masterFiles, setMasterFiles] = useState([]); // batch mode
  const [uploadProgress, setUploadProgress] = useState({ cover: 0, motionCover: 0, master: 0 });
  const [batchProgress, setBatchProgress] = useState({}); // { [filename]: "pending"|"uploading"|"done"|"error" }
  const [motionCoverDuration, setMotionCoverDuration] = useState(null);

  // Episode numbering is never predetermined — whenever the Seriez/season
  // choice resolves to a real seriez_id, fetch what already exists there
  // and default to the next one. Still fully editable (episodeNumberTouched
  // stops this from clobbering a manual edit).
  const fetchNextEpisodeNumber = useCallback(async (seriezId, season) => {
    if (!seriezId) return;
    try {
      const res = await fetch(`/api/admin/audio-visual/seriez/${seriezId}/next-episode?season=${season}`);
      const data = await res.json();
      if (res.ok && !episodeNumberTouched) setEpisodeNumber(data.next_episode_number);
    } catch {
      // Non-fatal — the field stays editable and DB uniqueness still guards against a collision.
    }
  }, [episodeNumberTouched]);

  const handleExistingSeriezBlur = useCallback(() => {
    if (existingSeriezId.trim()) fetchNextEpisodeNumber(existingSeriezId.trim(), Number(seasonNumber) || 1);
  }, [existingSeriezId, seasonNumber, fetchNextEpisodeNumber]);

  // Picking a track fills the video's own title from it too, unless the
  // admin already typed one — matches the confirmed intent that the video
  // title defaults to the linked track's title but stays fully editable.
  const handlePickTrack = useCallback(({ trackId: pickedId, title: pickedTitle }) => {
    setTrackId(pickedId || "");
    setLinkedTrackLabel(pickedTitle || "");
    setTrackPickerOpen(false);
    setTitle((current) => (current.trim() ? current : pickedTitle || current));
  }, []);

  const uploadOne = useCallback(async (videoId, file, assetType, onProgress) => {
    const { key } = await uploadAudioVisualAssetToR2({ videoId, assetType, file, onProgress });
    const durationSeconds = assetType === "av-cover-video" ? motionCoverDuration : undefined;
    await completeAudioVisualUpload({ videoId, assetType, key, durationSeconds });
  }, [motionCoverDuration]);

  const resolveSeriezId = useCallback(async () => {
    if (seriezMode === "new") {
      if (!seriezTitle.trim()) throw new Error("Seriez title is required");
      const res = await fetch("/api/admin/audio-visual/seriez", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: seriezTitle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create Seriez");
      return data.seriez_id;
    }
    if (seriezMode === "existing") {
      if (!existingSeriezId.trim()) throw new Error("Seriez ID is required");
      return existingSeriezId.trim();
    }
    return null;
  }, [seriezMode, seriezTitle, existingSeriezId]);

  // ── Single-episode (or standalone) path ──────────────────────────────────
  const handleCreateDraft = useCallback(async () => {
    if (!title.trim()) { setError("Title is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const seriezId = await resolveSeriezId();
      const res = await fetch("/api/admin/audio-visual/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          video_type: videoType,
          track_id: videoType === "music_video" && trackId.trim() ? trackId.trim() : null,
          seriez_id: seriezId,
          season_number: seriezId ? Number(seasonNumber) : null,
          episode_number: seriezId ? Number(episodeNumber) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create draft");
      setVideo(data);
      setStep("assets");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [title, videoType, trackId, seasonNumber, episodeNumber, resolveSeriezId]);

  const handleFinishAssets = useCallback(async () => {
    if (!coverFile) { setError("A cover image is required"); return; }
    if (!masterFile) { setError("The master content file is required"); return; }
    setSaving(true);
    setError(null);
    try {
      await uploadOne(video.video_id, coverFile, "av-cover", (pct) => setUploadProgress((p) => ({ ...p, cover: pct })));
      if (motionCoverFile) await uploadOne(video.video_id, motionCoverFile, "av-cover-video", (pct) => setUploadProgress((p) => ({ ...p, motionCover: pct })));
      await uploadOne(video.video_id, masterFile, "av-master", (pct) => setUploadProgress((p) => ({ ...p, master: pct })));
      setStep("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [coverFile, motionCoverFile, masterFile, video, uploadOne]);

  // ── Batch (multiple episodes at once) path — one master file per episode,
  // auto-numbered sequentially from the fetched starting point, sharing one
  // cover/motion-cover across the whole batch. ─────────────────────────────
  const handleBatchUpload = useCallback(async () => {
    if (!coverFile) { setError("A cover image is required"); return; }
    if (masterFiles.length === 0) { setError("Select at least one episode file"); return; }
    setSaving(true);
    setError(null);
    const sortedFiles = [...masterFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const startingEpisode = Number(episodeNumber) || 1;
    const results = [];
    try {
      const seriezId = await resolveSeriezId();
      if (!seriezId) throw new Error("Batch upload requires a Seriez — pick \"new\" or \"existing\" above");

      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        const thisEpisodeNumber = startingEpisode + i;
        setBatchProgress((p) => ({ ...p, [file.name]: "uploading" }));

        const draftRes = await fetch("/api/admin/audio-visual/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${seriezTitle || "Episode"} — Episode ${thisEpisodeNumber}`,
            video_type: videoType,
            seriez_id: seriezId,
            season_number: Number(seasonNumber) || 1,
            episode_number: thisEpisodeNumber,
          }),
        });
        const draftData = await draftRes.json();
        if (!draftRes.ok) throw new Error(`Episode ${thisEpisodeNumber}: ${draftData.error || "failed to create draft"}`);

        await uploadOne(draftData.video_id, coverFile, "av-cover", () => {});
        if (motionCoverFile) await uploadOne(draftData.video_id, motionCoverFile, "av-cover-video", () => {});
        await uploadOne(draftData.video_id, file, "av-master", () => {});

        results.push({ title: draftData.slug, episode: thisEpisodeNumber });
        setBatchProgress((p) => ({ ...p, [file.name]: "done" }));
      }
      setBatchResults(results);
      setStep("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [coverFile, motionCoverFile, masterFiles, episodeNumber, seasonNumber, seriezTitle, videoType, resolveSeriezId, uploadOne]);

  const probeVideoDuration = useCallback((file) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => { setMotionCoverDuration(el.duration); URL.revokeObjectURL(el.src); };
    el.src = URL.createObjectURL(file);
  }, []);

  if (step === "done") {
    return (
      <div style={{ padding: "60px 0", textAlign: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
        <h2 style={{ color: C.text, fontSize: 20, marginBottom: 8 }}>{batchMode ? `${batchResults.length} episode${batchResults.length === 1 ? "" : "s"} uploaded` : "Uploaded"}</h2>
        <p style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>
          {batchMode
            ? "All queued for encoding — they'll show up in the list once processing starts."
            : <>Queued for encoding — it&rsquo;ll show up in the list once processing starts. Slug: <strong style={{ color: C.accent }}>{video?.slug}</strong></>}
        </p>
        <Btn onClick={() => onComplete(video)}>Done</Btn>
      </div>
    );
  }

  if (step === "assets" && !batchMode) {
    return (
      <div style={{ padding: "28px 0 80px", maxWidth: 560, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <button onClick={onDismiss} style={backBtnStyle}>← Cancel</button>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "10px 0 24px" }}>Upload assets</h1>

        <Field label="Cover art (required)">
          <input type="file" accept={IMAGE_COVER_ACCEPT} onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
          {uploadProgress.cover > 0 && uploadProgress.cover < 100 && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{uploadProgress.cover}%</div>}
        </Field>

        <Field label="Motion cover art (optional — animated/looping poster)">
          <input
            type="file"
            accept={VIDEO_COVER_ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setMotionCoverFile(f);
              if (f) probeVideoDuration(f);
            }}
          />
          {uploadProgress.motionCover > 0 && uploadProgress.motionCover < 100 && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{uploadProgress.motionCover}%</div>}
        </Field>

        <Field label="Master content file (required)">
          <input type="file" accept={AV_MASTER_ACCEPT} onChange={(e) => setMasterFile(e.target.files?.[0] || null)} />
          {uploadProgress.master > 0 && uploadProgress.master < 100 && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{uploadProgress.master}%</div>}
        </Field>

        {error && <div style={{ color: C.error, fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <Btn onClick={handleFinishAssets} disabled={saving}>{saving ? "Uploading…" : "Upload & Finish"}</Btn>
      </div>
    );
  }

  if (step === "assets" && batchMode) {
    return (
      <div style={{ padding: "28px 0 80px", maxWidth: 560, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <button onClick={onDismiss} style={backBtnStyle}>← Cancel</button>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "10px 0 24px" }}>Upload {masterFiles.length || ""} episodes</h1>
        <p style={{ color: C.muted, fontSize: 12, marginBottom: 20 }}>
          Files are numbered in name order, starting at Episode {episodeNumber}. Cover art is shared across all of them.
        </p>

        <Field label="Cover art — shared across all episodes (required)">
          <input type="file" accept={IMAGE_COVER_ACCEPT} onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
        </Field>

        <Field label="Motion cover art — shared, optional">
          <input
            type="file"
            accept={VIDEO_COVER_ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setMotionCoverFile(f);
              if (f) probeVideoDuration(f);
            }}
          />
        </Field>

        <Field label="Episode files (select all at once — required)">
          <input type="file" accept={AV_MASTER_ACCEPT} multiple onChange={(e) => setMasterFiles(Array.from(e.target.files || []))} />
        </Field>

        {masterFiles.length > 0 && (
          <div style={{ marginBottom: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            {[...masterFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((f, i) => (
              <div key={f.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, background: C.surface2, borderRadius: 6, padding: "6px 10px" }}>
                <span>Ep. {Number(episodeNumber) + i}: {f.name}</span>
                <span style={{ color: batchProgress[f.name] === "done" ? C.success : batchProgress[f.name] === "uploading" ? C.accent : C.muted2 }}>
                  {batchProgress[f.name] || "pending"}
                </span>
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ color: C.error, fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <Btn onClick={handleBatchUpload} disabled={saving}>{saving ? "Uploading…" : "Upload All"}</Btn>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 0 80px", maxWidth: 560, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <button onClick={onDismiss} style={backBtnStyle}>← Cancel</button>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "10px 0 24px" }}>Upload New Audio Visualz</h1>

      <Field label="Content type">
        <select value={videoType} onChange={(e) => setVideoType(e.target.value)} style={inputStyle}>
          {CONTENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>

      {!batchMode && (
        <Field label="Title">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="Video title" />
        </Field>
      )}

      {videoType === "music_video" && !batchMode && (
        <Field label="Linked track (optional — derives the slug from that track's own slug)">
          {trackId ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ ...inputStyle, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {linkedTrackLabel || trackId}
              </div>
              <Btn small variant="secondary" onClick={() => setTrackPickerOpen(true)}>Change</Btn>
              <Btn small variant="secondary" onClick={() => { setTrackId(""); setLinkedTrackLabel(""); }}>Clear</Btn>
            </div>
          ) : (
            <Btn variant="secondary" onClick={() => setTrackPickerOpen(true)}>Pick a track…</Btn>
          )}
        </Field>
      )}
      {trackPickerOpen && <TrackPicker onPick={handlePickTrack} onClose={() => setTrackPickerOpen(false)} />}

      <Field label="Seriez">
        <select
          value={seriezMode}
          onChange={(e) => { setSeriezMode(e.target.value); if (e.target.value === "standalone") setBatchMode(false); }}
          style={{ ...inputStyle, marginBottom: 10 }}
        >
          <option value="standalone">Standalone (not part of a Seriez)</option>
          <option value="new">Create a new Seriez</option>
          <option value="existing">Attach to an existing Seriez (by ID)</option>
        </select>
        {seriezMode === "new" && (
          <input type="text" value={seriezTitle} onChange={(e) => setSeriezTitle(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} placeholder="Seriez title" />
        )}
        {seriezMode === "existing" && (
          <input
            type="text" value={existingSeriezId}
            onChange={(e) => setExistingSeriezId(e.target.value)}
            onBlur={handleExistingSeriezBlur}
            style={{ ...inputStyle, marginBottom: 10 }} placeholder="Seriez UUID"
          />
        )}
        {seriezMode !== "standalone" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <input
                type="number" min={1} value={seasonNumber}
                onChange={(e) => { setSeasonNumber(e.target.value); if (seriezMode === "existing" && existingSeriezId.trim()) fetchNextEpisodeNumber(existingSeriezId.trim(), Number(e.target.value) || 1); }}
                style={inputStyle} placeholder="Season #"
              />
              <input
                type="number" min={1} value={episodeNumber}
                onChange={(e) => { setEpisodeNumberTouched(true); setEpisodeNumber(e.target.value); }}
                style={inputStyle} placeholder="Episode #"
              />
            </div>
            <div style={{ fontSize: 11, color: C.muted2, marginBottom: 10 }}>
              {seriezMode === "existing"
                ? "Episode # is auto-suggested from what's already in this Seriez/season — edit it if you need to."
                : "First episode of a brand-new Seriez starts at Episode 1 by default — edit it if you need to."}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, cursor: "pointer" }}>
              <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
              I have multiple episodes ready right now — upload them all at once
            </label>
          </>
        )}
      </Field>

      {error && <div style={{ color: C.error, fontSize: 13, marginBottom: 16 }}>{error}</div>}
      <Btn
        onClick={batchMode ? () => setStep("assets") : handleCreateDraft}
        disabled={saving}
      >
        {saving ? "Creating…" : "Continue"}
      </Btn>
    </div>
  );
}

// ── Root component ───────────────────────────────────────────────────────
export default function InlineAudioVisualzManager() {
  const { isAdmin } = useAuth();
  const [view, setView] = useState("home"); // "home" | "upload" | "list"
  const [items, setItems] = useState([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/audio-visuals");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load Audio Visualz");
      setItems(json.audio_visuals || []);
      setItemsLoaded(true);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  if (!isAdmin) return null;

  if (view === "upload") {
    return (
      <UploadFlow
        onComplete={() => { loadItems(); setView("list"); }}
        onDismiss={() => setView(itemsLoaded ? "list" : "home")}
      />
    );
  }

  if (view === "list") {
    return (
      <AudioVisualListView
        items={items}
        loading={loading}
        error={loadError}
        onRefresh={loadItems}
        onNew={() => setView("upload")}
        onBack={() => setView("home")}
      />
    );
  }

  return (
    <HomeLanding
      count={items.length}
      onUpload={() => setView("upload")}
      onList={() => { if (!itemsLoaded) loadItems(); setView("list"); }}
    />
  );
}

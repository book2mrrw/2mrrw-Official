"use client";

/**
 * Homepage "Audio Visualz" section — real, entitlement-gated content
 * (previously a hardcoded 3-video YouTube embed with no backend
 * connection). Sub-type filter pills, confirmed cyan-transparent with
 * noticeable text, one per content type plus "Seriez" (a structural
 * container, not a real video_type, but the confirmed homepage design
 * treats it as its own filterable pill) — "All" last, not first, per the
 * user's own instruction. Clicking a Seriez card opens its own in-section
 * episode-list view rather than navigating away, matching this project's
 * established "no redirect" philosophy.
 *
 * Isolated from the actual video pipeline it renders (only ever calls this
 * feature's own public routes — /api/audio-visual/browse,
 * /api/audio-visual/seriez/[id], /api/audio-visual/[videoId]/manifest via
 * AudioVisualPlayer) — never anything release/track-shaped.
 *
 * `autoplay` is accepted for backward compatibility with both existing call
 * sites (MusicTabCatalogPanels.js passes autoplay={false}, HomeStorefront.js
 * doesn't pass it) but is now inert — there is no longer a single
 * autoplaying hero video to gate, only a poster grid the viewer taps into.
 */
import { memo, useState, useEffect, useRef, useCallback } from "react";
import { AudioVisualPlayer } from "@/components/audio-visual/AudioVisualPlayer";

const PILLS = [
  { value: "music_video", label: "Audio Visualz" },
  { value: "podcast", label: "Podcast" },
  { value: "interview", label: "Interviews" },
  { value: "movie", label: "Movies" },
  { value: "documentary", label: "Documentaries" },
  { value: "vlog", label: "Vlogs" },
  { value: "concert", label: "Concerts" },
  { value: "short_film", label: "Short Filmz" },
  { value: "seriez", label: "Seriez" },
  { value: "all", label: "All" },
];

// Confirmed: transparent cyan pill, genuinely noticeable text color — reuses
// the same #00ffff accent already used everywhere else in this app's own
// admin/nav UI, not a new palette invented for this one section.
const pillStyle = (active) => ({
  flexShrink: 0,
  padding: "7px 16px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  cursor: "pointer",
  border: `1px solid ${active ? "rgba(0,255,255,0.55)" : "rgba(0,255,255,0.18)"}`,
  background: active ? "rgba(0,255,255,0.18)" : "rgba(0,255,255,0.07)",
  color: active ? "#00ffff" : "rgba(0,255,255,0.75)",
  transition: "all 0.15s",
});

function PillRow({ activeType, onSelect }) {
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
      {PILLS.map((p) => (
        <button key={p.value} type="button" onClick={() => onSelect(p.value)} style={pillStyle(activeType === p.value)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

function PosterCard({ item, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: "pointer", borderRadius: 12, overflow: "hidden", background: "#0a0a0a",
        border: "1px solid #1a1a1a", transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,255,0.3)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; }}
    >
      <div style={{ position: "relative", paddingBottom: "140%", background: "#000" }}>
        {item.poster_url ? (
          <img src={item.poster_url} alt={item.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🎬</div>
        )}
        {item.kind === "seriez" && (
          <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,255,255,0.85)", color: "#000", fontSize: 9, fontWeight: 900, letterSpacing: 1, padding: "3px 8px", borderRadius: 999, textTransform: "uppercase" }}>
            Seriez
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.title}
      </div>
    </div>
  );
}

function SeriezDetailView({ seriezId, onBack, onPlay }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/audio-visual/seriez/${seriezId}`)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) { if (json.error) setError(json.error); else setData(json); } })
      .catch(() => { if (!cancelled) setError("Failed to load"); });
    return () => { cancelled = true; };
  }, [seriezId]);

  if (error) return <div style={{ color: "#ff453a", fontSize: 13, padding: "20px 0" }}>{error}</div>;
  if (!data) return <div style={{ color: "#777", fontSize: 13, padding: "20px 0" }}>Loading…</div>;

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "rgba(0,255,255,0.8)", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", padding: 0, marginBottom: 14 }}>
        ← Back
      </button>
      <h3 style={{ color: "#fff", fontSize: 18, fontWeight: 900, margin: "0 0 6px" }}>{data.seriez.title}</h3>
      {data.seriez.description && <p style={{ color: "#888", fontSize: 12, marginBottom: 18, maxWidth: 560 }}>{data.seriez.description}</p>}
      {data.episodes.length === 0 ? (
        <div style={{ color: "#666", fontSize: 12 }}>No episodes available yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.episodes.map((ep) => (
            <div
              key={ep.video_id}
              onClick={() => ep.status === "playable" && onPlay(ep)}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10,
                background: "#0d0d0d", border: "1px solid #1a1a1a",
                cursor: ep.status === "playable" ? "pointer" : "default",
                opacity: ep.status === "playable" ? 1 : 0.55,
              }}
            >
              <div style={{ fontSize: 11, color: "rgba(0,255,255,0.8)", fontWeight: 800, flexShrink: 0 }}>
                S{ep.season_number}E{ep.episode_number}
              </div>
              <div style={{ flex: 1, fontSize: 13, color: "#fff", fontWeight: 700 }}>{ep.title}</div>
              {ep.status === "upcoming" ? (
                <div style={{ fontSize: 10, color: "#999", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>
                  {new Date(ep.scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              ) : (
                <div style={{ fontSize: 10, color: "#00ffff", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>▶ Play</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const AudioVisualsSection = memo(function AudioVisualsSection({ onAudioVisualsFocused, onAudioVisualsExit }) {
  const [activeType, setActiveType] = useState("all");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openSeriezId, setOpenSeriezId] = useState(null);
  const [playingVideo, setPlayingVideo] = useState(null); // { video_id, title, poster_url }
  const sectionRef = useRef(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let hasBeenInView = false;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onAudioVisualsFocused?.();
          hasBeenInView = true;
        } else if (hasBeenInView) {
          onAudioVisualsExit?.();
        }
      },
      { threshold: [0, 0.45] }
    );
    obs.observe(el);
    return () => {
      if (hasBeenInView) onAudioVisualsExit?.();
      obs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadItems = useCallback((type) => {
    setLoading(true);
    const qs = type === "all" ? "" : `?type=${encodeURIComponent(type)}`;
    fetch(`/api/audio-visual/browse${qs}`)
      .then((r) => r.json())
      .then((json) => setItems(json.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadItems(activeType); }, [activeType, loadItems]);

  const handleCardClick = useCallback((item) => {
    if (item.kind === "seriez") setOpenSeriezId(item.seriez_id);
    else setPlayingVideo({ video_id: item.video_id, title: item.title, poster_url: item.poster_url });
  }, []);

  return (
    <div ref={sectionRef}>
      <div className="audio-visuals-heading" style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <h2 className="section-heading audio-visuals-heading__title" style={{ margin: 0 }}>Audio Visualz</h2>
      </div>

      <div style={{ marginBottom: 18 }}>
        <PillRow activeType={activeType} onSelect={setActiveType} />
      </div>

      {openSeriezId ? (
        <SeriezDetailView
          seriezId={openSeriezId}
          onBack={() => setOpenSeriezId(null)}
          onPlay={(ep) => setPlayingVideo({ video_id: ep.video_id, title: ep.title, poster_url: ep.poster_url })}
        />
      ) : loading ? (
        <div style={{ color: "#666", fontSize: 13, padding: "30px 0" }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: "#666", fontSize: 13, padding: "30px 0" }}>Nothing here yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>
          {items.map((item) => (
            <PosterCard key={item.kind === "seriez" ? `s-${item.seriez_id}` : `v-${item.video_id}`} item={item} onClick={() => handleCardClick(item)} />
          ))}
        </div>
      )}

      {playingVideo && (
        <AudioVisualPlayer
          videoId={playingVideo.video_id}
          title={playingVideo.title}
          posterUrl={playingVideo.poster_url}
          onClose={() => setPlayingVideo(null)}
        />
      )}
    </div>
  );
});

export default AudioVisualsSection;

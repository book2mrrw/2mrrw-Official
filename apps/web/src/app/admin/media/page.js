"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "book2mrrw@gmail.com").toLowerCase();

function isAdmin(session) {
  return (session?.user?.email?.toLowerCase() || "") === ADMIN_EMAIL;
}

function releaseTypeSlug(type) {
  if (!type) return "singles";
  const t = String(type).toLowerCase();
  if (t.includes("album")) return "albums";
  if (t.includes("ep") || t.includes("mixtape")) return "mixtapes-and-eps";
  if (t.includes("feature")) return "features";
  return "singles";
}

export default function AdminMediaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [releases, setReleases] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    sb.auth.getSession().then(({ data }) => {
      if (!isAdmin(data.session)) { router.replace("/"); return; }
      setReady(true);
      loadCatalog();
    });
  }, [router]);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const res = await fetch("/api/catalog/releases?limit=50");
      const data = await res.json();
      setReleases(data.tracks || []);
    } catch {
      // silently keep empty
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  if (!ready) return <div style={s.page}><div style={s.spinner} /></div>;

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logo}>2MRRW ADMIN</div>
          <div style={s.title}>Audio Refresh</div>
          <div style={s.sub}>
            Upload a new file to R2, then tap the track below to clear old HLS segments and re-transcode.
          </div>
        </div>

        {loadingCatalog ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <div style={s.spinner} />
          </div>
        ) : releases.length === 0 ? (
          <div style={{ padding: "32px 28px", color: "rgba(255,255,255,.3)", fontSize: 13, textAlign: "center" }}>
            No releases found
          </div>
        ) : (
          <div style={s.list}>
            {releases.map((release) => (
              <ReleaseRow key={release.slug || release.id} release={release} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReleaseRow({ release }) {
  const slug = release.slug || release.productSlug;
  const title = release.title || slug;
  const type = releaseTypeSlug(release.type);
  const tracks = Array.isArray(release.tracks) && release.tracks.length > 1 ? release.tracks : null;

  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState(null); // null | "loading" | result | "error"

  const refresh = useCallback(async (trackSlug) => {
    setState("loading");
    try {
      const res = await fetch("/api/admin/media/refresh-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, trackSlug: trackSlug || null, releaseType: type }),
      });
      const data = await res.json();
      setState(res.ok ? data : { error: data.error || "Failed" });
    } catch (err) {
      setState({ error: err.message || "Network error" });
    }
  }, [slug, type]);

  const isLoading = state === "loading";
  const result = state && state !== "loading" ? state : null;
  const allGreen = result && !result.error && Object.values(result.steps || {}).every((v) => v === true || (typeof v === "number" && v >= 0));

  return (
    <div style={s.releaseRow}>
      <div style={s.releaseTop}>
        <div style={s.releaseMeta}>
          <div style={s.releaseTitle}>{title}</div>
          <div style={s.releaseSlug}>{slug} · {type}</div>
        </div>
        <div style={s.releaseActions}>
          {tracks ? (
            <button
              type="button"
              style={s.expandBtn}
              onClick={() => { setExpanded((e) => !e); setState(null); }}
            >
              {expanded ? "▲ tracks" : "▼ tracks"}
            </button>
          ) : (
            <RefreshButton loading={isLoading} onClick={() => refresh(null)} result={result} allGreen={allGreen} />
          )}
        </div>
      </div>

      {tracks && expanded ? (
        <div style={s.trackList}>
          {tracks.map((track, i) => (
            <TrackRefreshRow
              key={track.slug || track.id || i}
              track={track}
              onRefresh={() => refresh(track.slug || null)}
            />
          ))}
        </div>
      ) : null}

      {result && !tracks ? (
        <ResultBar result={result} allGreen={allGreen} />
      ) : null}
    </div>
  );
}

function TrackRefreshRow({ track, onRefresh }) {
  const [state, setState] = useState(null);
  const isLoading = state === "loading";
  const result = state && state !== "loading" ? state : null;
  const allGreen = result && !result.error && Object.values(result.steps || {}).every((v) => v === true || (typeof v === "number" && v >= 0));

  const go = useCallback(async () => {
    setState("loading");
    try {
      const r = await onRefresh();
      setState(r);
    } catch (err) {
      setState({ error: err?.message || "Error" });
    }
  }, [onRefresh]);

  return (
    <div style={s.trackRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.trackTitle}>{track.position ? `${track.position}. ` : ""}{track.title || track.slug}</div>
        {result ? <ResultBar result={result} allGreen={allGreen} compact /> : null}
      </div>
      <RefreshButton loading={isLoading} onClick={go} result={result} allGreen={allGreen} small />
    </div>
  );
}

function RefreshButton({ loading, onClick, result, allGreen, small }) {
  const done = result && !result.error;
  const failed = result?.error;
  const bg = done ? (allGreen ? "#22c55e22" : "#f59e0b22") : "#9b5de522";
  const border = done ? (allGreen ? "#22c55e55" : "#f59e0b55") : "#9b5de555";
  const color = done ? (allGreen ? "#22c55e" : "#f59e0b") : "#c77dff";
  const label = loading ? "…" : done ? (allGreen ? "✓ Done" : "⚠ Partial") : failed ? "✗ Error" : "Refresh";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: small ? 8 : 10,
        padding: small ? "5px 12px" : "8px 18px",
        fontSize: small ? 10 : 11,
        fontFamily: "'DM Mono',monospace",
        letterSpacing: ".12em",
        color,
        cursor: loading ? "default" : "pointer",
        flexShrink: 0,
        opacity: loading ? 0.65 : 1,
        transition: "all .15s",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function ResultBar({ result, allGreen, compact }) {
  if (!result) return null;
  if (result.error) {
    return <div style={{ ...s.resultNote, color: "#ef4444" }}>{result.error}</div>;
  }
  const { steps } = result;
  return (
    <div style={s.resultNote}>
      {allGreen ? (
        <span style={{ color: "#22c55e" }}>Refreshed — new transcode queued. Audio updates in ~2 min.</span>
      ) : (
        <>
          {!steps?.jobQueued && <span style={{ color: "#f59e0b" }}>No source key found in R2 — check the bucket. </span>}
          {steps?.segmentsFailed > 0 && <span style={{ color: "#f59e0b" }}>{steps.segmentsFailed} segment delete(s) failed. </span>}
          {steps?.cacheInvalidated && <span style={{ color: "#22c55e" }}>Caches cleared.</span>}
        </>
      )}
    </div>
  );
}

const s = {
  page: {
    minHeight: "100dvh",
    background: "#0a0a0a",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "48px 16px 80px",
  },
  card: {
    width: "100%",
    maxWidth: 560,
    background: "#111",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,.08)",
    overflow: "hidden",
  },
  header: {
    padding: "28px 28px 22px",
    borderBottom: "1px solid rgba(255,255,255,.06)",
  },
  logo: {
    fontFamily: "'DM Mono',monospace",
    fontSize: 8,
    letterSpacing: ".3em",
    color: "#9b5de5",
    marginBottom: 8,
  },
  title: {
    fontFamily: "'Cormorant Garamond',serif",
    fontSize: 26,
    fontWeight: 500,
    color: "white",
    marginBottom: 6,
  },
  sub: {
    fontSize: 12,
    color: "rgba(255,255,255,.38)",
    lineHeight: 1.6,
  },
  list: {
    display: "flex",
    flexDirection: "column",
  },
  releaseRow: {
    borderBottom: "1px solid rgba(255,255,255,.05)",
  },
  releaseTop: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 20px",
  },
  releaseMeta: {
    flex: 1,
    minWidth: 0,
  },
  releaseTitle: {
    fontSize: 13,
    color: "rgba(255,255,255,.82)",
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  releaseSlug: {
    fontFamily: "'DM Mono',monospace",
    fontSize: 9,
    color: "rgba(255,255,255,.25)",
    marginTop: 2,
    letterSpacing: ".06em",
  },
  releaseActions: {
    flexShrink: 0,
  },
  expandBtn: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 9,
    fontFamily: "'DM Mono',monospace",
    letterSpacing: ".1em",
    color: "rgba(255,255,255,.4)",
    cursor: "pointer",
  },
  trackList: {
    borderTop: "1px solid rgba(255,255,255,.04)",
    background: "rgba(0,0,0,.2)",
    padding: "4px 0 8px",
  },
  trackRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 20px 8px 28px",
  },
  trackTitle: {
    fontSize: 12,
    color: "rgba(255,255,255,.6)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginBottom: 2,
  },
  resultNote: {
    fontSize: 11,
    color: "rgba(255,255,255,.38)",
    lineHeight: 1.5,
    padding: "0 20px 10px",
  },
  spinner: {
    width: 20,
    height: 20,
    border: "2px solid rgba(155,93,229,.2)",
    borderTop: "2px solid #9b5de5",
    borderRadius: "50%",
  },
};

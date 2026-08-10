"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "book2mrrw@gmail.com").toLowerCase();

function isAdminSession(session) {
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

async function fireRefresh(slug, trackSlug, releaseType) {
  const res = await fetch("/api/admin/media/refresh-track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, trackSlug: trackSlug || null, releaseType }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed");
  return data;
}

export default function AdminMediaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [releases, setReleases] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [bulkState, setBulkState] = useState(null);

  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    sb.auth.getSession().then(({ data }) => {
      if (!isAdminSession(data.session)) { router.replace("/"); return; }
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

  const refreshAll = useCallback(async () => {
    if (!releases.length || bulkState?.running) return;
    const tasks = [];
    for (const release of releases) {
      const slug = release.slug || release.productSlug;
      const type = releaseTypeSlug(release.type);
      const tracks = Array.isArray(release.tracks) && release.tracks.length > 1 ? release.tracks : null;
      if (tracks) {
        for (const track of tracks) tasks.push({ slug, trackSlug: track.slug || null, releaseType: type });
      } else {
        tasks.push({ slug, trackSlug: null, releaseType: type });
      }
    }
    setBulkState({ running: true, total: tasks.length, done: 0, failed: 0 });
    let done = 0, failed = 0;
    for (const task of tasks) {
      try { await fireRefresh(task.slug, task.trackSlug, task.releaseType); }
      catch { failed++; }
      done++;
      setBulkState({ running: done < tasks.length, total: tasks.length, done, failed });
    }
    setBulkState({ running: false, total: tasks.length, done, failed });
  }, [releases, bulkState]);

  if (!ready) return <div style={s.page}><div style={s.spinner} /></div>;

  const bulkLabel = bulkState?.running
    ? `Refreshing ${bulkState.done}/${bulkState.total}…`
    : bulkState
    ? `Done — ${bulkState.done - bulkState.failed} ok${bulkState.failed ? `, ${bulkState.failed} failed` : ""}`
    : "⟳  Refresh Entire Catalog";

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logo}>2MRRW ADMIN</div>
          <div style={s.title}>Audio Refresh</div>
          <div style={s.sub}>
            Upload a new file to R2, then tap below. Refreshes clear HLS segments and re-transcode —
            updates propagate to all listeners across every tier.
          </div>
          <button
            type="button"
            onClick={refreshAll}
            disabled={bulkState?.running || loadingCatalog || releases.length === 0}
            style={{
              marginTop: 16,
              background: bulkState && !bulkState.running && !bulkState.failed
                ? "rgba(34,197,94,.15)"
                : "rgba(155,93,229,.18)",
              border: `1px solid ${bulkState && !bulkState.running && !bulkState.failed ? "rgba(34,197,94,.45)" : "rgba(155,93,229,.5)"}`,
              borderRadius: 10,
              padding: "10px 22px",
              fontSize: 11,
              fontFamily: "'DM Mono',monospace",
              letterSpacing: ".12em",
              color: bulkState && !bulkState.running && !bulkState.failed ? "#22c55e" : "#c77dff",
              cursor: (bulkState?.running || loadingCatalog || releases.length === 0) ? "default" : "pointer",
              opacity: (bulkState?.running || loadingCatalog || releases.length === 0) ? 0.6 : 1,
              transition: "all .15s",
            }}
          >
            {bulkLabel}
          </button>
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

  const [singleState, setSingleState] = useState(null);
  const [wholeState, setWholeState] = useState(null);

  const refreshSingle = useCallback(async () => {
    setSingleState("loading");
    try {
      const data = await fireRefresh(slug, null, type);
      setSingleState(data);
    } catch (err) {
      setSingleState({ error: err.message || "Failed" });
    }
  }, [slug, type]);

  const refreshWhole = useCallback(async () => {
    if (!tracks || wholeState?.running) return;
    setWholeState({ running: true, total: tracks.length, done: 0, failed: 0 });
    let done = 0, failed = 0;
    for (const track of tracks) {
      try { await fireRefresh(slug, track.slug || null, type); }
      catch { failed++; }
      done++;
      setWholeState({ running: done < tracks.length, total: tracks.length, done, failed });
    }
    setWholeState({ running: false, total: tracks.length, done, failed });
  }, [slug, type, tracks, wholeState]);

  const singleResult = singleState && singleState !== "loading" ? singleState : null;
  const singleGreen = singleResult && !singleResult.error &&
    Object.values(singleResult.steps || {}).every((v) => v === true || (typeof v === "number" && v >= 0));

  const wholeColor = !wholeState ? "#c77dff"
    : wholeState.running ? "#c77dff"
    : wholeState.failed ? "#f59e0b"
    : "#22c55e";
  const wholeBg = !wholeState ? "rgba(155,93,229,.15)"
    : wholeState.running ? "rgba(155,93,229,.1)"
    : wholeState.failed ? "rgba(245,158,11,.12)"
    : "rgba(34,197,94,.12)";
  const wholeBorder = !wholeState ? "rgba(155,93,229,.4)"
    : wholeState.running ? "rgba(155,93,229,.3)"
    : wholeState.failed ? "rgba(245,158,11,.4)"
    : "rgba(34,197,94,.4)";
  const wholeLabel = !wholeState ? "Refresh All"
    : wholeState.running ? `${wholeState.done}/${wholeState.total}…`
    : wholeState.failed ? `⚠ ${wholeState.failed} failed`
    : "✓ Done";

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
              onClick={refreshWhole}
              disabled={wholeState?.running}
              style={{
                background: wholeBg,
                border: `1px solid ${wholeBorder}`,
                borderRadius: 10,
                padding: "7px 14px",
                fontSize: 10,
                fontFamily: "'DM Mono',monospace",
                letterSpacing: ".1em",
                color: wholeColor,
                cursor: wholeState?.running ? "default" : "pointer",
                opacity: wholeState?.running ? 0.65 : 1,
                transition: "all .15s",
                whiteSpace: "nowrap",
              }}
            >
              {wholeLabel}
            </button>
          ) : (
            <TrackIconButton
              loading={singleState === "loading"}
              result={singleResult}
              allGreen={singleGreen}
              onClick={refreshSingle}
              large
            />
          )}
        </div>
      </div>

      {singleResult && !tracks && (
        <ResultBar result={singleResult} allGreen={singleGreen} />
      )}

      {tracks && (
        <div style={s.trackList}>
          {tracks.map((track, i) => (
            <TrackRefreshRow
              key={track.slug || track.id || i}
              track={track}
              slug={slug}
              releaseType={type}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrackRefreshRow({ track, slug, releaseType }) {
  const [state, setState] = useState(null);
  const isLoading = state === "loading";
  const result = state && state !== "loading" ? state : null;
  const allGreen = result && !result.error &&
    Object.values(result.steps || {}).every((v) => v === true || (typeof v === "number" && v >= 0));

  const go = useCallback(async () => {
    setState("loading");
    try {
      const data = await fireRefresh(slug, track.slug || null, releaseType);
      setState(data);
    } catch (err) {
      setState({ error: err?.message || "Error" });
    }
  }, [slug, track.slug, releaseType]);

  return (
    <div style={s.trackRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.trackTitle}>
          {track.position ? `${track.position}. ` : ""}
          {track.title || track.slug}
        </div>
        {result ? <ResultBar result={result} allGreen={allGreen} compact /> : null}
      </div>
      <TrackIconButton loading={isLoading} result={result} allGreen={allGreen} onClick={go} />
    </div>
  );
}

function TrackIconButton({ loading, result, allGreen, onClick, large }) {
  const done = result && !result.error;
  const failed = result?.error;
  const color = done ? (allGreen ? "#22c55e" : "#f59e0b") : failed ? "#ef4444" : "#ff6400";
  const bg = done
    ? (allGreen ? "rgba(34,197,94,.12)" : "rgba(245,158,11,.12)")
    : failed
    ? "rgba(239,68,68,.1)"
    : "rgba(255,100,0,.1)";
  const border = done
    ? (allGreen ? "rgba(34,197,94,.35)" : "rgba(245,158,11,.35)")
    : failed
    ? "rgba(239,68,68,.3)"
    : "rgba(255,100,0,.35)";
  const icon = loading ? "…" : done ? (allGreen ? "✓" : "⚠") : failed ? "✗" : "⟳";
  const size = large ? 36 : 30;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title="Refresh audio"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: large ? 16 : 14,
        color,
        cursor: loading ? "default" : "pointer",
        opacity: loading ? 0.5 : 1,
        transition: "all .15s",
        flexShrink: 0,
      }}
    >
      {icon}
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
        <span style={{ color: "#22c55e" }}>Queued — audio updates in ~2 min.</span>
      ) : (
        <>
          {!steps?.jobQueued && (
            <span style={{ color: "#f59e0b" }}>No source key in R2 — check the bucket. </span>
          )}
          {steps?.segmentsFailed > 0 && (
            <span style={{ color: "#f59e0b" }}>{steps.segmentsFailed} segment delete(s) failed. </span>
          )}
          {steps?.cacheInvalidated && (
            <span style={{ color: "#22c55e" }}>Caches cleared.</span>
          )}
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
    maxWidth: 580,
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
  trackList: {
    borderTop: "1px solid rgba(255,255,255,.04)",
    background: "rgba(0,0,0,.2)",
    padding: "4px 0 8px",
  },
  trackRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 16px 8px 28px",
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
    animation: "spin 0.8s linear infinite",
  },
};

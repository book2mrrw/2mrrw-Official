"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "book2mrrw@gmail.com").toLowerCase();

function isAdmin(session) {
  return (session?.user?.email?.toLowerCase() || "") === ADMIN_EMAIL;
}

const RELEASE_TYPES = ["singles", "albums", "features", "mixtapes-and-eps", "eps"];

export default function AdminMediaPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_PUBLIC_KEY
    );
    sb.auth.getSession().then(({ data }) => {
      if (!isAdmin(data.session)) { router.replace("/"); return; }
      setSession(data.session);
      setChecked(true);
    });
  }, [router]);

  if (!checked) return <div style={styles.page}><div style={styles.spinner} /></div>;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.logo}>2MRRW</div>
          <div style={styles.title}>Audio Refresh</div>
          <div style={styles.sub}>
            Use this after uploading a new audio file to R2. Clears old HLS segments,
            invalidates all caches, and re-queues transcoding.
          </div>
        </div>
        <RefreshForm />
      </div>
    </div>
  );
}

function RefreshForm() {
  const [slug, setSlug] = useState("");
  const [trackSlug, setTrackSlug] = useState("");
  const [releaseType, setReleaseType] = useState("singles");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const submit = useCallback(async (e) => {
    e.preventDefault();
    if (!slug.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/media/refresh-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          trackSlug: trackSlug.trim() || null,
          releaseType,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Request failed"); return; }
      setResult(data);
    } catch (err) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [slug, trackSlug, releaseType]);

  const allGreen = result && Object.values(result.steps || {}).every((v) => v === true || (typeof v === "number" && v >= 0));

  return (
    <form onSubmit={submit} style={styles.form}>
      <label style={styles.label}>
        Slug <span style={styles.required}>*</span>
        <input
          style={styles.input}
          placeholder="e.g. my-track-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
        />
        <span style={styles.hint}>The slug of the album or single you uploaded audio for</span>
      </label>

      <label style={styles.label}>
        Track Slug <span style={styles.optional}>(optional)</span>
        <input
          style={styles.input}
          placeholder="e.g. track-title-slug — leave blank for single-track releases"
          value={trackSlug}
          onChange={(e) => setTrackSlug(e.target.value)}
        />
        <span style={styles.hint}>Only needed for multi-track albums — the specific track within the release</span>
      </label>

      <label style={styles.label}>
        Release Type
        <select
          style={{ ...styles.input, cursor: "pointer" }}
          value={releaseType}
          onChange={(e) => setReleaseType(e.target.value)}
        >
          {RELEASE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <button type="submit" style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh Audio"}
      </button>

      {error ? (
        <div style={styles.errorBox}>{error}</div>
      ) : null}

      {result ? (
        <div style={{ ...styles.resultBox, borderColor: allGreen ? "#22c55e44" : "#f59e0b44" }}>
          <div style={{ ...styles.resultTitle, color: allGreen ? "#22c55e" : "#f59e0b" }}>
            {allGreen ? "Refresh complete" : "Partial refresh — check steps below"}
          </div>
          <div style={styles.stepGrid}>
            <StepRow label="Job cancelled" value={result.steps?.jobCancelled} />
            <StepRow label="Manifest deleted" value={result.steps?.manifestDeleted} />
            <StepRow label="HLS segments deleted" value={result.steps?.segmentsDeleted} numeric suffix={`(${result.steps?.segmentsFailed ?? 0} failed)`} />
            <StepRow label="Caches invalidated" value={result.steps?.cacheInvalidated} />
            <StepRow label="Transcode re-queued" value={result.steps?.jobQueued} />
          </div>
          {result.steps?.jobQueued ? (
            <div style={styles.notice}>
              New transcode job queued. Audio will update in a few minutes once the HLS worker finishes.
            </div>
          ) : result.steps?.cacheInvalidated && !result.steps?.jobQueued ? (
            <div style={{ ...styles.notice, color: "#f59e0b" }}>
              Caches cleared but no source audio key found — check that the R2 key matches what&apos;s in Supabase.
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function StepRow({ label, value, numeric, suffix }) {
  const ok = numeric ? value > 0 : value === true;
  const icon = ok ? "✓" : numeric && value === 0 ? "—" : "✗";
  const color = ok ? "#22c55e" : numeric && value === 0 ? "#555" : "#ef4444";
  return (
    <div style={styles.stepRow}>
      <span style={{ color, fontWeight: 700, minWidth: 16 }}>{icon}</span>
      <span style={styles.stepLabel}>{label}</span>
      {numeric ? <span style={{ color: "#555", fontSize: 11 }}>{value} {suffix}</span> : null}
    </div>
  );
}

const styles = {
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
    maxWidth: 520,
    background: "#111",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,.08)",
    overflow: "hidden",
  },
  header: {
    padding: "32px 32px 24px",
    borderBottom: "1px solid rgba(255,255,255,.06)",
  },
  logo: {
    fontFamily: "'DM Mono',monospace",
    fontSize: 9,
    letterSpacing: ".3em",
    color: "#9b5de5",
    marginBottom: 10,
  },
  title: {
    fontFamily: "'Cormorant Garamond',serif",
    fontSize: 28,
    fontWeight: 500,
    color: "white",
    lineHeight: 1.15,
    marginBottom: 8,
  },
  sub: {
    fontSize: 13,
    color: "rgba(255,255,255,.42)",
    lineHeight: 1.6,
  },
  form: {
    padding: "28px 32px 36px",
    display: "flex",
    flexDirection: "column",
    gap: 22,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontFamily: "'DM Mono',monospace",
    fontSize: 9,
    letterSpacing: ".18em",
    color: "rgba(255,255,255,.5)",
  },
  required: { color: "#9b5de5" },
  optional: { color: "rgba(255,255,255,.25)", fontWeight: 400 },
  input: {
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 13,
    color: "white",
    fontFamily: "inherit",
    outline: "none",
    transition: "border-color .15s",
  },
  hint: {
    fontSize: 10,
    color: "rgba(255,255,255,.22)",
    letterSpacing: ".05em",
    lineHeight: 1.5,
  },
  btn: {
    background: "#9b5de5",
    border: "none",
    borderRadius: 12,
    padding: "14px 24px",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "'DM Mono',monospace",
    letterSpacing: ".12em",
    color: "white",
    cursor: "pointer",
    transition: "opacity .15s",
    marginTop: 4,
  },
  errorBox: {
    background: "rgba(239,68,68,.08)",
    border: "1px solid rgba(239,68,68,.25)",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 13,
    color: "#ef4444",
  },
  resultBox: {
    background: "rgba(255,255,255,.03)",
    border: "1px solid",
    borderRadius: 12,
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  resultTitle: {
    fontFamily: "'DM Mono',monospace",
    fontSize: 9,
    letterSpacing: ".2em",
    fontWeight: 700,
  },
  stepGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  stepRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "rgba(255,255,255,.65)",
  },
  stepLabel: {
    flex: 1,
  },
  notice: {
    fontSize: 12,
    color: "rgba(255,255,255,.4)",
    lineHeight: 1.55,
    borderTop: "1px solid rgba(255,255,255,.06)",
    paddingTop: 12,
  },
  spinner: {
    width: 24,
    height: 24,
    border: "2px solid rgba(155,93,229,.2)",
    borderTop: "2px solid #9b5de5",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};

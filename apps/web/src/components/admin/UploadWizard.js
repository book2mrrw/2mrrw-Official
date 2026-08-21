"use client";

import { useState, useRef, useCallback } from "react";

// ── Helpers ─────────────────────────────────────────────────────────────────────
function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `release-${Date.now()}`;
}

function slugifyTrack(title, position) {
  const base = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const num = String(position).padStart(2, "0");
  return base ? `${num}-${base}` : `track-${position}`;
}

export function newTrack(position) {
  return {
    tempId:           `t-${Date.now()}-${position}`,
    id:               null,
    position,
    title:            "",
    slug:             `track-${position}`,
    audio_key:        "",
    audio_filename:   "",
    upload_status:    "idle",
    upload_progress:  0,
    upload_error:     null,
    featured_artists: null,
    content_rating:   null,
    isrc:             "",
    lyrics:           "",
  };
}

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

// ── UI atoms ─────────────────────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.muted2, textTransform: "uppercase", marginBottom: 7 }}>
      {children}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {label && <Label>{label}</Label>}
      {children}
      {hint && <div style={{ fontSize: 11, color: C.muted2, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text", style = {} }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
        borderRadius: 8, color: C.text, fontSize: 14, padding: "10px 13px",
        outline: "none", boxSizing: "border-box", fontFamily: "inherit", ...style,
      }}
    />
  );
}

function Select({ value, onChange, children, style = {} }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
        borderRadius: 8, color: C.text, fontSize: 14, padding: "10px 13px",
        outline: "none", boxSizing: "border-box", fontFamily: "inherit", ...style,
      }}
    >
      {children}
    </select>
  );
}

function Textarea({ value, onChange, placeholder, rows = 6 }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
        borderRadius: 8, color: C.text, fontSize: 13, padding: "10px 13px",
        outline: "none", boxSizing: "border-box", fontFamily: "inherit",
        resize: "vertical", lineHeight: 1.6,
      }}
    />
  );
}

function Btn({ onClick, children, variant = "primary", disabled = false, style = {} }) {
  const base = {
    border: "none", borderRadius: 9, padding: "12px 24px", fontSize: 13,
    fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit", transition: "opacity 0.15s", ...style,
  };
  const variants = {
    primary:   { background: C.accent,   color: "#000" },
    secondary: { background: C.surface2, color: C.text, border: `1px solid ${C.border2}` },
    danger:    { background: C.error,    color: "#fff" },
    ghost:     { background: "none",     color: C.muted, border: `1px solid ${C.border}` },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
}

function TagList({ items, onRemove }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{
          background: C.accentDim, border: `1px solid ${C.accentBorder}`,
          borderRadius: 20, padding: "4px 12px", fontSize: 12, color: C.accent,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {item}
          <span onClick={() => onRemove(i)} style={{ cursor: "pointer", opacity: 0.7, fontSize: 14 }}>×</span>
        </div>
      ))}
    </div>
  );
}

function MultiEntry({ label, items, onAdd, onRemove, placeholder }) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (v && !items.includes(v)) { onAdd(v); setVal(""); }
  };
  return (
    <Field label={label}>
      <div style={{ display: "flex", gap: 8 }}>
        <Input value={val} onChange={setVal} placeholder={placeholder} style={{ flex: 1 }} />
        <Btn onClick={add} variant="secondary" style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>+ Add</Btn>
      </div>
      <TagList items={items} onRemove={onRemove} />
    </Field>
  );
}

// ── Step progress bar ────────────────────────────────────────────────────────────
function StepBar({ steps, current }) {
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 36, overflowX: "auto" }}>
      {steps.map((label, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center",
                background:  done ? C.success : active ? C.accent : C.surface2,
                border:     `2px solid ${done ? C.success : active ? C.accent : C.border2}`,
                fontSize: 11, fontWeight: 800,
                color: done || active ? "#000" : C.muted,
              }}>
                {done ? "✓" : i + 1}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textAlign: "center",
                whiteSpace: "nowrap", color: active ? C.accent : done ? C.success : C.muted2,
              }}>
                {label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ height: 2, flex: 1, background: done ? C.success : C.border2, margin: "0 6px", marginBottom: 22 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 0: Release Type ─────────────────────────────────────────────────────────
function ReleaseTypeStep({ data, onChange, onNext, loading }) {
  const TYPES = [
    { value: "single",  label: "Single",  desc: "One track, solo or feature" },
    { value: "feature", label: "Feature", desc: "Collab where 2MRRW is featured" },
    { value: "ep",      label: "EP",      desc: "3–6 track project" },
    { value: "mixtape", label: "Mixtape", desc: "Full-length informal release" },
    { value: "album",   label: "Album",   desc: "Official full-length LP" },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>What are you releasing?</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 28 }}>This creates your private draft — nothing goes live until you publish.</p>

      <Field label="Release Type">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          {TYPES.map((t) => (
            <div
              key={t.value}
              onClick={() => onChange("release_type", t.value)}
              style={{
                background: data.release_type === t.value ? C.accentDim : C.surface2,
                border: `2px solid ${data.release_type === t.value ? C.accent : C.border2}`,
                borderRadius: 10, padding: "14px 16px", cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: data.release_type === t.value ? C.accent : C.text }}>{t.label}</div>
              <div style={{ fontSize: 11, color: C.muted2, marginTop: 3 }}>{t.desc}</div>
            </div>
          ))}
        </div>
      </Field>

      {(data.release_type === "single" || data.release_type === "feature") && (
        <Field label="Artist Configuration">
          <div style={{ display: "flex", gap: 10 }}>
            {["solo", "featured"].map((v) => (
              <div
                key={v}
                onClick={() => onChange("artist_mode", v)}
                style={{
                  background: data.artist_mode === v ? C.accentDim : C.surface2,
                  border: `2px solid ${data.artist_mode === v ? C.accent : C.border2}`,
                  borderRadius: 8, padding: "10px 18px", cursor: "pointer",
                  fontSize: 13, fontWeight: 700,
                  color: data.artist_mode === v ? C.accent : C.text,
                }}
              >
                {v === "solo" ? "Solo Release" : "Has Featured Artist(s)"}
              </div>
            ))}
          </div>
        </Field>
      )}

      <Btn onClick={onNext} disabled={!data.release_type || loading}>
        {loading ? "Creating Draft…" : "Continue →"}
      </Btn>
    </div>
  );
}

// ── Step 1: Release Info ─────────────────────────────────────────────────────────
function ReleaseInfoStep({ data, onChange, onNext, onBack }) {
  const isSingle    = data.release_type === "single" || data.release_type === "feature";
  const hasFeatured = data.artist_mode === "featured" || data.release_type === "feature";
  const GENRES = ["R&B","Hip-Hop","Pop","Alternative R&B","Soul","Neo-Soul","Trap","Rap","Electronic","Other"];

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>Release Information</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 28 }}>This is how your release appears to fans.</p>

      <Field label={isSingle ? "Song Title" : "Project Title"} hint="Required">
        <Input
          value={data.title}
          onChange={(v) => {
            onChange("title", v);
            onChange("proposed_slug", slugify(v));
          }}
          placeholder={isSingle ? "e.g. Hour Glass" : "e.g. Love Hz Vol. 2"}
        />
      </Field>

      <Field label="Primary Artist">
        <Input value={data.primary_artist} onChange={(v) => onChange("primary_artist", v)} placeholder="2MRRW" />
      </Field>

      {hasFeatured && (
        <MultiEntry
          label="Featured Artist(s)"
          items={data.featured_artists}
          onAdd={(v) => onChange("featured_artists", [...data.featured_artists, v])}
          onRemove={(i) => onChange("featured_artists", data.featured_artists.filter((_, idx) => idx !== i))}
          placeholder="Artist name"
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Original Release Date">
          <Input type="date" value={data.release_date} onChange={(v) => onChange("release_date", v)} />
        </Field>
        <Field label="Genre">
          <Select value={data.genre} onChange={(v) => onChange("genre", v)}>
            <option value="">Select genre…</option>
            {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Field>
      </div>

      {isSingle && (
        <Field label="Content Rating">
          <div style={{ display: "flex", gap: 10 }}>
            {["clean", "explicit", "instrumental"].map((v) => (
              <div
                key={v}
                onClick={() => onChange("content_rating", v)}
                style={{
                  background: data.content_rating === v ? C.accentDim : C.surface2,
                  border: `2px solid ${data.content_rating === v ? C.accent : C.border2}`,
                  borderRadius: 8, padding: "9px 16px", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, textTransform: "capitalize",
                  color: data.content_rating === v ? C.accent : C.text,
                }}
              >
                {v}
              </div>
            ))}
          </div>
        </Field>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Price" hint="Default: $2.99 single · $9.99 EP/Mixtape · $12.99 album">
          <Input
            type="number"
            value={data.price}
            onChange={(v) => onChange("price", v)}
            placeholder={data.release_type === "album" ? "12.99" : data.release_type === "ep" || data.release_type === "mixtape" ? "9.99" : "2.99"}
          />
        </Field>
        <Field label="Publication">
          <Select value={data.publish_mode} onChange={(v) => onChange("publish_mode", v)}>
            <option value="immediate">Release Immediately</option>
            <option value="scheduled">Schedule Release</option>
          </Select>
        </Field>
      </div>

      {data.publish_mode === "scheduled" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Publish Date">
            <Input type="date" value={data.scheduled_date} onChange={(v) => onChange("scheduled_date", v)} />
          </Field>
          <Field label="Publish Time (UTC)">
            <Input type="time" value={data.scheduled_time} onChange={(v) => onChange("scheduled_time", v)} />
          </Field>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <Btn onClick={onBack} variant="secondary">← Back</Btn>
        <Btn onClick={onNext} disabled={!data.title}>Continue →</Btn>
      </div>
    </div>
  );
}

// ── Step 2: Credits ──────────────────────────────────────────────────────────────
function CreditsStep({ data, onChange, onNext, onBack, isMultiTrack }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>Credits</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 28 }}>
        {isMultiTrack
          ? "Project-level credits — used as defaults for all tracks. Override per track in the next steps."
          : "Internal record — not shown publicly on the fan site."}
      </p>

      <MultiEntry
        label="Produced By"
        items={data.produced_by}
        onAdd={(v) => onChange("produced_by", [...data.produced_by, v])}
        onRemove={(i) => onChange("produced_by", data.produced_by.filter((_, idx) => idx !== i))}
        placeholder="Producer name"
      />

      <MultiEntry
        label="Written By"
        items={data.written_by}
        onAdd={(v) => onChange("written_by", [...data.written_by, v])}
        onRemove={(i) => onChange("written_by", data.written_by.filter((_, idx) => idx !== i))}
        placeholder="Writer name"
      />

      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{ background: "none", border: "none", color: C.accent, fontSize: 12, cursor: "pointer", padding: "4px 0", marginBottom: 16, fontFamily: "inherit" }}
      >
        {showAdvanced ? "▾ Hide" : "▸ Show"} Advanced Credits + Rights
      </button>

      {showAdvanced && (
        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Mixing Engineer">
              <Input value={data.mixing_engineer} onChange={(v) => onChange("mixing_engineer", v)} placeholder="Name" />
            </Field>
            <Field label="Mastering Engineer">
              <Input value={data.mastering_engineer} onChange={(v) => onChange("mastering_engineer", v)} placeholder="Name" />
            </Field>
            <Field label="Executive Producer">
              <Input value={data.executive_producer} onChange={(v) => onChange("executive_producer", v)} placeholder="Name" />
            </Field>
            {!isMultiTrack && (
              <Field label="ISRC">
                <Input value={data.isrc} onChange={(v) => onChange("isrc", v)} placeholder="e.g. USRC12345678" />
              </Field>
            )}
            <Field label="UPC / EAN">
              <Input value={data.upc} onChange={(v) => onChange("upc", v)} placeholder="e.g. 123456789012" />
            </Field>
            <Field label="℗ Copyright Year">
              <Input type="number" value={data.copyright_year} onChange={(v) => onChange("copyright_year", v)} placeholder={new Date().getFullYear().toString()} />
            </Field>
          </div>
          <Field label="© Composition Owner">
            <Input value={data.c_line} onChange={(v) => onChange("c_line", v)} placeholder="Publishing company or artist name" />
          </Field>
          <Field label="℗ Sound Recording Owner">
            <Input value={data.p_line} onChange={(v) => onChange("p_line", v)} placeholder="Label or artist name" />
          </Field>
          <Field label="Publishing Info">
            <Input value={data.publishing_credits} onChange={(v) => onChange("publishing_credits", v)} placeholder="PRO, publisher, admin" />
          </Field>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Btn onClick={onBack} variant="secondary">← Back</Btn>
        <Btn onClick={onNext}>Continue →</Btn>
      </div>
    </div>
  );
}

// ── Step 3a: Audio Upload (single / feature) ─────────────────────────────────────
function AudioUploadStep({ data, onChange, onNext, onBack, releaseId, draftSlug }) {
  const [uploadState, setUploadState] = useState({ status: "idle", progress: 0, error: null });
  const xhrRef = useRef(null);

  const upload = useCallback(async (file) => {
    if (!file) return;
    setUploadState({ status: "uploading", progress: 0, error: null });

    try {
      const presignRes = await fetch("/api/admin/upload/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseType: data.release_type,
          slug: draftSlug || `draft-${Date.now()}`,
          assetType: "audio",
          filename: file.name,
          contentType: file.type || "audio/wav",
          size: file.size,
        }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || "Failed to get upload URL");
      const { uploadUrl, key } = presignData;

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadState((s) => ({ ...s, progress: Math.round((e.loaded / e.total) * 100) }));
          }
        };
        xhr.onload  = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "audio/wav");
        xhr.send(file);
      });

      const completeRes = await fetch("/api/admin/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseId,
          key,
          assetType: "audio",
          releaseType: data.release_type,
          slug: draftSlug,
          trackTitle: data.title || "",
          position: 1,
        }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error || "Upload verification failed");

      onChange("audio_key", key);
      onChange("audio_filename", file.name);
      onChange("track_id", completeData.trackId);
      setUploadState({ status: "ready", progress: 100, error: null });
    } catch (err) {
      setUploadState({ status: "error", progress: 0, error: err.message });
    }
  }, [data.release_type, data.title, draftSlug, releaseId, onChange]);

  const pickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".wav,.flac,.aiff,.aif,audio/wav,audio/flac,audio/aiff";
    input.onchange = (e) => { if (e.target.files?.[0]) upload(e.target.files[0]); };
    input.click();
  };

  const { status, progress, error } = uploadState;

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>Upload Audio</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 28 }}>WAV, FLAC, or AIFF preferred. Upload goes directly to secure storage — Vercel is not in the data path.</p>

      <div
        onClick={status !== "uploading" ? pickFile : undefined}
        style={{
          background: C.surface2,
          border: `2px dashed ${status === "ready" ? C.success : status === "error" ? C.error : C.border2}`,
          borderRadius: 14, padding: "40px 24px", textAlign: "center",
          cursor: status !== "uploading" ? "pointer" : "default", marginBottom: 20,
        }}
      >
        {status === "idle" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🎵</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 700 }}>Tap to select audio file</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>WAV · FLAC · AIFF &nbsp;·&nbsp; Max 2 GB</div>
          </>
        )}
        {status === "uploading" && (
          <>
            <div style={{ fontSize: 13, color: C.accent, fontWeight: 700, marginBottom: 12 }}>Uploading… {progress}%</div>
            <div style={{ background: C.surface, borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ background: C.accent, width: `${progress}%`, height: "100%", transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>Do not close this tab</div>
          </>
        )}
        {status === "ready" && (
          <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 14, color: C.success, fontWeight: 700 }}>{data.audio_filename || "Audio uploaded"}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Tap to replace</div>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ fontSize: 13, color: C.error, fontWeight: 700 }}>Upload failed</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{error}</div>
            <div style={{ fontSize: 12, color: C.accent, marginTop: 8 }}>Tap to retry</div>
          </>
        )}
      </div>

      <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px", marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
          HLS transcoding queues automatically after upload. You can publish while HLS is still processing.
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <Btn onClick={onBack} variant="secondary">← Back</Btn>
        <Btn onClick={onNext} disabled={status !== "ready"}>Continue →</Btn>
      </div>
    </div>
  );
}

// ── Step 3b: Tracklist Builder (album / EP / mixtape) ────────────────────────────
const iconBtn = {
  background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 5, padding: "5px 9px",
  color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};

function TrackRow({ track, idx, total, albumSlug, data, releaseId, setTracks }) {
  const fileInputRef = useRef(null);
  const xhrRef       = useRef(null);

  const updateSelf = (updates) =>
    setTracks((prev) => prev.map((t) => t.tempId === track.tempId ? { ...t, ...updates } : t));

  const startUpload = async (file) => {
    const trackSlug = track.slug || slugifyTrack(track.title, track.position);
    updateSelf({ upload_status: "uploading", upload_progress: 0, upload_error: null, audio_filename: file.name, slug: trackSlug });

    try {
      const presignRes = await fetch("/api/admin/upload/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseType: data.release_type,
          slug: albumSlug,
          trackSlug,
          assetType: "audio",
          filename: file.name,
          contentType: file.type || "audio/wav",
          size: file.size,
          releaseId,
        }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || "Failed to get upload URL");
      const { uploadUrl, key } = presignData;

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            updateSelf({ upload_progress: Math.round((e.loaded / e.total) * 100) });
          }
        };
        xhr.onload  = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.open("PUT", uploadUrl);
        xhr.send(file);
      });

      const completeRes = await fetch("/api/admin/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseId,
          key,
          assetType: "audio",
          releaseType: data.release_type,
          slug: albumSlug,
          trackSlug,
          trackTitle: track.title || `Track ${track.position}`,
          position: track.position,
        }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error || "Upload verification failed");

      updateSelf({ id: completeData.trackId, audio_key: key, upload_status: "ready", upload_progress: 100, slug: trackSlug });
    } catch (err) {
      updateSelf({ upload_status: "error", upload_error: err.message });
    }
  };

  const moveUp = () =>
    setTracks((prev) => {
      const i = prev.findIndex((t) => t.tempId === track.tempId);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next.map((t, j) => ({ ...t, position: j + 1 }));
    });

  const moveDown = () =>
    setTracks((prev) => {
      const i = prev.findIndex((t) => t.tempId === track.tempId);
      if (i >= prev.length - 1) return prev;
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next.map((t, j) => ({ ...t, position: j + 1 }));
    });

  const removeTrack = () =>
    setTracks((prev) => {
      const filtered = prev.filter((t) => t.tempId !== track.tempId);
      return filtered.map((t, j) => ({ ...t, position: j + 1 }));
    });

  const titleChange = (v) =>
    setTracks((prev) => prev.map((t) => t.tempId === track.tempId
      ? { ...t, title: v, slug: slugifyTrack(v, t.position) }
      : t));

  const st = track.upload_status;
  const statusColor = { idle: C.muted2, uploading: C.accent, ready: C.success, error: C.error }[st] || C.muted2;

  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: C.muted2, minWidth: 22, textAlign: "right", fontWeight: 700 }}>{track.position}.</div>
        <input
          type="text"
          value={track.title}
          onChange={(e) => titleChange(e.target.value)}
          placeholder={`Track ${track.position} title`}
          style={{
            flex: 1, background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 6,
            color: C.text, fontSize: 13, padding: "8px 11px", outline: "none", fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={moveUp}   disabled={idx === 0}         style={iconBtn} title="Move up">↑</button>
          <button onClick={moveDown} disabled={idx === total - 1} style={iconBtn} title="Move down">↓</button>
          {total > 1 && (
            <button onClick={removeTrack} style={{ ...iconBtn, color: C.error }} title="Remove track">×</button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          {st === "idle" && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ background: "none", border: `1px dashed ${C.border2}`, borderRadius: 7, padding: "8px 14px", fontSize: 12, color: C.muted, cursor: "pointer", fontFamily: "inherit", width: "100%" }}
            >
              Select audio file…
            </button>
          )}
          {st === "uploading" && (
            <div style={{ fontSize: 12, color: C.accent }}>
              <div style={{ marginBottom: 5 }}>Uploading… {track.upload_progress}%</div>
              <div style={{ background: C.surface, borderRadius: 3, height: 4, overflow: "hidden" }}>
                <div style={{ background: C.accent, width: `${track.upload_progress}%`, height: "100%", transition: "width 0.2s" }} />
              </div>
            </div>
          )}
          {st === "ready" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.success }}>✓ {track.audio_filename || "Audio ready"}</span>
              <button onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", color: C.muted2, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>replace</button>
            </div>
          )}
          {st === "error" && (
            <div style={{ fontSize: 12, color: C.error }}>
              {track.upload_error || "Upload failed"} —{" "}
              <button onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", color: C.accent, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>retry</button>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: statusColor, fontWeight: 700, minWidth: 60, textAlign: "right" }}>
          {st === "idle" ? "No file" : st === "uploading" ? "Uploading" : st === "ready" ? "✓ Ready" : "Error"}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.flac,.aiff,.aif,audio/wav,audio/flac,audio/aiff"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.[0]) startUpload(e.target.files[0]); e.target.value = ""; }}
      />
    </div>
  );
}

function TracklistBuilderStep({ data, tracks, setTracks, onNext, onBack, releaseId, draftSlug }) {
  const albumSlug   = data.proposed_slug || draftSlug || `draft-${releaseId?.slice(0, 8)}`;
  const readyCount  = tracks.filter((t) => t.upload_status === "ready").length;
  const uploadingAny = tracks.some((t) => t.upload_status === "uploading");

  const addTrack = () =>
    setTracks((prev) => [...prev, newTrack(prev.length + 1)]);

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>Build Tracklist</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>
        Add tracks, name them, and upload audio for each. Tracks can be uploaded simultaneously.
      </p>
      <div style={{ fontSize: 12, color: C.muted2, marginBottom: 24 }}>
        Album slug: <span style={{ color: C.muted }}>{albumSlug}</span>
      </div>

      {tracks.map((track, idx) => (
        <TrackRow
          key={track.tempId}
          track={track}
          idx={idx}
          total={tracks.length}
          albumSlug={albumSlug}
          data={data}
          releaseId={releaseId}
          setTracks={setTracks}
        />
      ))}

      <button
        onClick={addTrack}
        style={{
          width: "100%", background: "none", border: `1px dashed ${C.border2}`, borderRadius: 8,
          padding: "11px 0", color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          marginBottom: 24,
        }}
      >
        + Add Track
      </button>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Btn onClick={onBack} variant="secondary">← Back</Btn>
        <Btn onClick={onNext} disabled={readyCount === 0 || uploadingAny}>
          {uploadingAny ? "Uploading…" : `Continue → (${readyCount}/${tracks.length} ready)`}
        </Btn>
      </div>
    </div>
  );
}

// ── Step 4b: Track Details (multi-track only) ────────────────────────────────────
function FeaturedArtistInput({ items, onAdd, onRemove }) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (v) { onAdd(v); setVal(""); }
  };
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Artist name"
          style={{ flex: 1, background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 6, color: C.text, fontSize: 13, padding: "8px 11px", outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={add} style={{ background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "8px 12px", color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>+ Add</button>
      </div>
      <TagList items={items} onRemove={onRemove} />
    </div>
  );
}

function TrackDetailAccordion({ track, projectDefaults, isOpen, onToggle, onUpdate }) {
  const statusColor = { idle: C.muted2, uploading: C.accent, ready: C.success, error: C.error }[track.upload_status] || C.muted2;

  return (
    <div style={{ marginBottom: 8, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div onClick={onToggle} style={{ padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 12, color: C.muted2, minWidth: 22, fontWeight: 700 }}>{track.position}.</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{track.title || `Track ${track.position}`}</div>
          <div style={{ fontSize: 11, color: statusColor, marginTop: 2 }}>
            {track.upload_status === "ready" ? "✓ Audio ready" : `Audio: ${track.upload_status}`}
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.muted2 }}>{isOpen ? "▲" : "▼"}</div>
      </div>

      {isOpen && (
        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ height: 12 }} />

          <Field label="Track Title">
            <Input
              value={track.title}
              onChange={(v) => onUpdate({ title: v, slug: slugifyTrack(v, track.position) })}
              placeholder={`Track ${track.position}`}
            />
          </Field>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <Label>Featured Artists</Label>
              {track.featured_artists !== null ? (
                <button
                  onClick={() => onUpdate({ featured_artists: null })}
                  style={{ background: "none", border: "none", color: C.muted2, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Clear override
                </button>
              ) : (
                <span style={{ fontSize: 11, color: C.muted2 }}>Using project defaults</span>
              )}
            </div>

            {track.featured_artists === null ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>
                  {projectDefaults.featured_artists?.length > 0 ? projectDefaults.featured_artists.join(", ") : "None"}
                </div>
                <button
                  onClick={() => onUpdate({ featured_artists: [] })}
                  style={{ background: "none", border: `1px solid ${C.border2}`, borderRadius: 5, padding: "3px 9px", fontSize: 11, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Override
                </button>
              </div>
            ) : (
              <FeaturedArtistInput
                items={track.featured_artists}
                onAdd={(v) => onUpdate({ featured_artists: [...track.featured_artists, v] })}
                onRemove={(i) => onUpdate({ featured_artists: track.featured_artists.filter((_, idx) => idx !== i) })}
              />
            )}
          </div>

          <Field label="Content Rating">
            <div style={{ display: "flex", gap: 8 }}>
              {["clean", "explicit", "instrumental"].map((v) => {
                const current = track.content_rating || projectDefaults.content_rating || "clean";
                return (
                  <div
                    key={v}
                    onClick={() => onUpdate({ content_rating: v })}
                    style={{
                      background: current === v ? C.accentDim : C.surface,
                      border: `2px solid ${current === v ? C.accent : C.border2}`,
                      borderRadius: 6, padding: "7px 12px", cursor: "pointer",
                      fontSize: 11, fontWeight: 700, color: current === v ? C.accent : C.text,
                    }}
                  >
                    {v}
                  </div>
                );
              })}
            </div>
          </Field>

          <Field label="ISRC (per-track)">
            <Input value={track.isrc || ""} onChange={(v) => onUpdate({ isrc: v })} placeholder="e.g. USRC12345678" />
          </Field>
        </div>
      )}
    </div>
  );
}

function TrackDetailsStep({ data, tracks, setTracks, onNext, onBack }) {
  const [openTempId, setOpenTempId] = useState(tracks[0]?.tempId || null);

  const toggle = (tempId) => setOpenTempId((prev) => (prev === tempId ? null : tempId));

  const updateTrack = (tempId, updates) =>
    setTracks((prev) => prev.map((t) => t.tempId === tempId ? { ...t, ...updates } : t));

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>Track Details</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 28 }}>Review titles and set per-track overrides. Credits default to project settings.</p>

      {tracks.map((track) => (
        <TrackDetailAccordion
          key={track.tempId}
          track={track}
          projectDefaults={data}
          isOpen={openTempId === track.tempId}
          onToggle={() => toggle(track.tempId)}
          onUpdate={(updates) => updateTrack(track.tempId, updates)}
        />
      ))}

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Btn onClick={onBack} variant="secondary">← Back</Btn>
        <Btn onClick={onNext}>Continue →</Btn>
      </div>
    </div>
  );
}

// ── Step 4/5: Artwork + Lyrics ───────────────────────────────────────────────────
function ArtworkLyricsStep({ data, onChange, onNext, onBack, releaseId, draftSlug, isMultiTrack, tracks, setTracks }) {
  const [coverState, setCoverState] = useState({ status: data.cover_key ? "ready" : "idle", error: null });
  const [openLyricsId, setOpenLyricsId] = useState(null);

  const uploadCover = useCallback(async (file) => {
    setCoverState({ status: "uploading", error: null });
    try {
      const presignRes = await fetch("/api/admin/upload/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseType: data.release_type,
          slug: draftSlug || `draft-${Date.now()}`,
          assetType: "cover",
          filename: file.name,
          contentType: file.type || "image/jpeg",
          size: file.size,
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

      await fetch("/api/admin/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId, key, assetType: "cover", releaseType: data.release_type, slug: draftSlug }),
      });

      onChange("cover_key", key);
      onChange("cover_preview_url", URL.createObjectURL(file));
      setCoverState({ status: "ready", error: null });
    } catch (err) {
      setCoverState({ status: "error", error: err.message });
    }
  }, [data.release_type, draftSlug, releaseId, onChange]);

  const pickCover = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
    input.onchange = (e) => { if (e.target.files?.[0]) uploadCover(e.target.files[0]); };
    input.click();
  };

  const updateTrackLyrics = (tempId, lyrics) =>
    setTracks((prev) => prev.map((t) => t.tempId === tempId ? { ...t, lyrics } : t));

  const { status, error } = coverState;

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>Artwork & Lyrics</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 28 }}>Cover art is required to publish. Lyrics are optional and stored internally.</p>

      <Field label="Cover Artwork" hint="JPG, PNG, or WEBP — square recommended — max 20 MB. Required.">
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div
            onClick={status !== "uploading" ? pickCover : undefined}
            style={{
              width: 140, height: 140, flexShrink: 0, borderRadius: 10,
              background: C.surface2,
              border: `2px dashed ${status === "ready" ? C.success : status === "error" ? C.error : C.border2}`,
              cursor: status !== "uploading" ? "pointer" : "default",
              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {data.cover_preview_url ? (
              <img src={data.cover_preview_url} alt="cover" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ textAlign: "center", padding: 12 }}>
                <div style={{ fontSize: 28 }}>🖼</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{status === "uploading" ? "Uploading…" : "Tap to upload"}</div>
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <Btn onClick={pickCover} variant="secondary" disabled={status === "uploading"} style={{ marginBottom: 8 }}>
              {status === "ready" ? "Replace Cover" : status === "uploading" ? "Uploading…" : "Upload Cover"}
            </Btn>
            {status === "ready" && <div style={{ fontSize: 12, color: C.success }}>✓ Cover uploaded</div>}
            {status === "error"  && <div style={{ fontSize: 12, color: C.error }}>{error}</div>}
          </div>
        </div>
      </Field>

      {isMultiTrack ? (
        <div>
          <Label>Lyrics (Per Track)</Label>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Optional — stored internally, not displayed publicly.</p>
          {tracks.map((track) => (
            <div key={track.tempId} style={{ marginBottom: 6, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div
                onClick={() => setOpenLyricsId((prev) => prev === track.tempId ? null : track.tempId)}
                style={{ padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                  {track.position}. {track.title || `Track ${track.position}`}
                </span>
                <span style={{ fontSize: 11, color: track.lyrics ? C.success : C.muted2 }}>
                  {track.lyrics ? "Lyrics added ✓" : "No lyrics"} {openLyricsId === track.tempId ? "▲" : "▼"}
                </span>
              </div>
              {openLyricsId === track.tempId && (
                <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}>
                  <div style={{ height: 10 }} />
                  <Textarea
                    value={track.lyrics || ""}
                    onChange={(v) => updateTrackLyrics(track.tempId, v)}
                    placeholder={"[Verse 1]\n...\n\n[Chorus]\n..."}
                    rows={8}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Field label="Lyrics" hint="Optional — preserves line breaks and verse structure.">
          <Textarea
            value={data.lyrics}
            onChange={(v) => onChange("lyrics", v)}
            placeholder={"[Verse 1]\n...\n\n[Chorus]\n..."}
            rows={10}
          />
        </Field>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Btn onClick={onBack} variant="secondary">← Back</Btn>
        <Btn onClick={onNext} disabled={status !== "ready" && !data.cover_key}>Continue →</Btn>
      </div>
    </div>
  );
}

// ── Step 5/6: Review + Publish ───────────────────────────────────────────────────
function ReviewStep({ data, tracks, releaseId, isMultiTrack, onBack, onComplete, onUploadAnother }) {
  const [publishing, setPublishing] = useState(false);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);

  const readyTracks = tracks.filter((t) => t.upload_status === "ready");

  const checks = isMultiTrack
    ? [
        { label: "Project title set",                                                              ok: Boolean(data.title),          blocking: true  },
        { label: `Audio uploaded (${readyTracks.length}/${tracks.length} tracks)`,                ok: readyTracks.length > 0,        blocking: true  },
        { label: "Cover artwork uploaded",                                                         ok: Boolean(data.cover_key),       blocking: true  },
        { label: "Credits added",     ok: data.produced_by?.length > 0 || data.written_by?.length > 0, blocking: false },
        { label: "Genre set",                                                                      ok: Boolean(data.genre),           blocking: false },
      ]
    : [
        { label: "Title set",        ok: Boolean(data.title),       blocking: true  },
        { label: "Audio uploaded",   ok: Boolean(data.audio_key),   blocking: true  },
        { label: "Cover uploaded",   ok: Boolean(data.cover_key),   blocking: true  },
        { label: "Credits added",    ok: data.produced_by?.length > 0 || data.written_by?.length > 0, blocking: false },
        { label: "Lyrics added",     ok: Boolean(data.lyrics),      blocking: false },
        { label: "Genre set",        ok: Boolean(data.genre),       blocking: false },
      ];

  const hasBlocker = checks.some((c) => c.blocking && !c.ok);

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      let scheduled_at = null;
      if (data.publish_mode === "scheduled" && data.scheduled_date) {
        scheduled_at = `${data.scheduled_date}T${data.scheduled_time || "00:00"}:00Z`;
      }

      const res = await fetch(`/api/admin/releases/${releaseId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:              data.title,
          price:              data.price,
          release_date:       data.release_date,
          genre:              data.genre,
          content_rating:     data.content_rating,
          featured_artists:   data.featured_artists,
          produced_by:        data.produced_by,
          written_by:         data.written_by,
          mixing_engineer:    data.mixing_engineer,
          mastering_engineer: data.mastering_engineer,
          executive_producer: data.executive_producer,
          isrc:               data.isrc,
          upc:                data.upc,
          copyright_year:     data.copyright_year,
          c_line:             data.c_line,
          p_line:             data.p_line,
          publishing_credits: data.publishing_credits,
          cover_key:          data.cover_key,
          audio_key:          data.audio_key,
          track_id:           data.track_id,
          lyrics:             data.lyrics,
          scheduled_at,
          tracks: tracks.map((t) => ({
            id:               t.id,
            slug:             t.slug,
            position:         t.position,
            title:            t.title,
            lyrics:           t.lyrics,
            isrc:             t.isrc || null,
            featured_artists: t.featured_artists !== null ? t.featured_artists : undefined,
            content_rating:   t.content_rating   !== null ? t.content_rating   : undefined,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Publish failed");
      setResult(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
        <h2 style={{ fontSize: 26, fontWeight: 800, color: C.success, marginBottom: 8 }}>
          {result.status === "scheduled" ? "Release Scheduled!" : "Release is Live!"}
        </h2>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 6 }}>
          {result.status === "scheduled"
            ? `Your release will go live on ${data.scheduled_date} at ${data.scheduled_time || "00:00"} UTC`
            : "Your release is now live on the storefront."}
        </p>
        <p style={{ color: C.muted2, fontSize: 13, marginBottom: 32 }}>
          Slug: <span style={{ color: C.accent }}>/{result.slug}</span>
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn onClick={onUploadAnother} variant="secondary">Upload Another</Btn>
          <Btn onClick={() => onComplete(result)}>Done →</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 6 }}>Final Review</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 28 }}>Review everything before publishing.</p>

      <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: data.cover_preview_url ? "100px 1fr" : "1fr", gap: 16, alignItems: "start" }}>
          {data.cover_preview_url && (
            <img src={data.cover_preview_url} alt="cover" style={{ width: 100, height: 100, borderRadius: 8, objectFit: "cover" }} />
          )}
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>{data.title || "Untitled"}</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 2 }}>
              {data.release_type?.charAt(0).toUpperCase() + data.release_type?.slice(1)}
              {data.featured_artists?.length > 0 && ` ft. ${data.featured_artists.join(", ")}`}
            </div>
            {data.genre       && <div style={{ fontSize: 12, color: C.muted2 }}>{data.genre}</div>}
            {data.release_date && <div style={{ fontSize: 12, color: C.muted2 }}>Release date: {data.release_date}</div>}
            {isMultiTrack && (
              <div style={{ fontSize: 12, color: C.muted2, marginTop: 2 }}>
                {tracks.length} track{tracks.length !== 1 ? "s" : ""} · {readyTracks.length} ready
              </div>
            )}
          </div>
        </div>
      </div>

      {isMultiTrack && (
        <div style={{ marginBottom: 24 }}>
          <Label>Tracklist</Label>
          {tracks.map((t) => (
            <div key={t.tempId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, color: C.muted2, minWidth: 20 }}>{t.position}.</div>
              <div style={{ flex: 1, fontSize: 13, color: C.text }}>{t.title || `Track ${t.position}`}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: t.upload_status === "ready" ? C.success : t.upload_status === "error" ? C.error : C.muted2 }}>
                {t.upload_status === "ready" ? "✓ Ready" : t.upload_status === "error" ? "Error" : "No audio"}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <Label>Readiness Checklist</Label>
        {checks.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 14, color: c.ok ? C.success : c.blocking ? C.error : C.warn }}>
              {c.ok ? "✓" : c.blocking ? "✗" : "⚠"}
            </div>
            <div style={{ flex: 1, fontSize: 13, color: c.ok ? C.text : c.blocking ? C.error : C.warn }}>{c.label}</div>
            {!c.ok && c.blocking  && <span style={{ fontSize: 10, fontWeight: 700, color: C.error, letterSpacing: "0.08em" }}>BLOCKING</span>}
            {!c.ok && !c.blocking && <span style={{ fontSize: 10, fontWeight: 700, color: C.warn,  letterSpacing: "0.08em" }}>OPTIONAL</span>}
          </div>
        ))}
      </div>

      {hasBlocker && (
        <div style={{ background: "rgba(255,69,58,0.08)", border: `1px solid rgba(255,69,58,0.3)`, borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: C.error }}>
          Complete all required fields before publishing. Use ← Back to edit.
        </div>
      )}

      {error && (
        <div style={{ background: "rgba(255,69,58,0.08)", border: `1px solid rgba(255,69,58,0.3)`, borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: C.error }}>
          {error}
        </div>
      )}

      {data.publish_mode === "scheduled" && data.scheduled_date && (
        <div style={{ background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: C.accent }}>
          Scheduled: {data.scheduled_date} at {data.scheduled_time || "00:00"} UTC
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Btn onClick={onBack} variant="secondary">← Back</Btn>
        <Btn onClick={publish} disabled={hasBlocker || publishing}>
          {publishing
            ? "Publishing…"
            : data.publish_mode === "scheduled"
            ? "Schedule Release"
            : "Release Now"}
        </Btn>
      </div>
    </div>
  );
}

// ── Wizard state defaults ────────────────────────────────────────────────────────
const DEFAULT_DATA = {
  release_type:       "",
  artist_mode:        "solo",
  title:              "",
  proposed_slug:      "",
  primary_artist:     "2MRRW",
  featured_artists:   [],
  release_date:       "",
  genre:              "",
  content_rating:     "clean",
  price:              "",
  publish_mode:       "immediate",
  scheduled_date:     "",
  scheduled_time:     "00:00",
  produced_by:        [],
  written_by:         [],
  mixing_engineer:    "",
  mastering_engineer: "",
  executive_producer: "",
  isrc:               "",
  upc:                "",
  copyright_year:     "",
  c_line:             "",
  p_line:             "",
  publishing_credits: "",
  audio_key:          "",
  audio_filename:     "",
  track_id:           null,
  cover_key:          "",
  cover_preview_url:  "",
  lyrics:             "",
};

const STEPS_SINGLE = ["Type", "Info", "Credits", "Audio", "Artwork", "Review"];
const STEPS_MULTI  = ["Type", "Info", "Credits", "Tracklist", "Details", "Artwork", "Review"];

// ── Main exported component ──────────────────────────────────────────────────────
export function UploadWizard({ onComplete, onDismiss }) {
  const [step,          setStep]          = useState(0);
  const [data,          setData]          = useState(DEFAULT_DATA);
  const [tracks,        setTracks]        = useState([newTrack(1)]);
  const [releaseId,     setReleaseId]     = useState(null);
  const [draftSlug,     setDraftSlug]     = useState(null);
  const [creatingDraft, setCreatingDraft] = useState(false);

  const isMultiTrack = ["album", "ep", "mixtape"].includes(data.release_type);
  const STEPS        = isMultiTrack ? STEPS_MULTI : STEPS_SINGLE;

  const setField = useCallback((key, value) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetWizard = useCallback(() => {
    setStep(0);
    setData(DEFAULT_DATA);
    setTracks([newTrack(1)]);
    setReleaseId(null);
    setDraftSlug(null);
  }, []);

  const handleTypeNext = async () => {
    setCreatingDraft(true);
    try {
      const res = await fetch("/api/admin/releases/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release_type: data.release_type }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create draft");
      setReleaseId(json.draft_id);
      setDraftSlug(json.slug);
      setTracks([newTrack(1)]);
      setStep(1);
    } catch (err) {
      alert("Could not create draft: " + err.message);
    } finally {
      setCreatingDraft(false);
    }
  };

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const stepName    = STEPS[step];
  const commonProps = { data, onChange: setField, onNext: next, onBack: back, releaseId, draftSlug };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 20px 60px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
        <div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              style={{ background: "none", border: "none", color: C.muted2, fontSize: 11, cursor: "pointer", padding: "0 0 6px", fontFamily: "inherit", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase" }}
            >
              ← Back to Releases
            </button>
          )}
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: onDismiss ? "4px 0 0" : "0" }}>Upload Release</h1>
        </div>
        {draftSlug && (
          <div style={{ fontSize: 11, color: C.muted2 }}>
            Draft: <span style={{ color: C.muted }}>{draftSlug}</span>
          </div>
        )}
      </div>

      <StepBar steps={STEPS} current={step} />

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "32px 32px" }}>
        {stepName === "Type" && (
          <ReleaseTypeStep {...commonProps} loading={creatingDraft} onNext={handleTypeNext} />
        )}
        {stepName === "Info" && (
          <ReleaseInfoStep {...commonProps} />
        )}
        {stepName === "Credits" && (
          <CreditsStep {...commonProps} isMultiTrack={isMultiTrack} />
        )}
        {stepName === "Audio" && (
          <AudioUploadStep {...commonProps} />
        )}
        {stepName === "Tracklist" && (
          <TracklistBuilderStep
            data={data}
            tracks={tracks}
            setTracks={setTracks}
            onNext={next}
            onBack={back}
            releaseId={releaseId}
            draftSlug={draftSlug}
          />
        )}
        {stepName === "Details" && (
          <TrackDetailsStep
            data={data}
            tracks={tracks}
            setTracks={setTracks}
            onNext={next}
            onBack={back}
          />
        )}
        {stepName === "Artwork" && (
          <ArtworkLyricsStep
            {...commonProps}
            isMultiTrack={isMultiTrack}
            tracks={tracks}
            setTracks={setTracks}
          />
        )}
        {stepName === "Review" && (
          <ReviewStep
            data={data}
            tracks={tracks}
            releaseId={releaseId}
            isMultiTrack={isMultiTrack}
            onBack={back}
            onComplete={onComplete}
            onUploadAnother={resetWizard}
          />
        )}
      </div>
    </div>
  );
}

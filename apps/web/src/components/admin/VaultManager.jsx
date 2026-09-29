"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  VAULT_SECTIONS,
  MEDIA_TYPES,
  ACCESS_TIERS,
  MULTIPART_THRESHOLD_BYTES,
  SECTION_COVER_ACCEPT,
  slugify,
  kindForUpload,
} from "@/lib/vault/vault-upload-contract";

/** XHR rather than fetch: fetch still cannot report upload progress, and a
 *  multi-gigabyte phone video with no progress bar is indistinguishable from
 *  a hang. */
function putWithProgress(url, body, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.getResponseHeader("ETag"))
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(body);
  });
}

const FIELD = {
  width: "100%",
  padding: "11px 12px",
  background: "#0d0d0d",
  border: "1px solid #232323",
  borderRadius: 10,
  color: "#e8e8e8",
  fontSize: 14,
};
const LABEL = {
  display: "block",
  fontSize: 10,
  letterSpacing: 2,
  textTransform: "uppercase",
  color: "#6d6d6d",
  marginBottom: 6,
};

export default function VaultManager() {
  const [category, setCategory] = useState(VAULT_SECTIONS[0].category);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [mediaType, setMediaType] = useState("video");
  const [accessTier, setAccessTier] = useState("vault_pass");

  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const fileRef = useRef(null);

  const [cover, setCover] = useState(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverMsg, setCoverMsg] = useState(null);
  const coverRef = useRef(null);

  const loadItems = useCallback(async (cat) => {
    try {
      const res = await fetch(`/api/admin/vault/list?category=${encodeURIComponent(cat)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.items || []);
    } catch {
      /* the list is context, never the point of the screen */
    }
  }, []);

  const loadCover = useCallback(async (cat) => {
    try {
      const res = await fetch("/api/admin/vault/section-cover", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setCover((json.covers || []).find((c) => c.category === cat) || null);
    } catch {
      /* the cover panel is secondary to uploading */
    }
  }, []);

  useEffect(() => {
    loadItems(category);
    loadCover(category);
  }, [category, loadItems, loadCover]);

  /** Reads a local video's duration before upload so an over-long loop is
   *  caught here rather than after the bytes have been sent. */
  const probeDuration = (f) =>
    new Promise((resolve) => {
      if (!f.type.startsWith("video/")) return resolve(null);
      const el = document.createElement("video");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(el.src);
        resolve(Number.isFinite(el.duration) ? el.duration : null);
      };
      el.onerror = () => resolve(null);
      el.src = URL.createObjectURL(f);
    });

  const uploadCover = async (e) => {
    const f = e.target.files?.[0] || null;
    if (!f) return;
    setCoverBusy(true);
    setCoverMsg(null);
    try {
      const presignRes = await fetch("/api/admin/vault/section-cover/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, filename: f.name, size: f.size }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Could not prepare cover upload");

      await putWithProgress(presign.url, f, presign.contentType, () => {});

      const durationSeconds = await probeDuration(f);
      const doneRes = await fetch("/api/admin/vault/section-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, filename: f.name, size: f.size, durationSeconds }),
      });
      const done = await doneRes.json();
      if (!doneRes.ok) throw new Error(done.error || "Could not save cover");

      setCover(done.cover);
      setCoverMsg(
        done.needsStill
          ? { kind: "warn", msg: "Loop saved. Add a still too — it is the poster and the fallback if the video cannot play." }
          : { kind: "ok", msg: `${done.kind === "motion" ? "Loop" : "Still"} saved.` }
      );
    } catch (err) {
      setCoverMsg({ kind: "error", msg: err.message || "Cover upload failed" });
    } finally {
      setCoverBusy(false);
      if (coverRef.current) coverRef.current.value = "";
    }
  };

  const clearCover = async (kind) => {
    setCoverBusy(true);
    try {
      const res = await fetch(
        `/api/admin/vault/section-cover?category=${encodeURIComponent(category)}&kind=${kind}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await loadCover(category);
        setCoverMsg({ kind: "ok", msg: `${kind === "motion" ? "Loop" : "Still"} cleared.` });
      }
    } finally {
      setCoverBusy(false);
    }
  };

  const onPickFile = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (!f) return;
    const guessed = kindForUpload({ mimeType: f.type, filename: f.name });
    if (guessed) setMediaType(guessed);
    if (!title) {
      const base = f.name.replace(/\.[^.]+$/, "");
      setTitle(base);
      if (!slugTouched) setSlug(slugify(base));
    }
  };

  const onTitle = (v) => {
    setTitle(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const reset = () => {
    setFile(null);
    setTitle("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  const upload = async () => {
    if (!file || !title.trim() || !slug) {
      setStatus({ kind: "error", msg: "Pick a file and give it a title." });
      return;
    }
    setBusy(true);
    setProgress(0);
    setStatus({ kind: "info", msg: "Preparing…" });

    try {
      const presignRes = await fetch("/api/admin/vault/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          slug,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Could not prepare upload");

      let parts = null;

      if (presign.mode === "single") {
        setStatus({ kind: "info", msg: "Uploading…" });
        await putWithProgress(presign.url, file, file.type, setProgress);
      } else {
        // Chunked: progress is the share of bytes finished, so it keeps
        // moving smoothly across part boundaries.
        setStatus({ kind: "info", msg: `Uploading in ${presign.parts.length} parts…` });
        parts = [];
        const size = presign.partSize;
        for (const part of presign.parts) {
          const start = (part.partNumber - 1) * size;
          const blob = file.slice(start, Math.min(start + size, file.size));
          const etag = await putWithProgress(part.url, blob, null, (p) =>
            setProgress((start + p * blob.size) / file.size)
          );
          parts.push({ PartNumber: part.partNumber, ETag: etag });
        }
      }

      setProgress(1);
      setStatus({ kind: "info", msg: "Saving…" });

      const completeRes = await fetch("/api/admin/vault/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          slug,
          filename: file.name,
          title,
          description,
          mediaType,
          accessTier,
          uploadId: presign.uploadId || null,
          parts,
        }),
      });
      const done = await completeRes.json();
      if (!completeRes.ok) throw new Error(done.error || "Could not save entry");

      setStatus({ kind: "ok", msg: `Saved as a draft in ${category}.` });
      reset();
      loadItems(category);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message || "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  const setVisibility = async (id, visibility) => {
    try {
      const res = await fetch("/api/admin/vault/list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, visibility }),
      });
      if (res.ok) loadItems(category);
    } catch {
      /* leave the row as it was; the next load reconciles */
    }
  };

  const big = file && file.size >= MULTIPART_THRESHOLD_BYTES;

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 className="section-heading" style={{ marginBottom: 6 }}>Vault Manager</h2>
      <p style={{ fontSize: 13, color: "#555", marginBottom: 26, lineHeight: 1.7 }}>
        Upload straight into a Vault section from this device. Everything lands
        as a draft — nothing goes live until you publish it.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={LABEL} htmlFor="vm-section">Section</label>
          <select id="vm-section" style={FIELD} value={category} disabled={busy}
            onChange={(e) => setCategory(e.target.value)}>
            {VAULT_SECTIONS.map((s) => (
              <option key={s.folder} value={s.category}>{s.category}</option>
            ))}
          </select>
        </div>

        {/* Section cover: what the pod shows on its shelf before it is
            summoned, so a section is never sitting there blank. Separate
            from the item upload below -- this is the section's chrome, not
            a thing in the archive. */}
        <div style={{
          padding: 14, border: "1px solid #1c1c1c",
          borderRadius: 12, background: "#0a0a0a",
        }}>
          <label style={LABEL} htmlFor="vm-cover">Section cover</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            {["motion", "still"].map((k) => {
              const has = Boolean(cover?.[k === "motion" ? "motion_key" : "still_key"]);
              return (
                <span key={k} style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "5px 11px", borderRadius: 999, fontSize: 11,
                  letterSpacing: 1, textTransform: "uppercase",
                  color: has ? "#4ade80" : "#5a5a5a",
                  border: `1px solid ${has ? "rgba(74,222,128,0.35)" : "#242424"}`,
                }}>
                  {k === "motion" ? "Loop" : "Still"} {has ? "set" : "none"}
                  {has ? (
                    <button type="button" disabled={coverBusy} onClick={() => clearCover(k)}
                      style={{
                        background: "none", border: "none", color: "#777",
                        cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0,
                      }} aria-label={`Clear ${k}`}>×</button>
                  ) : null}
                </span>
              );
            })}
          </div>
          <input id="vm-cover" ref={coverRef} type="file" disabled={coverBusy}
            accept={SECTION_COVER_ACCEPT} onChange={uploadCover}
            style={{ ...FIELD, padding: 10 }} />
          <p style={{ fontSize: 11, color: "#4a4a4a", marginTop: 8, lineHeight: 1.6 }}>
            .mp4 or .webm for a loop (max 30s), .jpg/.png/.webp for the still.
            A loop wants a still as well — it is the poster and the fallback.
          </p>
          {coverMsg ? (
            <p style={{
              fontSize: 12, marginTop: 8, marginBottom: 0, lineHeight: 1.6,
              color: coverMsg.kind === "error" ? "#ff6b6b"
                : coverMsg.kind === "warn" ? "#e3bd76" : "#4ade80",
            }}>{coverMsg.msg}</p>
          ) : null}
        </div>

        <div>
          <label style={LABEL} htmlFor="vm-file">File</label>
          {/* No capture attribute: on a phone this offers camera, photo
              library and Files, which is the whole point of uploading from
              the device you recorded on. */}
          <input id="vm-file" ref={fileRef} type="file" disabled={busy}
            accept="video/*,audio/*,image/*" onChange={onPickFile}
            style={{ ...FIELD, padding: 10 }} />
          {file ? (
            <p style={{ fontSize: 11, color: "#6d6d6d", marginTop: 6 }}>
              {(file.size / 1e6).toFixed(1)} MB{big ? " · will upload in parts" : ""}
            </p>
          ) : null}
        </div>

        <div>
          <label style={LABEL} htmlFor="vm-title">Title</label>
          <input id="vm-title" style={FIELD} value={title} disabled={busy}
            onChange={(e) => onTitle(e.target.value)} placeholder="What is this?" />
        </div>

        <div>
          <label style={LABEL} htmlFor="vm-slug">Slug</label>
          <input id="vm-slug" style={FIELD} value={slug} disabled={busy}
            onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
          <p style={{ fontSize: 11, color: "#4a4a4a", marginTop: 6 }}>
            Becomes the filename in storage. Re-using one replaces that entry.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={LABEL} htmlFor="vm-type">Type</label>
            <select id="vm-type" style={FIELD} value={mediaType} disabled={busy}
              onChange={(e) => setMediaType(e.target.value)}>
              {MEDIA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={LABEL} htmlFor="vm-access">Access</label>
            <select id="vm-access" style={FIELD} value={accessTier} disabled={busy}
              onChange={(e) => setAccessTier(e.target.value)}>
              {ACCESS_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label style={LABEL} htmlFor="vm-desc">Description</label>
          <textarea id="vm-desc" style={{ ...FIELD, minHeight: 80, resize: "vertical" }}
            value={description} disabled={busy}
            onChange={(e) => setDescription(e.target.value)} />
        </div>

        {busy ? (
          <div>
            <div style={{ height: 6, background: "#1a1a1a", borderRadius: 999, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.round(progress * 100)}%`,
                background: "linear-gradient(90deg,#00ffff,#a259ff)",
                transition: "width 0.2s ease",
              }} />
            </div>
            <p style={{ fontSize: 11, color: "#6d6d6d", marginTop: 6 }}>
              {Math.round(progress * 100)}%
            </p>
          </div>
        ) : null}

        {status ? (
          <p style={{
            fontSize: 13,
            margin: 0,
            color: status.kind === "error" ? "#ff6b6b" : status.kind === "ok" ? "#4ade80" : "#888",
          }}>{status.msg}</p>
        ) : null}

        <button type="button" onClick={upload} disabled={busy || !file}
          style={{
            padding: "13px 18px",
            borderRadius: 12,
            border: "1px solid rgba(0,255,255,0.3)",
            background: busy || !file ? "#111" : "rgba(0,255,255,0.1)",
            color: busy || !file ? "#555" : "#00ffff",
            fontWeight: 700,
            letterSpacing: 1.5,
            fontSize: 13,
            cursor: busy || !file ? "default" : "pointer",
          }}>
          {busy ? "WORKING…" : "UPLOAD TO VAULT"}
        </button>
      </div>

      <div style={{ margin: "34px 0 12px", height: 1, background: "#1a1a1a" }} />
      <h3 style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#6d6d6d", marginBottom: 14 }}>
        In {category} · {items.length}
      </h3>

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: "#444" }}>Nothing here yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((it) => (
            <div key={it.id} style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "12px 14px", background: "#0c0c0c",
              border: "1px solid #1c1c1c", borderRadius: 12,
            }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8" }}>{it.title}</div>
                <div style={{ fontSize: 11, color: "#5a5a5a", marginTop: 3 }}>
                  {it.media_type} · {it.access_tier} · {it.slug}
                </div>
              </div>
              <span style={{
                fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
                padding: "4px 10px", borderRadius: 999,
                color: it.visibility === "published" ? "#4ade80" : "#b0893a",
                border: `1px solid ${it.visibility === "published" ? "rgba(74,222,128,0.35)" : "rgba(176,137,58,0.35)"}`,
              }}>{it.visibility}</span>
              <button type="button"
                onClick={() => setVisibility(it.id, it.visibility === "published" ? "draft" : "published")}
                style={{
                  padding: "7px 13px", borderRadius: 9, cursor: "pointer",
                  border: "1px solid #2a2a2a", background: "transparent",
                  color: "#9a9a9a", fontSize: 11, letterSpacing: 1,
                }}>
                {it.visibility === "published" ? "UNPUBLISH" : "PUBLISH"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

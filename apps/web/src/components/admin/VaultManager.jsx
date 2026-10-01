"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  VAULT_SECTIONS,
  MEDIA_TYPES,
  ACCESS_TIERS,
  MULTIPART_THRESHOLD_BYTES,
  SECTION_COVER_ACCEPT,
  ITEM_COVER_ACCEPT,
  slugify,
  kindForUpload,
} from "@/lib/vault/vault-upload-contract";
import {
  VAULT_AUDIO_ACCEPT,
  VAULT_AUDIO_MULTIPART_THRESHOLD_BYTES,
  isAudioNativeCategory,
} from "@/lib/vault/vault-audio-contract";

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

/** Transcode states worth waiting on. Anything else is settled. */
const LIVE_JOB_STATES = new Set(["pending", "processing"]);

export default function VaultManager() {
  const [category, setCategory] = useState(VAULT_SECTIONS[0].category);
  /**
   * "item"  — the file is served as-is through /api/vault/media.
   * "audio" — the file is a master: transcoded to an encrypted HLS ladder and
   *           streamed, the way a song release is. Audio sections default here.
   *
   * Derived from the section rather than synced to it with an effect. An
   * explicit choice is stored together with the section it was made for, so
   * changing sections falls back to that section's own default without a
   * setState in an effect body and the cascading render that causes.
   */
  const [modeChoice, setModeChoice] = useState(null);
  const mode = modeChoice?.category === category
    ? modeChoice.mode
    : (isAudioNativeCategory(category) ? "audio" : "item");
  const setMode = (m) => setModeChoice({ category, mode: m });
  const [audioItems, setAudioItems] = useState([]);
  const [videoItems, setVideoItems] = useState([]);
  const [requeuing, setRequeuing] = useState(null);
  // The row being edited, as a draft -- edits are not written until saved, so
  // abandoning one leaves the entry exactly as it was.
  const [editing, setEditing] = useState(null);
  // Delete asks twice, inline. A destructive action on a one-click row is too
  // easy to hit by accident, and a browser confirm() dialog is worse.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  // Which row's "art" button opened the picker. One input is reused for every
  // row rather than rendering an input per item.
  const artForRef = useRef(null);
  const artInputRef = useRef(null);
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

  const loadAudio = useCallback(async (cat) => {
    try {
      const res = await fetch(
        `/api/admin/vault/audio/status?category=${encodeURIComponent(cat)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const json = await res.json();
      setAudioItems(json.items || []);
    } catch {
      /* transcode state is informational; the upload form still works */
    }
  }, []);

  const loadVideo = useCallback(async (cat) => {
    try {
      const res = await fetch(
        `/api/admin/vault/video/status?category=${encodeURIComponent(cat)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const json = await res.json();
      setVideoItems(json.items || []);
    } catch {
      /* transcode state is informational; the upload form still works */
    }
  }, []);

  useEffect(() => {
    loadItems(category);
    loadCover(category);
    loadAudio(category);
    loadVideo(category);
  }, [category, loadItems, loadCover, loadAudio, loadVideo]);

  /**
   * Poll only while something is genuinely encoding, and stop the moment the
   * queue settles — an admin screen left open should not sit there issuing
   * requests forever.
   */
  const hasLiveJob =
    audioItems.some((it) => LIVE_JOB_STATES.has(it.job?.status)) ||
    videoItems.some((it) => LIVE_JOB_STATES.has(it.job?.status));
  useEffect(() => {
    if (!hasLiveJob) return undefined;
    const id = setInterval(() => {
      loadAudio(category);
      loadVideo(category);
    }, 5000);
    return () => clearInterval(id);
  }, [hasLiveJob, category, loadAudio, loadVideo]);

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

  /**
   * Sends the bytes and returns the multipart part list (null for a single
   * PUT). Shared by both upload paths because the transport is identical --
   * only the endpoints and what gets recorded differ.
   */
  const sendBytes = async (presign, f) => {
    if (presign.mode === "single") {
      setStatus({ kind: "info", msg: "Uploading…" });
      await putWithProgress(presign.url, f, presign.contentType || f.type, setProgress);
      return null;
    }
    // Chunked: progress is the share of bytes finished, so it keeps moving
    // smoothly across part boundaries.
    setStatus({ kind: "info", msg: `Uploading in ${presign.parts.length} parts…` });
    const parts = [];
    const size = presign.partSize;
    for (const part of presign.parts) {
      const start = (part.partNumber - 1) * size;
      const blob = f.slice(start, Math.min(start + size, f.size));
      const etag = await putWithProgress(part.url, blob, null, (p) =>
        setProgress((start + p * blob.size) / f.size)
      );
      parts.push({ PartNumber: part.partNumber, ETag: etag });
    }
    return parts;
  };

  /**
   * The master path: upload, record the item, queue the encode. Playback does
   * not exist until the worker finishes, which is why this reports the queue
   * state rather than claiming the item is ready.
   */
  const uploadAudioMaster = async () => {
    setBusy(true);
    setProgress(0);
    setStatus({ kind: "info", msg: "Preparing…" });

    try {
      const presignRes = await fetch("/api/admin/vault/audio/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, slug, filename: file.name, size: file.size }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Could not prepare upload");

      const parts = await sendBytes(presign, file);

      setProgress(1);
      setStatus({ kind: "info", msg: "Saving and queueing…" });

      const completeRes = await fetch("/api/admin/vault/audio/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          slug,
          filename: file.name,
          size: file.size,
          title,
          description,
          accessTier,
          uploadId: presign.uploadId || null,
          parts,
        }),
      });
      const done = await completeRes.json();
      if (!completeRes.ok) throw new Error(done.error || "Could not save entry");

      setStatus({
        kind: "ok",
        msg: done.queued
          ? "Master uploaded. Encoding now — it appears below as it progresses."
          : "Master uploaded, but encoding was not queued. Re-queue it below.",
      });
      reset();
      loadItems(category);
      loadAudio(category);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message || "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  const requeue = async (itemSlug) => {
    setRequeuing(itemSlug);
    try {
      const res = await fetch("/api/admin/vault/audio/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: itemSlug }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not re-queue");
      loadAudio(category);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setRequeuing(null);
    }
  };

  const upload = async () => {
    if (!file || !title.trim() || !slug) {
      setStatus({ kind: "error", msg: "Pick a file and give it a title." });
      return;
    }
    if (mode === "audio") return uploadAudioMaster();
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

      const parts = await sendBytes(presign, file);

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

  const patchItem = async (payload) => {
    const res = await fetch("/api/admin/vault/list", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || "Could not save");
    }
    return res.json();
  };

  const setVisibility = async (id, visibility) => {
    try {
      await patchItem({ id, visibility });
      loadItems(category);
    } catch {
      /* leave the row as it was; the next load reconciles */
    }
  };

  const startEdit = (it) => {
    setConfirmDelete(null);
    setEditing({
      id: it.id,
      title: it.title || "",
      description: it.description || "",
      accessTier: it.access_tier,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setRowBusy(editing.id);
    try {
      await patchItem({
        id: editing.id,
        title: editing.title,
        description: editing.description,
        accessTier: editing.accessTier,
      });
      setEditing(null);
      loadItems(category);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setRowBusy(null);
    }
  };

  /**
   * Move an item one place and renumber the section.
   *
   * Every row starts life at the same default sort_order, so swapping two
   * values would be a no-op on a section that has never been ordered. Instead
   * the whole visible list is renumbered by position and only the rows whose
   * number actually changed are written -- which normalises the section the
   * first time it is touched and costs two writes every time after.
   */
  const move = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    // Optimistic: the list reorders under the finger, then reconciles.
    setItems(next);
    setRowBusy(next[target].id);

    try {
      const writes = next
        .map((it, i) => ({ it, order: i * 10 }))
        .filter(({ it, order }) => it.sort_order !== order)
        .map(({ it, order }) => patchItem({ id: it.id, sortOrder: order }));
      await Promise.all(writes);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setRowBusy(null);
      loadItems(category);
    }
  };

  /** Queue a video item for the encrypted ladder, or retry a failed encode. */
  const queueVideo = async (itemSlug) => {
    setRequeuing(itemSlug);
    try {
      const res = await fetch("/api/admin/vault/video/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: itemSlug }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not queue");
      loadVideo(category);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setRequeuing(null);
    }
  };

  const pickArt = (it) => {
    artForRef.current = it;
    artInputRef.current?.click();
  };

  /** Card art for one item: the picture its card crops to fill in the chamber. */
  const uploadArt = async (e) => {
    const f = e.target.files?.[0] || null;
    const it = artForRef.current;
    if (artInputRef.current) artInputRef.current.value = "";
    if (!f || !it) return;

    setRowBusy(it.id);
    try {
      const presignRes = await fetch("/api/admin/vault/item-cover/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: it.category, slug: it.slug, filename: f.name, size: f.size }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Could not prepare upload");

      await putWithProgress(presign.url, f, presign.contentType, () => {});

      const doneRes = await fetch("/api/admin/vault/item-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id, category: it.category, slug: it.slug, filename: f.name, size: f.size }),
      });
      const done = await doneRes.json();
      if (!doneRes.ok) throw new Error(done.error || "Could not save the cover");

      setStatus({ kind: "ok", msg: `Card art set for "${it.title}".` });
      loadItems(category);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setRowBusy(null);
      artForRef.current = null;
    }
  };

  const clearArt = async (it) => {
    setRowBusy(it.id);
    try {
      const res = await fetch(`/api/admin/vault/item-cover?id=${encodeURIComponent(it.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not clear");
      setStatus({ kind: "ok", msg: "Card art cleared." });
      loadItems(category);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setRowBusy(null);
    }
  };

  const removeItem = async (id) => {
    setRowBusy(id);
    try {
      const res = await fetch(`/api/admin/vault/list?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not delete");
      setConfirmDelete(null);
      setStatus({
        kind: "ok",
        msg: json.removed?.segments
          ? `Deleted, along with ${json.removed.segments} encoded segments.`
          : "Deleted.",
      });
      loadItems(category);
      loadAudio(category);
      loadVideo(category);
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setRowBusy(null);
    }
  };

  const big = file && file.size >= (
    mode === "audio" ? VAULT_AUDIO_MULTIPART_THRESHOLD_BYTES : MULTIPART_THRESHOLD_BYTES
  );

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

        {/* What kind of upload this is. Audio sections open on "master"
            because that is what they are for, but any section can take
            either -- an interview section might still want one audio-only
            episode streamed properly. */}
        <div>
          <span style={LABEL}>Upload as</span>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { id: "audio", label: "Audio master", hint: "Transcoded + streamed" },
              { id: "item", label: "File", hint: "Served as uploaded" },
            ].map((m) => {
              const on = mode === m.id;
              return (
                <button key={m.id} type="button" disabled={busy}
                  onClick={() => setMode(m.id)}
                  style={{
                    flex: 1, padding: "10px 12px", borderRadius: 10, cursor: busy ? "default" : "pointer",
                    textAlign: "left", lineHeight: 1.35,
                    border: `1px solid ${on ? "rgba(0,255,255,0.35)" : "#232323"}`,
                    background: on ? "rgba(0,255,255,0.07)" : "#0d0d0d",
                    color: on ? "#00ffff" : "#7a7a7a",
                  }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{m.label}</span>
                  <span style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: on ? "rgba(0,255,255,0.6)" : "#4a4a4a" }}>
                    {m.hint}
                  </span>
                </button>
              );
            })}
          </div>
          {mode === "audio" ? (
            <p style={{ fontSize: 11, color: "#4a4a4a", marginTop: 8, lineHeight: 1.6 }}>
              Same pipeline shape as a song release: the master is archived, an
              encrypted ladder is encoded from it, and playback is gated. Nothing
              streams until encoding finishes.
            </p>
          ) : null}
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
          <label style={LABEL} htmlFor="vm-file">
            {mode === "audio" ? "Master" : "File"}
          </label>
          {/* No capture attribute: on a phone this offers camera, photo
              library and Files, which is the whole point of uploading from
              the device you recorded on. */}
          <input id="vm-file" ref={fileRef} type="file" disabled={busy}
            accept={mode === "audio" ? VAULT_AUDIO_ACCEPT : "video/*,audio/*,image/*"}
            onChange={onPickFile}
            style={{ ...FIELD, padding: 10 }} />
          {mode === "audio" ? (
            <p style={{ fontSize: 11, color: "#4a4a4a", marginTop: 6, lineHeight: 1.6 }}>
              .wav, .flac or .aiff for a real master. .m4a and .mp3 are accepted
              for voice recordings that never existed losslessly.
            </p>
          ) : null}
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
          {/* No Type picker in master mode: the type is audio by definition,
              and offering a choice that gets overridden server-side would be
              a lie about what the form does. */}
          {mode === "audio" ? null : (
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={LABEL} htmlFor="vm-type">Type</label>
              <select id="vm-type" style={FIELD} value={mediaType} disabled={busy}
                onChange={(e) => setMediaType(e.target.value)}>
                {MEDIA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
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
          {busy ? "WORKING…" : mode === "audio" ? "UPLOAD MASTER" : "UPLOAD TO VAULT"}
        </button>
      </div>

      {/* Transcode state, derived from the job and manifest rows rather than a
          status column, so a worker that died mid-job shows as stalled instead
          of as whatever it last claimed. */}
      {audioItems.length ? (
        <>
          <div style={{ margin: "34px 0 12px", height: 1, background: "#1a1a1a" }} />
          <h3 style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#6d6d6d", marginBottom: 14 }}>
            Audio · {audioItems.length}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {audioItems.map((it) => {
              const st = it.job?.status;
              const live = LIVE_JOB_STATES.has(st);
              const badge = it.streamable && st === "complete"
                ? { text: "streaming", color: "#4ade80" }
                : st === "processing" ? { text: "encoding", color: "#00ffff" }
                : st === "pending"    ? { text: "queued",   color: "#8a8a8a" }
                : st === "failed"     ? { text: "failed",   color: "#ff6b6b" }
                : it.streamable       ? { text: "streaming", color: "#4ade80" }
                : { text: "no encode", color: "#b0893a" };
              const secs = it.manifest?.durationSeconds ?? it.duration_seconds;
              return (
                <div key={it.id} style={{
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  padding: "12px 14px", background: "#0c0c0c",
                  border: "1px solid #1c1c1c", borderRadius: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8" }}>{it.title}</div>
                    <div style={{ fontSize: 11, color: "#5a5a5a", marginTop: 3 }}>
                      {it.slug}
                      {secs ? ` · ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}` : ""}
                      {it.manifest?.bitrates?.length ? ` · ${it.manifest.bitrates.length} rungs` : ""}
                    </div>
                    {st === "failed" && it.job?.error ? (
                      <div style={{ fontSize: 11, color: "#ff6b6b", marginTop: 5, lineHeight: 1.5 }}>
                        {it.job.failureCategory}: {it.job.error}
                      </div>
                    ) : null}
                  </div>
                  <span style={{
                    fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
                    padding: "4px 10px", borderRadius: 999,
                    color: badge.color, border: `1px solid ${badge.color}59`,
                  }}>{badge.text}</span>
                  {live ? null : (
                    <button type="button" disabled={requeuing === it.slug}
                      onClick={() => requeue(it.slug)}
                      style={{
                        padding: "7px 13px", borderRadius: 9,
                        cursor: requeuing === it.slug ? "default" : "pointer",
                        border: "1px solid #2a2a2a", background: "transparent",
                        color: "#9a9a9a", fontSize: 11, letterSpacing: 1,
                      }}>
                      {requeuing === it.slug ? "…" : "RE-ENCODE"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <div style={{ margin: "34px 0 12px", height: 1, background: "#1a1a1a" }} />
      <h3 style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#6d6d6d", marginBottom: 14 }}>
        In {category} · {items.length}
      </h3>

      {/* Video transcode state. Until an item is encoded it still plays, but
          as one progressive download of the whole file -- no ladder and no
          encryption. Streaming is a deliberate step, not automatic on upload,
          because a long encode should start when you decide it should. */}
      {videoItems.length ? (
        <>
          <div style={{ margin: "34px 0 12px", height: 1, background: "#1a1a1a" }} />
          <h3 style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#6d6d6d", marginBottom: 14 }}>
            Video · {videoItems.length}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {videoItems.map((it) => {
              const st = it.job?.status;
              const live = LIVE_JOB_STATES.has(st);
              const badge = it.streamable
                ? { text: "streaming", color: "#4ade80" }
                : st === "processing" ? { text: "encoding", color: "#00ffff" }
                : st === "pending"    ? { text: "queued",   color: "#8a8a8a" }
                : st === "failed"     ? { text: "failed",   color: "#ff6b6b" }
                : { text: "direct file", color: "#b0893a" };
              const secs = it.manifest?.durationSeconds ?? it.duration_seconds;
              return (
                <div key={it.id} style={{
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  padding: "12px 14px", background: "#0c0c0c",
                  border: "1px solid #1c1c1c", borderRadius: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8" }}>{it.title}</div>
                    <div style={{ fontSize: 11, color: "#5a5a5a", marginTop: 3 }}>
                      {it.slug}
                      {secs ? ` · ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}` : ""}
                      {it.manifest?.bitrates?.length ? ` · ${it.manifest.bitrates.length} rungs` : ""}
                    </div>
                    {st === "failed" && it.job?.error ? (
                      <div style={{ fontSize: 11, color: "#ff6b6b", marginTop: 5, lineHeight: 1.5 }}>
                        {it.job.failureCategory}: {it.job.error}
                      </div>
                    ) : null}
                  </div>
                  <span style={{
                    fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
                    padding: "4px 10px", borderRadius: 999,
                    color: badge.color, border: `1px solid ${badge.color}59`,
                  }}>{badge.text}</span>
                  {live ? null : (
                    <button type="button" disabled={requeuing === it.slug}
                      onClick={() => queueVideo(it.slug)}
                      style={{
                        padding: "7px 13px", borderRadius: 9,
                        cursor: requeuing === it.slug ? "default" : "pointer",
                        border: "1px solid #2a2a2a", background: "transparent",
                        color: "#9a9a9a", fontSize: 11, letterSpacing: 1,
                      }}>
                      {requeuing === it.slug ? "…" : it.streamable ? "RE-ENCODE" : "MAKE STREAMABLE"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <input ref={artInputRef} type="file" accept={ITEM_COVER_ACCEPT}
        onChange={uploadArt} style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: "#444" }}>Nothing here yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((it, index) => {
            const isEditing = editing?.id === it.id;
            const busyRow = rowBusy === it.id;
            return (
              <div key={it.id} style={{
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                padding: "12px 14px", background: "#0c0c0c",
                border: `1px solid ${isEditing ? "rgba(0,255,255,0.35)" : "#1c1c1c"}`,
                borderRadius: 12,
                opacity: busyRow ? 0.6 : 1,
              }}>
                {/* Order controls. The chamber lists a section by sort_order,
                    so this is the order people actually see. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {[["▲", -1, index === 0], ["▼", 1, index === items.length - 1]].map(
                    ([glyph, dir, disabled]) => (
                      <button key={glyph} type="button" disabled={disabled || busyRow}
                        onClick={() => move(index, dir)}
                        aria-label={dir === -1 ? `Move ${it.title} up` : `Move ${it.title} down`}
                        style={{
                          width: 22, height: 18, padding: 0, borderRadius: 5,
                          border: "1px solid #242424", background: "transparent",
                          color: disabled ? "#333" : "#8a8a8a", fontSize: 9,
                          cursor: disabled || busyRow ? "default" : "pointer", lineHeight: 1,
                        }}>{glyph}</button>
                    )
                  )}
                </div>

                {isEditing ? (
                  <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
                    <input style={{ ...FIELD, padding: "8px 10px" }} value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      aria-label="Title" placeholder="Title" />
                    <textarea style={{ ...FIELD, padding: "8px 10px", minHeight: 56, resize: "vertical" }}
                      value={editing.description}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                      aria-label="Description" placeholder="Description" />
                    <select style={{ ...FIELD, padding: "8px 10px" }} value={editing.accessTier}
                      onChange={(e) => setEditing({ ...editing, accessTier: e.target.value })}
                      aria-label="Access tier">
                      {ACCESS_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {/* Neither can be edited: both are baked into the object
                        key in storage, so changing one here would point the
                        row at a file that has moved. */}
                    <p style={{ fontSize: 10, color: "#4a4a4a", margin: 0, lineHeight: 1.5 }}>
                      {it.slug} · {it.category} — re-upload to change either
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={saveEdit} disabled={busyRow}
                        style={{
                          padding: "7px 14px", borderRadius: 9, cursor: "pointer",
                          border: "1px solid rgba(0,255,255,0.35)",
                          background: "rgba(0,255,255,0.09)", color: "#00ffff",
                          fontSize: 11, letterSpacing: 1, fontWeight: 700,
                        }}>SAVE</button>
                      <button type="button" onClick={() => setEditing(null)} disabled={busyRow}
                        style={{
                          padding: "7px 14px", borderRadius: 9, cursor: "pointer",
                          border: "1px solid #2a2a2a", background: "transparent",
                          color: "#8a8a8a", fontSize: 11, letterSpacing: 1,
                        }}>CANCEL</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* The card art this item shows in the chamber. Without
                        one its card is a title on an empty cell, so the state
                        is worth seeing at a glance in the list. */}
                    <button type="button" onClick={() => pickArt(it)} disabled={busyRow}
                      aria-label={it.cover_url ? `Replace art for ${it.title}` : `Add art for ${it.title}`}
                      style={{
                        width: 54, height: 34, flexShrink: 0, padding: 0,
                        borderRadius: 7, overflow: "hidden", cursor: busyRow ? "default" : "pointer",
                        border: `1px solid ${it.cover_url ? "rgba(0,255,255,0.3)" : "#262626"}`,
                        background: "#0a0a0a", color: it.cover_url ? "#00ffff" : "#4a4a4a",
                        fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                      }}>
                      {it.cover_url ? "art ✓" : "+ art"}
                    </button>

                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8" }}>{it.title}</div>
                      <div style={{ fontSize: 11, color: "#5a5a5a", marginTop: 3 }}>
                        {it.media_type} · {it.access_tier} · {it.slug}
                        {it.cover_url ? (
                          <>
                            {" · "}
                            <button type="button" onClick={() => clearArt(it)} disabled={busyRow}
                              style={{
                                padding: 0, border: "none", background: "none", cursor: "pointer",
                                color: "#6a5a5a", fontSize: 11, textDecoration: "underline",
                              }}>clear art</button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
                      padding: "4px 10px", borderRadius: 999,
                      color: it.visibility === "published" ? "#4ade80" : "#b0893a",
                      border: `1px solid ${it.visibility === "published" ? "rgba(74,222,128,0.35)" : "rgba(176,137,58,0.35)"}`,
                    }}>{it.visibility}</span>

                    <button type="button" disabled={busyRow}
                      onClick={() => setVisibility(it.id, it.visibility === "published" ? "draft" : "published")}
                      style={{
                        padding: "7px 13px", borderRadius: 9, cursor: "pointer",
                        border: "1px solid #2a2a2a", background: "transparent",
                        color: "#9a9a9a", fontSize: 11, letterSpacing: 1,
                      }}>
                      {it.visibility === "published" ? "UNPUBLISH" : "PUBLISH"}
                    </button>

                    <button type="button" onClick={() => startEdit(it)} disabled={busyRow}
                      style={{
                        padding: "7px 13px", borderRadius: 9, cursor: "pointer",
                        border: "1px solid #2a2a2a", background: "transparent",
                        color: "#9a9a9a", fontSize: 11, letterSpacing: 1,
                      }}>EDIT</button>

                    {confirmDelete === it.id ? (
                      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#ff6b6b", letterSpacing: 0.5 }}>
                          Delete for good?
                        </span>
                        <button type="button" onClick={() => removeItem(it.id)} disabled={busyRow}
                          style={{
                            padding: "7px 11px", borderRadius: 9, cursor: "pointer",
                            border: "1px solid rgba(255,107,107,0.5)",
                            background: "rgba(255,107,107,0.12)", color: "#ff8a8a",
                            fontSize: 11, letterSpacing: 1, fontWeight: 700,
                          }}>{busyRow ? "…" : "YES"}</button>
                        <button type="button" onClick={() => setConfirmDelete(null)} disabled={busyRow}
                          style={{
                            padding: "7px 11px", borderRadius: 9, cursor: "pointer",
                            border: "1px solid #2a2a2a", background: "transparent",
                            color: "#8a8a8a", fontSize: 11, letterSpacing: 1,
                          }}>NO</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(it.id)} disabled={busyRow}
                        style={{
                          padding: "7px 13px", borderRadius: 9, cursor: "pointer",
                          border: "1px solid #2a2a2a", background: "transparent",
                          color: "#7a5a5a", fontSize: 11, letterSpacing: 1,
                        }}>DELETE</button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

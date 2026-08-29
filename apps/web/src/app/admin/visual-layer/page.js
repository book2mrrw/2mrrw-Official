"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";
import { SUPABASE_URL } from "@/lib/supabase/supabase-url";
import {
  VISUAL_ASSET_TYPES,
  VISUAL_PLAYBACK_MODES,
  VISUAL_INTERACTIONS,
  VISUAL_ENTITLEMENT_TIERS,
  ASSET_TYPE_LABELS,
  PLAYBACK_MODE_LABELS,
  INTERACTION_LABELS,
  ENTITLEMENT_LABELS,
} from "@/lib/media/visual-asset-schema";
import { invalidateVisualAssetsCache } from "@/hooks/useVisualAssets";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "book2mrrw@gmail.com").toLowerCase();
function isAdmin(session) {
  return (session?.user?.email?.toLowerCase() || "") === ADMIN_EMAIL;
}

const BLANK_FORM = {
  release_slug:     "",
  track_slug:       "",
  asset_type:       "animated_cover",
  playback_mode:    "synced",
  interaction:      "hold",
  sync_offset:      "0",
  entitlement:      "public",
  r2_key:           "",
  hls_slug:         "",
  poster_r2_key:    "",
  thumbnail_url:    "",
  duration_seconds: "",
  priority:         "0",
  active:           true,
  publish_at:       "",
  expires_at:       "",
  title:            "",
  description:      "",
};

export default function AdminVisualLayerPage() {
  const router = useRouter();
  const [checked, setChecked]       = useState(false);
  const [session, setSession]       = useState(null);
  const [slug,    setSlug]          = useState("");
  const [assets,  setAssets]        = useState([]);
  const [loading, setLoading]       = useState(false);
  const [message, setMessage]       = useState(null);
  const [editing, setEditing]       = useState(null);   // null = create, obj = edit existing
  const [form,    setForm]          = useState(BLANK_FORM);
  const [saving,  setSaving]        = useState(false);
  const [deleting, setDeleting]     = useState(null);

  useEffect(() => {
    const sb = createBrowserClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY
    );
    sb.auth.getSession().then(({ data }) => {
      if (!isAdmin(data.session)) { router.replace("/"); return; }
      setSession(data.session);
      setChecked(true);
    });
  }, [router]);

  const fetchAssets = useCallback(async (releaseSlug) => {
    if (!releaseSlug) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/visual-assets?release_slug=${encodeURIComponent(releaseSlug)}`);
      const json = await res.json();
      if (!res.ok) { setMessage({ type: "error", text: json.error }); setAssets([]); }
      else setAssets(json.assets ?? []);
    } catch (e) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  function beginCreate() {
    setEditing(null);
    setForm({ ...BLANK_FORM, release_slug: slug });
  }

  function beginEdit(asset) {
    setEditing(asset);
    setForm({
      release_slug:     asset.release_slug     ?? "",
      track_slug:       asset.track_slug       ?? "",
      asset_type:       asset.asset_type       ?? "animated_cover",
      playback_mode:    asset.playback_mode    ?? "synced",
      interaction:      asset.interaction      ?? "hold",
      sync_offset:      String(asset.sync_offset ?? "0"),
      entitlement:      asset.entitlement      ?? "public",
      r2_key:           asset.r2_key           ?? "",
      hls_slug:         asset.hls_slug         ?? "",
      poster_r2_key:    asset.poster_r2_key    ?? "",
      thumbnail_url:    asset.thumbnail_url    ?? "",
      duration_seconds: String(asset.duration_seconds ?? ""),
      priority:         String(asset.priority  ?? "0"),
      active:           asset.active           ?? true,
      publish_at:       asset.publish_at?.slice(0,16) ?? "",
      expires_at:       asset.expires_at?.slice(0,16) ?? "",
      title:            asset.title            ?? "",
      description:      asset.description      ?? "",
    });
  }

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        release_slug:     form.release_slug.trim()   || undefined,
        track_slug:       form.track_slug.trim()     || null,
        asset_type:       form.asset_type,
        playback_mode:    form.playback_mode,
        interaction:      form.interaction,
        sync_offset:      parseFloat(form.sync_offset) || 0,
        entitlement:      form.entitlement,
        r2_key:           form.r2_key.trim()         || null,
        hls_slug:         form.hls_slug.trim()       || null,
        poster_r2_key:    form.poster_r2_key.trim()  || null,
        thumbnail_url:    form.thumbnail_url.trim()  || null,
        duration_seconds: form.duration_seconds ? parseFloat(form.duration_seconds) : null,
        priority:         parseInt(form.priority, 10) || 0,
        active:           form.active,
        publish_at:       form.publish_at ? new Date(form.publish_at).toISOString() : null,
        expires_at:       form.expires_at ? new Date(form.expires_at).toISOString() : null,
        title:            form.title.trim()          || null,
        description:      form.description.trim()    || null,
      };

      let res, json;
      if (editing) {
        res  = await fetch(`/api/admin/visual-assets?id=${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        json = await res.json();
      } else {
        res  = await fetch(`/api/admin/visual-assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        json = await res.json();
      }

      if (!res.ok) { setMessage({ type: "error", text: json.error }); return; }
      setMessage({ type: "ok", text: editing ? "Asset updated." : "Asset created." });
      invalidateVisualAssetsCache(form.release_slug.trim());
      await fetchAssets(slug);
      setEditing(null);
      setForm({ ...BLANK_FORM, release_slug: slug });
    } catch (ex) {
      setMessage({ type: "error", text: ex.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(asset) {
    if (!confirm(`Delete asset "${asset.asset_type}" (${asset.id.slice(0,8)}…)?`)) return;
    setDeleting(asset.id);
    try {
      const res  = await fetch(`/api/admin/visual-assets?id=${asset.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) { setMessage({ type: "error", text: json.error }); return; }
      invalidateVisualAssetsCache(slug);
      await fetchAssets(slug);
      setMessage({ type: "ok", text: "Deleted." });
    } finally {
      setDeleting(null);
    }
  }

  if (!checked) return <div style={s.page}><div style={s.spinner} /></div>;

  return (
    <div style={s.page}>
      <div style={s.shell}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.logo}>2MRRW</span>
          <span style={s.title}>Visual Layer</span>
          <span style={s.sub}>Release Visual Asset Manager</span>
        </div>

        {message && (
          <div style={{ ...s.msg, background: message.type === "error" ? "#3a0000" : "#003a1a", borderColor: message.type === "error" ? "#ff4444" : "#00cc77" }}>
            {message.text}
          </div>
        )}

        {/* Release slug lookup */}
        <div style={s.row}>
          <input
            style={s.input}
            placeholder="Release slug (e.g. love-hz-vol-1)"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetchAssets(slug)}
          />
          <button style={s.btn} onClick={() => fetchAssets(slug)} disabled={!slug || loading}>
            {loading ? "Loading…" : "Load Assets"}
          </button>
          <button style={{ ...s.btn, background: "#0a2a1a" }} onClick={beginCreate} disabled={!slug}>
            + New Asset
          </button>
        </div>

        {/* Asset list */}
        {assets.length > 0 && (
          <div style={s.table}>
            <div style={s.thead}>
              {["Type","Mode","Interaction","Entitlement","Priority","Active","R2 Key","Actions"].map(h => (
                <div key={h} style={s.th}>{h}</div>
              ))}
            </div>
            {assets.map(a => (
              <div key={a.id} style={s.trow}>
                <div style={s.td}>{ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}</div>
                <div style={s.td}>{PLAYBACK_MODE_LABELS[a.playback_mode] ?? a.playback_mode}</div>
                <div style={s.td}>{INTERACTION_LABELS[a.interaction]   ?? a.interaction}</div>
                <div style={s.td}>{ENTITLEMENT_LABELS[a.entitlement]   ?? a.entitlement}</div>
                <div style={s.td}>{a.priority}</div>
                <div style={s.td}><span style={{ color: a.active ? "#00cc77" : "#888" }}>{a.active ? "Yes" : "No"}</span></div>
                <div style={{ ...s.td, fontSize: 10, wordBreak: "break-all", maxWidth: 180 }}>{a.r2_key || a.hls_slug || "—"}</div>
                <div style={{ ...s.td, gap: 6, display: "flex" }}>
                  <button style={s.editBtn} onClick={() => beginEdit(a)}>Edit</button>
                  <button style={s.delBtn} onClick={() => handleDelete(a)} disabled={deleting === a.id}>
                    {deleting === a.id ? "…" : "Del"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {slug && assets.length === 0 && !loading && (
          <div style={{ color: "#555", fontSize: 13, padding: "20px 0" }}>No visual assets for this release yet.</div>
        )}

        {/* Form */}
        {(editing !== undefined || form.release_slug) && slug && (
          <form onSubmit={handleSave} style={s.form}>
            <div style={s.formTitle}>{editing ? "Edit Asset" : "New Visual Asset"}</div>
            <div style={s.grid}>
              <FormField label="Release Slug *"   value={form.release_slug}  onChange={v => setField("release_slug",  v)} />
              <FormField label="Track Slug"        value={form.track_slug}    onChange={v => setField("track_slug",    v)} placeholder="optional" />
              <FormSelect label="Asset Type *"     value={form.asset_type}    onChange={v => setField("asset_type",    v)} options={VISUAL_ASSET_TYPES.map(t => ({ value: t, label: ASSET_TYPE_LABELS[t] ?? t }))} />
              <FormSelect label="Playback Mode"    value={form.playback_mode} onChange={v => setField("playback_mode", v)} options={VISUAL_PLAYBACK_MODES.map(t => ({ value: t, label: PLAYBACK_MODE_LABELS[t] ?? t }))} />
              <FormSelect label="Interaction"      value={form.interaction}   onChange={v => setField("interaction",   v)} options={VISUAL_INTERACTIONS.map(t => ({ value: t, label: INTERACTION_LABELS[t] ?? t }))} />
              <FormField label="Sync Offset (s)"  value={form.sync_offset}   onChange={v => setField("sync_offset",   v)} placeholder="0" type="number" />
              <FormSelect label="Entitlement"      value={form.entitlement}   onChange={v => setField("entitlement",   v)} options={VISUAL_ENTITLEMENT_TIERS.map(t => ({ value: t, label: ENTITLEMENT_LABELS[t] ?? t }))} />
              <FormField label="R2 Key"            value={form.r2_key}        onChange={v => setField("r2_key",        v)} placeholder="path/in/r2/file.mp4" />
              <FormField label="HLS Slug"          value={form.hls_slug}      onChange={v => setField("hls_slug",      v)} placeholder="optional" />
              <FormField label="Poster R2 Key"     value={form.poster_r2_key} onChange={v => setField("poster_r2_key", v)} placeholder="path/to/poster.jpg" />
              <FormField label="Thumbnail URL"     value={form.thumbnail_url} onChange={v => setField("thumbnail_url", v)} placeholder="https://…" />
              <FormField label="Duration (s)"      value={form.duration_seconds} onChange={v => setField("duration_seconds", v)} type="number" />
              <FormField label="Priority"          value={form.priority}      onChange={v => setField("priority",      v)} type="number" />
              <FormField label="Title"             value={form.title}         onChange={v => setField("title",         v)} />
              <FormField label="Description"       value={form.description}   onChange={v => setField("description",   v)} />
              <FormField label="Publish At"        value={form.publish_at}    onChange={v => setField("publish_at",    v)} type="datetime-local" />
              <FormField label="Expires At"        value={form.expires_at}    onChange={v => setField("expires_at",    v)} type="datetime-local" />
              <div style={s.checkRow}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#aaa", cursor: "pointer" }}>
                  <input type="checkbox" checked={form.active} onChange={e => setField("active", e.target.checked)} style={{ width: 14, height: 14 }} />
                  Active
                </label>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button type="submit" style={s.btn} disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Asset"}</button>
              <button type="button" style={{ ...s.btn, background: "#111" }} onClick={() => { setEditing(undefined); setForm({ ...BLANK_FORM, release_slug: slug }); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label style={s.label}>
      <span style={s.labelText}>{label}</span>
      <input
        style={s.input}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        step={type === "number" ? "any" : undefined}
      />
    </label>
  );
}

function FormSelect({ label, value, onChange, options }) {
  return (
    <label style={s.label}>
      <span style={s.labelText}>{label}</span>
      <select style={s.input} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const s = {
  page:      { minHeight: "100vh", background: "#050505", display: "flex", justifyContent: "center", padding: "40px 16px", fontFamily: "'DM Mono',monospace,system-ui", color: "white" },
  shell:     { width: "100%", maxWidth: 900 },
  header:    { display: "flex", alignItems: "baseline", gap: 14, marginBottom: 28, borderBottom: "1px solid #1a1a1a", paddingBottom: 16 },
  logo:      { fontSize: 11, letterSpacing: "0.2em", color: "#555", textTransform: "uppercase" },
  title:     { fontSize: 18, fontWeight: 700, letterSpacing: "0.05em" },
  sub:       { fontSize: 11, color: "#555", marginLeft: "auto" },
  row:       { display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" },
  input:     { background: "#111", border: "1px solid #2a2a2a", borderRadius: 6, color: "white", padding: "8px 12px", fontSize: 12, width: "100%", boxSizing: "border-box", fontFamily: "inherit" },
  btn:       { padding: "8px 18px", background: "#0a3a2a", color: "white", border: "1px solid #1a5a3a", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", whiteSpace: "nowrap" },
  editBtn:   { padding: "4px 10px", background: "#0a2a3a", color: "#00aaff", border: "1px solid #1a4a5a", borderRadius: 4, cursor: "pointer", fontSize: 10, fontWeight: 600 },
  delBtn:    { padding: "4px 10px", background: "#2a0a0a", color: "#ff4444", border: "1px solid #5a1a1a", borderRadius: 4, cursor: "pointer", fontSize: 10, fontWeight: 600 },
  msg:       { padding: "10px 14px", borderRadius: 6, border: "1px solid", fontSize: 12, marginBottom: 16 },
  table:     { width: "100%", marginBottom: 24, overflowX: "auto" },
  thead:     { display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 60px 60px 1.8fr 100px", gap: 4, padding: "6px 8px", background: "#111", borderRadius: "6px 6px 0 0", borderBottom: "1px solid #222" },
  trow:      { display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 60px 60px 1.8fr 100px", gap: 4, padding: "8px 8px", borderBottom: "1px solid #141414", alignItems: "center" },
  th:        { fontSize: 9, letterSpacing: "0.1em", color: "#555", textTransform: "uppercase" },
  td:        { fontSize: 11, color: "#ccc", wordBreak: "break-all" },
  form:      { background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8, padding: 24, marginTop: 24 },
  formTitle: { fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 18, color: "#00cc77" },
  grid:      { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" },
  label:     { display: "flex", flexDirection: "column", gap: 4 },
  labelText: { fontSize: 9, letterSpacing: "0.12em", color: "#666", textTransform: "uppercase" },
  checkRow:  { gridColumn: "1/-1", marginTop: 4 },
  spinner:   { width: 32, height: 32, border: "3px solid #1a1a1a", borderTop: "3px solid #00ff99", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "40vh auto" },
};

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAdminGate } from "@/hooks/useAdminGate";

export default function AdminShowsPage() {
  const gate = useAdminGate();

  if (gate !== "ok") return <div style={s.page}><div style={s.spinner} /></div>;
  return <ShowsManager />;
}

function ShowsManager() {
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const blank = { name:"", location:"", event_date:"", event_time:"", price_cents:"", tickets_available:"", active:true };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/shows");
      const data = await res.json();
      setShows(data.shows || []);
    } catch { setShows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (msg, isErr = false) => {
    if (isErr) setError(msg); else setSuccess(msg);
    setTimeout(() => { setError(null); setSuccess(null); }, 4000);
  };

  const openCreate = () => { setForm(blank); setEditingId(null); setShowForm(true); };
  const openEdit = (show) => {
    setForm({
      name: show.name,
      location: show.location,
      event_date: show.event_date,
      event_time: show.event_time || "",
      price_cents: String(show.price_cents),
      tickets_available: show.tickets_available != null ? String(show.tickets_available) : "",
      active: show.active,
    });
    setEditingId(show.id);
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        price_cents: Number(form.price_cents) || 0,
        tickets_available: form.tickets_available === "" ? null : Number(form.tickets_available),
      };
      let res;
      if (editingId) {
        res = await fetch("/api/admin/shows", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id: editingId, ...payload }) });
      } else {
        res = await fetch("/api/admin/shows", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      }
      const data = await res.json();
      if (!res.ok) { flash(data.error || "Save failed", true); return; }
      flash(editingId ? "Show updated" : "Show created");
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (err) { flash(err.message || "Error", true); }
    finally { setSaving(false); }
  };

  const handleToggleActive = async (show) => {
    try {
      const res = await fetch("/api/admin/shows", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id: show.id, active: !show.active }) });
      if (!res.ok) { flash("Update failed", true); return; }
      flash(show.active ? "Show hidden" : "Show made active");
      await load();
    } catch { flash("Error", true); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Deactivate this show? It will be hidden from fans.")) return;
    try {
      const res = await fetch("/api/admin/shows", { method:"DELETE", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id }) });
      if (!res.ok) { flash("Delete failed", true); return; }
      flash("Show deactivated");
      await load();
    } catch { flash("Error", true); }
  };

  const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}) : "—";
  const fmtPrice = (cents) => cents ? `$${(cents/100).toFixed(2)}` : "—";
  const isPast = (d) => d && new Date(d) < new Date(new Date().toISOString().slice(0,10));

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logo}>2MRRW</div>
          <div style={s.title}>Shows & Events</div>
          <div style={s.sub}>Create and manage live show listings. Tickets are sold via Stripe.</div>
        </div>

        {error   && <div style={s.errorBox}>{error}</div>}
        {success && <div style={s.successBox}>{success}</div>}

        <div style={s.toolbar}>
          <button style={s.createBtn} onClick={openCreate}>+ New Show</button>
        </div>

        {showForm && (
          <form onSubmit={handleSave} style={s.form}>
            <div style={s.formTitle}>{editingId ? "Edit Show" : "New Show"}</div>
            <div style={s.fieldRow}>
              <label style={s.label}>
                Show Name <span style={s.req}>*</span>
                <input style={s.input} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="2MRRW Live – Dallas" required />
              </label>
              <label style={s.label}>
                Location <span style={s.req}>*</span>
                <input style={s.input} value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Dallas, TX" required />
              </label>
            </div>
            <div style={s.fieldRow}>
              <label style={s.label}>
                Date <span style={s.req}>*</span>
                <input style={s.input} type="date" value={form.event_date} onChange={e=>setForm(f=>({...f,event_date:e.target.value}))} required />
              </label>
              <label style={s.label}>
                Time
                <input style={s.input} value={form.event_time} onChange={e=>setForm(f=>({...f,event_time:e.target.value}))} placeholder="8:00 PM" />
              </label>
            </div>
            <div style={s.fieldRow}>
              <label style={s.label}>
                Ticket Price (USD) <span style={s.req}>*</span>
                <input style={s.input} type="number" min="0.50" step="0.01" value={form.price_cents ? (Number(form.price_cents)/100).toFixed(2) : ""} onChange={e=>setForm(f=>({...f,price_cents:String(Math.round(parseFloat(e.target.value||0)*100))}))} placeholder="25.00" required />
              </label>
              <label style={s.label}>
                Tickets Available <span style={s.opt}>(leave blank for unlimited)</span>
                <input style={s.input} type="number" min="0" step="1" value={form.tickets_available} onChange={e=>setForm(f=>({...f,tickets_available:e.target.value}))} placeholder="50" />
              </label>
            </div>
            <label style={{...s.label, flexDirection:"row", alignItems:"center", gap:10, cursor:"pointer"}}>
              <input type="checkbox" checked={form.active} onChange={e=>setForm(f=>({...f,active:e.target.checked}))} />
              <span>Active (visible to fans)</span>
            </label>
            <div style={{display:"flex",gap:10,marginTop:4}}>
              <button type="submit" style={{...s.btn, opacity: saving ? 0.6 : 1}} disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Create Show"}</button>
              <button type="button" style={s.cancelBtn} onClick={()=>{setShowForm(false);setEditingId(null);}}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? (
          <div style={{textAlign:"center",padding:40}}><div style={s.spinner}/></div>
        ) : shows.length === 0 ? (
          <div style={{textAlign:"center",padding:40,color:"rgba(255,255,255,0.3)",fontSize:13}}>No shows yet — create your first one above.</div>
        ) : (
          <div style={s.showList}>
            {shows.map(show => (
              <div key={show.id} style={{...s.showRow, opacity: (!show.active || isPast(show.event_date)) ? 0.5 : 1}}>
                <div style={s.showInfo}>
                  <div style={s.showName}>{show.name}</div>
                  <div style={s.showMeta}>{show.location} · {fmtDate(show.event_date)}{show.event_time ? ` · ${show.event_time}` : ""}</div>
                  <div style={s.showMeta}>
                    {fmtPrice(show.price_cents)}
                    {show.tickets_available != null ? ` · ${show.tickets_available} tickets` : " · unlimited"}
                    {isPast(show.event_date) && <span style={{color:"#f59e0b",marginLeft:8}}>PAST</span>}
                    {!show.active && <span style={{color:"#ef4444",marginLeft:8}}>HIDDEN</span>}
                    {show.active && !isPast(show.event_date) && show.tickets_available === 0 && <span style={{color:"#ef4444",marginLeft:8}}>SOLD OUT</span>}
                  </div>
                </div>
                <div style={s.showActions}>
                  <button style={s.actionBtn} onClick={()=>openEdit(show)}>Edit</button>
                  <button style={{...s.actionBtn, color: show.active ? "#f59e0b" : "#22c55e"}} onClick={()=>handleToggleActive(show)}>{show.active ? "Hide" : "Show"}</button>
                  <button style={{...s.actionBtn, color:"#ef4444"}} onClick={()=>handleDelete(show.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={s.sqlNote}>
          <div style={s.sqlLabel}>Required Supabase SQL (run once)</div>
          <pre style={s.sqlBlock}>{SQL_SETUP}</pre>
        </div>
      </div>
    </div>
  );
}

const SQL_SETUP = `-- Run once in Supabase SQL editor before selling tickets:

CREATE TABLE IF NOT EXISTS ticket_purchases (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 text        NOT NULL,
  show_id                 uuid        NOT NULL REFERENCES shows_events(id),
  stripe_session_id       text,
  stripe_payment_intent_id text,
  email                   text,
  phone                   text,
  quantity                int         NOT NULL DEFAULT 1,
  price_cents             int         NOT NULL,
  status                  text        NOT NULL DEFAULT 'pending',
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_purchases_user_id ON ticket_purchases(user_id);
CREATE INDEX IF NOT EXISTS ticket_purchases_show_id ON ticket_purchases(show_id);`;

const s = {
  page: { minHeight:"100dvh", background:"#0a0a0a", display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"48px 16px 80px" },
  card: { width:"100%", maxWidth:740, background:"#111", borderRadius:18, border:"1px solid rgba(255,255,255,.08)", overflow:"hidden" },
  header: { padding:"32px 32px 24px", borderBottom:"1px solid rgba(255,255,255,.06)" },
  logo: { fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:".3em", color:"#9b5de5", marginBottom:10 },
  title: { fontFamily:"'Cormorant Garamond',serif", fontSize:28, fontWeight:500, color:"white", lineHeight:1.15, marginBottom:8 },
  sub: { fontSize:13, color:"rgba(255,255,255,.42)", lineHeight:1.6 },
  toolbar: { padding:"20px 32px 0", display:"flex", justifyContent:"flex-end" },
  createBtn: { background:"#9b5de5", border:"none", borderRadius:10, padding:"10px 20px", fontSize:12, fontWeight:700, fontFamily:"'DM Mono',monospace", letterSpacing:".1em", color:"white", cursor:"pointer" },
  form: { padding:"24px 32px", borderBottom:"1px solid rgba(255,255,255,.06)", display:"flex", flexDirection:"column", gap:16 },
  formTitle: { fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:".2em", color:"rgba(255,255,255,.4)", textTransform:"uppercase" },
  fieldRow: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 },
  label: { display:"flex", flexDirection:"column", gap:6, fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:".18em", color:"rgba(255,255,255,.5)" },
  req: { color:"#9b5de5" },
  opt: { color:"rgba(255,255,255,.25)", fontWeight:400 },
  input: { background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", borderRadius:10, padding:"11px 14px", fontSize:13, color:"white", fontFamily:"inherit", outline:"none" },
  btn: { background:"#9b5de5", border:"none", borderRadius:10, padding:"12px 24px", fontSize:12, fontWeight:700, fontFamily:"'DM Mono',monospace", letterSpacing:".1em", color:"white", cursor:"pointer" },
  cancelBtn: { background:"transparent", border:"1px solid rgba(255,255,255,.12)", borderRadius:10, padding:"12px 24px", fontSize:12, color:"rgba(255,255,255,.4)", cursor:"pointer" },
  showList: { padding:"0 32px 24px", display:"flex", flexDirection:"column", gap:10, marginTop:20 },
  showRow: { display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, padding:"14px 16px", background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", borderRadius:12 },
  showInfo: { flex:1, minWidth:0 },
  showName: { fontSize:14, fontWeight:700, color:"white", marginBottom:3 },
  showMeta: { fontSize:11, color:"rgba(255,255,255,.4)", letterSpacing:".05em" },
  showActions: { display:"flex", gap:8, flexShrink:0 },
  actionBtn: { background:"transparent", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, padding:"6px 12px", fontSize:11, color:"rgba(255,255,255,.5)", cursor:"pointer" },
  errorBox: { margin:"16px 32px 0", background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.25)", borderRadius:10, padding:"12px 14px", fontSize:13, color:"#ef4444" },
  successBox: { margin:"16px 32px 0", background:"rgba(34,197,94,.08)", border:"1px solid rgba(34,197,94,.25)", borderRadius:10, padding:"12px 14px", fontSize:13, color:"#22c55e" },
  sqlNote: { margin:"0 32px 32px", marginTop:24, borderTop:"1px solid rgba(255,255,255,.06)", paddingTop:20 },
  sqlLabel: { fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:".2em", color:"rgba(255,255,255,.3)", textTransform:"uppercase", marginBottom:10 },
  sqlBlock: { background:"rgba(0,0,0,.4)", border:"1px solid rgba(255,255,255,.07)", borderRadius:10, padding:"14px 16px", fontSize:11, color:"rgba(255,255,255,.5)", whiteSpace:"pre-wrap", overflowX:"auto", lineHeight:1.7, fontFamily:"'Courier New',monospace" },
  spinner: { width:24, height:24, border:"2px solid rgba(155,93,229,.2)", borderTop:"2px solid #9b5de5", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
};

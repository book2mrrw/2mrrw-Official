"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SESSION_TYPES, ACCESS_POLICIES, VISUAL_CUES } from "@/lib/broadcast/session-model";
import { mergeAdminSession } from "@/lib/broadcast/admin-state";
import styles from "./BroadcastConsole.module.css";

const label = (value) => value.replaceAll("_", " ").toLowerCase();
const musicTypes = new Set(["listening_session", "live_listening"]);
const setupStates = new Set(["DRAFT", "SCHEDULED", "PRE_SHOW"]);
async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...options });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || "Broadcast request failed"), { body, status: response.status });
  return body;
}

/** A controller only: no audio elements, playback providers, or personal queue imports. */
export default function BroadcastConsole() {
  const [library, setLibrary] = useState("current");
  const [filter, setFilter] = useState("all");
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [nextPage, setNextPage] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionCursor, setSessionCursor] = useState(null);
  const [session, setSession] = useState(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("listening_session");
  const [accessPolicy, setAccess] = useState("ADMIN");
  const [presentation, setPresentation] = useState({ showTitle: true, showArtwork: true, showTracklist: true });
  const [schedule, setSchedule] = useState("");
  const [cue, setCue] = useState("PRE_SHOW");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const mutation = useRef(false);
  const retry = useRef(null);
  const creation = useRef(null);
  const projectRequest = useRef(null);
  const activeId = useRef(null);

  const accept = useCallback((snapshot) => {
    if (!snapshot) return;
    setSessions((rows) => mergeAdminSession(rows, snapshot));
    if (activeId.current === snapshot.id) setSession((prior) => prior?.id === snapshot.id && prior.sequence > snapshot.sequence ? prior : snapshot);
  }, []);
  const selectSession = (snapshot) => { activeId.current = snapshot?.id || null; setSession(snapshot); retry.current = null; setCanRetry(false); setError(""); };

  const loadProjects = useCallback(async (selectedLibrary, page = 0) => {
    projectRequest.current?.abort();
    const controller = new AbortController(); projectRequest.current = controller;
    setLoadingProjects(true);
    try {
      const data = await request(`/api/admin/broadcast/projects?library=${selectedLibrary}&page=${page}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setProjects((previous) => page ? [...previous, ...data.projects] : data.projects); setNextPage(data.nextPage);
    } catch (e) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (!controller.signal.aborted) setLoadingProjects(false); }
  }, []);
  useEffect(() => { setProjects([]); setNextPage(null); void loadProjects(library); return () => projectRequest.current?.abort(); }, [library, loadProjects]);
  useEffect(() => {
    const controller = new AbortController();
    request("/api/admin/broadcast/sessions", { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) { setSessions((rows) => data.sessions.reduce(mergeAdminSession, rows)); setSessionCursor(data.nextCursor); }
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);
  const sessionId = session?.id;
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController(); let pending = false;
    const refresh = async () => {
      if (pending || mutation.current) return;
      pending = true;
      try { const data = await request(`/api/admin/broadcast/sessions/${sessionId}`, { signal: controller.signal }); if (!controller.signal.aborted) accept(data.session); }
      catch (e) { if (!controller.signal.aborted) setError(e.message); }
      finally { pending = false; }
    };
    const timer = setInterval(refresh, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [sessionId, accept]);

  const send = async (operation) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(""); setCanRetry(false); retry.current = operation;
    try {
      const data = await request(operation.url, { method: operation.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation.body) });
      retry.current = null;
      if (operation.method === "POST") { activeId.current = data.session.id; creation.current = null; }
      accept(data.session);
    } catch (e) {
      if (e.status && e.status < 500) retry.current = null;
      setCanRetry(Boolean(retry.current));
      if (e.body?.session) accept(e.body.session);
      setError(e.message);
    } finally { mutation.current = false; setBusy(false); }
  };
  const command = (commandType, payload = {}) => session && send({ url: `/api/admin/broadcast/sessions/${session.id}`, method: "PATCH",
    body: { commandId: crypto.randomUUID(), expectedSequence: session.sequence, type: commandType, payload } });
  const create = (event) => {
    event.preventDefault();
    const config = { title, type, accessPolicy, presentation,
      ...(musicTypes.has(type) && project ? { [project.kind === "release" ? "releaseId" : "productId"]: project.id } : {}) };
    const fingerprint = JSON.stringify(config);
    if (creation.current?.fingerprint !== fingerprint) creation.current = { fingerprint, sessionId: crypto.randomUUID() };
    void send({ url: "/api/admin/broadcast/sessions", method: "POST", body: { ...config, sessionId: creation.current.sessionId } });
  };
  const move = (index, offset) => {
    const ids = session.items.map((item) => item.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void command("REORDER_TRACKS", { itemIds: ids });
  };
  const ended = session?.state === "ENDED";
  const setup = setupStates.has(session?.state);
  const current = session?.items.find((item) => item.id === session.currentItemId);
  const selected = session ? projects.find((item) => item.id === (session.releaseId || session.productId)) : project;
  const artwork = session?.releaseId ? `/api/admin/broadcast/projects/release/${session.releaseId}/artwork`
    : session?.productId ? `/api/admin/broadcast/projects/product/${session.productId}/artwork` : selected?.artworkUrl;
  const locked = (item) => item.completed || (!setup && item.id === session?.currentItemId);

  return <main className={styles.page}>
    <header className={styles.header}><div><Link href="/admin">← Admin</Link><p className={styles.eyebrow}>2MRRW LIVE</p><h1>Broadcast</h1><p>Prepare a listening session. Keep the original project untouched.</p></div>
      {session && <button disabled={busy} onClick={() => selectSession(null)}>New session</button>}</header>
    {error && <div role="alert" className={styles.error}>{error} {canRetry && <button disabled={busy} onClick={() => send(retry.current)}>Retry same request</button>}</div>}
    <div className={styles.layout}>
      <aside className={styles.panel}><h2>Your sessions</h2>{sessions.length === 0 && <p>No sessions loaded.</p>}
        {sessions.map((row) => <button disabled={busy} className={styles.session} aria-pressed={session?.id === row.id} key={row.id} onClick={() => selectSession(row)}><strong>{row.title}</strong><small>{label(row.state)}</small></button>)}
        {sessionCursor && <button disabled={busy} onClick={async () => { try { const data = await request(`/api/admin/broadcast/sessions?before=${encodeURIComponent(sessionCursor)}`); setSessions((rows) => [...rows, ...data.sessions.filter((s) => !rows.some((r) => r.id === s.id))]); setSessionCursor(data.nextCursor); } catch (e) { setError(e.message); } }}>Load more sessions</button>}
      </aside>
      {!session ? <section className={styles.panel}>
        <h2>Create a session</h2><form onSubmit={create}><fieldset disabled={busy}>
          <div className={styles.fields}><label>Session title<input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Format<select value={type} onChange={(e) => setType(e.target.value)}>{SESSION_TYPES.map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label>
            <label>Audience<select value={accessPolicy} onChange={(e) => setAccess(e.target.value)}>{ACCESS_POLICIES.filter((value) => value !== "ENTRY").map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label></div>
          <div className={styles.actions}>{Object.keys(presentation).map((key) => <label key={key}><input type="checkbox" checked={presentation[key]} onChange={(e) => setPresentation({ ...presentation, [key]: e.target.checked })} />{key === "showTitle" ? "Show title" : key === "showArtwork" ? "Show artwork" : "Show tracklist"}</label>)}</div>
          {musicTypes.has(type) && <>
            <div className={styles.actions}>{["current", "unrelzd"].map((value) => <button type="button" aria-pressed={library === value} key={value} onClick={() => { setLibrary(value); setProject(null); }}>{value === "current" ? "Current releases" : "UNRELZD"}</button>)}
              <label>Release type<select value={filter} onChange={(e) => setFilter(e.target.value)}>{["all", "single", "feature", "album", "mixtape", "ep"].map((v) => <option value={v} key={v}>{label(v)}</option>)}</select></label></div>
            <div className={styles.grid}>{projects.filter((p) => filter === "all" || p.type === filter).map((p) => <button type="button" className={styles.project} aria-pressed={project?.id === p.id && project?.kind === p.kind} key={`${p.kind}:${p.id}`} onClick={() => setProject(p)}><Artwork url={p.artworkUrl} title={p.title} /><strong>{p.title}</strong><small>{p.status === "unrelzd" ? "UNRELZD · " : ""}{label(p.type)} · {p.trackCount} tracks</small></button>)}</div>
            {loadingProjects && <p role="status">Loading projects…</p>}{!loadingProjects && !projects.length && <p>No projects available in this library.</p>}
            {nextPage !== null && <button type="button" disabled={loadingProjects} onClick={() => loadProjects(library, nextPage)}>Load more projects</button>}
            {project && <p>Selected: <strong>{project.title}</strong> · {label(project.type)}</p>}
          </>}
          <button className={styles.primary} disabled={musicTypes.has(type) && !project} type="submit">{busy ? "Creating…" : "Create private draft"}</button>
        </fieldset></form>
      </section> : <section className={styles.panel}>
        <div className={styles.now}><Artwork url={artwork} title={session.title} /><div><p className={styles.eyebrow}>{label(session.state)}</p><h2>{session.title}</h2><p>{label(session.accessPolicy)} · {label(session.type)}</p><p>{current ? `Selected track: ${current.title || "Untitled track"}` : "No track cued"}</p></div></div>
        <p>Media checks confirm delivery only. Browser audio and live-video readiness require separate verification.</p>
        <fieldset disabled={busy || ended}><div className={styles.actions}>
          <button disabled={!setup} onClick={() => command("PREPARE_MEDIA")}>Prepare media</button>
          <button disabled={!setup} onClick={() => command("PRE_SHOW")}>Pre-show</button>
          <button disabled={!setup || (musicTypes.has(session.type) && !session.items.some((i) => i.prepared && !i.excluded))} onClick={() => command("GO_LIVE")}>Go live</button>
          <button disabled={setup || !current?.prepared || current.completed} onClick={() => command(session.isPlaying ? "PAUSE_TRACK" : "RESUME_TRACK")}>{session.isPlaying ? "Pause music" : "Start / resume music"}</button>
          <button disabled={setup} onClick={() => command("NEXT_TRACK")}>Next track</button>
          <button disabled={setup} onClick={() => command("START_COMMENTARY")}>Commentary</button>
          <button disabled={setup} onClick={() => command("INTERMISSION")}>Intermission</button>
          <button disabled={setup} onClick={() => command("SET_MIX", { musicGain: session.musicGain === 0.25 ? 1 : 0.25, videoPolicy: "muted" })}>{session.musicGain === 0.25 ? "Restore music level" : "Duck music"}</button>
          <button disabled={setup} onClick={() => command("FINALE")}>Finale</button>
          <button onClick={() => { if (window.confirm("End this Broadcast session? It cannot be restarted.")) void command("END_SESSION"); }}>End session</button>
        </div><div className={styles.fields}>
          <label>Schedule<input type="datetime-local" value={schedule} disabled={!setup} onChange={(e) => setSchedule(e.target.value)} /></label><button disabled={!setup || !schedule} onClick={() => command("SCHEDULE", { scheduledAt: new Date(schedule).getTime() })}>Schedule session</button>
          <label>Visual cue<select value={cue} onChange={(e) => setCue(e.target.value)}>{VISUAL_CUES.map((v) => <option value={v} key={v}>{label(v)}</option>)}</select></label><button onClick={() => command("VISUAL_CUE", { cue })}>Send cue</button>
        </div></fieldset>
        <h3>Session tracklist</h3><p>Reordering and exclusions apply only to this session.</p>
        <ol className={styles.tracks}>{session.items.map((item, index) => <li key={item.id} aria-current={item.id === session.currentItemId ? "true" : undefined}><div><strong>{index + 1}. {item.title || "Untitled track"}</strong><small>{item.completed ? "Completed" : item.excluded ? "Excluded" : item.prepared ? "Delivery verified" : "Needs preparation"}</small></div><div className={styles.actions}>
          <button aria-label={`Move ${item.title || "track"} earlier`} disabled={busy || ended || index === 0 || locked(item) || locked(session.items[index - 1])} onClick={() => move(index, -1)}>↑</button>
          <button aria-label={`Move ${item.title || "track"} later`} disabled={busy || ended || index === session.items.length - 1 || locked(item) || locked(session.items[index + 1])} onClick={() => move(index, 1)}>↓</button>
          <button disabled={busy || ended || item.completed || item.id === session.currentItemId} onClick={() => command("EXCLUDE_TRACK", { itemId: item.id, excluded: !item.excluded })}>{item.excluded ? "Include" : "Exclude"}</button>
          <button disabled={busy || ended || session.isPlaying || !item.prepared || item.excluded || item.completed} onClick={() => command("CUE_TRACK", { itemId: item.id })}>Cue</button>
        </div></li>)}</ol>
      </section>}
    </div>
  </main>;
}

function Artwork({ url, title }) {
  const [failed, setFailed] = useState(null);
  return url && failed !== url ? <img className={styles.artwork} src={url} alt={title || "Project artwork"} onError={() => setFailed(url)} />
    : <div className={styles.artwork} aria-label="No artwork">2MRRW</div>;
}

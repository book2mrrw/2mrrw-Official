"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { allocationResult, CREDIT_CATEGORIES, CREDIT_LABELS, editableCreditGroups } from '@/lib/credits/contract';

const control = { color: 'inherit', background: 'transparent', border: '1px solid currentColor', borderRadius: 5, padding: '8px', maxWidth: '100%' };

function ContributorRow({ entry, onChange, onRemove, onMove, index, count, allocations, directoryAvailable }) {
  const id = useId();
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!directoryAvailable || query.trim().length < 2) return;
    let active = true;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true); setError('');
      try {
        const response = await fetch(`/api/admin/contributors?q=${encodeURIComponent(query)}`, { signal: abort.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (active) setSuggestions(body.contributors);
      } catch (e) { if (active && e.name !== 'AbortError') setError(e.message); }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); abort.abort(); };
  }, [query, directoryAvailable]);
  const latest = useRef(null);
  useEffect(() => { latest.current = { entry, onChange }; return () => { latest.current = null; }; }, [entry, onChange]);
  const create = async () => {
    const requestedName = entry.name;
    setCreating(true); setError('');
    try {
      const response = await fetch('/api/admin/contributors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: entry.name }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const current = latest.current;
      if (!current || current.entry.name !== requestedName || current.entry.contributor_id) return;
      current.onChange({ ...current.entry, contributor_id: body.contributor.id, name: body.contributor.name });
      setQuery(''); setSuggestions([]);
    } catch (e) { setError(e.message); } finally { setCreating(false); }
  };
  return <div style={{ borderBottom: '1px solid #333', padding: '12px 0' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
      <label htmlFor={id} style={{ flex: '1 1 200px' }}>Contributor name
        <input id={id} style={{ ...control, display: 'block', width: '100%', boxSizing: 'border-box' }} value={entry.name || ''} onChange={e => { onChange({ ...entry, name: e.target.value }); setQuery(e.target.value); setSuggestions([]); }} />
      </label>
      {allocations ? <label htmlFor={`${id}-percent`}>Percentage
        <input id={`${id}-percent`} inputMode="decimal" style={{ ...control, display: 'block', width: 85 }} value={entry.percentage ?? ''} onChange={e => onChange({ ...entry, percentage: e.target.value })} />
      </label> : null}
      <button type="button" style={control} disabled={!index} aria-label={`Move contributor ${index + 1} up`} onClick={() => onMove(-1)}>Up</button>
      <button type="button" style={control} disabled={index === count - 1} aria-label={`Move contributor ${index + 1} down`} onClick={() => onMove(1)}>Down</button>
      <button type="button" style={control} onClick={onRemove}>Remove</button>
    </div>
    {entry.contributor_id ? <small>Linked contributor: {entry.contributor_id}. Name edits apply to this credit only.</small> : null}
    {entry.contributor_id ? <button type="button" style={control} onClick={() => onChange({ ...entry, contributor_id: null })}>Unlink identity</button> : null}
    {searching ? <p role="status">Searching contributors…</p> : null}
    {suggestions.length ? <ul aria-label="Contributor suggestions">{suggestions.map(person => <li key={person.id}><button type="button" style={control} onClick={() => { onChange({ ...entry, name: person.name, contributor_id: person.id }); setQuery(''); setSuggestions([]); }}>{person.name} · {person.id}</button></li>)}</ul> : null}
    {directoryAvailable && !entry.contributor_id && entry.name?.trim() ? <button type="button" style={control} disabled={creating} onClick={create}>{creating ? 'Creating…' : 'Create a new directory contributor with this name'}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

export default function CreditsEditor({ groups, onChange, directoryAvailable = false, disabled = false }) {
  const values = groups || editableCreditGroups(null);
  const update = (category, group) => onChange({ ...values, [category]: group });
  return <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    {!directoryAvailable ? <p role="status">Contributor search is unavailable. Saved names and identities are retained.</p> : null}
    {CREDIT_CATEGORIES.map(category => {
      const group = values[category] || { state: 'legacy', entries: [] };
      const entries = group.entries || [];
      const allocations = category !== 'featured_artist';
      const result = allocationResult(group, category);
      return <section key={category} style={{ marginBottom: 24 }}>
        <h3>{CREDIT_LABELS[category]}</h3>
        {allocations ? <label>Allocation status <select aria-label={`${CREDIT_LABELS[category]} allocation status`} style={control} value={group.state} onChange={e => update(category, { ...group, state: e.target.value })}>
          <option value="legacy">Names only / percentages unknown</option>
          <option value="draft">Incomplete allocation</option>
          <option value="complete">Complete allocation (100.00%)</option>
          {category === 'producer' ? <option value="not_applicable">No producer allocation applies</option> : null}
        </select></label> : null}
        {entries.map((entry, index) => <ContributorRow key={entry.row_id || entry.id || `${category}-${index}`} entry={entry} index={index} count={entries.length} allocations={allocations} directoryAvailable={directoryAvailable}
          onChange={next => update(category, { ...group, entries: entries.map((e, i) => i === index ? next : e) })}
          onRemove={() => update(category, { ...group, entries: entries.filter((_, i) => i !== index) })}
          onMove={delta => { const reordered = [...entries]; [reordered[index], reordered[index + delta]] = [reordered[index + delta], reordered[index]]; update(category, { ...group, entries: reordered }); }} />)}
        <button type="button" style={control} onClick={() => update(category, { ...group, entries: [...entries, { row_id: crypto.randomUUID(), name: '', percentage: '' }] })}>Add {category === 'songwriter' ? 'songwriter' : category === 'producer' ? 'producer' : 'featured artist'}</button>
        {allocations ? <p role="status">Total: {result.formattedTotal}% · {group.state === 'complete' ? result.valid ? 'Complete' : 'Needs correction' : group.state === 'not_applicable' ? 'Not applicable' : 'Not marked complete'}</p> : null}
        {result.errors.length ? <ul role="alert">{result.errors.map((error, i) => <li key={i}>{error}</li>)}</ul> : null}
      </section>;
    })}
  </fieldset>;
}

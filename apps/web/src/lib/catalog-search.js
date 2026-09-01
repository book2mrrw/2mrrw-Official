/**
 * Client-side catalog search — no external deps.
 * Works against the static module-level catalog arrays (singles, albums, mixtapesAndEps).
 * Scoring: exact > prefix > substring > fuzzy-ordered-chars.
 */

export function buildSearchIndex(singles, albums, mixtapesAndEps) {
  const items = [];

  for (const s of singles || []) {
    if (s?.title && s?.slug) {
      items.push({ type: "single", title: s.title, slug: s.slug, cover: s.cover, item: s });
    }
  }

  for (const a of [...(albums || []), ...(mixtapesAndEps || [])]) {
    if (!a?.title || !a?.slug) continue;
    items.push({ type: "album", title: a.title, slug: a.slug, cover: a.cover, item: a });
    for (const t of a?.tracks || []) {
      if (t?.title && (t?.slug || t?.trackSlug)) {
        items.push({
          type: "track",
          title: t.title,
          slug: t.slug || t.trackSlug,
          albumSlug: a.slug,
          albumTitle: a.title,
          cover: a.cover,
          item: t,
          album: a,
        });
      }
    }
  }

  return items;
}

function scoreMatch(text, q) {
  const t = (text || "").toLowerCase();
  const query = q.toLowerCase();
  if (!t || !query) return 0;
  if (t === query) return 100;
  if (t.startsWith(query)) return 80;
  if (t.includes(query)) return 50;
  // Fuzzy: all query chars present in order
  let pos = 0;
  let matched = 0;
  for (const ch of query) {
    const idx = t.indexOf(ch, pos);
    if (idx >= 0) { matched++; pos = idx + 1; }
  }
  return matched === query.length ? 20 : 0;
}

export function searchCatalog(index, query) {
  if (!query?.trim() || !index?.length) return [];
  const q = query.trim();
  const results = [];
  for (const entry of index) {
    const s = Math.max(
      scoreMatch(entry.title, q),
      scoreMatch(entry.albumTitle || "", q)
    );
    if (s > 0) results.push({ ...entry, _score: s });
  }
  // Stable sort: score desc, then by type (album before tracks), then title
  return results
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      const typeOrder = { single: 0, album: 1, track: 2 };
      if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
      return a.title.localeCompare(b.title);
    })
    .slice(0, 24);
}

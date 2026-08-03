const CREDIT_ROLE_MAP = {
  writer: "writtenBy",
  songwriter: "writtenBy",
  "written by": "writtenBy",
  producer: "producedBy",
  "produced by": "producedBy",
  featured: "featuredArtists",
  "featured artist": "featuredArtists",
  "featured artists": "featuredArtists",
  collaborator: "collaborators",
  collaborators: "collaborators",
  mixing: "mixingEngineer",
  "mixing engineer": "mixingEngineer",
  mastering: "masteringEngineer",
  "mastering engineer": "masteringEngineer",
  label: "recordLabel",
  "record label": "recordLabel",
};

const GLOBAL_CREDIT_DEFAULTS = {
  writtenBy: "Eellian Shakur Morrow",
  mixingEngineer: "AudioArkitech",
  masteringEngineer: "AudioArkitech",
  recordLabel: "Kastaweh Records",
};

/** @type {Record<string, string>} slug → producer */
const PRODUCED_BY_SLUG = {
  "hour-glass": "Sonswift",
  w2d: "Sonswift",
  "turnt-me-2-dis": "Sonswift",
  artificial: "Inglewood Jones",
};

/** @type {Record<string, string>} display title → producer */
const PRODUCED_BY_TITLE = {
  "Hour Glass": "Sonswift",
  "W.2.D": "Sonswift",
  "Turnt Me 2 Dis": "Sonswift",
  Artificial: "Inglewood Jones",
};

const CREDITS_ROWS = [
  { key: "writtenBy", label: "Written By" },
  { key: "producedBy", label: "Produced By" },
  { key: "featuredArtists", label: "Featured Artists" },
  { key: "collaborators", label: "Collaborators" },
  { key: "mixingEngineer", label: "Mixing Engineer" },
  { key: "masteringEngineer", label: "Mastering Engineer" },
  { key: "recordLabel", label: "Record Label" },
  { key: "releaseDate", label: "Release Date" },
];

const OPTIONAL_ROW_KEYS = new Set(["featuredArtists", "collaborators"]);

function pickField(obj, keys) {
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function creditsByRole(credits, roleKey) {
  if (!Array.isArray(credits)) return null;
  const names = credits
    .filter((c) => {
      const role = String(c?.role || "").toLowerCase().trim();
      return CREDIT_ROLE_MAP[role] === roleKey;
    })
    .map((c) => c?.name)
    .filter(Boolean);
  return names.length ? names.join(", ") : null;
}

function resolveTrackKey(release) {
  const slug = pickField(release, ["slug", "id"]);
  const title = pickField(release, ["title", "name"]);
  return { slug, title };
}

function mergeStaticCredits(fields, release) {
  const { slug, title } = resolveTrackKey(release);
  const merged = { ...fields };

  if (!merged.writtenBy) merged.writtenBy = GLOBAL_CREDIT_DEFAULTS.writtenBy;
  if (!merged.producedBy) {
    merged.producedBy =
      (slug && PRODUCED_BY_SLUG[slug]) ||
      (title && PRODUCED_BY_TITLE[title]) ||
      null;
  }
  if (!merged.mixingEngineer) merged.mixingEngineer = GLOBAL_CREDIT_DEFAULTS.mixingEngineer;
  if (!merged.masteringEngineer) merged.masteringEngineer = GLOBAL_CREDIT_DEFAULTS.masteringEngineer;
  if (!merged.recordLabel) merged.recordLabel = GLOBAL_CREDIT_DEFAULTS.recordLabel;

  return merged;
}

export function getReleaseEditorial(release) {
  const track = Array.isArray(release?.tracks) ? release.tracks[0] : null;
  const credits = Array.isArray(release?.credits) ? release.credits : [];
  const source = { ...release, ...(track || {}) };

  const fields = {
    writtenBy: pickField(source, ["writtenBy", "written_by"]),
    producedBy: pickField(source, ["producedBy", "produced_by"]),
    featuredArtists: pickField(source, ["featuredArtists", "featured_artists", "featuring", "featureLabel"]),
    collaborators: pickField(source, ["collaborators", "collaborator"]),
    mixingEngineer: pickField(source, ["mixingEngineer", "mixing_engineer", "mixedBy", "mixed_by"]),
    masteringEngineer: pickField(source, ["masteringEngineer", "mastering_engineer", "masteredBy", "mastered_by"]),
    recordLabel: pickField(source, ["recordLabel", "record_label", "label"]),
    releaseDate: pickField(release, ["releaseDate", "release_date", "date"]),
  };

  for (const [, key] of Object.entries(CREDIT_ROLE_MAP)) {
    if (!fields[key]) fields[key] = creditsByRole(credits, key);
  }

  const merged = mergeStaticCredits(fields, release);

  return {
    ...merged,
    genre: pickField(release, ["genre", "genreLabel", "genre_label"]) || "Unclassified",
  };
}

/** Rows with values only — no placeholders; optional rows omitted when empty. */
export function getCreditsDisplayRows(editorial) {
  return CREDITS_ROWS.filter(({ key }) => {
    if (OPTIONAL_ROW_KEYS.has(key) && !editorial[key]) return false;
    return Boolean(editorial[key]);
  }).map(({ key, label }) => ({
    key,
    label,
    value: editorial[key],
  }));
}

/** @deprecated Use getCreditsDisplayRows — kept for import stability */
export const EDITORIAL_ROWS = CREDITS_ROWS;

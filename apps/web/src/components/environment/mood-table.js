// Route/tab -> target visual parameters for the galaxy environment.
// Deliberately a small set of named presets, not a per-route table — see
// the plan doc for why (most of the app lives on a single "/" route whose
// content is switched by in-app tabs, not real navigation).

export const PRESETS = {
  // Home tab — the richest treatment.
  home: { starDensity: 1, nebulaIntensity: 1, speed: 1, hueBias: 0 },
  // Music/Vault tabs — deeper, slightly denser, more intimate pace.
  intimate: { starDensity: 1.15, nebulaIntensity: 0.85, speed: 0.75, hueBias: -8 },
  // Shop / collectors-cards — cleaner, more structured, less nebula motion.
  clean: { starDensity: 0.7, nebulaIntensity: 0.6, speed: 1, hueBias: 6 },
  // Everything else (login/admin/subscribe/etc.) — restrained default.
  // Currently invisible there too (the shell-opacity change is scoped to
  // the main app shell only), kept only so the target state is always
  // well-defined if that scope is ever extended.
  restrained: { starDensity: 0.6, nebulaIntensity: 0.5, speed: 0.9, hueBias: 0 },
};

// In-app tabs all live under the "/" route; HomeClient's switchTab()
// dispatches a "2mrrw:tab-changed" CustomEvent this module's caller
// listens for (see GalaxyEnvironment.js).
const TAB_PRESET_KEY = {
  home: "home",
  singles: "intimate",
  albums: "intimate",
  mixtapes: "intimate",
  mymusic: "intimate",
  vault: "intimate",
  shop: "clean",
};

export function resolveMood({ pathname, tabId }) {
  if (pathname === "/") {
    return PRESETS[TAB_PRESET_KEY[tabId]] || PRESETS.home;
  }
  if (pathname === "/collectors-cards") return PRESETS.clean;
  return PRESETS.restrained;
}
